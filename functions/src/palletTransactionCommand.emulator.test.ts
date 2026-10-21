import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { initializeApp as clientApp, deleteApp as deleteClientApp, type FirebaseApp } from 'firebase/app';
import { getAuth as clientAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { writeFileSync } from 'node:fs';
import { executePalletTransactionForActor } from './palletTransactionCommand';
import type { PalletTransactionRequest, PalletTransactionOpenResult } from './shared/palletTransactionCommand';
const project = process.env.PALLET_TRANSACTION_TEST_PROJECT ?? '';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST, authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const ready = project.startsWith('demo-') && firestoreHost === '127.0.0.1:8182' && authHost === '127.0.0.1:9199';
const run = `pallet-${crypto.randomUUID()}`, paths = new Set<string>(), users: string[] = [], clients: FirebaseApp[] = [];
let app: App, db: Firestore, who: { uid: string; token: Record<string, unknown> };
describe.skipIf(!ready)('파렛트 실제 Auth·Firestore 원자 명령', () => {
  beforeAll(async () => {
    app = initializeApp({ projectId: project }, run); db = getFirestore(app);
    const uid = `${run}-employee`, email = `${uid}@local.invalid`; users.push(uid);
    await getAuth(app).createUser({ uid, email, password: 'emulator-only-123' });
    await getAuth(app).setCustomUserClaims(uid, { employeeId: '', companyId: 'taebaek', isAdmin: false });
    const client = clientApp({ projectId: project, apiKey: 'demo-key' }, run); clients.push(client);
    const auth = clientAuth(client); connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
    const credential = await signInWithEmailAndPassword(auth, email, 'emulator-only-123');
    who = { uid, token: (await credential.user.getIdTokenResult()).claims };
    writeFileSync(`work/pallet-transaction-A-${run}-fixture-backup.json`, JSON.stringify({ project, run, fixedPaths: [], policy: '고유 UUID 신규 경로만 사용' }, null, 2));
  }, 90000);
  afterAll(async () => {
    if (!app) return;
    for (const path of paths) await db.doc(path).delete();
    for (const uid of users) await getAuth(app).deleteUser(uid);
    const removed = (await Promise.all([...paths].map(path => db.doc(path).get()))).every(s => !s.exists);
    const usersRemoved = (await getAuth(app).getUsers(users.map(uid => ({ uid })))).users.length === 0;
    writeFileSync(`work/pallet-transaction-A-${run}-fixture-cleanup.json`, JSON.stringify({ project, paths: [...paths], removed, usersRemoved, fixedPathsTouched: 0 }, null, 2));
    expect(removed && usersRemoved).toBe(true);
    for (const client of clients) await deleteClientApp(client); await deleteApp(app);
  }, 90000);
  async function fixture(): Promise<PalletTransactionRequest> {
    const id = `${run}-${crypto.randomUUID()}`;
    const reference = { companyId: 'taebaek' as const, operationId: `${id}-op`, transactionId: `${id}-거래` };
    const request: PalletTransactionRequest = { version: 1, reference, transaction: { partnerId: `${id}-partner`, palletId: `${id}-pallet`, type: 'out', quantity: 3, date: '2026-10-21', note: '실제SDK' } };
    for (const path of [`partners/${request.transaction.partnerId}`, `pallets/${request.transaction.palletId}`, `palletTransactions/${reference.transactionId}`, `palletTransactionOperations/${reference.operationId}`]) paths.add(path);
    await db.doc(`partners/${request.transaction.partnerId}`).set({ companyId: 'taebaek', name: '거래처' });
    await db.doc(`pallets/${request.transaction.palletId}`).set({ companyId: 'taebaek', total: 2, hidden: { legacy: true }, damaged: 1 });
    return request;
  }
  async function transfer(request: PalletTransactionRequest) {
    const prepared = await executePalletTransactionForActor(db, who, { mode: 'open', reference: request.reference, palletId: request.transaction.palletId, originalTotal: 2 }) as PalletTransactionOpenResult;
    request.transaction.isTransfer = true; request.transfer = { originalTotal: prepared.originalTotal, expectedVersion: prepared.expectedVersion };
    return request;
  }
  const apply = (request: PalletTransactionRequest, store = db) => executePalletTransactionForActor(store, who, { mode: 'apply', request });
  it('실제 비관리 직원 claim 일반 등록은 거래·영수증만 만들고 같은 op는 중복0이다', async () => {
    const request = await fixture(); expect(who.token.isAdmin).toBe(false);
    expect(await apply(request)).toMatchObject({ status: 'applied' });
    expect(await apply(request)).toMatchObject({ status: 'applied' });
    expect((await db.doc(`pallets/${request.transaction.palletId}`).get()).data()?.total).toBe(2);
    expect((await db.doc(`palletTransactions/${request.reference.transactionId}`).get()).data()?.quantity).toBe(3);
  });
  it('교체 지급은 회수0을 보존하고 총량을 바꾸지 않는다', async () => {
    const request = await fixture(); request.transaction.status = '교체중'; request.transaction.exchangeReturnQty = 0;
    await apply(request);
    expect((await db.doc(`palletTransactions/${request.reference.transactionId}`).get()).data()).toMatchObject({ status: '교체중', exchangeReturnQty: 0, type: 'out' });
    expect((await db.doc(`pallets/${request.transaction.palletId}`).get()).data()?.total).toBe(2);
  });
  it('이동 open은 쓰기0이고 total-only patch·기존 clamp·숨은 필드 보존을 적용한다', async () => {
    const request = await transfer(await fixture());
    expect((await db.doc(`palletTransactionOperations/${request.reference.operationId}`).get()).exists).toBe(false);
    await apply(request);
    expect((await db.doc(`pallets/${request.transaction.palletId}`).get()).data()).toEqual({ companyId: 'taebaek', total: 0, hidden: { legacy: true }, damaged: 1 });
  });
  it('이동 준비 후 수정·삭제한 native 원문은 거절하고 거래를 만들지 않는다', async () => {
    for (const deletion of [false, true]) {
      const request = await transfer(await fixture()), pallet = db.doc(`pallets/${request.transaction.palletId}`);
      if (deletion) await pallet.delete(); else await pallet.update({ damaged: 2 });
      await expect(apply(request)).rejects.toThrow();
      expect((await db.doc(`palletTransactions/${request.reference.transactionId}`).get()).exists).toBe(false);
      expect((await db.doc(`palletTransactionOperations/${request.reference.operationId}`).get()).exists).toBe(false);
    }
  });
  it('다른 op의 동일 거래 ID·다른 원문은 덮어쓰지 않는다', async () => {
    const request = await fixture(); await apply(request);
    const other = structuredClone(request); other.reference.operationId += '-다름'; paths.add(`palletTransactionOperations/${other.reference.operationId}`); other.transaction.quantity = 7;
    await expect(apply(other)).rejects.toThrow('이미');
    const changed = structuredClone(request); changed.transaction.note = '바뀜'; await expect(apply(changed)).rejects.toThrow('원문');
    expect((await db.doc(`palletTransactions/${request.reference.transactionId}`).get()).data()?.quantity).toBe(3);
  });
  it('완료 뒤 거래·파렛트 삭제에도 과거 조회/중단/동일 apply는 재생성0이다', async () => {
    const request = await fixture(); await apply(request);
    await db.doc(`palletTransactions/${request.reference.transactionId}`).delete(); await db.doc(`pallets/${request.transaction.palletId}`).delete();
    for (const mode of ['inspect', 'cancel']) expect(await executePalletTransactionForActor(db, who, { mode, reference: request.reference })).toMatchObject({ status: 'applied' });
    await apply(request); expect((await db.doc(`palletTransactions/${request.reference.transactionId}`).get()).exists).toBe(false);
  });
  it('부재 조회는 쓰기0·먼저 중단하면 늦은 apply0이다', async () => {
    const request = await fixture();
    expect(await executePalletTransactionForActor(db, who, { mode: 'inspect', reference: request.reference })).toMatchObject({ status: 'unknown' });
    expect((await db.doc(`palletTransactionOperations/${request.reference.operationId}`).get()).exists).toBe(false);
    await executePalletTransactionForActor(db, who, { mode: 'cancel', reference: request.reference });
    await expect(apply(request)).rejects.toMatchObject({ details: { operationStatus: 'cancelled' } });
    expect((await db.doc(`palletTransactions/${request.reference.transactionId}`).get()).exists).toBe(false);
  });
  it('실제 apply/cancel 경합은 하나의 terminal로 수렴한다', async () => {
    const request = await transfer(await fixture());
    await Promise.allSettled([apply(request), executePalletTransactionForActor(db, who, { mode: 'cancel', reference: request.reference })]);
    const final = await executePalletTransactionForActor(db, who, { mode: 'inspect', reference: request.reference });
    expect(['applied', 'cancelled']).toContain('status' in final ? final.status : 'invalid');
    const exists = (await db.doc(`palletTransactions/${request.reference.transactionId}`).get()).exists;
    expect(exists).toBe('status' in final && final.status === 'applied');
    expect((await db.doc(`pallets/${request.transaction.palletId}`).get()).data()?.total).toBe(exists ? 0 : 2);
  });
  it('같은 native 재고로 준비한 두 이동 등록은 한 거래만 확정한다', async () => {
    const first = await transfer(await fixture()), second = structuredClone(first);
    second.reference.operationId += '-second'; second.reference.transactionId += '-second';
    paths.add(`palletTransactionOperations/${second.reference.operationId}`); paths.add(`palletTransactions/${second.reference.transactionId}`);
    const results = await Promise.allSettled([apply(first), apply(second)]);
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(value => value.status === 'rejected')).toHaveLength(1);
    const transactions = await Promise.all([first, second].map(request => db.doc(`palletTransactions/${request.reference.transactionId}`).get()));
    expect(transactions.filter(value => value.exists)).toHaveLength(1);
    expect((await db.doc(`pallets/${first.transaction.palletId}`).get()).data()?.total).toBe(0);
  });
  it('타회사·UID·직원claim없음과 실제 target회사 충돌은 기존자료를 보호한다', async () => {
    const request = await fixture(); await apply(request);
    for (const actor of [undefined, { uid: 'other', token: who.token }, { uid: who.uid, token: { employeeId: 3, companyId: 'taebaek' } }, { uid: who.uid, token: { employeeId: 'e', companyId: 'punghoe' } }])
      await expect(executePalletTransactionForActor(db, actor, { mode: 'inspect', reference: request.reference })).rejects.toThrow();
    const fresh = await fixture(); await db.doc(`partners/${fresh.transaction.partnerId}`).update({ companyId: 'punghoe' }); await expect(apply(fresh)).rejects.toThrow('거래처');
    expect((await db.doc(`palletTransactions/${fresh.reference.transactionId}`).get()).exists).toBe(false);
  });
  it('실 backend 두번째 업무쓰기 실패는 거래·total·영수증을 모두 rollback한다', async () => {
    const request = await transfer(await fixture());
    const wrapped = new Proxy(db, { get(target, key) {
      if (key === 'runTransaction') return (runTx: (tx: FirebaseFirestore.Transaction) => Promise<unknown>) => target.runTransaction(tx => runTx(new Proxy(tx, { get(original, method) {
        if (method === 'create') return (ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData) => ref.path.startsWith('palletTransactionOperations/') ? original.update(ref, data) : original.create(ref, data);
        const value = Reflect.get(original, method); return typeof value === 'function' ? value.bind(original) : value;
      } })));
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await expect(apply(request, wrapped)).rejects.toThrow(/NOT_FOUND|No document|not found/i);
    expect((await db.doc(`palletTransactions/${request.reference.transactionId}`).get()).exists).toBe(false);
    expect((await db.doc(`palletTransactionOperations/${request.reference.operationId}`).get()).exists).toBe(false);
    expect((await db.doc(`pallets/${request.transaction.palletId}`).get()).data()?.total).toBe(2);
  });
});
