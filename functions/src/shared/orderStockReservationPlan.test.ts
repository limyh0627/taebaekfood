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
