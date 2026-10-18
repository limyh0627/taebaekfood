import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { executeDirectoryDeleteCommand, directoryDeleteReceiptId } from './directoryDeleteCommand';
import { DIRECTORY_DELETE_OPERATIONS, directoryDeleteOpening, normalizeDirectoryDeletePreview, normalizeDirectoryDeleteRequest, normalizeDirectoryDeleteResult, type DirectoryDeleteReference, type DirectoryDeleteRequest, type DirectoryDeleteCommand } from './shared/directoryDeleteCommand';
import { executeRetirementBenefit, retirementReceiptId } from './retirementBenefitCommand';
import { RETIREMENT_COLLECTIONS, retirementProfileId, type RetirementRequest } from './shared/retirementBenefit';
const active = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8182';
const actor = { uid: 'directory-admin', token: { employeeId: 'directory-admin', companyId: 'taebaek', isAdmin: true } };
let app: admin.app.App, db: admin.firestore.Firestore;
const owned = new Set<string>();
const doc = (path: string) => { owned.add(path); return db.doc(path); };
const receipt = (ref: DirectoryDeleteReference) => doc(DIRECTORY_DELETE_OPERATIONS + '/' + directoryDeleteReceiptId(ref.companyId, actor.uid, ref.planId));
const run = async (command: Exclude<DirectoryDeleteCommand, { mode: 'preview' }>, database = db) => {
  const reference = command.mode === 'apply' ? command.request.reference : command.reference;
  return normalizeDirectoryDeleteResult(await executeDirectoryDeleteCommand(database, actor, command), reference, actor.uid);
};
const apply = (request: DirectoryDeleteRequest, database = db) => run({ mode: 'apply', request }, database);
async function fixture(kind: 'partner' | 'employee' = 'partner') {
  const id = 'delete-' + randomUUID(), reference: DirectoryDeleteReference = { companyId: 'taebaek', planId: 'plan-' + randomUUID(), kind, targetId: id };
  const raw = { companyId: 'taebaek', name: '합성 삭제 대상', phone: '010-0000-0000', status: 'retired', joinDate: '2020-01-01' };
  const target = doc((kind === 'partner' ? 'partners/' : 'employees/') + id); await target.set(raw); receipt(reference);
  const preview = normalizeDirectoryDeletePreview(await executeDirectoryDeleteCommand(db, actor, { mode: 'preview', reference, opening: directoryDeleteOpening(raw) }), reference, actor.uid);
  const request = normalizeDirectoryDeleteRequest({ version: 1, reference, opening: preview.opening, expectedVersion: preview.expectedVersion });
  return { reference, raw, target, request };
}
function retirementRequest(employeeId: string): RetirementRequest {
  const request: RetirementRequest = { version: 1, operationId: 'retirement-' + randomUUID(), companyId: 'taebaek', employeeId, expectedRevision: 0, releaseId: 'directory-sdk-release', action: { kind: 'configure', profile: { eligible: true, managementDay: '2026-01-01', targetStartDay: '2020-01-01', targetEndDay: null, closedThroughDay: null } } };
  doc(RETIREMENT_COLLECTIONS.profiles + '/' + retirementProfileId('taebaek', employeeId));
  doc(RETIREMENT_COLLECTIONS.receipts + '/' + retirementReceiptId('taebaek', actor.uid, request.operationId));
  return request;
}

