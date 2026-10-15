import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterAll,describe,expect,it,vi} from 'vitest';
import {initializeApp,deleteApp,type App} from 'firebase-admin/app';
import {getFirestore,Timestamp,type Firestore,type DocumentReference} from 'firebase-admin/firestore';
import {prepareAccountNoncashRemoval,commitAccountNoncashRemoval,SOURCE_HASHES,type Document} from './shared/accountNoncashRemoval';
import {hash} from './shared/zeroItemPriceBackup';

// 실제 Admin SDK batch 시험이며 운영 인증·Auth 서버 로그인 시험은 아니다.
describe.skipIf(process.env.ACCOUNT_NONCASH_REMOVAL_EMULATOR_TEST!=='true')('양사 noncash4개의 실제 SDK 원자 정리',()=>{
 let app:App,db:Firestore,refs:DocumentReference[];
 beforeAll(()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082')throw Error('승인된 로컬 주소만 사용합니다.');
  const namespace=randomUUID();app=initializeApp({projectId:'demo-noncash-'+namespace.slice(0,18)},namespace);db=getFirestore(app);
  refs=Array.from({length:4},(_,i)=>db.doc('accountCodes/noncash-removal-'+namespace+'-'+i));
 });
 beforeEach(async()=>{const batch=db.batch();refs.forEach((ref,i)=>batch.set(ref,{
  companyId:i<2?'taebaek':'punghoe',noncash:true,id:'원본과다른저장ID-'+i,code:'합성계정-'+i,name:'합성 검증 계정',
  groupId:'합성그룹',at:new Timestamp(100,123456000),nested:{keep:true,values:[1,'보존',false]},amount:7,
 }));await batch.commit();});
 afterAll(async()=>{if(!db)return;try{const batch=db.batch();refs.forEach(ref=>batch.delete(ref));await batch.commit();}finally{await deleteApp(app);}});
 const read=async():Promise<Document[]> => (await db.getAll(...refs)).map(s=>({path:s.ref.path,data:s.data()!,version:{seconds:s.updateTime!.seconds,nanoseconds:s.updateTime!.nanoseconds}}));
 const instrument=(commit:(batch:ReturnType<Firestore['batch']>)=>Promise<unknown>)=>{
  const calls=vi.fn(()=>{const batch=db.batch(),actual=batch.commit.bind(batch);return new Proxy(batch,{get(target,key){if(key==='commit')return ()=>commit(new Proxy(batch,{get(t,k){return k==='commit'?actual:Reflect.get(t,k,t);}}));const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});});
  return {db:new Proxy(db,{get(target,key){if(key==='batch')return calls;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}}) as Firestore,calls};
 };
 it('양사각2개 true만 삭제하고 실제 영수증 버전으로 정확히 복원한다',async()=>{
  const before=await read(),plan=prepareAccountNoncashRemoval(before,SOURCE_HASHES),approved=hash(plan);
  const receipt=await commitAccountNoncashRemoval(db,plan,before,'apply',approved),after=await read();
  expect(receipt.documents).toHaveLength(4);
  for(const row of plan.documents){const found=after.find(d=>d.path===row.path)!;expect(found.data).toEqual(row.after);expect(found.version).toEqual(receipt.documents.find(d=>d.path===row.path)!.version);}
  const undone=await commitAccountNoncashRemoval(db,plan,after,'undo',approved,receipt),restored=await read();
  expect(restored.map(r=>r.data)).toEqual(before.map(r=>r.data));expect(restored.every(r=>r.data.noncash===true)).toBe(true);
  for(const row of restored)expect(row.version).toEqual(undone.documents.find(d=>d.path===row.path)!.version);
 });
 it('commit 직전 한 문서 CAS 충돌이면 양사4개 삭제가 전부 무반영이다',async()=>{
  const before=await read(),plan=prepareAccountNoncashRemoval(before,SOURCE_HASHES);
  const adapter=instrument(async batch=>{await refs[3].update({amount:8});return batch.commit();});
  await expect(commitAccountNoncashRemoval(adapter.db,plan,before,'apply',hash(plan))).rejects.toThrow();
  expect(adapter.calls).toHaveBeenCalledOnce();expect((await read()).map(r=>r.data)).toEqual(before.map((r,i)=>i===3?{...r.data,amount:8}:r.data));
 });
 it('삭제 뒤 타필드 변경 또는 receipt 오염은 undo batch 생성 전에 막는다',async()=>{
  const before=await read(),plan=prepareAccountNoncashRemoval(before,SOURCE_HASHES),approved=hash(plan);
  const receipt=await commitAccountNoncashRemoval(db,plan,before,'apply',approved),after=await read();
  const adapter=instrument(batch=>batch.commit());
  await expect(commitAccountNoncashRemoval(adapter.db,plan,after,'undo',approved,{...receipt,documents:receipt.documents.slice(1)})).rejects.toThrow();
  await refs[0].update({groupId:'후속변경그룹'});const changed=await read();
  await expect(commitAccountNoncashRemoval(adapter.db,plan,changed,'undo',approved,receipt)).rejects.toThrow();
  expect(adapter.calls).not.toHaveBeenCalled();expect(await read()).toEqual(changed);
 });
 it('다른 회사 편입·false·계획 해시 변조는 현재4문서를 쓰지 못한다',async()=>{
  const before=await read();expect(()=>prepareAccountNoncashRemoval(before.map((r,i)=>i===0?{...r,data:{...r.data,companyId:'punghoe'}}:r),SOURCE_HASHES)).toThrow();
  for(const value of [false,0,null,'true'])expect(()=>prepareAccountNoncashRemoval(before.map((r,i)=>i===0?{...r,data:{...r.data,noncash:value}}:r),SOURCE_HASHES)).toThrow();
  const plan=prepareAccountNoncashRemoval(before,SOURCE_HASHES),adapter=instrument(batch=>batch.commit());
  await expect(commitAccountNoncashRemoval(adapter.db,plan,before,'apply','a'.repeat(64))).rejects.toThrow();
  expect(adapter.calls).not.toHaveBeenCalled();expect(await read()).toEqual(before);
 });
});
