// @vitest-environment jsdom
import {beforeEach,describe,expect,it,vi} from 'vitest';
const runtime=vi.hoisted(()=>({auth:{currentUser:null as any},transaction:vi.fn()}));
vi.mock('../firebase',()=>({auth:runtime.auth,authReady:Promise.resolve(),db:{}}));
vi.mock('firebase/firestore',async importOriginal=>({...await importOriginal<typeof import('firebase/firestore')>(),doc:(_db:unknown,...parts:string[])=>({path:parts.join('/'),id:parts.at(-1)}),runTransaction:runtime.transaction}));
import {executeOrderRawBatch,executeOrderRawBatchWithDb,orderRawBatchProofProblem,orderRawBatchReceiptMatches} from './orderRawBatchService';
import {commandHash,operationDocId} from '../rawInventoryCore';
import {toLedgerDoc} from './rawInventoryService';
import {orderRawBatchAttemptKey,orderRawBatchJobId,orderRawBatchOrderEvidence,type OrderRawBatchRequest} from '../orderRawBatchAttempt';
import {OrderStatus,type Order} from '../types';
const command={operationId:'raw-command',companyId:'taebaek' as const,rawItemId:'raw',kind:'consume' as const,kg:2,effectiveAt:'2026-10-12T01:00:00Z',source:{type:'production' as const,id:'order'},materialSnapshot:'원료'};
const movement={id:operationDocId(command.operationId),operationId:command.operationId,companyId:command.companyId,rawItemId:'raw',kind:command.kind,effectiveAt:command.effectiveAt,source:command.source,materialSnapshot:'원료',commandHash:commandHash(command),reportedDeltaKg:-2,appliedDeltaKg:-2,recordedAt:command.effectiveAt,sequence:2,balanceAfterKg:8,lotChanges:[]};
const result={status:'applied' as const,movement,state:{} as any};
const request={recordedAt:command.effectiveAt,commands:[{command}]} as OrderRawBatchRequest;
const read=(value:any,dual=false)=>({movementSnap:{exists:()=>true,data:()=>value},oldMovementSnap:{exists:()=>dual,data:()=>value}}) as any;
describe('일괄 원료 영수증 증거',()=>{
 it('공용 job proof는 source/hash와 품목·상태 회사까지 같은 판정으로 검증한다',()=>{
  const g={contractVersion:1 as const,companyId:'taebaek' as const,orderId:'order',operationId:'first',actorUid:'employee',startedAt:command.effectiveAt};
  const request={generation:g,jobId:orderRawBatchJobId(g),recordedAt:g.startedAt,commands:[{command}]} as OrderRawBatchRequest;
  const snapshot=(data:any)=>({exists:()=>true,data:()=>data});const row={...read(movement),itemSnap:snapshot({companyId:'taebaek'}),stateSnap:snapshot({companyId:'taebaek',rawItemId:'raw'})};
  const job={atomicVersion:1,status:'complete',companyId:'taebaek',actorUid:'employee',id:request.jobId,source:{type:'production',id:'order'},createdAt:g.startedAt,completedAt:g.startedAt,requestHash:'hash',expectedOperationIds:[command.operationId],request,results:[result]};
  expect(orderRawBatchProofProblem(job,request,[row],'hash')).toBeNull();expect(orderRawBatchProofProblem({...job,requestHash:'other'},request,[row],'hash')).toBeTruthy();expect(orderRawBatchProofProblem(job,request,[{...row,stateSnap:snapshot({companyId:'punghoe',rawItemId:'raw'})}],'hash')).toBeTruthy();
 });
 it('실제 원장 어댑터의 추가 화면 칸과 표시명 변경은 중복 증거를 깨지 않는다',()=>{
  const ledger=toLedgerDoc(movement,{type:'auto',note:'옛 칸'});expect(orderRawBatchReceiptMatches(request,0,read({...ledger,materialSnapshot:'바뀐 표시명'}),result)).toBe(true);
 });
 it.each(['id','companyId','rawItemId','operationId','kind','effectiveAt','commandHash','reportedDeltaKg','appliedDeltaKg','sequence','balanceAfterKg','recordedAt'])('%s 손상은 완료로 취급하지 않는다',key=>{
  const original=(movement as any)[key],value=typeof original==='number'?original+1:'other';expect(orderRawBatchReceiptMatches(request,0,read({...movement,[key]:value}),result)).toBe(false);
 });
 it('옛·새 문서 둘 모두 있으면 임의로 하나를 고르지 않는다',()=>{expect(orderRawBatchReceiptMatches(request,0,read(movement,true),result)).toBe(false);});
});
describe('실제 서비스 최초 저장 경계',()=>{
 beforeEach(()=>{localStorage.clear();vi.clearAllMocks();});
 const make=():OrderRawBatchRequest=>{const generation={contractVersion:1 as const,companyId:'taebaek' as const,orderId:'order',operationId:'first',actorUid:'employee',startedAt:'2026-10-12T00:00:00Z'};return {version:1,generation,jobId:orderRawBatchJobId(generation),recordedAt:generation.startedAt,legacyJobIds:[],business:{orderText:'original'},plan:{first:true},commands:[]};};
 it('저장 뒤 token 대기 중 다른 원문이 생기면 TX0·바뀐 원문 보존',async()=>{
  let calls=0;runtime.auth.currentUser={uid:'employee',getIdTokenResult:vi.fn(async()=>{if(++calls===2)localStorage.setItem(orderRawBatchAttemptKey('taebaek','employee','order'),'replacement');return {claims:{companyId:'taebaek',employeeId:'employee'}};})};
  await expect(executeOrderRawBatch(make())).rejects.toThrow('최초 원료 요청이 바뀌');expect(runtime.transaction).not.toHaveBeenCalled();expect(localStorage.getItem(orderRawBatchAttemptKey('taebaek','employee','order'))).toBe('replacement');
 });
 it('token 대기 중 UID 교체는 첫 요청 저장도 하지 않는다',async()=>{runtime.auth.currentUser={uid:'employee',getIdTokenResult:vi.fn(async()=>{runtime.auth.currentUser={uid:'other'};return {claims:{companyId:'taebaek',employeeId:'employee'}};})};await expect(executeOrderRawBatch(make())).rejects.toThrow('직원 로그인');expect(localStorage.length).toBe(0);expect(runtime.transaction).not.toHaveBeenCalled();});
});
describe('신규 생산기록 계획과 첫 원료 쓰기 경계',()=>{
 beforeEach(()=>{vi.clearAllMocks();});
 it.each(['no-flag','no-manifest'] as const)('%s는 원료·job·단계 쓰기0이다',async mode=>{
  const generation={contractVersion:1 as const,companyId:'taebaek' as const,orderId:'order',operationId:'first',actorUid:'employee',startedAt:'2026-10-12T00:00:00Z'};
  const order={id:'order',companyId:'taebaek',status:OrderStatus.PENDING,items:[],inventoryOperation:{id:'first',contractVersion:1,actorUid:'employee',startedAt:generation.startedAt,state:'processing',stage:'reservation',...(mode==='no-manifest'?{productionRecordContractVersion:1}:{})}} as unknown as Order;
  const request:OrderRawBatchRequest={version:1,generation,jobId:orderRawBatchJobId(generation),recordedAt:generation.startedAt,legacyJobIds:[],business:{orderText:orderRawBatchOrderEvidence(order)},plan:mode==='no-flag'?{productionRecords:{version:1,generation,recordedAt:generation.startedAt,records:[]}}:{},commands:[]};
  const write=vi.fn();runtime.transaction.mockImplementation(async(_db,fn)=>fn({get:async(ref:any)=>({id:ref.id,exists:()=>ref.path==='orders/order',data:()=>order}),set:write,update:write}));
  expect(await executeOrderRawBatchWithDb({} as any,request,async()=>{})).toMatchObject({status:'blocked'});expect(write).not.toHaveBeenCalled();
 });
});
