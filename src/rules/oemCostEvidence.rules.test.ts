import {afterAll,beforeAll,beforeEach,describe,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {deleteDoc,deleteField,doc,setDoc,updateDoc} from 'firebase/firestore';
const address=process.env.FIRESTORE_EMULATOR_HOST;
const available=['127.0.0.1:8082','127.0.0.1:8182'].includes(address??'');
let env:RulesTestEnvironment;
const db=(companyId='taebaek')=>env.authenticatedContext(companyId,{employeeId:'operator',companyId,isAdmin:true}).firestore();
const evidence={version:1,ownerCompanyId:'taebaek',rawMaterials:[{rawItemId:'raw',kg:10,supplyAmount:1000}],packaging:{confirmed:true,supplyAmount:0},capturedAt:'2026-10-11T00:00:00Z'};
const po={companyId:'taebaek',poType:'oem',status:'pending',oemSent:[{rawItemId:'raw',material:'참깨',kg:10}],oemCostEvidence:evidence,oemIssueFingerprint:'original'};
describe.skipIf(!available)('신규 OEM 원가 근거 보안 경계',()=>{
 beforeAll(async()=>{const [host,port]=address!.split(':');env=await initializeTestEnvironment({projectId:'demo-oem-cost-rules',firestore:{host,port:Number(port),rules:readFileSync('firestore.rules','utf8')}});});
 afterAll(async()=>{await env?.cleanup();});
 beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(async ctx=>{await setDoc(doc(ctx.firestore(),'purchaseOrders/fixed'),po);await setDoc(doc(ctx.firestore(),'purchaseOrders/legacy'),{companyId:'taebaek',status:'pending'});});});
 it('발주 때 근거를 기록하고 후속 상태·메모는 그대로 수정할 수 있다',async()=>{
  await assertSucceeds(setDoc(doc(db(),'purchaseOrders/new'),po));
  await assertSucceeds(updateDoc(doc(db(),'purchaseOrders/fixed'),{status:'invoiced',note:'수정 메모'}));
  await assertSucceeds(updateDoc(doc(db(),'purchaseOrders/legacy'),{status:'invoiced',note:'기존 발주'}));
 });
 it('확인 공급금액·출고량·발주 지문을 나중에 바꾸거나 지우지 못한다',async()=>{
  const fixed=doc(db(),'purchaseOrders/fixed');
  await assertFails(updateDoc(fixed,{oemCostEvidence:{...evidence,packaging:{confirmed:true,supplyAmount:50}}}));
  await assertFails(updateDoc(fixed,{oemCostEvidence:deleteField()}));
  await assertFails(updateDoc(fixed,{oemSent:[{rawItemId:'raw',material:'참깨',kg:9}]}));
  await assertFails(updateDoc(fixed,{oemIssueFingerprint:'changed'}));
 });
 it('입고 출처나 확정 원가는 관리자 클라이언트도 직접 생성·추가하지 못한다',async()=>{
  await assertFails(setDoc(doc(db(),'purchaseOrders/forged'),{...po,oemCostEvidenceSource:'receipt'}));
  await assertFails(setDoc(doc(db(),'purchaseOrders/cost'),{...po,oemBatchCost:{version:1,status:'confirmed'}}));
  await assertFails(updateDoc(doc(db(),'purchaseOrders/legacy'),{oemCostEvidence:evidence,oemCostEvidenceSource:'receipt'}));
  await assertFails(updateDoc(doc(db(),'purchaseOrders/fixed'),{oemBatchCost:{version:1,status:'confirmed'}}));
 });
 it('서버가 고정한 입고 근거와 원가는 일반 상태 수정으로 덮어쓰지 못한다',async()=>{
  const confirmed={version:1,status:'confirmed',feeSupplyAmount:100};
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'purchaseOrders/received'),{...po,status:'received',linkedStatementId:'OEMFEE-received',linkedStatementAt:'2026-10-11',oemCostEvidenceSource:'receipt',oemBatchCost:confirmed}));
  const received=doc(db(),'purchaseOrders/received');
  await assertSucceeds(updateDoc(received,{note:'입고 메모'}));
  await assertFails(updateDoc(received,{linkedStatementId:deleteField()}));
  await assertFails(updateDoc(received,{linkedStatementId:'other'}));
  await assertFails(updateDoc(received,{linkedStatementAt:deleteField()}));
  await assertFails(deleteDoc(received));
  await assertFails(updateDoc(received,{oemBatchCost:{...confirmed,feeSupplyAmount:200}}));
  await assertFails(updateDoc(received,{oemCostEvidenceSource:'issue'}));
  await assertFails(updateDoc(doc(db('punghoe'),'purchaseOrders/received'),{note:'다른 회사'}));
 });
});
