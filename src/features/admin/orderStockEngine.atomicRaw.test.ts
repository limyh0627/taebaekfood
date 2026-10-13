// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from 'vitest';
import {createOrderStockEngine} from './orderStockEngine';
import {buildOrderProductionRecordPlan} from '../../shared/orderProductionRecordPlan';
import {rawPressText} from '../../shared/rawPressAttempt';
import {saveOrderRawBatchAttempt,orderRawBatchJobId,orderRawBatchAttemptKey} from '../../shared/orderRawBatchAttempt';
import {createHash} from 'node:crypto';
import {finalOrderInventoryRequestText} from '../../shared/orderInventoryGeneration';
import {claimOrderInventoryOperation} from '../../shared/services/firebaseService';
import {buildBomIndex} from '../../shared/bomIndex';
import {buildPackIndex} from '../../shared/packIndex';
import {executeRawInventoryCommand} from '../../shared/services/rawInventoryService';
import {emptyRawInventory,inventoryDocId} from '../../shared/rawInventoryCore';
import {OrderStatus,type Item,type Order} from '../../shared/types';
const mem=vi.hoisted(()=>({docs:new Map<string,any>(),calls:[] as string[],writes:vi.fn(),retireCall:vi.fn(),loseFinalOnce:false,failFinalOnce:false,swapPointerBeforeFinal:false,auth:{currentUser:{uid:'employee',getIdTokenResult:async()=>({claims:{employeeId:'employee',companyId:'taebaek'}})}}}));
vi.mock('firebase/functions',()=>({httpsCallable:()=>mem.retireCall}));
vi.mock('../../shared/firebase',()=>({auth:mem.auth,authReady:Promise.resolve(),db:{},functions:{}}));
vi.mock('firebase/firestore',()=>({doc:(_db:unknown,...parts:string[])=>({path:parts.join('/')}),getDoc:async(ref:any)=>({exists:()=>mem.docs.has(ref.path),data:()=>mem.docs.get(ref.path),id:ref.path.split('/').at(-1)}),runTransaction:async(_db:unknown,fn:any)=>{mem.calls.push('read-tx');const pending:any[]=[];const result=await fn({get:async(ref:any)=>{if(mem.swapPointerBeforeFinal&&ref.path==='orders/order'&&mem.docs.get(ref.path)?.inventoryOperation?.stage==='production-record'){mem.swapPointerBeforeFinal=false;mem.docs.get(ref.path).productionRecordIndex={changed:{recordId:'foreign'}};}return {exists:()=>mem.docs.has(ref.path),data:()=>mem.docs.get(ref.path),id:ref.path.split('/').at(-1)};},set:(ref:any,value:any)=>{mem.writes(ref,value);pending.push([ref.path,value]);},update:(ref:any,value:any)=>{mem.writes(ref,value);const updated=structuredClone(mem.docs.get(ref.path));for(const [key,val] of Object.entries(value)){const parts=key.split('.');let target=updated;for(const part of parts.slice(0,-1))target=target[part]??={};target[parts.at(-1)!]=val;}pending.push([ref.path,updated]);},delete:mem.writes});if(mem.failFinalOnce&&pending.some(([path,value])=>path.startsWith('orders/')&&value.inventoryGenerationCompletion)){mem.failFinalOnce=false;throw Error('final rejected');}for(const [path,value] of pending)mem.docs.set(path,value);if(mem.loseFinalOnce&&pending.some(([path,value])=>path.startsWith('orders/')&&value.inventoryGenerationCompletion)){mem.loseFinalOnce=false;throw Error('final unknown');}return result;}}));
function fixture(quantities=[1,1],rawKg=1,secondRaw=false,successful=false,overrideClaim?:any){
 const items=[{id:'product',companyId:'taebaek',name:'기름',type:'product',unit:'개',stock:0,spec:'1L'},{id:'raw',companyId:'taebaek',name:'참깨',rawMaterialName:'참깨',type:'raw',subtype:'벌크',unit:'kg',stock:rawKg},{id:'bottle',companyId:'taebaek',name:'병',type:'submaterial',unit:'개',stock:20}] as Item[];
 if(secondRaw)items.push({...items[1],id:'raw2',name:'들깨',rawMaterialName:'들깨',stock:0,lots:[]});
 const order={id:'order',companyId:'taebaek',partnerName:'합성',status:OrderStatus.PENDING,deliveredAt:'2026-10-12',items:quantities.map((quantity,index)=>({itemId:'product',lineId:'line-'+index,quantity,name:'기름',checked:true}))} as Order;
 const state=emptyRawInventory('taebaek','raw','참깨','2026-10-01T00:00:00Z');state.stockKg=rawKg;state.activeLots=[{id:'raw-lot',material:'참깨',supplierName:'합성',receivedDate:'2026-10-01',qtyIn:0,kgIn:rawKg,kgRemaining:rawKg,status:'active',createdAt:'2026-10-01T00:00:00Z'}];
 items[1].lots=state.activeLots;for(const item of items)mem.docs.set('items/'+item.id,item);mem.docs.set('orders/order',order);mem.docs.set('rawInventories/'+inventoryDocId('taebaek','raw'),state);if(secondRaw)mem.docs.set('rawInventories/'+inventoryDocId('taebaek','raw2'),emptyRawInventory('taebaek','raw2','들깨','2026-10-01T00:00:00Z'));
 const claim=vi.fn(async(_id:string,_status:OrderStatus,operation:NonNullable<Order['inventoryOperation']>)=>{mem.calls.push('claim');if(!successful)throw Error('시험 claim 도달');const live={...mem.docs.get('orders/order'),inventoryOperation:operation};mem.docs.set('orders/order',live);return live as Order;});
 const rawJob=vi.fn(async(input:any)=>{const results=[];for(const row of input.commands)results.push({input:row,result:await executeRawInventoryCommand(row.command,{...row.options,db:{} as any})});return {job:{status:'complete'} as any,results};});
 const update=vi.fn(async(collection:string,id:string,data:any)=>{mem.docs.set(collection+'/'+id,{...mem.docs.get(collection+'/'+id),...data});}),add=vi.fn(),production=vi.fn();
 const inputs={bom:buildBomIndex(items,[{parent_id:'product',child_id:'raw',quantity:1},{parent_id:'product',child_id:'bottle',quantity:1},...(secondRaw?[{parent_id:'product',child_id:'raw2',quantity:1}]:[])]),pack:buildPackIndex()};
 const engine=createOrderStockEngine({db:{}as any,allItems:items,submaterials:[items[2]],partners:[],allOrders:[order],orders:[order],orderUnitInputs:inputs,buildFormula:()=>[],claimOrderOperation:overrideClaim??claimOrderInventoryOperation,runRawInventoryJob:rawJob,updateItem:update,addItem:add,createProductionRecordsForOrder:production,createProductionRecordPlan:(order,inputs,generation)=>buildOrderProductionRecordPlan(order,items,inputs,generation)});return {engine,order,items,inputs,claim,rawJob,update,add,production};
}
beforeEach(()=>{vi.useRealTimers();mem.loseFinalOnce=false;mem.failFinalOnce=false;mem.swapPointerBeforeFinal=false;localStorage.clear();mem.docs.clear();mem.calls.length=0;mem.writes.mockClear();mem.retireCall.mockReset();});

