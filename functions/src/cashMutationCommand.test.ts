import { describe, expect, it, vi } from 'vitest';
vi.mock('firebase-functions/v2/https', () => ({ HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } }, onCall: (_o: unknown, fn: unknown) => fn }));
vi.mock('firebase-admin', () => ({ firestore: () => ({}) }));
import { cashMutationHash, cashOriginalHash, mutateCashEntry, prepareTransferCashEdit } from './cashMutationCommand';
type Row = Record<string, any>;
function fakeDb(initial: Record<string, Row>) {
  const rows = new Map(Object.entries(initial));
  const snapshot = (key: string) => ({ id: key.split('/')[1], ref: { key }, exists: rows.has(key), data: () => rows.get(key) });
  const db = { collection: (name: string) => ({ collection: name, doc: (id: string) => ({ key: `${name}/${id}` }),
    where: (field: string, _op: string, value: unknown) => ({ collection: name, field, value }) }),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => {
      const writes: (() => void)[] = [];
      const result = await fn({ get: async (ref: any) => {
        if (writes.length) throw new Error('read after write');
        if (ref.key) return snapshot(ref.key);
        return { docs: [...rows].filter(([key, data]) => key.startsWith(`${ref.collection}/`) && (!ref.field || data[ref.field] === ref.value)).map(([key]) => snapshot(key)) };
      }, update: (ref: any, value: Row) => writes.push(() => rows.set(ref.key, { ...rows.get(ref.key), ...value })),
      create: (ref: any, value: Row) => writes.push(() => rows.set(ref.key, value)), delete: (ref: any) => writes.push(() => rows.delete(ref.key)) });
      writes.forEach(write => write()); return result;
    } };
  return { db: db as any, rows };
}
const cash = { companyId: 'taebaek', date: '2026-10-03', dir: '출금', amount: 100, accountCode: '253', partnerId: 'p', docNo: '261003-001' };
function seeded(extra: Record<string, Row> = {}) { return fakeDb({ 'appMeta/releaseCutover': { status: 'active', releaseId: 'release' },
  'cashEntries/cash': cash, 'accountCodes/c': { companyId: 'taebaek', code: '253' },
  'partners/p': { companyId: 'taebaek', name: '거래처' }, ...extra }); }
const input = (action: 'edit' | 'delete', patch?: any) => ({ action, operationId: 'mutation', cashEntryId: 'cash', expectedRevision: 0,
  expectedCashHash: cashMutationHash(cash), releaseId: 'release', ...(patch ? { patch } : {}) });
describe('fresh cash transaction', () => {
  it('atomically changes cash and one settlement and increments partner revision', async () => {
    const { db, rows } = seeded({ 'issuedStatements/v': { companyId: 'taebaek', partnerId: 'p', type: '매입', tradeDate: '2026-10-03', totalAmount: 200, totalSupply: 200, totalTax: 0, items: [{ accountCode: '802', supply: 200, tax: 0, total: 200, qty: 1 }] },
      'settlements/s': { companyId: 'taebaek', statementId: 'v', cashEntryId: 'cash', amount: 100 } });
    const request = input('edit', { amount: 150 });
    expect(await mutateCashEntry(db, 'taebaek', 'uid', request)).toMatchObject({ status: 'applied', revision: 1, docNo: '261003-001' });
    expect(rows.get('settlements/s')?.amount).toBe(150);
    expect(rows.get('cashEntries/cash')?.amount).toBe(150);
    expect(rows.get('appMeta/partnerPaymentState_taebaek_p')?.revision).toBe(1);
    expect(await mutateCashEntry(db, 'taebaek', 'uid', request)).toMatchObject({ status: 'duplicate' });
  });
  it('deletes fresh settlements and preserves the issuance counter', async () => {
    const { db, rows } = seeded({ 'issuedStatements/v': { companyId: 'taebaek', partnerId: 'p' },
      'settlements/s': { companyId: 'taebaek', statementId: 'v', cashEntryId: 'cash', amount: 50 },
      'appMeta/voucherNo': { last: 10 } });
    expect(await mutateCashEntry(db, 'taebaek', 'uid', input('delete'))).toMatchObject({ status: 'applied' });
    expect(rows.has('cashEntries/cash')).toBe(false); expect(rows.has('settlements/s')).toBe(false);
    expect(rows.get('appMeta/voucherNo')).toEqual({ last: 10 });
    expect(await mutateCashEntry(db, 'taebaek', 'uid', input('delete'))).toMatchObject({ status: 'duplicate' });
  });
  it('rejects stale originals, wrong company and same-operation hash collisions without writes', async () => {
    for (const request of [{ ...input('edit', { note: '메모' }), expectedRevision: 1 }, { ...input('edit', { note: '메모' }), expectedCashHash: '0'.repeat(64) }]) {
      const { db, rows } = seeded(); await expect(mutateCashEntry(db, 'taebaek', 'uid', request)).rejects.toThrow(); expect(rows.get('cashEntries/cash')).toEqual(cash);
    }
    const { db, rows } = seeded(); await expect(mutateCashEntry(db, 'punghoe', 'uid', input('delete'))).rejects.toThrow();
    await mutateCashEntry(db, 'taebaek', 'uid', input('edit', { note: '메모' }));
    await expect(mutateCashEntry(db, 'taebaek', 'uid', input('edit', { note: '다른 내용' }))).rejects.toThrow();
    expect(rows.get('cashEntries/cash')?.note).toBe('메모');
  });
  it('fails all writes when a fresh settlement would exceed the claim', async () => {
    const { db, rows } = seeded({ 'issuedStatements/v': { companyId: 'taebaek', partnerId: 'p', type: '매입', tradeDate: '2026-10-03', totalAmount: 110, totalSupply: 110, totalTax: 0, items: [{ accountCode: '802', qty: 1, supply: 110, tax: 0, total: 110 }] },
      'settlements/s': { companyId: 'taebaek', statementId: 'v', cashEntryId: 'cash', amount: 100 } });
    await expect(mutateCashEntry(db, 'taebaek', 'uid', input('edit', { amount: 150 }))).rejects.toThrow();
    expect(rows.get('settlements/s')?.amount).toBe(100); expect(rows.get('cashEntries/cash')).toEqual(cash);
    expect(rows.has('voucherMutationOperations/mutation')).toBe(false);
  });
});

