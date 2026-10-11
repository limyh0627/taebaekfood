import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { companyScopedWriteData, updateItem } from './firebaseService';

const gateway = vi.hoisted(() => ({ db: undefined as any, auth: undefined as any }));
vi.mock('../firebase', () => ({
  get db() { return gateway.db; }, get auth() { return gateway.auth; }, authReady: Promise.resolve(),
}));

describe.skipIf(process.env.HACCP_INCOMING_EMULATOR_TEST !== 'true')('입고검사 수정 실제 Auth·Firestore 회사 경계', () => {
  const projectId = 'demo-taebaekfood-local';
  const prefix = 'noah-haccp-' + randomUUID();
  const ownPath = `haccp_incoming/${prefix}-own`;
  const foreignPath = `haccp_incoming/${prefix}-foreign`;
  let app: any; let adminApp: any; let adminDb: any; let adminAuth: any;
  const createdAccounts = new Map<string, {uid:string;email:string;password:string}>();
  const createdPaths = new Set<string>();

  beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8082') throw new Error('Firestore 주소 불일치');
    if (process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('Auth 주소 불일치');
    if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId) throw new Error('프로젝트 불일치');
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8082';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
    process.env.GCLOUD_PROJECT = projectId;
    adminApp = initializeAdminApp({ projectId }, prefix + '-admin');
    adminDb = getAdminFirestore(adminApp);
    adminAuth = getAdminAuth(adminApp);
    for (const companyId of ['taebaek','punghoe'] as const) {
      const uid=prefix+'-'+companyId+'-'+randomUUID();
      const email=uid+'@example.invalid';
      const password=randomUUID()+'A1!';
      const user=await adminAuth.createUser({uid,email,password});
      createdAccounts.set(companyId,{uid:user.uid,email,password});
      await adminAuth.setCustomUserClaims(user.uid,{employeeId:user.uid,companyId,isAdmin:false});
    }
    app = initializeApp({ projectId, apiKey: 'local-emulator-only' }, prefix + '-sdk');
    gateway.db = getFirestore(app); connectFirestoreEmulator(gateway.db, '127.0.0.1', 8082);
    gateway.auth = getAuth(app); connectAuthEmulator(gateway.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    const taebaek=createdAccounts.get('taebaek')!;
    await signInWithEmailAndPassword(gateway.auth, taebaek.email, taebaek.password);
    expect((await gateway.auth.currentUser.getIdTokenResult(true)).claims).toMatchObject({ employeeId: taebaek.uid, companyId: 'taebaek' });
    for (const [path, companyId] of [[ownPath, 'taebaek'], [foreignPath, 'punghoe']] as const) {
      if (![ownPath, foreignPath].includes(path)) throw new Error('자기 문서가 아닌 경로');
      await adminDb.doc(path).create({ companyId, month: '2026-09', updatedBy: '합성 최초' });
      createdPaths.add(path);
    }
  }, 30_000);

  afterAll(async () => {
    const errors: string[] = [];
    if (adminDb) for (const path of createdPaths) {
      try {
        if (![ownPath, foreignPath].includes(path)) throw new Error('자기 문서가 아닌 경로');
        await adminDb.doc(path).delete();
        expect((await adminDb.doc(path).get()).exists).toBe(false);
      } catch { errors.push(path + ' 정리 실패'); }
    }
    if (adminAuth) for (const [companyId,account] of createdAccounts) {
      try {
        if (!['taebaek','punghoe'].includes(companyId) || !account.uid.startsWith(prefix+'-'+companyId+'-')) throw new Error('자기 계정이 아닌 UID');
        await adminAuth.deleteUser(account.uid);
        await expect(adminAuth.getUser(account.uid)).rejects.toMatchObject({code:'auth/user-not-found'});
      } catch { errors.push(companyId+' 계정 정리 실패'); }
    }
    if (app) await deleteApp(app);
    if (adminApp) await deleteAdminApp(adminApp);
    expect(errors).toEqual([]);
  }, 30_000);

  it('로그인 claim의 자기 문서는 수정하고 타 회사·위조 회사 갱신은 거절한다', async () => {
    await updateItem('haccp_incoming', `${prefix}-own`, { updatedBy: '합성 검사자' });
    expect((await adminDb.doc(ownPath).get()).data()).toMatchObject({ companyId: 'taebaek', updatedBy: '합성 검사자' });
    await expect(updateItem('haccp_incoming', `${prefix}-foreign`, { updatedBy: '침범' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateItem('haccp_incoming', `${prefix}-own`, { companyId: 'punghoe', updatedBy: '위조' })).rejects.toThrow('현재 로그인한 회사와 다른 회사');
    expect((await adminDb.doc(ownPath).get()).data()?.updatedBy).toBe('합성 검사자');
    expect((await adminDb.doc(foreignPath).get()).data()).toMatchObject({ companyId: 'punghoe', updatedBy: '합성 최초' });
  }, 30_000);
  it('풍회 실제 로그인은 풍회 문서만 수정하고 태백·위조 회사는 원문과 저장시각을 유지한다',async()=>{
    const account=createdAccounts.get('punghoe')!;
    await signOut(gateway.auth);
    await signInWithEmailAndPassword(gateway.auth,account.email,account.password);
    expect((await gateway.auth.currentUser.getIdTokenResult(true)).claims).toMatchObject({employeeId:account.uid,companyId:'punghoe'});
    await updateItem('haccp_incoming',prefix+'-foreign',{updatedBy:'풍회 합성 검사자'});
    expect((await adminDb.doc(foreignPath).get()).data()).toMatchObject({companyId:'punghoe',updatedBy:'풍회 합성 검사자'});
    const taebaekBefore=await adminDb.doc(ownPath).get();
    const punghoeBefore=await adminDb.doc(foreignPath).get();
    await expect(updateItem('haccp_incoming',prefix+'-own',{updatedBy:'풍회 침범'})).rejects.toMatchObject({code:'permission-denied'});
    await expect(updateItem('haccp_incoming',prefix+'-foreign',{companyId:'taebaek',updatedBy:'풍회 위조'})).rejects.toThrow('현재 로그인한 회사와 다른 회사');
    for(const [path,before] of [[ownPath,taebaekBefore],[foreignPath,punghoeBefore]]){
      const after=await adminDb.doc(path).get();expect(after.data()).toEqual(before.data());expect(after.updateTime.isEqual(before.updateTime)).toBe(true);
    }
  },30_000);

  it('로그아웃 뒤 저장 경계와 실제 수정은 거절하고 두 회사 원문과 저장시각을 유지한다',async()=>{
    const originals=await Promise.all([ownPath,foreignPath].map(path=>adminDb.doc(path).get()));
    await signOut(gateway.auth);expect(gateway.auth.currentUser).toBeNull();
    await expect(companyScopedWriteData('haccp_incoming',{companyId:'punghoe',updatedBy:'로그아웃 위조'})).rejects.toThrow('로그인이 만료되어 저장하지 않았습니다');
    for(const id of [prefix+'-own',prefix+'-foreign'])await expect(updateItem('haccp_incoming',id,{updatedBy:'로그아웃 수정'})).rejects.toThrow('로그인이 만료되어 저장하지 않았습니다');
    for(const [index,path] of [ownPath,foreignPath].entries()){
      const after=await adminDb.doc(path).get();expect(after.data()).toEqual(originals[index].data());expect(after.updateTime.isEqual(originals[index].updateTime)).toBe(true);
    }
  },30_000);

});