function retainedManualRequest(){const generation={contractVersion:1 as const,companyId:'taebaek' as const,orderId:'order',operationId:'old-manual-line',startedAt:'2026-10-12T00:00:00Z',actorUid:'employee'};return saveOrderRawBatchAttempt({version:1,generation,jobId:orderRawBatchJobId(generation),recordedAt:generation.startedAt,legacyJobIds:[],commands:[],plan:{},business:{orderText:'최초 원문'}});}
it.each(['status','line'] as const)('실제 %s 소비자는 무승인 retained 원문을 claim 전에 막아 반복 잠금/예약/재고쓰기0',async mode=>{
 const f=fixture([2],10,false,true),first=retainedManualRequest();mem.docs.set('appMeta/releaseCutover',{status:'active',releaseId:'release'});mem.retireCall.mockRejectedValue(Error('수동 해제 승인 없음'));
 const original=structuredClone(mem.docs);await expect(mode==='status'?f.engine.changeOrderStatus('order',OrderStatus.DISPATCHED):f.engine.changeOrderItemCompletion('order',0,f.order.items,OrderStatus.DISPATCHED)).rejects.toThrow('승인 없음');
 expect(mem.writes).not.toHaveBeenCalled();expect(mem.docs).toEqual(original);expect(localStorage.getItem(orderRawBatchAttemptKey('taebaek','employee','order'))).toBe(first.encoded);
});
it.each(['status','line'] as const)('실제 %s 소비자는 unknown 원문 서버보관·localarchive 뒤 첫 새 claim으로 진행한다',async mode=>{
 const f=fixture([2],10,false,true),first=retainedManualRequest();mem.docs.set('appMeta/releaseCutover',{status:'active',releaseId:'release'});
 mem.retireCall.mockImplementation(async(input:any)=>{expect(mem.writes).not.toHaveBeenCalled();return {data:{status:'retired',action:'allow-new-claim',allowNewClaim:true,inventoryApplied:'unknown',requestHash:createHash('sha256').update(input.requestText).digest('hex'),requestText:input.requestText,generation:first.request.generation,authorizationId:'manual-retire',retirementId:'manual-retire'}};});
 if(mode==='status')await f.engine.changeOrderStatus('order',OrderStatus.DISPATCHED);else await f.engine.changeOrderItemCompletion('order',0,f.order.items,OrderStatus.DISPATCHED);
 expect(mem.retireCall).toHaveBeenCalledOnce();expect(JSON.parse(localStorage.getItem('order-raw-batch-retired:manual-retire')!).encoded).toBe(first.encoded);expect(mem.docs.get('orders/order').inventoryGenerationCompletion.generation.operationId).not.toBe(first.request.generation.operationId);expect(mem.docs.get('items/raw').stock).toBe(8);expect(localStorage.getItem(orderRawBatchAttemptKey('taebaek','employee','order'))).toBeNull();
});
it.each(['status','line'] as const)('실제 %s archive-only는 옛 완료확인보다 먼저 보관하고 같은클릭 claim/예약/원료/기록/재고쓰기0이다',async mode=>{
 const f=fixture([2],10,false,true),first=retainedManualRequest();mem.docs.set('appMeta/releaseCutover',{status:'active',releaseId:'release'});
 Object.assign(mem.docs.get('orders/order'),{status:OrderStatus.DISPATCHED,producedAt:'2026-10-13T01:00:00Z',inventoryOperation:null,inventoryGenerationCompletion:{generation:{operationId:'현재 후속 세대'},requestText:'최초 옛원문과 다른 완료표'}});
 const original=structuredClone(mem.docs);
 mem.retireCall.mockImplementation(async(input:any)=>({data:{status:'retired',action:'archived-only',allowNewClaim:false,inventoryApplied:'unknown',requestHash:createHash('sha256').update(input.requestText).digest('hex'),requestText:input.requestText,generation:first.request.generation,authorizationId:'manual-retire',retirementId:'manual-retire'}}));
 if(mode==='status')await f.engine.changeOrderStatus('order',OrderStatus.DISPATCHED);else await f.engine.changeOrderItemCompletion('order',0,f.order.items,OrderStatus.DISPATCHED);
 expect(mem.retireCall).toHaveBeenCalledOnce();expect(mem.writes).not.toHaveBeenCalled();expect(mem.docs).toEqual(original);expect(mem.calls).not.toContain('read-tx');expect(f.rawJob).not.toHaveBeenCalled();expect(f.production).not.toHaveBeenCalled();expect(f.update).not.toHaveBeenCalled();expect(localStorage.getItem(orderRawBatchAttemptKey('taebaek','employee','order'))).toBeNull();
});
it.each(['status','line'] as const)('firstclaim %s 완료 ACK의 null잠금은 legacy 효과로 내려가지 않는다',async mode=>{
 let serverCurrent:Map<string,any>|undefined;
 const claim=vi.fn(async()=>{const g={contractVersion:1 as const,companyId:'taebaek' as const,orderId:'order',operationId:'retained-first-claim',actorUid:'employee',startedAt:'2026-10-13T00:00:00Z'},live={...mem.docs.get('orders/order'),retirementId:'a'.repeat(64),retirementClaimPending:false,inventoryOperation:null,inventoryGenerationCompletion:{generation:g,completedAt:g.startedAt,requestText:finalOrderInventoryRequestText(g,new Map(),[],{}),consumedLots:[],consumedLotsText:'[]'}};mem.docs.set('orders/order',live);serverCurrent=structuredClone(mem.docs);return live;});
 const f=fixture([2],10,false,true,claim);
 if(mode==='status')await f.engine.changeOrderStatus('order',OrderStatus.DISPATCHED);else await f.engine.changeOrderItemCompletion('order',0,f.order.items,OrderStatus.DISPATCHED);
 expect(claim).toHaveBeenCalledOnce();expect(mem.docs).toEqual(serverCurrent);expect(mem.writes).not.toHaveBeenCalled();expect(f.rawJob).not.toHaveBeenCalled();expect(f.production).not.toHaveBeenCalled();expect(f.update).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
});
it('다른 최초 UID의 completed-firstclaim ACK는 effects0으로 보존·거절한다',async()=>{
 const claim=vi.fn(async()=>{const g={contractVersion:1 as const,companyId:'taebaek' as const,orderId:'order',operationId:'first-claim',actorUid:'other',startedAt:'2026-10-13T00:00:00Z'};return {...mem.docs.get('orders/order'),retirementId:'a'.repeat(64),retirementClaimPending:false,inventoryOperation:null,inventoryGenerationCompletion:{generation:g,completedAt:g.startedAt,requestText:finalOrderInventoryRequestText(g,new Map(),[],{}),consumedLots:[],consumedLotsText:'[]'}};});
 const f=fixture([2],10,false,true,claim);await expect(f.engine.changeOrderStatus('order',OrderStatus.DISPATCHED)).rejects.toThrow('로그인 계정');expect(mem.writes).not.toHaveBeenCalled();expect(f.rawJob).not.toHaveBeenCalled();expect(f.update).not.toHaveBeenCalled();
});

