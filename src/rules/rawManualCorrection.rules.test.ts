import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createEmulatorTestPolicy,cleanupOwnedResources} from '../test/emulatorTestPolicy';
import type {RulesTestEnvironment} from '@firebase/rules-unit-testing';
const rules=readFileSync('firestore.rules','utf8');
it('수동정정 영수증은 포괄허용에서 제외하고 클라이언트 접근을 열지 않는다',()=>{
 expect(rules.match(/function hasOwnRule\(c\)[\s\S]*?\n    }/)?.[0]).toContain("'rawManualCorrectionReceipts'");
 expect(rules).toContain('match /rawManualCorrectionReceipts/{document=**} { allow read, write: if false; }');
});
it('직접 원장 쓰기는 before와 after의 수동 표식을 함께 검사한다',()=>{
 expect(rules).toContain('!rawManualCorrectionMarked(before) && !rawManualCorrectionMarked(request.resource.data)');
});
const policy=createEmulatorTestPolicy(process.env,'raw-manual-rules',randomUUID);
let env:RulesTestEnvironment|undefined;
let runtime:typeof import('@firebase/rules-unit-testing');
let sdk:typeof import('firebase/firestore');
const normal={companyId:'taebaek',operationId:'purchase-1',source:{type:'purchase',id:'po'},kind:'receive',type:'auto',inventoryWriterProtocolVersion:1,inventoryWriteRevision:1};
describe.skipIf(!policy.enabled)('수동정정 서버경계 실제 Rules SDK (별도 승인 실행)',()=>{
 beforeAll(async()=>{
  policy.assertCurrentEnvironment(process.env);policy.assertOwned(policy.projectId);
  runtime=await import('@firebase/rules-unit-testing');sdk=await import('firebase/firestore');
  policy.assertCurrentEnvironment(process.env);
  try{env=await runtime.initializeTestEnvironment({projectId:policy.projectId,firestore:{host:policy.host,port:policy.port,rules}});policy.assertCurrentEnvironment(process.env);policy.assertOwned(env.projectId);}
  catch(error){await cleanupOwnedResources([()=>env?.cleanup()],error);throw error;}
 });
 afterAll(async()=>{await cleanupOwnedResources([async()=>{if(env){policy.assertCurrentEnvironment(process.env);policy.assertOwned(env.projectId);await env.clearFirestore();}},()=>env?.cleanup()]);});
 const context=()=>{policy.assertCurrentEnvironment(process.env);policy.assertOwned(env!.projectId);return env!.authenticatedContext('employee',{companyId:'taebaek',employeeId:'e',isAdmin:false}).firestore();};
 it('직원도 영수증의 위조·조회·수정·삭제를 할 수 없다',async()=>{
  const db=context(),ref=sdk.doc(db,'rawManualCorrectionReceipts/receipt');
  await runtime.assertFails(sdk.setDoc(ref,{companyId:'taebaek',actorUid:'employee'}));
  await env!.withSecurityRulesDisabled(async ctx=>{await sdk.setDoc(sdk.doc(ctx.firestore(),ref.path),{companyId:'taebaek',actorUid:'employee'});});
  await runtime.assertFails(sdk.getDoc(ref));await runtime.assertFails(sdk.updateDoc(ref,{status:'applied'}));await runtime.assertFails(sdk.deleteDoc(ref));
 });
 it('옛 prefix·source·correction 표식과 신규 namespace를 막되 정상 입고·압착·역분개를 보존한다',async()=>{
  const db=context();
  const variants=[{operationId:'rm-corr-1'},{operationId:'rm-stocktake-1'},{operationId:'raw-manual-v1-00000000-0000-0000-0000-000000000001'},{source:{type:'adjustment',id:'rm-corr-1'}},{kind:'consume',type:'correction',source:{type:'adjustment',id:'other'}},{kind:'stocktake',type:'correction',source:{type:'stocktake',id:'other'}}];
  for(let i=0;i<variants.length;i++)await runtime.assertFails(sdk.setDoc(sdk.doc(db,'rawMaterialLedger/blocked-'+i),{...normal,...variants[i]}));
  for(const [index,row]of [{...normal},{...normal,kind:'consume',type:'manual',source:{type:'manual',id:'press'}},{...normal,kind:'reverse',type:'correction',source:{type:'reversal',id:'original'}}].entries())await runtime.assertSucceeds(sdk.setDoc(sdk.doc(db,'rawMaterialLedger/normal-'+index),row));
 });
 it('기존 수동 표식 제거 update와 결합거래도 전체 거절한다',async()=>{
  const db=context();await env!.withSecurityRulesDisabled(async ctx=>{await sdk.setDoc(sdk.doc(ctx.firestore(),'rawMaterialLedger/legacy'),{...normal,operationId:'rm-corr-1',type:'correction',source:{type:'adjustment',id:'rm-corr-1'}});await sdk.setDoc(sdk.doc(ctx.firestore(),'items/manual-raw'),{companyId:'taebaek',stock:10});});
  await runtime.assertFails(sdk.setDoc(sdk.doc(db,'rawMaterialLedger/legacy'),{...normal,inventoryWriteRevision:2}));
  const batch=sdk.writeBatch(db);batch.update(sdk.doc(db,'items/manual-raw'),{stock:0,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1});batch.set(sdk.doc(db,'rawInventories/manual-state'),{companyId:'taebaek',stockKg:0,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1});batch.set(sdk.doc(db,'rawMaterialLedger/manual-batch'),{...normal,operationId:'rm-corr-batch'});await runtime.assertFails(batch.commit());
  await env!.withSecurityRulesDisabled(async ctx=>{expect((await sdk.getDoc(sdk.doc(ctx.firestore(),'items/manual-raw'))).data()!.stock).toBe(10);expect((await sdk.getDoc(sdk.doc(ctx.firestore(),'rawInventories/manual-state'))).exists()).toBe(false);});
 });
 it('비수동 legacy의 비map source create와 정상 revision update를 보존한다',async()=>{
  const db=context();
  for(const [index,source]of [null,'legacy-source',42].entries()){
   const ref=sdk.doc(db,'rawMaterialLedger/nonmap-'+index);
   await runtime.assertSucceeds(sdk.setDoc(ref,{...normal,source}));
   await runtime.assertSucceeds(sdk.updateDoc(ref,{inventoryWriteRevision:2,note:'정상 legacy 수정'}));
  }
 });
 it('비map source라도 옛·신규 수동 operationId prefix는 create와 표식제거 update를 차단한다',async()=>{
  const db=context();
  for(const [index,operationId]of ['rm-corr-1','rm-stocktake-1','raw-manual-v1-00000000-0000-0000-0000-000000000001'].entries()){
   const ref=sdk.doc(db,'rawMaterialLedger/nonmap-manual-'+index);
   await runtime.assertFails(sdk.setDoc(ref,{...normal,operationId,source:null}));
   await env!.withSecurityRulesDisabled(async ctx=>{await sdk.setDoc(sdk.doc(ctx.firestore(),ref.path),{...normal,operationId,source:42});});
   await runtime.assertFails(sdk.setDoc(ref,{...normal,inventoryWriteRevision:2,source:'legacy-source'}));
  }
 });
});
