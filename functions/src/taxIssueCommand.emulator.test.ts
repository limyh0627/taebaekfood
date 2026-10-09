import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { recordTaxIssue } from './taxIssueCommand';
import { issueTradeStatement } from './tradeStatementIssue';
import { issueVoucher, voucherSequenceKey } from './voucherIssue';
import { deleteIssuedStatement, statementOriginalHash } from './deleteIssuedStatementCommand';
import { preparePartnerAdvance, applyPartnerAdvance, cancelPartnerAdvance } from './partnerAdvanceCommand';
import { kstDateOf } from './shared/calculation';
import { semanticHash, genericVoucherBusiness } from './shared/partnerAdvanceReceipt';
const enabled = process.env.TAX_ISSUE_EMULATOR_TEST === 'true' && process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8082';
const run = `tax-${randomUUID()}`, actor = `${run}-uid`, date = kstDateOf(new Date());
let app: admin.app.App, db: admin.firestore.Firestore;
const ref = (collection: string, id: string) => db.collection(collection).doc(id);
async function issued(label: string, exempt = false) {
 const id = `${run}-${label}`, partnerId = `${id}-partner`;
 await ref('partners', partnerId).set({ companyId: 'taebaek', name: '합성 거래처' });
 const statement = { id, companyId: 'taebaek', type: '매출', tradeDate: date, partnerId, partnerName: '합성 거래처', orderId: '', createdBy: actor,
  totalSupply: 100, totalTax: exempt ? 0 : 10, totalAmount: exempt ? 100 : 110,
  items: [{ name: '합성 품목', spec: '', qty: 1, price: exempt ? 100 : 110, supply: 100, tax: exempt ? 0 : 10, total: exempt ? 100 : 110, accountCode: '800', isTaxExempt: exempt }] };
 const command = { operationId: `${id}:ISSUE`, statement, orderIds: [], poIds: [], costUpdates: [], releaseId: run };
 await issueTradeStatement(db, 'taebaek', actor, command);
 return { id, partnerId, command, snapshot: { ...(await ref('issuedStatements', id).get()).data()!, id } };
}
const tax = (id: string, statements: any[]) => ({ companyId: 'taebaek' as const, operationId: `${run}-${id}`, scope: 'all' as const, issuedAt: new Date().toISOString(), statements });
describe.skipIf(!enabled)('발행 확인 Admin Firestore SDK 원자 저장', { timeout: 90000 }, () => {
 beforeAll(async () => {
  app = admin.initializeApp({ projectId: `demo-tax-${randomUUID()}` }, run); db = admin.firestore(app);
  await ref('appMeta', 'releaseCutover').set({ status: 'active', releaseId: run, voucherNotBefore: { taebaek: date } });
  for (const prefix of ['partnerPaymentCutover', 'partnerAdvanceCutover']) await ref('appMeta', `${prefix}_taebaek`).set({ companyId: 'taebaek', enabled: true, auditPassed: true, legacyWritersBlocked: true });
  for (const code of ['800', '108', '254', '103']) await ref('accountCodes', code).set({ companyId: 'taebaek', code, name: '합성 계정' });
  await ref('appMeta', voucherSequenceKey('taebaek', date, '')).set({ companyId: 'taebaek', tradeDate: date, prefix: '', last: 0 });
  await ref('appMeta', voucherSequenceKey('taebaek', date, '대체')).set({ companyId: 'taebaek', tradeDate: date, prefix: '대체', last: 0 });
 });
 afterAll(async () => { if (db) for (const collection of await db.listCollections()) await db.recursiveDelete(collection); await app?.delete(); });
 it('두 종류 표시+기록을 함께 저장하고 동시 동일 요청 및 최초 발행 replay는 번호를 바꾸지 않는다', async () => {
  const a = await issued('taxable'), b = await issued('exempt', true), input = tax('both', [a.snapshot, b.snapshot]);
  const counter = await ref('appMeta', voucherSequenceKey('taebaek', date, '')).get();
  const results = await Promise.allSettled([recordTaxIssue(db, 'taebaek', actor, input), recordTaxIssue(db, 'taebaek', actor, input)]);
  expect(results.every(row => row.status === 'fulfilled')).toBe(true);
  expect(results.map(row => row.status === 'fulfilled' ? row.value.status : '').sort()).toEqual(['applied', 'duplicate']);
  expect((await ref('taxIssueRecords', `${input.operationId}_taxable`).get()).get('amount')).toBe(110);
  expect((await ref('taxIssueRecords', `${input.operationId}_exempt`).get()).get('amount')).toBe(100);
  for (const row of [a, b]) {
   const current = await ref('issuedStatements', row.id).get(); expect(current.get('items')).toEqual(row.snapshot.items);
   expect(current.get('totalAmount')).toBe(row.snapshot.totalAmount); expect(current.get('docNo')).toBe(row.snapshot.docNo);
   expect((await issueTradeStatement(db, 'taebaek', actor, row.command)).status).toBe('duplicate');
   expect((await current.ref.get()).updateTime!.isEqual(current.updateTime!)).toBe(true);
  }
  expect((await counter.ref.get()).updateTime!.isEqual(counter.updateTime!)).toBe(true);
 });
 it('서로 다른 요청의 같은 원문 CAS는 하나만 저장하고 나머지는 금융 없는 확정 거절이다', async () => {
  const f = await issued('race'), before = await ref('appMeta', voucherSequenceKey('taebaek', date, '')).get();
  const results = await Promise.allSettled([recordTaxIssue(db, 'taebaek', actor, tax('race-a', [f.snapshot])), recordTaxIssue(db, 'taebaek', actor, tax('race-b', [f.snapshot]))]);
  expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
  const failure = results.find(row => row.status === 'rejected') as PromiseRejectedResult;
  expect(failure.reason.details).toMatchObject({ terminalConfirmed: true, financialWrites: false });
  expect((await ref('issuedStatements', f.id).get()).get('mutationRevision')).toBe(1);
  expect((await before.ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
 });
 it('tax 표시 뒤 삭제하고 최초 발행을 재시도해도 원번호만 반환하고 삭제 원문을 재생성하지 않는다', async () => {
  const f = await issued('deleted', true); await recordTaxIssue(db, 'taebaek', actor, tax('deleted-tax', [f.snapshot]));
  const current = await ref('issuedStatements', f.id).get(), counter = await ref('appMeta', voucherSequenceKey('taebaek', date, '')).get();
  await deleteIssuedStatement(db, 'taebaek', actor, { operationId: `${run}-delete`, statementId: f.id, expectedRevision: 1, expectedOriginalHash: statementOriginalHash(current.data()!), releaseId: run });
  expect((await issueTradeStatement(db, 'taebaek', actor, f.command)).status).toBe('duplicate');
  expect((await current.ref.get()).exists).toBe(false); expect((await counter.ref.get()).updateTime!.isEqual(counter.updateTime!)).toBe(true);
 });
 it('이미 적용한 선수금은 tax 표시 뒤에도 조회·전용 취소가 가능하고 표시만 바꾼다', async () => {
  const f = await issued('advance', true), cashId = `${run}-advance-cash`;
  const cash = { companyId: 'taebaek', partnerId: f.partnerId, date, dir: '입금', amount: 100, accountCode: '254', cashAccountId: 'synthetic-bank', createdBy: actor, docNo: 'synthetic-cash', issuePrefix: '', issueOperationId: cashId };
  await ref('cashEntries', cashId).set({ ...cash, issuePayloadHash: semanticHash(genericVoucherBusiness(cash)) });
  const ready = await preparePartnerAdvance(db, 'taebaek', f.partnerId);
  const applied = await applyPartnerAdvance(db, 'taebaek', actor, { operationId: `${run}-apply`, partnerId: f.partnerId, date, source: { collection: 'cashEntries', id: cashId, lineKey: '254' }, statementId: f.id, accountCode: '108', amount: 60, expectedRevision: ready.revision, releaseId: run, expectedSourceFingerprint: ready.sources[0].fingerprint, expectedTargetFingerprint: ready.targets[0].fingerprint });
  const state = await ref('appMeta', `partnerPaymentState_taebaek_${f.partnerId}`).get();
  await recordTaxIssue(db, 'taebaek', actor, tax('advance-tax', [f.snapshot]));
  expect((await state.ref.get()).updateTime!.isEqual(state.updateTime!)).toBe(true);
  const after = await preparePartnerAdvance(db, 'taebaek', f.partnerId); expect(after.sources[0].remaining).toBe(40);
  expect((await cancelPartnerAdvance(db, 'taebaek', actor, { operationId: `${run}-cancel`, partnerId: f.partnerId, date, applicationStatementId: applied.id, reason: '합성 취소', expectedRevision: after.revision, releaseId: run })).status).toBe('applied');
 });
 it('타회사 원문과 actor 충돌은 표시·금액을 바꾸지 않는다', async () => {
  const f = await issued('foreign'), current = await ref('issuedStatements', f.id).get(), input = tax('foreign-tax', [f.snapshot]);
  await expect(recordTaxIssue(db, 'punghoe', actor, input)).rejects.toThrow('회사');
  await recordTaxIssue(db, 'taebaek', actor, input);
  const saved = await current.ref.get(); await expect(recordTaxIssue(db, 'taebaek', 'foreign-actor', input)).rejects.toThrow('원문');
  expect((await current.ref.get()).updateTime!.isEqual(saved.updateTime!)).toBe(true);
 });
 it('generic 발행도 tax 표시와 삭제 뒤 최초 번호만 재사용한다', async () => {
  const id = `${run}-generic`, document = { companyId: 'taebaek', type: '매출', tradeDate: date, partnerId: `${run}-generic-partner`, totalSupply: 100, totalTax: 0, totalAmount: 100, items: [{ name: '합성 면세', qty: 1, supply: 100, tax: 0, total: 100, isTaxExempt: true }] };
  const command = { kind: 'issuedStatements' as const, operationId: id, tradeDate: date, document, releaseId: run };
  await issueVoucher(db, 'taebaek', command);
  const original = await ref('issuedStatements', id).get(); await recordTaxIssue(db, 'taebaek', actor, tax('generic-tax', [{ ...original.data()!, id }]));
  const before = await original.ref.get(), counter = await ref('appMeta', voucherSequenceKey('taebaek', date, '')).get();
  expect((await issueVoucher(db, 'taebaek', command)).docNo).toBe(original.get('docNo'));
  expect((await before.ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
  await deleteIssuedStatement(db, 'taebaek', actor, { operationId: `${run}-generic-delete`, statementId: id, expectedRevision: 1, expectedOriginalHash: statementOriginalHash(before.data()!), releaseId: run });
  expect((await issueVoucher(db, 'taebaek', command)).docNo).toBe(original.get('docNo'));
  expect((await original.ref.get()).exists).toBe(false); expect((await counter.ref.get()).updateTime!.isEqual(counter.updateTime!)).toBe(true);
 });
 it('거래 중간 native 쓰기 실패는 표시·기록·감사 모두 원복하고 동일 ID 재시도가 한 번 저장한다', async () => {
  const f = await issued('rollback'), original = await ref('issuedStatements', f.id).get(), input = tax('rollback-tax', [f.snapshot]);
  const create = admin.firestore.Transaction.prototype.create;
  const injected = vi.spyOn(admin.firestore.Transaction.prototype, 'create').mockImplementation(function (this: admin.firestore.Transaction, target, value) {
   if (target.path === `voucherMutationOperations/${input.operationId}_tax_0`) throw new Error('합성 native 중간 실패');
   return create.call(this, target, value);
  });
  try { await expect(recordTaxIssue(db, 'taebaek', actor, input)).rejects.toThrow('합성 native'); } finally { injected.mockRestore(); }
  expect((await original.ref.get()).updateTime!.isEqual(original.updateTime!)).toBe(true);
  expect((await ref('taxIssueOperations', input.operationId).get()).exists).toBe(false);
  expect((await ref('taxIssueRecords', `${input.operationId}_taxable`).get()).exists).toBe(false);
  expect((await recordTaxIssue(db, 'taebaek', actor, input)).status).toBe('applied'); expect((await recordTaxIssue(db, 'taebaek', actor, input)).status).toBe('duplicate');
 });
 it('과거 화면은 반환 revision을 반영해 다른 종류를 연속 확인하고 최초 발행 replay를 보존한다', async () => {
  const f = await issued('history-revision'), firstInput = { ...tax('history-first', [f.snapshot]), scope: 'taxable' as const };
  const first = await recordTaxIssue(db, 'taebaek', actor, firstInput);
  expect(first.statementPatches[0].data.mutationRevision).toBe(1);
  const extraSnapshot = { ...f.snapshot, ...first.statementPatches[0].data };
  const second = await recordTaxIssue(db, 'taebaek', actor, tax('history-second', [extraSnapshot]));
  expect(second.statementPatches[0].data.mutationRevision).toBe(2);
  const current = await ref('issuedStatements', f.id).get(), counter = await ref('appMeta', voucherSequenceKey('taebaek', date, '')).get();
  expect((await issueTradeStatement(db, 'taebaek', actor, f.command)).status).toBe('duplicate');
  expect((await current.ref.get()).updateTime!.isEqual(current.updateTime!)).toBe(true);
  expect((await counter.ref.get()).updateTime!.isEqual(counter.updateTime!)).toBe(true);
 });
});