it.each(['status','line'] as const)('실제 claim Auth stamp → %s 새 원료 일괄 경로로 반복 품목 전체를 한 TX에 적용한다',async mode=>{const f=fixture([1,1],10,false,true);if(mode==='status')await f.engine.changeOrderStatus('order',OrderStatus.DISPATCHED);else await f.engine.changeOrderItemCompletion('order',0,f.order.items,OrderStatus.DISPATCHED);expect(f.rawJob).not.toHaveBeenCalled();expect(mem.docs.get('items/raw').stock).toBe(8);expect(mem.docs.get('items/product').stock).toBe(2);const jobWrites=mem.writes.mock.calls.filter(([ref,value]:any[])=>ref.path.startsWith('rawInventoryJobs/order-raw-batch:')&&value.atomicVersion===1);expect(jobWrites).toHaveLength(1);expect(mem.docs.get('orders/order').inventoryGenerationCompletion.generation.actorUid).toBe('employee');});

it.each(['status','line'] as const)('완료 응답 유실 %s 재개는 실제 final 원문만 확인하며 생산기록·재고·job 추가쓰기0',async mode=>{
 const f=fixture([1,1],10,false,true);mem.loseFinalOnce=true;const run=()=>mode==='status'?f.engine.changeOrderStatus('order',OrderStatus.DISPATCHED):f.engine.changeOrderItemCompletion('order',0,f.order.items,OrderStatus.DISPATCHED);
 await expect(run()).rejects.toThrow();expect(mem.docs.get('orders/order').inventoryOperation).toBeNull();expect(localStorage.length).toBe(1);const before=structuredClone(mem.docs),count=mem.writes.mock.calls.length,records=f.production.mock.calls.length;await run();expect(mem.docs).toEqual(before);expect(mem.writes.mock.calls.length).toBe(count);expect(f.production.mock.calls.length).toBe(records);expect(localStorage.length).toBe(0);
});
it('raw 완료 뒤 final 실패·BOM/날짜 변경 재개는 최초 원료량과 로트kg/시각을 그대로 사용한다',async()=>{
 const f=fixture([2],10,false,true);mem.failFinalOnce=true;await expect(f.engine.changeOrderStatus('order',OrderStatus.DISPATCHED)).rejects.toThrow('final rejected');const first=JSON.parse(localStorage.getItem(localStorage.key(0)!)!);expect(mem.docs.get('items/raw').stock).toBe(8);const generation=mem.docs.get('orders/order').inventoryOperation;
 f.inputs.bom=buildBomIndex(f.items,[{parent_id:'product',child_id:'raw',quantity:99},{parent_id:'product',child_id:'bottle',quantity:99}]);vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-13T01:00:00Z'));
 await f.engine.changeOrderStatus('order',OrderStatus.DISPATCHED);expect(mem.docs.get('items/raw').stock).toBe(8);expect(mem.docs.get('items/product').stock).toBe(2);expect(mem.docs.get('orders/order').inventoryGenerationCompletion.generation.startedAt).toBe(generation.startedAt);expect(mem.docs.get('items/product').lots.at(-1).createdAt).toBe(first.generation.startedAt);expect(localStorage.length).toBe(0);vi.useRealTimers();
});
it('첫 계획의 기존재고1은 재개 전에 소진되면 신규3으로 다시 계산하지 않고 예약부족으로 보존한다',async()=>{
 const f=fixture([3],10,false,true);f.items[0].stock=1;mem.failFinalOnce=true;await expect(f.engine.changeOrderStatus('order',OrderStatus.DISPATCHED)).rejects.toThrow('final rejected');expect(mem.docs.get('items/raw').stock).toBe(8);mem.docs.get('items/product').stock=0;const beforeRaw=structuredClone(mem.docs.get('rawInventories/'+inventoryDocId('taebaek','raw')));await expect(f.engine.changeOrderStatus('order',OrderStatus.DISPATCHED)).rejects.toThrow();expect(mem.docs.get('items/product').stock).toBe(0);expect(mem.docs.get('rawInventories/'+inventoryDocId('taebaek','raw'))).toEqual(beforeRaw);expect(localStorage.length).toBe(1);
});

