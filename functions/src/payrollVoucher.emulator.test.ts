import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';

vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } },
  onCall: (_options: unknown, handler: unknown) => handler,
}));

import { issuePayrollVoucher, savePayrollDraft } from './payrollVoucher';

// Run only with FIRESTORE_EMULATOR_HOST=127.0.0.1:8082 explicitly set.
const available = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8182';
const projectId = `demo-payroll-voucher-${Math.random().toString(36).slice(2)}`;
let app: admin.app.App;
let db: admin.firestore.Firestore;

const line = { employeeId: 'emp-1', employeeName: '김하나', base: 3_000_000, incomeTax: 300_000 };
async function seed(ym: string, payDate: string) {
  const month = Number(ym.slice(5));
  const year = Number(ym.slice(0, 4));
  const last = `${ym}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
  for (const date of [payDate, last]) await db.collection('appMeta').doc(`voucherNo_taebaek_${date}_급여`)
    .set({ companyId: 'taebaek', tradeDate: date, prefix: '급여', last: 0 });
}

describe.skipIf(!available)('급여 명령 Firestore SDK 거래', () => {
  beforeAll(async () => {
    app = admin.initializeApp({ projectId }, projectId);
    db = admin.firestore(app);
    await Promise.all([
      db.collection('employees').doc('emp-1').set({ companyId: 'taebaek', name: '김하나', status: 'working' }),
      db.collection('accountCodes').doc('salary').set({ companyId: 'taebaek', name: '급여', code: '802' }),
      db.collection('accountCodes').doc('withhold').set({ companyId: 'taebaek', name: '예수금', code: '257' }),
      db.collection('accountCodes').doc('accrued').set({ companyId: 'taebaek', name: '미지급비용', code: '275' }),
      db.collection('cashAccounts').doc('bank').set({ companyId: 'taebaek', type: '통장', active: true }),
      db.collection('appMeta').doc('payrollIssueCutover_taebaek').set({ companyId: 'taebaek', firstYearMonth: '2026-10' }),
      db.collection('appMeta').doc('releaseCutover').set({ status: 'active', releaseId: 'test-release', voucherNotBefore: { taebaek: '2026-10-25' } }),
    ]);
  });
  afterAll(async () => { await app?.delete(); });

  it('동시 지급·발생 중 하나만 발행하고 재시도는 원번호를 돌려준다', async () => {
    await seed('2026-10', '2026-10-25');
    const input = { yearMonth: '2026-10', payDate: '2026-10-25', lines: [line], expectedRevision: 0,
      releaseId: 'test-release' };
    const results = await Promise.allSettled([
      issuePayrollVoucher(db, 'taebaek', { ...input, mode: 'cash' }),
      issuePayrollVoucher(db, 'taebaek', { ...input, mode: 'accrual' }),
    ]);
    const success = results.find(r => r.status === 'fulfilled');
    expect(success?.status).toBe('fulfilled');
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    if (success?.status !== 'fulfilled') return;
    const mode = success.value.kind === 'cashEntries' ? 'cash' : 'accrual';
    expect(await issuePayrollVoucher(db, 'taebaek', { ...input, mode })).toEqual(success.value);
    const voucher = await db.collection(success.value.kind).doc(success.value.id).get();
    expect(voucher.data()?.docNo).toBe(success.value.docNo);
    expect((await db.collection('payrolls').doc('pay-2026-10').get()).data()?.cashEntryId).toBe(success.value.id);
    const counters = await Promise.all(['2026-10-25', '2026-10-31'].map(date => db.collection('appMeta').doc(`voucherNo_taebaek_${date}_급여`).get()));
    expect(counters.reduce((n, snap) => n + snap.data()!.last, 0)).toBe(1);
    await voucher.ref.update(success.value.kind === 'cashEntries' ? { amount: 1 } : { totalAmount: 1 });
    await expect(issuePayrollVoucher(db, 'taebaek', { ...input, mode })).rejects.toThrow('연결');
  }, 20_000);

  it('카운터가 없으면 급여대장과 전표가 모두 미반영이다', async () => {
    const input = { yearMonth: '2026-11', payDate: '2026-11-25', lines: [line], expectedRevision: 0,
      releaseId: 'test-release', mode: 'cash' as const };
    await expect(issuePayrollVoucher(db, 'taebaek', input)).rejects.toThrow('카운터');
    expect((await db.collection('payrolls').doc('pay-2026-11').get()).exists).toBe(false);
    expect((await db.collection('cashEntries').doc('payroll-taebaek-2026-11-base').get()).exists).toBe(false);
  });
  it('원본 버전 충돌과 명시 메인 지급 계좌를 실제 transaction으로 검증한다', async () => {
    await seed('2026-12', '2026-12-25');
    await db.collection('cashAccounts').doc('cashacct-temp-main').set({ companyId: 'taebaek', type: '통장', active: true });
    const input = { yearMonth: '2026-12', payDate: '2026-12-25', lines: [line], expectedRevision: 0, releaseId: 'test-release' };
    expect(await savePayrollDraft(db, 'taebaek', input)).toEqual({ revision: 1 });
    await expect(issuePayrollVoucher(db, 'taebaek', { ...input, mode: 'cash', cashAccountId: 'cashacct-temp-main' })).rejects.toThrow('다른 화면');
    expect((await db.collection('cashEntries').doc('payroll-taebaek-2026-12-base').get()).exists).toBe(false);
    const request = { ...input, expectedRevision: 1, mode: 'cash' as const, cashAccountId: 'cashacct-temp-main' };
    const first = await issuePayrollVoucher(db, 'taebaek', request);
    expect((await db.collection('cashEntries').doc(first.id).get()).data()?.cashAccountId).toBe('cashacct-temp-main');
    expect(await issuePayrollVoucher(db, 'taebaek', request)).toEqual(first);
    expect((await db.collection('appMeta').doc('voucherNo_taebaek_2026-12-25_급여').get()).data()?.last).toBe(1);
  }, 20_000);

});
