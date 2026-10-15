import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterAll,describe,expect,it,vi} from 'vitest';
import {initializeTestEnvironment,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,deleteDoc,arrayUnion} from 'firebase/firestore';
const gateway=vi.hoisted(()=>({db:undefined as any,attempts:0,retryOnce:false,onRetry:undefined as undefined|(()=>Promise<void>)}));
vi.mock('../firebase',()=>({get db(){return gateway.db;},authReady:Promise.resolve(),functions:undefined,
 auth:{currentUser:{uid:'smartstore-sdk',getIdTokenResult:async()=>({claims:{companyId:'taebaek',employeeId:'smartstore-sdk',isAdmin:true}})}}}));
vi.mock('firebase/firestore',async importOriginal=>{
 const real=await importOriginal<typeof import('firebase/firestore')>();const {FirebaseError}=await import('firebase/app');
 return {...real,runTransaction:(database:any,callback:any,options:any)=>real.runTransaction(database,async tx=>{
  gateway.attempts++;
  if(gateway.attempts===2&&gateway.onRetry)await gateway.onRetry();
  const result=await callback(tx);
  // 실제 SDK의 재시도를 실행한다. 첫 시도는 commit 전에 합성 ABORTED로 종료한다.
  if(gateway.retryOnce&&gateway.attempts===1)throw new FirebaseError('aborted','합성 재시도');
  return result;
 },options)};
});
import {updateItem} from './firebaseService';

// 실제 서비스와 Firestore Rules 인증 문맥을 사용한다. Auth 서버 로그인 검증은 아니다.
describe.skipIf(process.env.SMARTSTORE_SAVE_EMULATOR_TEST!=='true')('사용자 SMARTSTORE 저장의 실제 SDK 경계',()=>{
 let env:RulesTestEnvironment;const paths=new Set<string>();const projectId='demo-smart-save-'+randomUUID().slice(0,17);
 beforeAll(async()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082')throw Error('승인된 로컬 연결 주소만 사용합니다.');
  env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8082,rules:readFileSync('firestore.rules','utf8')}});
  gateway.db=env.authenticatedContext('smartstore-sdk',{companyId:'taebaek',employeeId:'smartstore-sdk',isAdmin:true}).firestore();
 },30000);
 beforeEach(()=>{gateway.attempts=0;gateway.retryOnce=false;gateway.onRetry=undefined;});
 afterAll(async()=>{if(!env)return;try{await env.withSecurityRulesDisabled(async ctx=>{for(const path of paths)await deleteDoc(doc(ctx.firestore(),path));});}finally{await env.cleanup();}},30000);
 const base={companyId:'taebaek',type:'product',name:'합성 품목',stock:7,lots:[],isSmartStore:false,partnerIds:['SMARTSTORE','partner-a']};
 async function seed(data:Record<string,unknown>){const id='smart-save-'+randomUUID(),path='items/'+id;paths.add(path);await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),path),data));return id;}
 async function raw(id:string){let value:Record<string,any>|undefined;await env.withSecurityRulesDisabled(async ctx=>{value=(await getDoc(doc(ctx.firestore(),'items',id))).data();});if(!value)throw Error('자기 합성 문서가 없습니다.');return value;}
 it.each([false,true])('사용자 체크 %s와 exactmarker 제거를 같은 저장에서 반영한다',async value=>{
  const id=await seed({...base,isSmartStore:!value});
  await updateItem('items',id,{isSmartStore:value},{reconcileSmartStoreMarker:true});
  expect(await raw(id)).toMatchObject({isSmartStore:value,partnerIds:['partner-a'],stock:7,lots:[],name:'합성 품목'});
 });
 it('실제 SDK 재시도에서 최신 배열의 동시 추가 관계를 보존한다',async()=>{
  const id=await seed(base);gateway.retryOnce=true;
  gateway.onRetry=()=>env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'items',id),{partnerIds:arrayUnion('partner-concurrent')},{merge:true}));
  await updateItem('items',id,{isSmartStore:false},{reconcileSmartStoreMarker:true});
  expect(gateway.attempts).toBeGreaterThanOrEqual(2);
  expect(await raw(id)).toMatchObject({isSmartStore:false,partnerIds:['partner-a','partner-concurrent'],stock:7});
 });
 it.each(['missing','not-array','no-marker'])('%s 원배열에는 transform이나 새 배열을 만들지 않는다',async kind=>{
  const data:Record<string,unknown>={...base};if(kind==='missing')delete data.partnerIds;else data.partnerIds=kind==='not-array'?'legacy':['partner-a'];
  const id=await seed(data);await updateItem('items',id,{isSmartStore:false},{reconcileSmartStoreMarker:true});
  const saved=await raw(id);if(kind==='missing')expect(saved).not.toHaveProperty('partnerIds');else expect(saved.partnerIds).toEqual(data.partnerIds);
 });
 it('기존3인수 저장과 raw품목은 채널 표식을 자동 정리하지 않는다',async()=>{
  const old=await seed(base);await updateItem('items',old,{isSmartStore:false});expect((await raw(old)).partnerIds).toEqual(base.partnerIds);
  const rawItem=await seed({...base,type:'raw'});await updateItem('items',rawItem,{isSmartStore:false},{reconcileSmartStoreMarker:true});expect((await raw(rawItem)).partnerIds).toEqual(base.partnerIds);
 });
 it('타회사·삭제문서·낡은 재고 사본·동시배열 요청은 원문을 변경하지 못한다',async()=>{
  const foreign=await seed({...base,companyId:'punghoe'}),before=await raw(foreign);
  await expect(updateItem('items',foreign,{isSmartStore:false},{reconcileSmartStoreMarker:true})).rejects.toThrow();expect(await raw(foreign)).toEqual(before);
  const missing='smart-missing-'+randomUUID();await expect(updateItem('items',missing,{isSmartStore:false},{reconcileSmartStoreMarker:true})).rejects.toThrow();
  const id=await seed({...base,inventoryWriterProtocolVersion:1,inventoryWriteRevision:3});const original=await raw(id);
  await expect(updateItem('items',id,{name:'낡은 사본',stock:1,isSmartStore:false},{reconcileSmartStoreMarker:true})).rejects.toThrow();
  await expect(updateItem('items',id,{isSmartStore:false,partnerIds:['replace']},{reconcileSmartStoreMarker:true})).rejects.toThrow();
  await expect(updateItem('items',id,{isSmartStore:false,'partnerIds.0':'replace'},{reconcileSmartStoreMarker:true})).rejects.toThrow();
  expect(await raw(id)).toEqual(original);
 });
});