it('대출 현금과 최신 계약 원금잔액·revision을 함께 수정한다', async () => {
  const original = { ...cash, loanId: 'loan', accountCode: '', partnerId: '', amount: 120,
    createdAt: '2026-10-03T00:00:00Z', lines: [{ accountCode: '260', amount: 100 }, { accountCode: '931', amount: 20 }] };
  const { db, rows } = seeded({ 'cashEntries/cash': original, 'loanContracts/loan': { companyId: 'taebaek', accountCode: '260', openingDate: '2026-07-31', openingPrincipal: 1000, principalBalance: 900, movementRevision: 2 },
    'accountCodes/principal': { companyId: 'taebaek', code: '260' }, 'accountCodes/interest': { companyId: 'taebaek', code: '931' } });
  const request = { ...input('edit', { amount: 220, lines: [{ accountCode: '260', amount: 200 }, { accountCode: '931', amount: 20 }] }), expectedCashHash: cashMutationHash(original) };
  await mutateCashEntry(db, 'taebaek', 'uid', request);
  expect(rows.get('loanContracts/loan')).toMatchObject({ principalBalance: 800, movementRevision: 3 });
  expect(rows.get('cashEntries/cash')?.amount).toBe(220);
  expect(await mutateCashEntry(db, 'taebaek', 'uid', request)).toMatchObject({ status: 'duplicate' });
  expect(rows.get('loanContracts/loan')?.movementRevision).toBe(3);
});

it('사원별 급여 입력을 실제 검증하여 원대장과 현금 분개를 함께 갱신한다', async () => {
  const original = { ...cash, payrollId: 'pay-2026-10', partnerId: '', accountCode: '802' };
  const { db, rows } = seeded({ 'cashEntries/cash': original,
    'payrolls/pay-2026-10': { companyId: 'taebaek', yearMonth: '2026-10', payDate: '2026-10-03', revision: 2, cashEntryId: 'cash', issueKind: 'cashEntries' },
    'accountCodes/salary': { companyId: 'taebaek', name: '급여', code: '802' }, 'accountCodes/tax': { companyId: 'taebaek', name: '예수금', code: '254' },
    'employees/employee': { companyId: 'taebaek', name: '합성 사원' } });
  const request = { ...input('edit', { amount: 180, accountCode: '', lines: [{ accountCode: '802', amount: 200 }, { accountCode: '254', amount: -20 }] }),
    expectedCashHash: cashMutationHash(original), payrollEdit: { yearMonth: '2026-10', payDate: '2026-10-03', expectedRevision: 2,
      lines: [{ employeeId: 'employee', employeeName: '합성 사원', base: 200, incomeTax: 20 }] } };
  await mutateCashEntry(db, 'taebaek', 'uid', request);
  expect(rows.get('cashEntries/cash')?.amount).toBe(180);
  expect(rows.get('payrolls/pay-2026-10')).toMatchObject({ revision: 3, lines: [{ base: 200, incomeTax: 20 }] });
  expect(rows.get('payrolls/pay-2026-10')?.issueVoucherHash).toMatch(/^[a-f0-9]{64}$/);
  expect(await mutateCashEntry(db, 'taebaek', 'uid', request)).toMatchObject({ status: 'duplicate' });
});
it('급여 삭제는 원대장 연결과 취소 증거를 남기며 현금을 원자 삭제한다', async () => {
  const original = { ...cash, payrollId: 'pay-2026-10', partnerId: '' };
  const { db, rows } = seeded({ 'cashEntries/cash': original,
    'payrolls/pay-2026-10': { companyId: 'taebaek', yearMonth: '2026-10', revision: 2, cashEntryId: 'cash', issueKind: 'cashEntries' } });
  await mutateCashEntry(db, 'taebaek', 'uid', { ...input('delete'), expectedCashHash: cashMutationHash(original) });
  expect(rows.has('cashEntries/cash')).toBe(false);
  expect(rows.get('payrolls/pay-2026-10')).toMatchObject({ cashEntryId: 'cash', issueCancelled: true, revision: 3, issueCancellationOperationId: 'mutation' });
  expect(rows.get('voucherMutationOperations/mutation')?.beforeSnapshot.payrollId).toBe('pay-2026-10');
});

