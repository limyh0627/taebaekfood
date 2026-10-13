// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from 'vitest';
import {createHash,webcrypto} from 'node:crypto';
const m=vi.hoisted(()=>({user:{uid:'employee',getIdTokenResult:vi.fn()},auth:{currentUser:null as any},get:vi.fn(),call:vi.fn(),callable:vi.fn()}));
vi.mock('../firebase',()=>({auth:m.auth,authReady:Promise.resolve(),db:{},functions:{}}));
vi.mock('firebase/firestore',()=>({doc:(_db:unknown,...path:string[])=>path.join('/'),getDoc:m.get}));
vi.mock('firebase/functions',()=>({httpsCallable:m.callable}));
import {retireRetainedOrderRequestBeforeClaim,claimRetiredOrderInventoryOperation,hasRetainedRetirementClaim} from './orderRequestRetirementService';
import {finalOrderInventoryRequestText} from '../orderInventoryGeneration';
import {saveOrderRawBatchAttempt,orderRawBatchJobId,orderRawBatchAttemptKey,type OrderRawBatchRequest} from '../orderRawBatchAttempt';
import {rawPressText} from '../rawPressAttempt';
import {OrderStatus,type Order} from '../types';
const make=():OrderRawBatchRequest=>{const generation={contractVersion:1 as const,companyId:'taebaek' as const,orderId:'order',operationId:'old',startedAt:'2026-10-12T00:00:00Z',actorUid:'employee'};return {version:1,generation,jobId:orderRawBatchJobId(generation),recordedAt:generation.startedAt,legacyJobIds:[],business:{orderText:'old business'},plan:{},commands:[]};};
const order=():Order=>({id:'order',companyId:'taebaek',status:OrderStatus.PENDING,items:[],inventoryOperation:null,partnerName:'합성',totalAmount:0,createdAt:'2026-10-12',deliveryDate:'2026-10-12',email:'',source:'일반'});
const receipt=(r:OrderRawBatchRequest)=>({status:'retired',action:'allow-new-claim',allowNewClaim:true,inventoryApplied:'unknown',requestText:rawPressText(r),requestHash:createHash('sha256').update(rawPressText(r)).digest('hex'),generation:r.generation,authorizationId:'authorized',retirementId:'authorized'});
beforeEach(()=>{vi.restoreAllMocks();vi.clearAllMocks();localStorage.clear();vi.stubGlobal('crypto',webcrypto);m.auth.currentUser=m.user;m.user.getIdTokenResult.mockResolvedValue({claims:{companyId:'taebaek',employeeId:'staff'}});m.get.mockResolvedValue({data:()=>({status:'active',releaseId:'release'})});m.callable.mockReturnValue(m.call);m.call.mockImplementation(async()=>({data:receipt(make())}));});
it('요청 없는 주문과 다른 UID 요청은 서버 호출·스토리지 변경0',async()=>{await retireRetainedOrderRequestBeforeClaim(order());const r=make();r.generation.actorUid='other';saveOrderRawBatchAttempt(r);await retireRetainedOrderRequestBeforeClaim(order());expect(m.call).not.toHaveBeenCalled();expect(localStorage.length).toBe(1);});
it('같은 실패 세대는 최초 원문을 그대로 재개하며 퇴역 호출0',async()=>{saveOrderRawBatchAttempt(make());await retireRetainedOrderRequestBeforeClaim({...order(),inventoryOperation:{id:'old',actor:'employee',startedAt:make().generation.startedAt,actorUid:'employee',contractVersion:1,state:'failed',kind:'line',targetStatus:OrderStatus.DISPATCHED}});expect(m.call).not.toHaveBeenCalled();expect(localStorage.length).toBe(1);});
it('실제 Admin UID 기본 경로가 exact unknown 영수증을 확인하고 archive 뒤 active키만 제거한다',async()=>{const first=saveOrderRawBatchAttempt(make());await retireRetainedOrderRequestBeforeClaim(order());expect(m.callable).toHaveBeenCalledWith({},'retireOrderRequestCommand');expect(m.call).toHaveBeenCalledWith({requestText:rawPressText(first.request),requestHash:receipt(first.request).requestHash,releaseId:'release'});expect(localStorage.getItem(orderRawBatchAttemptKey('taebaek','employee','order'))).toBeNull();expect(JSON.parse(localStorage.getItem('order-raw-batch-retired:authorized')!).encoded).toBe(first.encoded);});
it.each(['new-lock','completed','damaged','foreign-company','no-login'])('%s는 새 claim 전에 보존·중단한다',async kind=>{const first=saveOrderRawBatchAttempt(make()),live=order();if(kind==='new-lock')live.inventoryOperation={id:'new',actor:'employee',kind:'status',state:'processing',targetStatus:OrderStatus.DISPATCHED,startedAt:'2026-10-13'};if(kind==='completed')live.inventoryGenerationCompletion={} as any;if(kind==='damaged')localStorage.setItem(orderRawBatchAttemptKey('taebaek','employee','order'),'{');if(kind==='foreign-company')m.user.getIdTokenResult.mockResolvedValue({claims:{companyId:'punghoe',employeeId:'staff'}});if(kind==='no-login')m.auth.currentUser=null;await expect(retireRetainedOrderRequestBeforeClaim(live)).rejects.toThrow();expect(m.call).toHaveBeenCalledTimes(['new-lock','completed'].includes(kind)?1:0);expect(localStorage.getItem(orderRawBatchAttemptKey('taebaek','employee','order'))).toBe(kind==='damaged'?'{':first.encoded);});
it('응답 유실은 최초 원문을 남기고 정확 duplicate 재시도로 archive한다',async()=>{const first=saveOrderRawBatchAttempt(make());m.call.mockRejectedValueOnce(Error('response lost'));await expect(retireRetainedOrderRequestBeforeClaim(order())).rejects.toThrow();expect(localStorage.getItem(orderRawBatchAttemptKey('taebaek','employee','order'))).toBe(first.encoded);m.call.mockResolvedValueOnce({data:{...receipt(make()),status:'duplicate'}});await retireRetainedOrderRequestBeforeClaim(order());expect(localStorage.getItem(orderRawBatchAttemptKey('taebaek','employee','order'))).toBeNull();});
it.each(['uid','request','hash','none','generation'])('대기 중 %s가 바뀌면 active 원문을 퇴역하지 않는다',async kind=>{const first=saveOrderRawBatchAttempt(make());m.call.mockImplementation(async()=>{const data:any=receipt(make());if(kind==='uid')m.auth.currentUser={uid:'other'};if(kind==='request')localStorage.setItem(orderRawBatchAttemptKey('taebaek','employee','order'),'replacement');if(kind==='hash')data.requestHash='0'.repeat(64);if(kind==='none')data.inventoryApplied='none';if(kind==='generation')data.generation={...data.generation,operationId:'new'};return {data};});await expect(retireRetainedOrderRequestBeforeClaim(order())).rejects.toThrow();expect(localStorage.getItem(orderRawBatchAttemptKey('taebaek','employee','order'))).toBe(kind==='request'?'replacement':first.encoded);});
it('archive 쓰기 실패는 active 요청과 claim을 보존한다',async()=>{const first=saveOrderRawBatchAttempt(make());vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota');});await expect(retireRetainedOrderRequestBeforeClaim(order())).rejects.toThrow('quota');expect(localStorage.getItem(orderRawBatchAttemptKey('taebaek','employee','order'))).toBe(first.encoded);});
const firstKey='order-retirement-first-claim:employee:taebaek:order';
const operation=()=>({id:'first-claim',startedAt:'2026-10-13T00:00:00Z',actor:'직원',actorUid:'employee',contractVersion:1 as const,productionRecordContractVersion:1 as const,kind:'status' as const,targetStatus:OrderStatus.DISPATCHED,state:'processing' as const});
function mockFirstClaim(){
 const live={...order(),retirementId:'a'.repeat(64),retirementClaimPending:true};
 m.get.mockImplementation(async(path:string)=>({exists:()=>true,data:()=>path==='orders/order'?live:{status:'active',releaseId:'release'}}));
 m.call.mockImplementation(async(input:any)=>{const request=JSON.parse(input.requestText),g={contractVersion:1,companyId:request.companyId,actorUid:request.actorUid,orderId:request.orderId,operationId:request.operation.id,startedAt:request.operation.startedAt};return {data:{status:'claimed',retirementId:request.retirementId,requestText:input.requestText,requestHash:input.requestHash,generation:g,order:{...live,retirementClaimPending:false,inventoryOperation:{...request.operation,stage:'claim'}}}};});
 return live;
}
it('firstclaim는 서버 호출 전에 text/hash를 고정하고 정확 ACK만 CAS 정리한다',async()=>{
 mockFirstClaim();const call=m.call.getMockImplementation()!;m.call.mockImplementation(async(input:any)=>{const stored=JSON.parse(localStorage.getItem(firstKey)!);expect(stored.requestText).toBe(input.requestText);expect(stored.requestHash).toBe(input.requestHash);return call(input);});
 expect((await claimRetiredOrderInventoryOperation('order',OrderStatus.PENDING,operation())).inventoryOperation?.id).toBe('first-claim');expect(localStorage.getItem(firstKey)).toBeNull();expect(m.callable).toHaveBeenCalledWith({},'claimRetiredOrderInventoryOperationCommand');
});
it('firstclaim 응답유실 뒤 새nonce/시각은 원명세를 덮지 않고 정확 재사용한다',async()=>{
 mockFirstClaim();m.call.mockRejectedValueOnce(Error('response lost'));await expect(claimRetiredOrderInventoryOperation('order',OrderStatus.PENDING,operation())).rejects.toThrow('response lost');const first=localStorage.getItem(firstKey)!;
 expect(hasRetainedRetirementClaim('order','taebaek','employee','a'.repeat(64))).toBe(true);expect(hasRetainedRetirementClaim('order','taebaek','other')).toBe(false);expect(hasRetainedRetirementClaim('order','taebaek','employee','b'.repeat(64))).toBe(false);
 expect((await claimRetiredOrderInventoryOperation('order',OrderStatus.PENDING,{...operation(),id:'next-click',startedAt:'2026-10-14T00:00:00Z'})).inventoryOperation?.id).toBe('first-claim');expect(m.call.mock.calls[1][0].requestText).toBe(JSON.parse(first).requestText);expect(localStorage.getItem(firstKey)).toBeNull();
});
it.each(['kind','lineId','targetStatus','expectedStatus'])('retained firstclaim %s 변경은 원문 유지·새 서버쓰기0이다',async kind=>{
 mockFirstClaim();m.call.mockRejectedValueOnce(Error('unknown'));await expect(claimRetiredOrderInventoryOperation('order',OrderStatus.PENDING,operation())).rejects.toThrow();const first=localStorage.getItem(firstKey),changed:any=operation();let status=OrderStatus.PENDING;
 if(kind==='kind')changed.kind='line';if(kind==='lineId')changed.lineId='different';if(kind==='targetStatus')changed.targetStatus=OrderStatus.SHIPPED;if(kind==='expectedStatus')status=OrderStatus.PROCESSING;
 await expect(claimRetiredOrderInventoryOperation('order',status,changed)).rejects.toThrow('명세가 다릅니다');expect(m.call).toHaveBeenCalledTimes(1);expect(localStorage.getItem(firstKey)).toBe(first);
});
it.each(['hash','uid','CAS','other-generation'])('firstclaim 결과 %s 불확실은 최초 명세를 지우지 않는다',async kind=>{
 mockFirstClaim();const call=m.call.getMockImplementation()!;let first:string|null=null;
 m.call.mockImplementation(async(input:any)=>{first=localStorage.getItem(firstKey);const result=await call(input);if(kind==='hash')result.data.requestHash='0'.repeat(64);if(kind==='uid')m.auth.currentUser={uid:'other'};if(kind==='CAS')localStorage.setItem(firstKey,'replacement');if(kind==='other-generation')result.data.order.inventoryOperation.id='other';return result;});
 await expect(claimRetiredOrderInventoryOperation('order',OrderStatus.PENDING,operation())).rejects.toThrow();expect(localStorage.getItem(firstKey)).toBe(kind==='CAS'?'replacement':first);
});
it('exact completion firstclaim ACK는 현재 완료표를 유지하고 원명세만 정리한다',async()=>{
 mockFirstClaim();const call=m.call.getMockImplementation()!;m.call.mockImplementation(async(input:any)=>{const result=await call(input),g=result.data.generation;result.data.status='duplicate';result.data.order.inventoryOperation=null;result.data.order.inventoryGenerationCompletion={generation:g,completedAt:g.startedAt,requestText:finalOrderInventoryRequestText(g,new Map(),[],{}),consumedLots:[],consumedLotsText:'[]'};return result;});
 expect((await claimRetiredOrderInventoryOperation('order',OrderStatus.PENDING,operation())).inventoryOperation).toBeNull();expect(localStorage.getItem(firstKey)).toBeNull();
});
it('archive-only는 현 완료·세대가 있어도 unknown을 보관하고 같은 클릭 종료를 반환한다',async()=>{
 const first=saveOrderRawBatchAttempt(make()),live={...order(),status:OrderStatus.DISPATCHED,inventoryGenerationCompletion:{current:'후속 세대'}} as any;
 m.call.mockResolvedValue({data:{...receipt(make()),action:'archived-only',allowNewClaim:false}});
 expect(await retireRetainedOrderRequestBeforeClaim(live)).toBe('archived-only');expect(localStorage.getItem(orderRawBatchAttemptKey('taebaek','employee','order'))).toBeNull();expect(JSON.parse(localStorage.getItem('order-raw-batch-retired:authorized')!).encoded).toBe(first.encoded);
});
it('손상 own firstctx는 route true로 strict검증에 보내고 다른UID는 조회0이다',async()=>{localStorage.setItem(firstKey,'{');expect(hasRetainedRetirementClaim('order','taebaek','employee','a'.repeat(64))).toBe(true);expect(hasRetainedRetirementClaim('order','taebaek','other')).toBe(false);await expect(claimRetiredOrderInventoryOperation('order',OrderStatus.PENDING,operation())).rejects.toThrow('명세');expect(localStorage.getItem(firstKey)).toBe('{');expect(m.call).not.toHaveBeenCalled();});
it('retained 사본 없는 service import와 pure predicate는 Firebase runtime을 초기화하지 않는다',async()=>{
 vi.resetModules();const runtime=vi.fn(()=>{throw Error('예상하지 않은 Firebase 초기화');});vi.doMock('../firebase',runtime);
 try{const service=await import('./orderRequestRetirementService');expect(service.hasRetainedRetirementClaim('order','taebaek','employee')).toBe(false);await service.retireRetainedOrderRequestBeforeClaim(order());localStorage.setItem('order-raw-batch:employee:taebaek:other-order','다른 주문 사본');await service.retireRetainedOrderRequestBeforeClaim(order());expect(runtime).not.toHaveBeenCalled();}
 finally{vi.doMock('../firebase',()=>({auth:m.auth,authReady:Promise.resolve(),db:{},functions:{}}));vi.resetModules();}
});

