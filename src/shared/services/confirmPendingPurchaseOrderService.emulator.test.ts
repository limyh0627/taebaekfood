import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { confirmPendingPurchaseOrder } from './confirmPendingPurchaseOrderService';
import type { PurchaseOrder } from '../types';
const gateway = vi.hoisted(() => ({ db: undefined as any, auth: undefined as any }));
vi.mock('../firebase', () => ({ get db() { return gateway.db; }, get auth() { return gateway.auth; }, authReady: Promise.resolve() }));

describe.skipIf(process.env.PO_CONFIRM_EMULATOR_TEST !== 'true')('일반 발주확정 실제 Auth·Firestore 최신 상태', () => {
  const projectId = 'demo-taebaekfood-local', prefix = 'noah-po-confirm-' + randomUUID();
  let app: any, adminApp: any, store: any, adminAuth: any;
  const accounts = new Map<string, { uid: string; email: string; password: string }>();
  const paths = new Set<string>();
  const login = async (company: string) => { const account = accounts.get(company)!; await signOut(gateway.auth); await signInWithEmailAndPassword(gateway.auth, account.email, account.password); };
  const seed = async (suffix: string, patch: Partial<PurchaseOrder> = {}) => {
    const po: PurchaseOrder = { id: prefix + '-' + suffix, companyId: 'taebaek', status: 'pending', itemId: 'synthetic-item', itemName: '합성 부자재', quantity: 3, unit: '개', partnerId: 'synthetic-original-partner', partnerName: '원거래처', createdAt: '2026-10-11T01:00:00Z', ...patch };
    const path = 'purchaseOrders/' + po.id; paths.add(path); const { id, ...data } = po; await store.doc(path).create(data); return po;
  };
  const saved = (po: PurchaseOrder) => store.doc('purchaseOrders/' + po.id).get();
  beforeAll(async () => {
    for (const [key, target] of [['FIRESTORE_EMULATOR_HOST','127.0.0.1:8082'],['FIREBASE_AUTH_EMULATOR_HOST','127.0.0.1:9099'],['GCLOUD_PROJECT',projectId]]) {
      if (process.env[key] && process.env[key] !== target) throw new Error('합성 검증 환경 불일치'); process.env[key] = target;
    }
    adminApp = initializeAdminApp({ projectId }, prefix + '-admin'); store = getAdminFirestore(adminApp); adminAuth = getAdminAuth(adminApp);
    for (const companyId of ['taebaek','punghoe']) {
      const uid = prefix + '-' + companyId, email = uid + '@example.invalid', password = randomUUID() + 'A1!';
      await adminAuth.createUser({ uid, email, password }); accounts.set(companyId, { uid, email, password });
      await adminAuth.setCustomUserClaims(uid, { employeeId: uid, companyId, isAdmin: false });
    }
    app = initializeApp({ projectId, apiKey: 'local-emulator-only' }, prefix + '-sdk');
    gateway.db = getFirestore(app); connectFirestoreEmulator(gateway.db, '127.0.0.1', 8082);
    gateway.auth = getAuth(app); connectAuthEmulator(gateway.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    await login('taebaek');
    expect((await gateway.auth.currentUser.getIdTokenResult(true)).claims).toMatchObject({ companyId: 'taebaek', employeeId: accounts.get('taebaek')!.uid, isAdmin: false });
  }, 30_000);
  afterAll(async () => {
    vi.restoreAllMocks(); const errors: string[] = [];
    if (store) for (const path of paths) { try { if (!path.startsWith('purchaseOrders/' + prefix + '-')) throw Error(); await store.doc(path).delete(); expect((await store.doc(path).get()).exists).toBe(false); } catch { errors.push(path); } }
    if (adminAuth) for (const account of accounts.values()) { try { if (!account.uid.startsWith(prefix + '-')) throw Error(); await adminAuth.deleteUser(account.uid); await expect(adminAuth.getUser(account.uid)).rejects.toMatchObject({ code: 'auth/user-not-found' }); } catch { errors.push(account.uid); } }
    if (app) await deleteApp(app); if (adminApp) await deleteAdminApp(adminApp); expect(errors).toEqual([]);
  }, 30_000);
  it('동시 확정은 한 번 저장하고 같은 원문 재시도는 시각·거래처를 유지한다', async () => {
    const po = await seed('normal'); const results = await Promise.all([confirmPendingPurchaseOrder('taebaek', po), confirmPendingPurchaseOrder('taebaek', po)]);
    expect(results.map(row => row.status).sort()).toEqual(['already-confirmed','confirmed']);
    const before = await saved(po); expect(before.data()).toMatchObject({ status: 'invoiced', partnerId: po.partnerId, partnerName: po.partnerName });
    expect(await confirmPendingPurchaseOrder('taebaek', po)).toMatchObject({ status: 'already-confirmed', invoicedAt: before.data().invoicedAt });
    expect((await saved(po)).updateTime.isEqual(before.updateTime)).toBe(true);
  }, 30_000);
  it.each(['received','cancelled','changed','deleted'] as const)('늦은 확정은 %s 최신 문서를 덮어쓰지 않는다', async mode => {
    const po = await seed(mode), ref = store.doc('purchaseOrders/' + po.id);
    if (mode === 'deleted') await ref.delete(); else await ref.update(mode === 'changed' ? { quantity: 9, note: '다른 창 수정' } : { status: mode, ...(mode === 'received' ? { receivedAt: '2026-10-11T02:00:00Z' } : {}) });
    const before = await ref.get(); await expect(confirmPendingPurchaseOrder('taebaek', po)).rejects.toThrow(); const after = await ref.get();
    expect(after.exists).toBe(before.exists); if (before.exists) { expect(after.data()).toEqual(before.data()); expect(after.updateTime.isEqual(before.updateTime)).toBe(true); }
  }, 30_000);
  it('다른 회사·OEM 원문은 원문과 저장시각을 유지한다', async () => {
    const foreign = await seed('foreign', { companyId: 'punghoe' }), oem = await seed('oem', { poType: 'oem' });
    for (const po of [foreign, oem]) { const before = await saved(po); await expect(confirmPendingPurchaseOrder('taebaek', po)).rejects.toThrow(); expect((await saved(po)).updateTime.isEqual(before.updateTime)).toBe(true); }
    await login('punghoe'); const own = await seed('punghoe-own', { companyId: 'punghoe' });
    expect(await confirmPendingPurchaseOrder('punghoe', own)).toMatchObject({ status: 'confirmed' });
    await expect(confirmPendingPurchaseOrder('punghoe', { ...foreign, companyId: 'taebaek' })).rejects.toThrow(); await login('taebaek');
  }, 30_000);
  it('권한 확인 중 회사·UID 전환과 로그아웃은 저장하지 않는다', async () => {
    const po = await seed('uid-switch'), before = await saved(po), user = gateway.auth.currentUser;
    const token = await user.getIdTokenResult(); let release!: (value: any) => void;
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; }); const spy = vi.spyOn(user, 'getIdTokenResult').mockImplementationOnce(() => { entered(); return gate as any; });
    const pending = confirmPendingPurchaseOrder('taebaek', po); const rejected = expect(pending).rejects.toThrow('바뀌었습니다'); await started; await login('punghoe'); release(token);
    await rejected; spy.mockRestore(); expect((await saved(po)).updateTime.isEqual(before.updateTime)).toBe(true);
    await signOut(gateway.auth); await expect(confirmPendingPurchaseOrder('taebaek', po)).rejects.toThrow('로그인'); expect((await saved(po)).updateTime.isEqual(before.updateTime)).toBe(true); await login('taebaek');
  }, 30_000);
});