it('완료 후 원문 정리 실패는 다음 재개에서 생산기록·재고·raw 추가쓰기 없이 정확히 정리한다',async()=>{
 const f=fixture([1],10,false,true),original=Storage.prototype.removeItem;const remove=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw Error('cleanup unavailable');});await f.engine.changeOrderStatus('order',OrderStatus.DISPATCHED);expect(localStorage.length).toBe(1);remove.mockRestore();const before=structuredClone(mem.docs),count=mem.writes.mock.calls.length,records=f.production.mock.calls.length;await f.engine.changeOrderStatus('order',OrderStatus.DISPATCHED);expect(mem.docs).toEqual(before);expect(mem.writes.mock.calls.length).toBe(count);expect(f.production.mock.calls.length).toBe(records);expect(localStorage.length).toBe(0);
});

it('실패 재개에서 요청 품목수량이 바뀌면 첫 생산계획으로 새 주문수량을 저장하지 않는다',async()=>{const f=fixture([2],10,false,true);mem.failFinalOnce=true;await expect(f.engine.changeOrderItemCompletion('order',0,f.order.items,OrderStatus.DISPATCHED)).rejects.toThrow('final rejected');const encoded=localStorage.getItem(localStorage.key(0)!)!,rawBefore=structuredClone(mem.docs.get('rawInventories/'+inventoryDocId('taebaek','raw')));await expect(f.engine.changeOrderItemCompletion('order',0,[{...f.order.items[0],quantity:3}],OrderStatus.DISPATCHED)).rejects.toThrow('최초');expect(mem.docs.get('items/product').stock).toBe(0);expect(mem.docs.get('rawInventories/'+inventoryDocId('taebaek','raw'))).toEqual(rawBefore);expect(localStorage.getItem(localStorage.key(0)!)).toBe(encoded);});

