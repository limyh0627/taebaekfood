import {expect,it} from 'vitest';
import {liveItemInventoryReservations,planOrderStockReservation,orderStockTouchedIds} from './orderStockReservationPlan';

it('서버 예약은 만료와 배정 및 원래 행과 추가 필드를 보존한다',()=>{
 const now=Date.parse('2026-01-01T02:00:00Z');
 const allocated={operationId:'a',orderId:'own',qty:3,createdAt:'2026-01-01T00:00:00Z',state:'allocated',extra:'keep'};
 const expired={...allocated,operationId:'b',state:'processing'};
 const future={...allocated,operationId:'c',state:'processing',createdAt:'2026-01-01T03:00:00Z'};
 const rows=[allocated,expired,future];const live=liveItemInventoryReservations(rows,now);
 expect(live).toEqual([allocated,future]);expect(live[0]).toBe(allocated);expect(rows).toEqual([allocated,expired,future]);
 const result=planOrderStockReservation('own',new Map([['x',{stock:10,inventoryReservations:[allocated]}]]),available=>{expect(available.get('x')).toBe(7);return new Map([['x',-2]]);},{preserveOwnAllocation:true,nowMs:now});
 expect(result.quantities.get('x')).toBe(5);expect(result.previousReservations.get('x')?.[0]).toBe(allocated);
});

it('서버 BOM 순회는 깊이 5까지 DFS하며 순환과 중복을 한 번만 방문한다',()=>{
 const edges:Record<string,string[]>={a:['b','d'],b:['c'],c:['e'],e:['f'],f:['g'],g:['h'],d:['c','a'],z:['d']};
 const bom={of:(id:string)=>(edges[id]??[]).map(childId=>({childId}))};
 expect(orderStockTouchedIds({items:[{itemId:'a'},{itemId:'z'},{itemId:'a'}]},bom)).toEqual(['a','b','c','e','f','g','d','z']);
});

it('서버 처리중 힌트는 유효한 행만 TTL 뒤에도 남기며 과거 행 정책을 유지한다',()=>{
 const now=Date.parse('2026-01-01T02:00:00Z');
 const row={operationId:'full',orderId:'a',qty:3,createdAt:'2026-01-01T00:00:00Z',state:'processing',serverProtocol:'full-v1',extra:'보존'};
 const legacy={...row,operationId:'legacy',serverProtocol:undefined};
 const wrong={...row,operationId:'wrong',serverProtocol:'other'};
 const invalid=[{...row,operationId:''},{...row,qty:0},{...row,createdAt:'invalid'}];
 // 빈 operationId는 기존 검사가 허용하므로 새로운 정책으로 강화하지 않는다.
 expect(liveItemInventoryReservations([row,legacy,wrong,...invalid],now)).toEqual([row,invalid[0]]);
 const plan=planOrderStockReservation('other',new Map([['x',{stock:10,inventoryReservations:[row,legacy]}]]),()=>new Map(),{nowMs:now});
 expect(plan.available.get('x')).toBe(7);expect(plan.activeByItem.get('x')).toEqual([row]);
 expect(liveItemInventoryReservations([{...row,state:'unknown'}],now)).toEqual([]);
});
