import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {initializeApp,deleteApp,type App} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {submitReturnRequest,type ReturnSubmissionInput} from './submitReturnRequestCommand';
const ready=process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8082';
const run=`submission-${crypto.randomUUID()}`,paths=new Set<string>();let app:App;
describe.skipIf(!ready)('반품 접수 terminal 감사 실제 transaction',()=>{
 beforeAll(()=>{app=initializeApp({projectId:'demo-taebaekfood-local'},run);});
 afterAll(async()=>{if(!app)return;for(const path of paths)await getFirestore(app).doc(path).delete();await deleteApp(app);},90000);
 async function fixture(valid=true):Promise<ReturnSubmissionInput>{const db=getFirestore(app),requestId=`${run}-${crypto.randomUUID()}`,partnerId=`${requestId}-partner`,itemId=`${requestId}-item`;
  for(const path of [`partners/${partnerId}`,`items/${itemId}`,`returnRequests/${requestId}`,`returnSubmissionOperations/${requestId}`])paths.add(path);
  await db.doc(`partners/${partnerId}`).set({companyId:'taebaek',name:'시험'});await db.doc(`items/${itemId}`).set({companyId:'taebaek',name:'시험'});
  for(const code of ['404','108','255']){const path=`accountCodes/${requestId}-${code}`;paths.add(path);await db.doc(path).set({companyId:'taebaek',code});}
  // 실패 케이스도 실제 도메인 검증까지 도달하며 계정 fixture를 건드리지 않는다.
  return {companyId:'taebaek',requestId,request:{companyId:'taebaek',partnerId,partnerName:'시험',returnType:'매출',status:'pending',totalAmount:110,createdAt:'2026-10-09T00:00:00Z',items:[{itemId,quantity:1,isResellable:false,supply:100,tax:10,accountCode:valid?'404':'108'}]}};
 }
 it('같은 접수의 동시 성공은 하나만 생성하고 처리 후 재개는 최신 원문과 번호를 보존한다',async()=>{const db=getFirestore(app),body=await fixture(),actor=`${run}-actor`;const before=(await db.collection('voucherSeq').get()).docs.map(row=>({id:row.id,data:row.data()}));const result=await Promise.all([submitReturnRequest(db,'taebaek',actor,body),submitReturnRequest(db,'taebaek',actor,body)]);expect(result.map(row=>row.status).sort()).toEqual(['created','duplicate']);const ref=db.doc(`returnRequests/${body.requestId}`);await ref.update({status:'processed',items:[{itemId:body.request.items[0].itemId,quantity:2}],totalAmount:220});const processed=await ref.get();expect((await submitReturnRequest(db,'taebaek',actor,body)).status).toBe('duplicate');expect((await ref.get()).updateTime).toEqual(processed.updateTime);expect((await db.collection('voucherSeq').get()).docs.map(row=>({id:row.id,data:row.data()}))).toEqual(before);},90000);
 it('동일 거절 원문의 동시 요청·재시도는 rejected 감사 하나만 확정하고 접수·금융 쓰기0',async()=>{const db=getFirestore(app),body=await fixture(false),actor=`${run}-actor`;const results=await Promise.allSettled([submitReturnRequest(db,'taebaek',actor,body),submitReturnRequest(db,'taebaek',actor,body)]);
  for(const result of results){expect(result.status).toBe('rejected');if(result.status==='rejected')expect(result.reason).toMatchObject({details:{terminalConfirmed:true,receiptStatus:'rejected',requestId:body.requestId,actorId:actor}});}
  const audit=await db.doc(`returnSubmissionOperations/${body.requestId}`).get();expect(audit.data()?.status).toBe('rejected');expect((await db.doc(`returnRequests/${body.requestId}`).get()).exists).toBe(false);
  await expect(submitReturnRequest(db,'taebaek',actor,body)).rejects.toMatchObject({details:{receiptStatus:'rejected'}});expect((await db.doc(`returnSubmissionOperations/${body.requestId}`).get()).updateTime).toEqual(audit.updateTime);
 },90000);
 it('확정 거절 ID를 유효한 다른 본문으로 바꿔도 accepted로 전환하거나 원문을 덮지 않는다',async()=>{const db=getFirestore(app),body=await fixture(false),actor=`${run}-actor`;await expect(submitReturnRequest(db,'taebaek',actor,body)).rejects.toThrow();const original=(await db.doc(`returnSubmissionOperations/${body.requestId}`).get()).data();body.request.items[0].accountCode='404';await expect(submitReturnRequest(db,'taebaek',actor,body)).rejects.toMatchObject({details:undefined});expect((await db.doc(`returnRequests/${body.requestId}`).get()).exists).toBe(false);expect((await db.doc(`returnSubmissionOperations/${body.requestId}`).get()).data()).toEqual(original);},90000);
});
