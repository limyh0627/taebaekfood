import {createHash} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({db:null as any,firestore:vi.fn(),update:vi.fn(),create:vi.fn()}));
vi.mock('firebase-admin',()=>({firestore:m.firestore}));
// onCall은 모킹하지 않는다. 실제 등록된 callable의 run으로 권한·업무 본문을 실행한다.
import {recoverOrderInventoryLockCommand} from './orderLockRecovery';
import {cancellationEvidenceText} from './shared/orderCancellationEvidence';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
let data:any,order:any;
const call=(request:any)=>(recoverOrderInventoryLockCommand as any).run(request);
beforeEach(()=>{
 vi.clearAllMocks();
 order={id:'auth-order',companyId:'taebaek',status:'SHIPPED',shippedOut:true,items:[{itemId:'product',quantity:2}],inventorySnapshots:{shipment:{stockDeltas:[{itemId:'product',delta:-2}]}}};
 const operationId='order-cancellation-cancel-shipment-auth-order-'+hash(cancellationEvidenceText(order,'cancel-shipment'));
 order.inventoryOperation={id:operationId,state:'failed',kind:'status',stage:'final-stock',targetStatus:'DISPATCHED',startedAt:'2026-10-11T00:00:00Z',error:'미반영 실패'};
 data={action:'inspect',orderId:order.id,failedOperationId:operationId,failedStartedAt:order.inventoryOperation.startedAt,releaseId:'release'};
 m.db={collection:(name:string)=>({doc:(id:string)=>({path:name+'/'+id})}),runTransaction:async(callback:any)=>callback({get:async(ref:any)=>{const row=ref.path==='appMeta/releaseCutover'?{status:'active',releaseId:'release'}:ref.path==='orders/auth-order'?order:undefined;return {exists:row!==undefined,data:()=>row};},update:m.update,create:m.create})};m.firestore.mockReturnValue(m.db);
});
it.each([undefined,{uid:'staff',token:{}},{uid:'staff',token:{companyId:'unknown'}}])('실제 callable는 로그인·유효 회사 claim 없으면 DB를 열지 않는다',async auth=>{await expect(call({auth,data})).rejects.toMatchObject({code:auth===undefined?'unauthenticated':'permission-denied'});expect(m.firestore).not.toHaveBeenCalled();});
it.each([undefined,false])('실제 callable는 관리자 claim %s 없이 같은 회사 직원의 안전 inspect를 허용한다',async isAdmin=>{await expect(call({auth:{uid:'staff',token:{companyId:'taebaek',employeeId:'employee',...(isAdmin===undefined?{}:{isAdmin})}},data})).resolves.toMatchObject({status:'ready',inventoryApplied:'none'});expect(m.update).not.toHaveBeenCalled();});
it.each([undefined,'',' ',123])('실제 callable는 잘못된 employeeId %s에 DB 접근을 허용하지 않는다',async employeeId=>{await expect(call({auth:{uid:'staff',token:{companyId:'taebaek',employeeId,isAdmin:true}},data})).rejects.toMatchObject({code:'permission-denied'});expect(m.firestore).not.toHaveBeenCalled();});
it('실제 callable는 직원 recover도 동일 TX 근거로 잠금만 해제한다',async()=>{await expect(call({auth:{uid:'staff',token:{companyId:'taebaek',employeeId:'employee',isAdmin:false}},data:{...data,action:'recover'}})).resolves.toMatchObject({status:'recovered',inventoryApplied:'none'});expect(m.update).toHaveBeenCalledWith({path:'orders/auth-order'},{inventoryOperation:null,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1});expect(m.create).toHaveBeenCalledWith(expect.objectContaining({path:expect.stringContaining('orderLockRecoveryOperations/')}),expect.objectContaining({recoveredBy:'staff',companyId:'taebaek'}));});
it('다른 회사 직원은 관리자라도 실제 주문 회사 검증을 우회하지 못한다',async()=>{await expect(call({auth:{uid:'foreign',token:{companyId:'punghoe',employeeId:'employee',isAdmin:true}},data:{...data,action:'recover'}})).rejects.toMatchObject({code:'permission-denied'});expect(m.update).not.toHaveBeenCalled();expect(m.create).not.toHaveBeenCalled();});
it('직원도 실패 세대·원문 변경이나 완료 근거를 무시하고 해제하지 않는다',async()=>{order.inventoryOperation.startedAt='2026-10-12T00:00:00Z';expect(await call({auth:{uid:'staff',token:{companyId:'taebaek',employeeId:'employee'}},data:{...data,action:'recover'}})).toMatchObject({status:'blocked',reason:'OPERATION_GENERATION_CHANGED'});expect(m.update).not.toHaveBeenCalled();});

it('기존 주문 writer 버전은 잠금 해제 거래에서 한 번만 증가한다',async()=>{order.inventoryWriterProtocolVersion=1;order.inventoryWriteRevision=7;await call({auth:{uid:'staff',token:{companyId:'taebaek',employeeId:'employee'}},data:{...data,action:'recover'}});expect(m.update).toHaveBeenCalledWith({path:'orders/auth-order'},{inventoryOperation:null,inventoryWriterProtocolVersion:1,inventoryWriteRevision:8});});
it.each([undefined,null,-1,1.5,Number.MAX_SAFE_INTEGER])('표식 있는 주문의 손상 버전 %s는 잠금·영수증을 쓰지 않는다',async revision=>{order.inventoryWriterProtocolVersion=1;order.inventoryWriteRevision=revision;await expect(call({auth:{uid:'staff',token:{companyId:'taebaek',employeeId:'employee'}},data:{...data,action:'recover'}})).rejects.toThrow('프로토콜');expect(m.update).not.toHaveBeenCalled();expect(m.create).not.toHaveBeenCalled();});