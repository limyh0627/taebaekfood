import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { applyRawCommand, inventoryDocId, operationDocId } from '../rawInventoryCore';
import { cancelOemIssue } from './oemCancelService';
import { firestoreOemIssuePorts, oemIssueFingerprint } from '../../features/admin/oemIssueJob';
import { receiveOemFinishedGoods } from '../../../functions/src/oemReceiptCommand';

describe.skipIf(process.env.OEM_CANCEL_EMULATOR_TEST !== 'true')('OEM 발주 취소 실제 Auth·Firestore 계약', () => {
  const projectId = 'demo-taebaekfood-local', prefix = `oem-cancel-sdk-${randomUUID()}`, date = '2026-10-08';
  let app: ReturnType<typeof initializeApp>, adminApp: ReturnType<typeof initializeAdminApp>;
  let db: ReturnType<typeof getFirestore>, adminDb: ReturnType<typeof getAdminFirestore>, adminAuth: ReturnType<typeof getAdminAuth>;
  const paths = new Set<string>(), credentials = new Map<string, { email: string; password: string }>();
  let originalGate: Record<string, any> | undefined;
  // 순수 계산 fixture의 선택 필드는 실제 writer와 같이 undefined를 저장하지 않는다.
  const save = async (path: string, value: any) => { if (!path.includes(prefix) && !String(value.rawItemId ?? '').startsWith(prefix)) throw new Error('합성 자료 범위 오류'); paths.add(path); await adminDb.doc(path).create(JSON.parse(JSON.stringify(value))); };
  const read = async (path: string) => (await adminDb.doc(path).get()).data();
  const login = async (role: string) => { const c = credentials.get(role)!; await signInWithEmailAndPassword(getAuth(app), c.email, c.password); };
  beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8082' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('로컬 에뮬레이터 주소가 아닙니다.');
    if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId) throw new Error('demo 프로젝트가 아닙니다.');
    adminApp = initializeAdminApp({ projectId }, prefix); adminDb = getAdminFirestore(adminApp); adminAuth = getAdminAuth(adminApp);
    for (const [role, companyId] of [['admin', 'taebaek'], ['foreign', 'punghoe']] as const) {
      const uid = `${prefix}-${role}`, email = `${uid}@example.invalid`, password = `${randomUUID()}A1!`;
      await adminAuth.createUser({ uid, email, password }); await adminAuth.setCustomUserClaims(uid, { employeeId: `${prefix}-employee-${role}`, companyId, isAdmin: true }); credentials.set(role, { email, password });
    }
    app = initializeApp({ projectId, apiKey: 'local-emulator-only' }, prefix); db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8082);
    connectAuthEmulator(getAuth(app), 'http://127.0.0.1:9099', { disableWarnings: true });
    originalGate = await read('appMeta/releaseCutover');
    await adminDb.doc('appMeta/releaseCutover').set({ status: 'active', releaseId: prefix, oemLotCutoverDate: date, testRunId: prefix });
    await login('admin');
  }, 90_000);
  afterAll(async () => {
    const errors: string[] = [];
    if (adminDb) {
      for (const path of paths) try { await adminDb.doc(path).delete(); expect((await adminDb.doc(path).get()).exists).toBe(false); } catch { errors.push(path); }
      const gate = await read('appMeta/releaseCutover');
      if (gate?.testRunId !== prefix) errors.push('gate 소유권 변경');
      else if (originalGate) await adminDb.doc('appMeta/releaseCutover').set(originalGate); else await adminDb.doc('appMeta/releaseCutover').delete();
    }
    if (adminAuth) for (const role of credentials.keys()) try { await adminAuth.deleteUser(`${prefix}-${role}`); await expect(adminAuth.getUser(`${prefix}-${role}`)).rejects.toMatchObject({ code: 'auth/user-not-found' }); } catch { errors.push(role); }
    if (app) await deleteApp(app); if (adminApp) await deleteAdminApp(adminApp); expect(errors).toEqual([]);
  }, 90_000);
  async function seed(suffix: string) {
    const poId = `${prefix}-${suffix}`, rawItemId = `${poId}-raw`, productId = `${poId}-product`, partnerId = `${poId}-partner`, material = `${poId}-material`;
    const input = { jobId: poId, companyId: 'taebaek' as const, partnerId, partnerName: '합성 외주공장', sent: [{ rawItemId, material, kg: 100 }], date, addedBy: '합성 관리자' };
    const base = { companyId: 'taebaek' as const, rawItemId, materialSnapshot: material, effectiveAt: `${date}T12:00:00+09:00`, source: { type: 'oem' as const, id: poId } };
    const det = { now: `${date}T03:00:00Z`, newLotId: `${poId}-lot`, carryOverLotId: `${poId}-carry` };
    const received = applyRawCommand({ state: null, command: { ...base, operationId: `${poId}-receive`, kind: 'receive', kg: 200, lot: { supplierName: '합성 공급처' } }, det });
    if (received.status !== 'applied') throw new Error('입고 fixture 오류');
    const originalId = `oem-issue:${poId}:${rawItemId}`;
    const consumed = applyRawCommand({ state: received.state, command: { ...base, actorName: input.addedBy, operationId: originalId, kind: 'consume', kg: 100 }, det });
    if (consumed.status !== 'applied') throw new Error('차감 fixture 오류');
    await save(`purchaseOrders/${poId}`, { ...input, companyId: 'taebaek', poType: 'oem', status: 'invoiced', oemIssueStatus: 'complete', oemIssueDate: date,
      oemIssueFingerprint: oemIssueFingerprint(input), oemIssuedBy: input.addedBy, oemPartnerId: partnerId, oemSent: input.sent, itemId: '', itemName: '', quantity: 0, items: [] });
    await save(`items/${rawItemId}`, { companyId: 'taebaek', name: material, stock: 100, lots: [...consumed.state.activeLots, ...consumed.state.recentDepletedLots] });
    await save(`rawInventories/${inventoryDocId('taebaek', rawItemId)}`, consumed.state);
    await save(`rawMaterialLedger/${operationDocId(originalId)}`, consumed.movement);
    await save(`partners/${partnerId}`, { companyId: 'taebaek', name: '합성 외주공장' });
    await save(`items/${productId}`, { companyId: 'taebaek', name: productId, 품목: productId, procureType: '임가공', packageKg: 1, unit: '개', stock: 0, lots: [] });
    await save(`item_formula/${poId}-formula`, { parent_key: productId, child_name: material, ratio: 1, yield_rate: 1 });
    await save(`appMeta/oemLotSequence_taebaek_20261008_${encodeURIComponent(material)}`, { companyId: 'taebaek', material, date, lastSequence: 0 });
    for (const path of [`rawMaterialLedger/${operationDocId(`oem-cancel:${poId}:${rawItemId}`)}`, `rawInventoryReversalGuards/${operationDocId(originalId)}`, `adjustmentRequests/OEMFEE-${poId}`, `oemReceiptOperations/oem-receive:${poId}`]) paths.add(path);
    return { poId, rawItemId, productId, input, receive: { poId, operationId: `oem-receive:${poId}`, date, releaseId: prefix, returns: [{ itemId: productId, qty: 1 }], unitPricePerKg: 500 } };
  }
  it('본인 회사 취소는 원로트를 복원하고 재시도·발주 재개·입고 재시도를 차단한다', async () => {
    const s = await seed('own'); const original = await read(`rawMaterialLedger/${operationDocId(`oem-issue:${s.poId}:${s.rawItemId}`)}`);
    const prepared = await firestoreOemIssuePorts(db).prepareDraft(s.input);
    expect(await cancelOemIssue(db, 'taebaek', s.poId)).toEqual({ status: 'applied' });
    expect((await read(`items/${s.rawItemId}`))?.stock).toBe(200);
    const before = await read(`items/${s.rawItemId}`);
    expect(await cancelOemIssue(db, 'taebaek', s.poId)).toEqual({ status: 'duplicate' });
    expect(await read(`items/${s.rawItemId}`)).toEqual(before);
    expect(await read(`rawMaterialLedger/${operationDocId(`oem-issue:${s.poId}:${s.rawItemId}`)}`)).toEqual(original);
    await expect(firestoreOemIssuePorts(db).prepareDraft(s.input)).rejects.toThrow('취소');
    await expect(firestoreOemIssuePorts(db).finalizeDraft(prepared)).rejects.toThrow('취소');
    await expect(receiveOemFinishedGoods(adminDb, 'taebaek', s.receive)).rejects.toThrow('취소');
    expect(await read(`oemReceiptOperations/oem-receive:${s.poId}`)).toBeUndefined();
  }, 60_000);
  it('타회사 실제 Auth 거절과 가공비 존재 거절은 원문을 보존한다', async () => {
    const s = await seed('foreign'); const before = await read(`items/${s.rawItemId}`);
    await login('foreign'); await expect(cancelOemIssue(db, 'taebaek', s.poId)).rejects.toMatchObject({ code: 'permission-denied' }); await login('admin');
    await save(`adjustmentRequests/OEMFEE-${s.poId}`, { companyId: 'taebaek', oemPoId: s.poId });
    await expect(cancelOemIssue(db, 'taebaek', s.poId)).rejects.toThrow('취소할 수 없습니다');
    expect(await read(`items/${s.rawItemId}`)).toEqual(before); expect((await read(`purchaseOrders/${s.poId}`))?.oemCancelledAt).toBeUndefined();
  }, 60_000);
  it('가공입고와 취소가 경합해도 한쪽만 확정되고 원료 복원이 중복되지 않는다', async () => {
    const s = await seed('race');
    const results = await Promise.allSettled([cancelOemIssue(db, 'taebaek', s.poId), receiveOemFinishedGoods(adminDb, 'taebaek', s.receive)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const po = await read(`purchaseOrders/${s.poId}`);
    if (po?.oemCancelledAt) { expect((await read(`items/${s.rawItemId}`))?.stock).toBe(200); expect((await read(`items/${s.productId}`))?.stock).toBe(0); expect(await read(`oemReceiptOperations/oem-receive:${s.poId}`)).toBeUndefined(); }
    else { expect(po?.status).toBe('received'); expect((await read(`items/${s.rawItemId}`))?.stock).toBe(100); expect((await read(`items/${s.productId}`))?.stock).toBe(1); await expect(cancelOemIssue(db, 'taebaek', s.poId)).rejects.toThrow('취소할 수 없습니다'); }
  }, 60_000);
});
