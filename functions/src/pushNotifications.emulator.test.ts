import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import * as admin from 'firebase-admin';
import {randomUUID} from 'node:crypto';
import {sendPushNotifications,type PushDependencies} from './pushNotifications';
const enabled=process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8182';
let app:admin.app.App,db:admin.firestore.Firestore;
const owned:admin.firestore.DocumentReference[]=[];
const data={title:'합성',body:'합성',tag:'synthetic',view:'orders'};
describe.skipIf(!enabled)('푸시 미등록 토큰 정리 실제 Firestore TX',()=>{
 beforeAll(()=>{const projectId='demo-push-server-'+randomUUID();app=admin.initializeApp({projectId},projectId);db=admin.firestore(app);});
 afterAll(async()=>{await Promise.all(owned.map(ref=>ref.delete()));expect((await Promise.all(owned.map(ref=>ref.get()))).every(s=>!s.exists)).toBe(true);await app.delete();});
 it.each(['same','changed-company','deleted','replaced-token','invalid-argument','throw'] as const)('%s에서는 현재 소유 문서·원 토큰만 확인한다',async mode=>{
  const id='push-'+randomUUID(),ref=db.collection('employees').doc(id);owned.push(ref);expect((await ref.get()).exists).toBe(false);
  const initial={companyId:'taebaek',fcmTokens:['old-synthetic','new-synthetic'],name:'합성',preserve:7};await ref.set(initial);
  let sent=0;const deps={db,messaging:{sendEachForMulticast:async()=>{
   sent++;if(mode==='changed-company')await ref.update({companyId:'punghoe'});if(mode==='deleted')await ref.delete();if(mode==='replaced-token')await ref.update({fcmTokens:['new-synthetic']});
   if(mode==='throw')throw new Error('합성 일시 오류');
   return {successCount:0,failureCount:1,responses:[{success:false,error:{code:mode==='invalid-argument'?'messaging/invalid-argument':'messaging/registration-token-not-registered'}}]};
  }}} as unknown as PushDependencies;
  if(mode==='throw')await expect(sendPushNotifications(deps,'taebaek',[{id,tokens:['old-synthetic']}],data,'test')).rejects.toThrow('합성');
  else await sendPushNotifications(deps,'taebaek',[{id,tokens:['old-synthetic']}],data,'test');
  expect(sent).toBe(1);const after=await ref.get();
  if(mode==='deleted')expect(after.exists).toBe(false);
  else expect(after.data()).toEqual({...initial,companyId:mode==='changed-company'?'punghoe':'taebaek',fcmTokens:mode==='same'||mode==='replaced-token'?['new-synthetic']:initial.fcmTokens});
 });
});