it('옛 주문의 없는 줄 ID는 첫 상태 생산 계획과 최종 주문에 같은 ID로 고정한다',async()=>{
 const f=fixture([2],10,false,true);delete f.order.items[0].lineId;f.items[0].cost=0;
 await f.engine.changeOrderStatus('order',OrderStatus.DISPATCHED);
 const order=mem.docs.get('orders/order'),records=[...mem.docs.entries()].filter(([path])=>path.startsWith('productionRecords/')).map(([,record])=>record);
 expect(order.items[0].lineId).toBeTruthy();expect(records).toHaveLength(1);expect(records[0]).toMatchObject({lineId:order.items[0].lineId,finishedQty:2,cost:0});
 expect(order.productionRecordIndex[order.items[0].lineId].recordId).toBe(records[0].id);
});
it.each(['status','line'] as const)('완료 ACK %s는 자기일관적인 marker라도 최초 승인 품목 원문 변조를 받아들이지 않는다',async mode=>{
 const f=fixture([1],10,false,true);mem.loseFinalOnce=true;const run=()=>mode==='status'?f.engine.changeOrderStatus('order',OrderStatus.DISPATCHED):f.engine.changeOrderItemCompletion('order',0,f.order.items,OrderStatus.DISPATCHED);
 await expect(run()).rejects.toThrow();const order=mem.docs.get('orders/order'),payload=JSON.parse(order.inventoryGenerationCompletion.requestText);payload.patch.items[0].quantity=99;order.inventoryGenerationCompletion.requestText=rawPressText(payload);
 const count=mem.writes.mock.calls.length;await expect(run()).rejects.toThrow();expect(mem.writes.mock.calls.length).toBe(count);expect(localStorage.length).toBe(1);
});
it('완료 ACK는 최초 승인 비고도 marker 자기일관성만으로 바꾸지 않는다',async()=>{
 const f=fixture([1],10,false,true);mem.loseFinalOnce=true;
 const run=()=>f.engine.changeOrderStatus('order',OrderStatus.DISPATCHED,undefined,{orderPatch:{note:'최초 승인 비고'}});
 await expect(run()).rejects.toThrow();const marker=mem.docs.get('orders/order').inventoryGenerationCompletion,payload=JSON.parse(marker.requestText);payload.patch.note='다른 승인';marker.requestText=rawPressText(payload);
 const count=mem.writes.mock.calls.length;await expect(run()).rejects.toThrow('승인 내용');expect(mem.writes.mock.calls.length).toBe(count);expect(localStorage.length).toBe(1);
});
it.each(['status','line'] as const)('실제 %s 소비자는 record 저장 뒤 index 경합에서 최종 재고를 쓰지 않는다',async mode=>{
 const f=fixture([1],10,false,true);mem.swapPointerBeforeFinal=true;
 const run=()=>mode==='status'?f.engine.changeOrderStatus('order',OrderStatus.DISPATCHED):f.engine.changeOrderItemCompletion('order',0,f.order.items,OrderStatus.DISPATCHED);
 await expect(run()).rejects.toThrow('연결이 변경');expect(mem.docs.get('items/product').stock).toBe(0);expect(mem.docs.get('items/raw').stock).toBe(9);expect(mem.docs.get('orders/order').inventoryGenerationCompletion).toBeUndefined();expect(localStorage.length).toBe(1);
});
