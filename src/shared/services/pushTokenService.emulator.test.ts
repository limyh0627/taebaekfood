import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { initializeApp as adminInitializeApp, deleteApp as adminDeleteApp } from 'firebase-admin/app';
import { getAuth as adminGetAuth } from 'firebase-admin/auth';
import { getFirestore as adminGetFirestore } from 'firebase-admin/firestore';
const gateway = vi.hoisted(() => ({ db: undefined as any, auth: undefined as any }));
vi.mock('../firebase', () => ({ get db() { return gateway.db; }, get auth() { return gateway.auth; }, authReady: Promise.resolve() }));
import { updateOwnPushToken } from './pushTokenService';

describe.skipIf(process.env.PUSH_TOKEN_EMULATOR_TEST !== 'true')('푸시 정보 공용 명령 실제 Auth·Rules', () => {
  const projectId = 'demo-taebaekfood-local', prefix = `push-token-${randomUUID()}`;
  const uid = `${prefix}-auth`, employeeId = `${prefix}-employee`, foreignId = `${prefix}-foreign`;
  let app: ReturnType<typeof initializeApp> | undefined;
  let adminApp: ReturnType<typeof adminInitializeApp> | undefined;
  let adminDb: ReturnType<typeof adminGetFirestore> | undefined;
  let adminAuth: ReturnType<typeof adminGetAuth> | undefined;
  const paths = new Set<string>();
  beforeAll(async () => {
    for (const [key, value] of Object.entries({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8082', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', GCLOUD_PROJECT: projectId })) {
      if (process.env[key] && process.env[key] !== value) throw new Error('격리 에뮬레이터 대상이 다릅니다.');
      process.env[key] = value;
    }
    adminApp = adminInitializeApp({ projectId }, `${prefix}-admin`);
    adminDb = adminGetFirestore(adminApp); adminAuth = adminGetAuth(adminApp);
    const email = `${prefix}@example.invalid`, password = `${randomUUID()}A1!`;
    await adminAuth.createUser({ uid, email, password });
    await adminAuth.setCustomUserClaims(uid, { employeeId, companyId: 'taebaek', isAdmin: false });
    for (const [id, companyId] of [[employeeId, 'taebaek'], [foreignId, 'punghoe']]) {
      const path = `employees/${id}`; paths.add(path);
      await adminDb.doc(path).create({ companyId, name: '합성 직원', fcmTokens: ['preserved'], fcmDevices: { preserved: { name: '기존 기기', at: '2026-10-01' } } });
    }
    app = initializeApp({ projectId, apiKey: 'local-emulator-only' }, `${prefix}-sdk`);
    gateway.db = getFirestore(app); connectFirestoreEmulator(gateway.db, '127.0.0.1', 8082);
    gateway.auth = getAuth(app); connectAuthEmulator(gateway.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    await signInWithEmailAndPassword(gateway.auth, email, password);
    expect(gateway.auth.currentUser.uid).not.toBe(employeeId);
    expect((await gateway.auth.currentUser.getIdTokenResult(true)).claims).toMatchObject({ employeeId, companyId: 'taebaek', isAdmin: false });
  }, 90_000);
  afterAll(async () => {
    const failures: string[] = [];
    if (adminDb) for (const path of paths) {
      try { if (!path.includes(prefix)) throw new Error('정리 범위 오류'); await adminDb.doc(path).delete(); expect((await adminDb.doc(path).get()).exists).toBe(false); } catch { failures.push(path); }
    }
    if (adminAuth) try { await adminAuth.deleteUser(uid); await expect(adminAuth.getUser(uid)).rejects.toMatchObject({ code: 'auth/user-not-found' }); } catch { failures.push(uid); }
    if (app) await deleteApp(app); if (adminApp) await adminDeleteApp(adminApp);
    expect(failures).toEqual([]);
  }, 90_000);
  it('자기 직원 ID로 특수문자 토큰·기기 정보를 함께 저장하고 함께 삭제한다', async () => {
    const token = 'synthetic:token.with.dots', device = { name: '합성 기기', at: '2026-10-07T00:00:00Z' };
    await updateOwnPushToken(employeeId, token, device);
    const saved = (await adminDb!.doc(`employees/${employeeId}`).get()).data()!;
    expect(saved.fcmTokens).toEqual(['preserved', token]);
    expect(saved.fcmDevices).toEqual({ preserved: { name: '기존 기기', at: '2026-10-01' }, [token]: device });
    await updateOwnPushToken(employeeId, token);
    const removed = (await adminDb!.doc(`employees/${employeeId}`).get()).data()!;
    expect(removed.fcmTokens).toEqual(['preserved']);
    expect(removed.fcmDevices).toEqual({ preserved: { name: '기존 기기', at: '2026-10-01' } });
  }, 60_000);
  it('타직원 대상은 거절하며 양쪽 문서를 바꾸지 않는다', async () => {
    const refs = [employeeId, foreignId].map(id => adminDb!.doc(`employees/${id}`));
    const before = await Promise.all(refs.map(async ref => (await ref.get()).data()));
    await expect(updateOwnPushToken(foreignId, 'foreign-token', { name: '기기', at: 'now' })).rejects.toThrow('본인');
    await expect(updateOwnPushToken(foreignId, 'preserved')).rejects.toThrow('본인');
    expect(await Promise.all(refs.map(async ref => (await ref.get()).data()))).toEqual(before);
  }, 60_000);
});