describe.skipIf(!active)('거래처·직원 삭제 실제 SDK 계약', () => {
  beforeAll(async () => { app = admin.initializeApp({ projectId: 'demo-directory-delete-' + randomUUID().slice(0, 8) }, 'directory-' + randomUUID()); db = admin.firestore(app); await doc('employees/' + actor.token.employeeId).set({ companyId: 'taebaek', name: '합성 관리자' }); await doc('appMeta/releaseCutover').set({ status: 'active', releaseId: 'directory-sdk-release' }); });
  afterAll(async () => { if (!db) return; const paths = [...owned]; for (let i = 0; i < paths.length; i += 400) { const batch = db.batch(); paths.slice(i, i + 400).forEach(path => batch.delete(db.doc(path))); await batch.commit(); } await app.delete(); }, 60000);

  it('preview는 삭제·영수증0이며 명시 apply는 삭제와 영수증을 함께 확정한다', async () => {
    const f = await fixture(); expect((await f.target.get()).data()).toEqual(f.raw); expect((await receipt(f.reference).get()).exists).toBe(false);
    expect((await apply(f.request)).status).toBe('applied'); expect((await f.target.get()).exists).toBe(false); expect((await receipt(f.reference).get()).get('status')).toBe('applied');
    expect((await run({ mode: 'inspect', reference: f.reference })).status).toBe('applied');
    await f.target.set({ ...f.raw, phone: '다시 생성' }); expect((await apply(f.request)).status).toBe('applied'); expect((await f.target.get()).get('phone')).toBe('다시 생성');
  });
  it('이름 외 필드 변경과 같은 ID 삭제·재생성도 native 버전 CAS로 거절한다', async () => {
    for (const change of ['phone', 'recreate'] as const) {
      const f = await fixture(); if (change === 'phone') await f.target.update({ phone: '변경' }); else { await f.target.delete(); await f.target.set(f.raw); }
      expect((await apply(f.request)).status).toBe('rejected'); expect((await f.target.get()).exists).toBe(true); expect((await receipt(f.reference).get()).get('status')).toBe('rejected');
      await f.target.set(f.raw); expect((await apply(f.request)).status).toBe('rejected'); expect((await f.target.get()).exists).toBe(true);
    }
  });
  it('대상 회사 누락·null·타회사는 preview 실패와 apply 거절로 보존한다', async () => {
    for (const company of [undefined, null, 'punghoe']) {
      const f = await fixture(); await f.target.update({ companyId: company === undefined ? admin.firestore.FieldValue.delete() : company });
      const now = (await f.target.get()).data()!;
      await expect(executeDirectoryDeleteCommand(db, actor, { mode: 'preview', reference: f.reference, opening: directoryDeleteOpening(now) })).rejects.toMatchObject({ code: 'failed-precondition' });
      expect((await receipt(f.reference).get()).exists).toBe(false); expect((await apply(f.request)).status).toBe('rejected'); expect((await f.target.get()).exists).toBe(true);
    }
  });
  it('receipt 실제 커밋 실패는 먼저 예약된 삭제도 취소하고 같은 원문 재실행만 확정한다', async () => {
    const f = await fixture();
    const failing = new Proxy(db, { get(database, property) {
      if (property === 'runTransaction') return (work: (tx: admin.firestore.Transaction) => Promise<unknown>) => database.runTransaction(tx => work(new Proxy(tx, { get(transaction, method) {
        if (method === 'create') return (target: admin.firestore.DocumentReference, data: admin.firestore.DocumentData) => transaction.create(target, target.parent.id === DIRECTORY_DELETE_OPERATIONS ? { ...data, sdkFailurePadding: 'x'.repeat(1100000) } : data);
        const value = Reflect.get(transaction, method); return typeof value === 'function' ? value.bind(transaction) : value;
      } })));
      const value = Reflect.get(database, property); return typeof value === 'function' ? value.bind(database) : value;
    } });
    await expect(apply(f.request, failing)).rejects.toThrow(); expect((await f.target.get()).exists).toBe(true); expect((await receipt(f.reference).get()).exists).toBe(false);
    expect((await apply(f.request)).status).toBe('applied'); expect((await f.target.get()).exists).toBe(false);
  });
  it('부재 조회는 unknown이고 중단과 늦은 apply의 경합은 단일 결과만 확정한다', async () => {
    const f = await fixture(); expect((await run({ mode: 'inspect', reference: f.reference })).status).toBe('unknown'); expect((await receipt(f.reference).get()).exists).toBe(false);
    expect((await run({ mode: 'cancel', reference: f.reference })).status).toBe('cancelled'); expect((await apply(f.request)).status).toBe('cancelled'); expect((await f.target.get()).exists).toBe(true);
    const race = await fixture(), results = await Promise.all([apply(race.request), run({ mode: 'cancel', reference: race.reference })]);
    const status = (await receipt(race.reference).get()).get('status'); expect(results.every(row => row.status === status)).toBe(true); expect((await race.target.get()).exists).toBe(status !== 'applied');
  }, 60000);
  it('퇴직금 실등록 선행은 삭제 거절·삭제 선행은 퇴직금 신규등록 거절이며 동시 경합도 고아 장부를 만들지 않는다', async () => {
    const configured = await fixture('employee'), request = retirementRequest(configured.reference.targetId);
    await executeRetirementBenefit(db, actor, { mode: 'apply', request }); expect((await apply(configured.request)).status).toBe('rejected'); expect((await configured.target.get()).exists).toBe(true);
    const deleted = await fixture('employee'), later = retirementRequest(deleted.reference.targetId); expect((await apply(deleted.request)).status).toBe('applied');
    await expect(executeRetirementBenefit(db, actor, { mode: 'apply', request: later })).rejects.toThrow('직원'); expect((await doc(RETIREMENT_COLLECTIONS.profiles + '/' + retirementProfileId('taebaek', deleted.reference.targetId)).get()).exists).toBe(false);
    const race = await fixture('employee'), concurrent = retirementRequest(race.reference.targetId);
    const results = await Promise.allSettled([apply(race.request), executeRetirementBenefit(db, actor, { mode: 'apply', request: concurrent })]);
    const profile = await doc(RETIREMENT_COLLECTIONS.profiles + '/' + retirementProfileId('taebaek', race.reference.targetId)).get(), employee = await race.target.get();
    expect(profile.exists && !employee.exists).toBe(false); expect(profile.exists || !employee.exists).toBe(true);
    expect(results[0].status).toBe('fulfilled');
  }, 60000);
  it('직원 삭제 관리자권한과 현재 회사·실직원 검증을 지키고 이미 확정된 자기 영수증은 다시 읽는다', async () => {
    const f = await fixture('employee');
    await expect(executeDirectoryDeleteCommand(db, { ...actor, token: { ...actor.token, isAdmin: false } }, { mode: 'apply', request: f.request })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(executeDirectoryDeleteCommand(db, { ...actor, token: { ...actor.token, companyId: 'punghoe' } }, { mode: 'apply', request: f.request })).rejects.toMatchObject({ code: 'permission-denied' }); expect((await f.target.get()).exists).toBe(true);
    const missing = { uid: 'missing', token: { companyId: 'taebaek', employeeId: 'missing', isAdmin: true } };
    await expect(executeDirectoryDeleteCommand(db, missing, { mode: 'preview', reference: f.reference, opening: f.request.opening })).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await apply(f.request)).status).toBe('applied');
    await doc('employees/' + actor.token.employeeId).delete();
    try { expect((await run({ mode: 'inspect', reference: f.reference })).status).toBe('applied'); }
    finally { await doc('employees/' + actor.token.employeeId).set({ companyId: 'taebaek', name: '합성 관리자' }); }
  });
});
