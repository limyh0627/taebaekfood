import {beforeEach,describe,expect,it,vi} from 'vitest';

const calls=vi.hoisted(()=>({read:vi.fn(),scope:vi.fn()}));
vi.mock('./shared/orderProductionBatchEvidence',()=>({readBatchOpening:calls.read,withBatchEvidenceScope:calls.scope,assertBatchEvidenceScope:vi.fn()}));
import {readOrderProductionBatchOpen,executeOrderProductionBatchCommand,prepareBatchOwnerIndexAppend} from './orderProductionBatchCommand';
import {Timestamp} from 'firebase-admin/firestore';

describe('부분 생산 열기 거래',()=>{
 const actor:any={uid:'uid',token:{employeeId:'employee',companyId:'taebaek'}};
 const clock={now:'2026-11-02T00:00:00.000Z',nowMs:Date.parse('2026-11-02T00:00:00.000Z')};
 const command={version:1,mode:'open',companyId:'taebaek',orderId:'주문'};
 const opening={version:1,state:'open',companyId:'taebaek',orderId:'주문',opening:{version:1,token:'a'.repeat(64)},rows:[],availableStockOnly:[],allowedActions:['complete-partial'],warnings:[]};
 const transaction=()=>({get:vi.fn(async(ref:any)=>({exists:true,data:()=>ref.path==='employees/employee'?{name:'담당',authUid:'uid',companyId:'taebaek',status:'working'}:{id:'주문',companyId:'taebaek'}}))});
 beforeEach(()=>{vi.resetAllMocks();calls.scope.mockImplementation(async (_tx,fn)=>fn('scope'));calls.read.mockResolvedValue({opening});});
 it('실제 거래 콜백 안에서 열기 증거를 읽고 대상에 결박한다',async()=>{
  const tx=transaction(),db:any={doc:(path:string)=>({path}),runTransaction:vi.fn(async (fn,options)=>{expect(options).toEqual({readOnly:true});return fn(tx);})};
  await expect(readOrderProductionBatchOpen(db,actor,command,clock)).resolves.toEqual({...opening,reversibleBatches:[]});
  expect(calls.scope).toHaveBeenCalledWith(tx,expect.any(Function));
  expect(calls.read).toHaveBeenCalledWith(tx,db,actor,{companyId:'taebaek',orderId:'주문'},clock,'scope');
 });
 it('다른 주문의 응답과 비열기 명령은 통과시키지 않는다',async()=>{
  const db:any={doc:(path:string)=>({path}),runTransaction:vi.fn(async fn=>fn(transaction()))};
  calls.read.mockResolvedValue({opening:{...opening,orderId:'다른주문'}});
  await expect(readOrderProductionBatchOpen(db,actor,command,clock)).rejects.toThrow('invalid-input');
  await expect(readOrderProductionBatchOpen(db,actor,{version:1,mode:'list',companyId:'taebaek'},clock)).rejects.toThrow('invalid-input');
  expect(db.runTransaction).toHaveBeenCalledTimes(1);
 });
 it('열기 오류를 한국어로 전달하고 내부 기술 내용을 노출하지 않는다',async()=>{
  const db:any={doc:(path:string)=>({path}),runTransaction:async(fn:any)=>fn(transaction())};
  for(const [reason,code,message] of [['unit-proof-missing','failed-precondition','주문 품목과 생산 근거를 확인해 주세요.'],['permission-denied','permission-denied','회사 직원 권한을 확인해 주세요.'],['secret diagnostic','internal','요청 결과를 확인하지 못했습니다. 다시 확인해 주세요.']]){
   calls.read.mockRejectedValueOnce(new Error(reason));
   await expect(executeOrderProductionBatchCommand(db,actor,command,clock)).rejects.toMatchObject({code,message});
  }
 });
 it('손상된 주문 잠금은 복구 위치로 승격하지 않는다',async()=>{
  const tx={get:vi.fn(async(ref:any)=>({exists:true,data:()=>ref.path==='employees/employee'?{name:'담당',authUid:'uid',companyId:'taebaek'}:{id:'주문',companyId:'taebaek',inventoryOperation:{fullAttemptId:'forged',actorUid:'uid',fullReference:{version:1,companyId:'taebaek',orderId:'다른주문',requestId:'pb1-123e4567-e89b-42d3-a456-426614174000'}}}}))},db:any={doc:(path:string)=>({path}),runTransaction:async(fn:any)=>fn(tx)};
  await expect(readOrderProductionBatchOpen(db,actor,command,clock)).rejects.toThrow('source-unproven');expect(calls.read).not.toHaveBeenCalled();
 });
});

it('소유 인덱스는 같은 회사와 UID의 페이지를 검증하고 25개에서 새 페이지를 연다',async()=>{
 const rows=new Map<string,any>(),db:any={projectId:'demo-index-unit',databaseId:'(default)',doc:(path:string)=>({path})},tx:any={get:async(ref:any)=>({ref,exists:rows.has(ref.path),data:()=>rows.get(ref.path),updateTime:rows.has(ref.path)?new Timestamp(100,1):undefined})};
 const locator={reference:{version:1,companyId:'taebaek',orderId:'주문',requestId:'pb1-123e4567-e89b-42d3-a456-426614174000'},originalOwnerUid:'uid'},entry={locator,action:'complete-partial',requestedAt:'2026-11-02T00:00:00.000Z'};
 const first=await prepareBatchOwnerIndexAppend(tx,db,'taebaek','uid',entry);expect(first.headExists).toBe(false);expect(first.pageExists).toBe(false);expect(first.nextPage.entries).toEqual([{sequence:1,...entry}]);
 rows.set(first.headRef.path,{...first.nextHead,lastSequence:25});rows.set(first.pageRef.path,{...first.nextPage,entries:Array.from({length:25},(_,i)=>({sequence:i+1,...entry,locator:{...locator,reference:{...locator.reference,requestId:'pb1-123e4567-e89b-42d3-a456-'+String(i).padStart(12,'0')}}}))});
 const next=await prepareBatchOwnerIndexAppend(tx,db,'taebaek','uid',entry);expect(next.nextHead).toMatchObject({lastPage:1,lastSequence:26});expect(next.nextPage.entries).toEqual([{sequence:26,...entry}]);expect(next.pageExists).toBe(false);
 rows.get(first.pageRef.path).entries[7].locator={...locator,originalOwnerUid:'different'};await expect(prepareBatchOwnerIndexAppend(tx,db,'taebaek','uid',entry)).rejects.toThrow('source-unproven');
});
