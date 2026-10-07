import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { updateItem } from './firebaseService';

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
  let createdUid: string | undefined;
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
    const password = randomUUID() + 'A1!';
    const user = await adminAuth.createUser({ uid: prefix, email: prefix + '@example.invalid', password });
    createdUid = user.uid;
    await adminAuth.setCustomUserClaims(user.uid, { employeeId: user.uid, companyId: 'taebaek', isAdmin: false });
    app = initializeApp({ projectId, apiKey: 'local-emulator-only' }, prefix + '-sdk');
    gateway.db = getFirestore(app); connectFirestoreEmulator(gateway.db, '127.0.0.1', 8082);
    gateway.auth = getAuth(app); connectAuthEmulator(gateway.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    await signInWithEmailAndPassword(gateway.auth, prefix + '@example.invalid', password);
    expect((await gateway.auth.currentUser.getIdTokenResult(true)).claims).toMatchObject({ employeeId: user.uid, companyId: 'taebaek' });
    for (const [path, companyId] of [[ownPath, 'taebaek'], [foreignPath, 'punghoe']] as const) {
      if (!path.includes(prefix)) throw new Error('자기 문서가 아닌 경로');
      await adminDb.doc(path).create({ companyId, month: '2026-09', updatedBy: '합성 최초' });
      createdPaths.add(path);
    }
  }, 30_000);

  afterAll(async () => {
    const errors: string[] = [];
    if (adminDb) for (const path of createdPaths) {
      try {
        if (!path.includes(prefix)) throw new Error('자기 문서가 아닌 경로');
        await adminDb.doc(path).delete();
        expect((await adminDb.doc(path).get()).exists).toBe(false);
      } catch { errors.push(path + ' 정리 실패'); }
    }
    if (createdUid && adminAuth) {
      try {
        await adminAuth.deleteUser(createdUid);
        await expect(adminAuth.getUser(createdUid)).rejects.toMatchObject({ code: 'auth/user-not-found' });
      } catch { errors.push('계정 정리 실패'); }
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
});
