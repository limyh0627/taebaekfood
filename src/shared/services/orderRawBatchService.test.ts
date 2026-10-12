// @vitest-environment jsdom
import {beforeEach,describe,expect,it,vi} from 'vitest';
const runtime=vi.hoisted(()=>({auth:{currentUser:null as any},transaction:vi.fn()}));
vi.mock('../firebase',()=>({auth:runtime.auth,authReady:Promise.resolve(),db:{}}));
vi.mock('firebase/firestore',async importOriginal=>({...await importOriginal<typeof import('firebase/firestore')>(),runTransaction:runtime.transaction}));
import {executeOrderRawBatch,orderRawBatchReceiptMatches} from './orderRawBatchService';
import {commandHash,operationDocId} from '../rawInventoryCore';
import {toLedgerDoc} from './rawInventoryService';
import {orderRawBatchAttemptKey,orderRawBatchJobId,type OrderRawBatchRequest} from '../orderRawBatchAttempt';
const command={operationId:'raw-command',companyId:'taebaek' as const,rawItemId:'raw',kind:'consume' as const,kg:2,effectiveAt:'2026-10-12T01:00:00Z',source:{type:'production' as const,id:'order'},materialSnapshot:'원료'};
const movement={id:operationDocId(command.operationId),operationId:command.operationId,companyId:command.companyId,rawItemId:'raw',kind:command.kind,effectiveAt:command.effectiveAt,source:command.source,materialSnapshot:'원료',commandHash:commandHash(command),reportedDeltaKg:-2,appliedDeltaKg:-2,recordedAt:command.effectiveAt,sequence:2,balanceAfterKg:8,lotChanges:[]};
const result={status:'applied' as const,movement,state:{} as any};
const request={recordedAt:command.effectiveAt,commands:[{command}]} as OrderRawBatchRequest;
const read=(value:any,dual=false)=>({movementSnap:{exists:()=>true,data:()=>value},oldMovementSnap:{exists:()=>dual,data:()=>value}}) as any;
describe('일괄 원료 영수증 증거',()=>{
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
