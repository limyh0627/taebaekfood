import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterAll,describe,expect,it,vi} from 'vitest';
import {initializeApp,deleteApp,type App} from 'firebase-admin/app';
import {getFirestore,Timestamp,type Firestore,type DocumentReference} from 'firebase-admin/firestore';
import {prepareDeprecatedFieldRemoval,commitDeprecatedFieldRemoval,SOURCE_HASHES,type Document} from './shared/deprecatedFieldRemoval';
import {hash} from './shared/zeroItemPriceBackup';

// 실제 Admin SDK batch 검증이다. 운영 인증이나 Auth 서버 로그인 시험은 아니다.
describe.skipIf(process.env.DEPRECATED_FIELD_REMOVAL_EMULATOR_TEST!=='true')('폐기 필드9개의 실제 SDK 원자 정리',()=>{
 let app:App,db:Firestore,refs:DocumentReference[];
 const sourceHashes=SOURCE_HASHES;
 beforeAll(()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082')throw Error('승인된 로컬 주소만 사용합니다.');
  const namespace=randomUUID();
  app=initializeApp({projectId:'demo-field-removal-'+namespace.slice(0,18)},namespace);db=getFirestore(app);
  refs=[db.doc('items/field-removal-'+namespace),...Array.from({length:8},(_,i)=>db.doc('pallets/field-removal-'+namespace+'-'+i))];
 });
 beforeEach(async()=>{
  const batch=db.batch();
  refs.forEach((ref,i)=>batch.set(ref,{companyId:'taebaek',...(i?{inUse:i===1?0:i+0.5}:{lotsAreTotal:false}),
   cost:42,stock:7,quantity:3,at:new Timestamp(100,123456000),nested:{keep:true,values:[1,'보존',false]},
   ...(i?{}:{lots:[{status:'active',kgRemaining:12,qtyRemaining:2}]})}));
  await batch.commit();
 });
 afterAll(async()=>{
  if(!db)return;
  try{const batch=db.batch();refs.forEach(ref=>batch.delete(ref));await batch.commit();}
  finally{await deleteApp(app);}
 });
 const read=async():Promise<Document[]> => (await db.getAll(...refs)).map(s=>({path:s.ref.path,data:s.data()!,version:{seconds:s.updateTime!.seconds,nanoseconds:s.updateTime!.nanoseconds}}));
 const instrument=(commit:(batch:ReturnType<Firestore['batch']>)=>Promise<unknown>)=>{
  const calls=vi.fn(()=>{const batch=db.batch();const actual=batch.commit.bind(batch);return new Proxy(batch,{get(target,key){if(key==='commit')return ()=>commit(new Proxy(batch,{get(t,k){return k==='commit'?actual:Reflect.get(t,k,t);}}));const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});});
  return {db:new Proxy(db,{get(target,key){if(key==='batch')return calls;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}}) as Firestore,calls};
 };
 it('9개 한 필드만 삭제하고 실제 영수증 버전으로 false와 숫자 타입을 복원한다',async()=>{
  const before=await read(),plan=prepareDeprecatedFieldRemoval(before,sourceHashes),approved=hash(plan);
  const receipt=await commitDeprecatedFieldRemoval(db,plan,before,'apply',approved);
  const after=await read();expect(receipt.documents).toHaveLength(9);
  for(const row of plan.documents){const found=after.find(d=>d.path===row.path)!;expect(found.data).toEqual(row.after);expect(found.version).toEqual(receipt.documents.find(d=>d.path===row.path)!.version);}
  const undo=await commitDeprecatedFieldRemoval(db,plan,after,'undo',approved,receipt);
  const restored=await read();expect(restored.map(r=>r.data)).toEqual(before.map(r=>r.data));
  expect(restored[0].data.lotsAreTotal).toBe(false);expect(restored[1].data.inUse).toBe(0);
  for(const row of restored)expect(row.version).toEqual(undo.documents.find(d=>d.path===row.path)!.version);
 });
 it('commit 직전 한 문서가 바뀌면 CAS 실패로9개 삭제가 전부 반영되지 않는다',async()=>{
  const before=await read(),plan=prepareDeprecatedFieldRemoval(before,sourceHashes);
  const adapter=instrument(async batch=>{await refs[8].update({stock:8});return batch.commit();});
  await expect(commitDeprecatedFieldRemoval(adapter.db,plan,before,'apply',hash(plan))).rejects.toThrow();
  const after=await read();expect(adapter.calls).toHaveBeenCalledOnce();
  expect(after.map((row,i)=>row.data)).toEqual(before.map((row,i)=>i===8?{...row.data,stock:8}:row.data));
 });
 it('삭제 뒤 다른 필드 변경이나 불완전 영수증은 undo batch 생성 전에 거절한다',async()=>{
  const before=await read(),plan=prepareDeprecatedFieldRemoval(before,sourceHashes),approved=hash(plan);
  const receipt=await commitDeprecatedFieldRemoval(db,plan,before,'apply',approved);
  await refs[8].update({quantity:9});const changed=await read();
  const adapter=instrument(batch=>batch.commit());
  await expect(commitDeprecatedFieldRemoval(adapter.db,plan,changed,'undo',approved,receipt)).rejects.toThrow();
  await expect(commitDeprecatedFieldRemoval(adapter.db,plan,changed,'undo',approved,{...receipt,documents:receipt.documents.slice(1)})).rejects.toThrow();
  expect(adapter.calls).not.toHaveBeenCalled();expect(await read()).toEqual(changed);
 });
 it('실제 commit 뒤 응답을 잃어도 재전송하지 않고 승인 hash 불일치는 쓰기 전에 거절한다',async()=>{
  const before=await read(),plan=prepareDeprecatedFieldRemoval(before,sourceHashes),approved=hash(plan);
  const blocked=instrument(batch=>batch.commit());
  await expect(commitDeprecatedFieldRemoval(blocked.db,plan,before,'apply','c'.repeat(64))).rejects.toThrow();expect(blocked.calls).not.toHaveBeenCalled();
  const lost=instrument(async batch=>{await batch.commit();throw Error('합성 응답 유실');});
  await expect(commitDeprecatedFieldRemoval(lost.db,plan,before,'apply',approved)).rejects.toThrow();
  expect(lost.calls).toHaveBeenCalledOnce();const after=await read();for(const row of plan.documents)expect(after.find(d=>d.path===row.path)!.data).toEqual(row.after);
 });
});
