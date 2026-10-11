import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import type { ChatMessage } from '../types';
import { sendSharedChatMessage } from './sharedChatMessageService';

const gateway=vi.hoisted(()=>({db:undefined as any,auth:undefined as any}));
vi.mock('../firebase',()=>({get db(){return gateway.db;},get auth(){return gateway.auth;},authReady:Promise.resolve()}));

describe.skipIf(process.env.SHARED_CHAT_EMULATOR_TEST!=='true')('공유 메시지 실제 Auth·Firestore 원문 중복 방지',()=>{
 const projectId='demo-taebaekfood-local',prefix='shared-chat-'+randomUUID();
 const shareId=randomUUID(),legacyId=randomUUID(),concurrentId=randomUUID();
 const roomId=prefix+'-own',otherRoomId=prefix+'-not-member';
 const paths=[`chatRooms/${roomId}`,`chatRooms/${otherRoomId}`,...[shareId,legacyId,concurrentId].map(id=>`chatMessages/MSG-share-${id}`)];
 const accounts=new Map<string,{uid:string,email:string,password:string,employeeId:string}>();
 let app:any,adminApp:any,adminDb:any,adminAuth:any;
 const message=(id=shareId):ChatMessage=>({id:'MSG-share-'+id,companyId:'taebaek',roomId,senderId:accounts.get('taebaek')!.employeeId,senderName:'합성 공유 직원',text:'원문',createdAt:'2026-10-11T12:00:00.000Z',fileUrl:'https://example.invalid/synthetic.pdf',fileName:'synthetic.pdf',fileSize:3});
 beforeAll(async()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082')throw Error('Firestore 주소 불일치');
  if(process.env.FIREBASE_AUTH_EMULATOR_HOST&&process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('Auth 주소 불일치');
  if(process.env.GCLOUD_PROJECT&&process.env.GCLOUD_PROJECT!==projectId)throw Error('프로젝트 불일치');
  process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8082';process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';process.env.GCLOUD_PROJECT=projectId;
  adminApp=initializeAdminApp({projectId},prefix+'-admin');adminDb=getAdminFirestore(adminApp);adminAuth=getAdminAuth(adminApp);
  for(const companyId of ['taebaek','punghoe']){
   const uid=prefix+'-'+companyId,employeeId=prefix+'-employee-'+companyId,email=uid+'@example.invalid',password=randomUUID()+'A1!';
   await adminAuth.createUser({uid,email,password});accounts.set(companyId,{uid,email,password,employeeId});
   await adminAuth.setCustomUserClaims(uid,{employeeId,companyId,isAdmin:false});
  }
  app=initializeApp({projectId,apiKey:'local-emulator-only'},prefix+'-sdk');gateway.db=getFirestore(app);connectFirestoreEmulator(gateway.db,'127.0.0.1',8082);
  gateway.auth=getAuth(app);connectAuthEmulator(gateway.auth,'http://127.0.0.1:9099',{disableWarnings:true});
  const own=accounts.get('taebaek')!;await signInWithEmailAndPassword(gateway.auth,own.email,own.password);
  for(const [id,employeeId] of [[roomId,own.employeeId],[otherRoomId,prefix+'-other-employee']])await adminDb.doc('chatRooms/'+id).create({companyId:'taebaek',participantIds:[employeeId],participantCompanies:{[employeeId]:'taebaek'},isGroup:false,lastUpdatedAt:'2026-10-11T12:00:00.000Z'});
 },30000);
 afterAll(async()=>{
  const errors:string[]=[];
  if(adminDb)for(const path of paths){try{await adminDb.doc(path).delete();expect((await adminDb.doc(path).get()).exists).toBe(false);}catch{errors.push(path+' 정리 실패');}}
  if(adminAuth)for(const account of accounts.values()){try{await adminAuth.deleteUser(account.uid);await expect(adminAuth.getUser(account.uid)).rejects.toMatchObject({code:'auth/user-not-found'});}catch{errors.push(account.uid+' 정리 실패');}}
  if(app)await deleteApp(app);if(adminApp)await deleteAdminApp(adminApp);expect(errors).toEqual([]);
 },30000);
 it('최초 저장 뒤 같은 원문 재확인은 쓰기0이고 저장시각이 유지된다',async()=>{
  expect(await sendSharedChatMessage(message(),shareId)).toBe('created');
  const before=await adminDb.doc(paths[2]).get();expect(before.data()).toEqual(message());
  expect(await sendSharedChatMessage(message(),shareId)).toBe('duplicate');
  const after=await adminDb.doc(paths[2]).get();expect(after.data()).toEqual(before.data());expect(after.updateTime.isEqual(before.updateTime)).toBe(true);
 },30000);
 it('같은 번호의 방·내용·첨부 변경은 원문과 저장시각을 유지한다',async()=>{
  const before=await adminDb.doc(paths[2]).get();
  for(const patch of [{roomId:otherRoomId},{text:'변경'},{fileUrl:'https://example.invalid/changed.pdf'}])await expect(sendSharedChatMessage({...message(),...patch},shareId)).rejects.toThrow();
  const after=await adminDb.doc(paths[2]).get();expect(after.data()).toEqual(before.data());expect(after.updateTime.isEqual(before.updateTime)).toBe(true);
 },30000);
 it('기존 id 없는 문서도 실제 문서 번호로 동일 원문을 확인하고 반응을 덮지 않는다',async()=>{
  const {id,...raw}=message(legacyId);await adminDb.doc(paths[3]).create({...raw,reactions:{'👍':['someone']}});
  const before=await adminDb.doc(paths[3]).get();expect(await sendSharedChatMessage(message(legacyId),legacyId)).toBe('duplicate');
  const after=await adminDb.doc(paths[3]).get();expect(after.data()).toEqual(before.data());expect(after.updateTime.isEqual(before.updateTime)).toBe(true);
 },30000);
 it('동시에 같은 원문을 보내도 생성 한 번과 중복 확인 한 번만 한다',async()=>{
  const results=await Promise.all([sendSharedChatMessage(message(concurrentId),concurrentId),sendSharedChatMessage(message(concurrentId),concurrentId)]);
  expect(results.sort()).toEqual(['created','duplicate']);expect((await adminDb.doc(paths[4]).get()).data()).toEqual(message(concurrentId));
 },30000);
 it('직원 claim 위조와 비참여 방 전송은 거절한다',async()=>{
  await expect(sendSharedChatMessage({...message(),senderId:prefix+'-fake'},shareId)).rejects.toThrow('회사·로그인');
  await expect(sendSharedChatMessage({...message(),roomId:otherRoomId},shareId)).rejects.toThrow('참여 중인 대화방');
 },30000);
 it('다른 회사 로그인과 로그아웃은 기존 메시지를 바꾸지 않는다',async()=>{
  const before=await adminDb.doc(paths[2]).get(),other=accounts.get('punghoe')!;
  await signOut(gateway.auth);await signInWithEmailAndPassword(gateway.auth,other.email,other.password);
  await expect(sendSharedChatMessage(message(),shareId)).rejects.toThrow('회사·로그인');
  await signOut(gateway.auth);await expect(sendSharedChatMessage(message(),shareId)).rejects.toThrow('로그인 후');
  const after=await adminDb.doc(paths[2]).get();expect(after.data()).toEqual(before.data());expect(after.updateTime.isEqual(before.updateTime)).toBe(true);
 },30000);
});
