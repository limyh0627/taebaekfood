import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { executeCatalogOrderReferenceProof } from './catalogOrderReferenceProof';
import { encodeCatalogValue } from './shared/catalogOrderReferenceProof';
const available=process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8082';
describe.skipIf(!available)('품목 참조 proof 로컬 SDK',()=>{
 const run='proof-'+randomUUID(),co='taebaek',actor={uid:run,token:{companyId:co,employeeId:'e'}};
 let app:admin.app.App,db:admin.firestore.Firestore;const owned=new Set<string>();
 const ref=(c:string,id:string)=>{owned.add(c+'/'+id);return db.collection(c).doc(id);};
 const request=()=>({version:1,companyId:co,orderId:run,orderExists:false,beforeRevision:0,catalogRevision:1,status:'PENDING',items:encodeCatalogValue([{itemId:run,detail:{seconds:1,nanoseconds:2}}])});
 beforeAll(async()=>{app=admin.initializeApp({projectId:'demo-taebaekfood-local'},run);db=admin.firestore(app);await ref('catalogItemMergeState',co).set({companyId:co,revision:1,testRunId:run});await ref('items',run).set({companyId:co,stock:0});});
 afterAll(async()=>{for(const path of owned){const r=db.doc(path);if(path==='catalogItemMergeState/'+co&&(await r.get()).get('testRunId')!==run)continue;await r.delete();expect((await r.get()).exists).toBe(false);}await app.delete();});
 it('증거 생성·원문 재시도·실제 Timestamp와 일반 지도 구분',async()=>{const input=request();input.items=encodeCatalogValue([{itemId:run,at:new Date('2026-10-18T00:00:00Z'),detail:{seconds:1,nanoseconds:2}}]);const result=await executeCatalogOrderReferenceProof(db,actor,input);const r=ref('catalogOrderReferenceProofs',result.proofId!);const first=await r.get();expect(first.get('items')[0].at).toBeInstanceOf(admin.firestore.Timestamp);expect(first.get('items')[0].detail).toEqual({seconds:1,nanoseconds:2});expect(await executeCatalogOrderReferenceProof(db,actor,input)).toEqual(result);expect((await r.get()).updateTime!.isEqual(first.updateTime!)).toBe(true);});
 it('통합 뒤 donor와 옛 epoch 재시도는 쓰기 전에 거절한다',async()=>{await ref('inventoryWriterDeletions',co+'__'+run).set({companyId:co,itemId:run,mergedIntoItemId:'keeper'});await expect(executeCatalogOrderReferenceProof(db,actor,request())).rejects.toMatchObject({code:'failed-precondition'});await ref('catalogItemMergeState',co).update({revision:2});await expect(executeCatalogOrderReferenceProof(db,actor,request())).rejects.toMatchObject({code:'aborted'});});
});