it('미지급비용 지급 금액은 fresh 발생 원전표와 다른 지급 합계 안에서만 수정한다', async () => {
  const original = { ...cash, accountCode: '275', partnerId: '', linkedAccrualStatementId: 'accrual' };
  const extra = { 'cashEntries/cash': original, 'cashEntries/other': { ...original, amount: 50 },
    'accountCodes/accrued': { companyId: 'taebaek', code: '275' },
    'issuedStatements/accrual': { companyId: 'taebaek', type: '비용', partnerId: '', items: [{ accountCode: '275', side: '대변', total: 200 }] } };
  const success = seeded(extra);
  await mutateCashEntry(success.db, 'taebaek', 'uid', { ...input('edit', { amount: 150 }), expectedCashHash: cashMutationHash(original) });
  expect(success.rows.get('cashEntries/cash')?.amount).toBe(150);
  const rejected = seeded(extra);
  await expect(mutateCashEntry(rejected.db, 'taebaek', 'uid', { ...input('edit', { amount: 151 }), expectedCashHash: cashMutationHash(original) })).rejects.toThrow('잔액');
  expect(rejected.rows.get('cashEntries/cash')?.amount).toBe(100);
});

it('조정 현금 날짜·금액 변경은 공용 원장의 fresh before로 metadata를 맞추고 계좌 기준점은 보존한다', async () => {
  const original = { ...cash, accountCode: '', partnerId: '', cashAccountId: 'bank', dir: '입금', amount: 20,
    balanceAdjustment: { before: 100, target: 120, delta: 20, reason: '미분류' } };
  const account = { companyId: 'taebaek', openingDate: '2026-07-31', openingBalance: 100,
    confirmedBalances: [{ date: '2026-09-30', balance: 200, recordedAt: '2026-10-01T00:00:00Z', reason: '확정' }] };
  const { db, rows } = seeded({ 'cashEntries/cash': original, 'cashAccounts/bank': account,
    'cashEntries/movement': { companyId: 'taebaek', cashAccountId: 'bank', date: '2026-10-02', dir: '출금', amount: 50 } });
  await mutateCashEntry(db, 'taebaek', 'uid', { ...input('edit', { date: '2026-10-04', amount: 30 }), expectedCashHash: cashMutationHash(original) });
  expect(rows.get('cashEntries/cash')).toMatchObject({ date: '2026-10-04', amount: 30, balanceAdjustment: { before: 150, target: 180, delta: 30, reason: '미분류' } });
  expect(rows.get('cashAccounts/bank')).toEqual(account);
});

function transferSeed() {
  const out = { ...cash, partnerId: 'outPartner', accountCode: '', lines: [{ accountCode: '133', amount: 100 }], transferOperationId: 'transfer', issuePayloadHash: 'request' };
  const incoming = { ...out, companyId: 'punghoe', dir: '입금', partnerId: 'inPartner', lines: [{ accountCode: '254', amount: 100 }] };
  const business = (row: Row) => ({ companyId: row.companyId, partnerId: row.partnerId, date: row.date, amount: row.amount, note: row.note, cashAccountId: row.cashAccountId, dir: row.dir, lines: row.lines });
  const fake = seeded({ 'cashEntries/cash': out, 'cashEntries/incoming': incoming,
    'companyTransferOperations/transfer': { from: 'taebaek', to: 'punghoe', outCashEntryId: 'cash', inCashEntryId: 'incoming', requestHash: 'request', outHash: cashMutationHash(business(out)), inHash: cashMutationHash(business(incoming)) },
    'companyTransferGrants/uid': { enabled: true, authUid: 'uid', allowedPairs: ['taebaek>punghoe'], revision: 1, approvedBy: '승인자', approvedAt: '2026-10-01T00:00:00Z' },
    'employees/employee': { authUid: 'uid', companyId: 'taebaek', adminAccess: true, status: 'working' },
    'partners/outPartner': { companyId: 'taebaek', name: '풍회' }, 'partners/inPartner': { companyId: 'punghoe', name: '태백' },
    'accountCodes/prepaid': { companyId: 'taebaek', code: '133' }, 'accountCodes/advance': { companyId: 'punghoe', code: '254' } });
  return { ...fake, out, incoming, claims: { employeeId: 'employee', companyId: 'taebaek', isAdmin: true } };
}
it('회사이체 prepare는 양사 grant와 화면 원문을 검증해 실제 counterpart만 반환한다', async () => {
  const setup = transferSeed();
  expect(await prepareTransferCashEdit(setup.db, 'taebaek', 'uid', setup.claims, { cashEntryId: 'cash', expectedCashHash: cashOriginalHash(setup.out), releaseId: 'release' })).toMatchObject({ counterpart: { id: 'incoming', companyId: 'punghoe' }, expectedRevision: 0 });
  setup.rows.get('companyTransferGrants/uid')!.enabled = false;
  await expect(prepareTransferCashEdit(setup.db, 'taebaek', 'uid', setup.claims, { cashEntryId: 'cash', expectedCashHash: cashOriginalHash(setup.out), releaseId: 'release' })).rejects.toThrow('권한');
});
it('회사이체 full 변경은 양쪽 금액·분개·revision과 거래처 상태를 한 transaction으로 수정한다', async () => {
  const setup = transferSeed();
  const request = { ...input('edit', { amount: 120, lines: [{ accountCode: '133', amount: 120 }] }), expectedCashHash: cashOriginalHash(setup.out),
    transferEdit: { counterpartId: 'incoming', expectedRevision: 0, expectedCashHash: cashOriginalHash(setup.incoming), patch: { amount: 120, lines: [{ accountCode: '254', amount: 120 }] } } };
  await mutateCashEntry(setup.db, 'taebaek', 'uid', request, setup.claims);
  expect(setup.rows.get('cashEntries/cash')).toMatchObject({ amount: 120, mutationRevision: 1 });
  expect(setup.rows.get('cashEntries/incoming')).toMatchObject({ amount: 120, mutationRevision: 1 });
  expect(setup.rows.get('appMeta/partnerPaymentState_punghoe_inPartner')?.revision).toBe(1);
  expect(await mutateCashEntry(setup.db, 'taebaek', 'uid', request, setup.claims)).toMatchObject({ status: 'duplicate' });
});
it('회사이체 금액 불일치 또는 다른 원문 hash는 양쪽 금융 쓰기 없이 거절한다', async () => {
  const setup = transferSeed();
  const request = { ...input('edit', { amount: 120, lines: [{ accountCode: '133', amount: 120 }] }), expectedCashHash: cashOriginalHash(setup.out),
    transferEdit: { counterpartId: 'incoming', expectedRevision: 0, expectedCashHash: cashOriginalHash(setup.incoming), patch: { amount: 121, lines: [{ accountCode: '254', amount: 121 }] } } };
  await expect(mutateCashEntry(setup.db, 'taebaek', 'uid', request, setup.claims)).rejects.toThrow('금액');
  expect(setup.rows.get('cashEntries/cash')).toEqual(setup.out); expect(setup.rows.get('cashEntries/incoming')).toEqual(setup.incoming);
  await expect(mutateCashEntry(setup.db, 'taebaek', 'uid', { ...request, transferEdit: { ...request.transferEdit, expectedCashHash: '0'.repeat(64) } }, setup.claims)).rejects.toThrow('원문');
});
it('회사이체 삭제는 양쪽 전표를 동시에 지우고 원 발행 작업과 취소 감사를 보존한다', async () => {
  const setup = transferSeed();
  const request = { ...input('delete'), expectedCashHash: cashOriginalHash(setup.out), transferEdit: { counterpartId: 'incoming', expectedRevision: 0, expectedCashHash: cashOriginalHash(setup.incoming) } };
  await mutateCashEntry(setup.db, 'taebaek', 'uid', request, setup.claims);
  expect(setup.rows.has('cashEntries/cash')).toBe(false); expect(setup.rows.has('cashEntries/incoming')).toBe(false);
  expect(setup.rows.has('companyTransferOperations/transfer')).toBe(true);
  expect(setup.rows.get('voucherMutationOperations/mutation')?.transferBeforeSnapshots.incoming.companyId).toBe('punghoe');
  expect(setup.rows.get('voucherMutationOperations/mutation')?.transferAfterHashes).toEqual({ cash: null, incoming: null });
  expect(await mutateCashEntry(setup.db, 'taebaek', 'uid', request, setup.claims)).toMatchObject({ status: 'duplicate' });
});
