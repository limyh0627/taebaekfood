import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } },
  onCall: (_options: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-admin', () => ({ firestore: () => ({}) }));

import { issuePayrollVoucher, savePayrollDraft } from './payrollVoucher';

type Row = Record<string, any>;
function fakeDb(initial: Record<string, Row>) {
  const rows = new Map(Object.entries(initial));
  let queue = Promise.resolve();
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => ({ key: `${name}/${id}` }),
      where: (field: string, op: string, value: string) => ({ collection: name, field, op, value }),
    }),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const pending: Array<() => void> = [];
      try {
        const result = await fn({
          get: async (ref: { key?: string; collection?: string; field?: string; op?: string; value?: string }) => ref.key
            ? { ref, exists: rows.has(ref.key), data: () => rows.get(ref.key!) }
            : { docs: [...rows.entries()].filter(([key, value]) => key.startsWith(`${ref.collection!}/`)
                && (ref.op === 'array-contains' ? Array.isArray(value[ref.field!]) && value[ref.field!].includes(ref.value)
                  : value[ref.field!] === ref.value))
              .map(([key, value]) => ({ id: key.slice(ref.collection!.length + 1), data: () => value })) },
          update: (ref: { key: string }, value: Row) => pending.push(() => rows.set(ref.key, { ...rows.get(ref.key), ...value })),
          create: (ref: { key: string }, value: Row) => pending.push(() => {
            if (rows.has(ref.key)) throw new Error('already exists');
            rows.set(ref.key, value);
          }),
        });
        pending.forEach(write => write());
        return result;
      } finally { release(); }
    },
  };
  return { db: db as any, rows };
}

const counter = 'appMeta/voucherNo_taebaek_2026-10-25_급여';
const accrualCounter = 'appMeta/voucherNo_taebaek_2026-10-31_급여';
const line = { employeeId: 'emp-1', employeeName: '김하나', base: 3_000_000, incomeTax: 300_000 };
const input = { yearMonth: '2026-10', payDate: '2026-10-25', lines: [line], expectedRevision: 0,
  releaseId: 'test-release' };
const base = () => fakeDb({
  [counter]: { companyId: 'taebaek', tradeDate: '2026-10-25', prefix: '급여', last: 4 },
  [accrualCounter]: { companyId: 'taebaek', tradeDate: '2026-10-31', prefix: '급여', last: 8 },
  'appMeta/payrollIssueCutover_taebaek': { companyId: 'taebaek', firstYearMonth: '2026-10' },
  'appMeta/releaseCutover': { status: 'active', releaseId: 'test-release', voucherNotBefore: { taebaek: '2026-10-03' } },
  'employees/emp-1': { companyId: 'taebaek', name: '김하나', status: 'working' },
  'accountCodes/a1': { companyId: 'taebaek', name: '급여', code: '802' },
  'accountCodes/a2': { companyId: 'taebaek', name: '예수금', code: '257' },
  'accountCodes/a3': { companyId: 'taebaek', name: '미지급비용', code: '275' },
  'cashAccounts/bank': { companyId: 'taebaek', type: '통장', active: true },
});

describe('급여대장 공통 번호 원자 발행', () => {
  it('지급 한 건의 실지급액과 대장 연결, 번호를 함께 쓴다', async () => {
    const { db, rows } = base();
    const result = await issuePayrollVoucher(db, 'taebaek', { ...input, mode: 'cash' });
    expect(result).toEqual({ id: 'payroll-taebaek-2026-10-base', docNo: '급여261025-005', kind: 'cashEntries' });
    expect(rows.get(`cashEntries/${result.id}`)).toMatchObject({ amount: 2_700_000, cashAccountId: 'bank', lines: [
      { accountCode: '802', amount: 3_000_000 }, { accountCode: '257', amount: 300_000, side: '대변' },
    ] });
    expect(rows.get('payrolls/pay-2026-10')).toMatchObject({ cashEntryId: result.id, issueKind: 'cashEntries', revision: 1 });
    expect(rows.get(counter)?.last).toBe(5);
  });

  it('응답 유실 재시도는 원번호를 반환하고 변경된 입력은 거절한다', async () => {
    const { db, rows } = base();
    const request = { ...input, mode: 'cash' as const };
    const first = await issuePayrollVoucher(db, 'taebaek', request);
    expect(await issuePayrollVoucher(db, 'taebaek', request)).toEqual(first);
    expect(rows.get(counter)?.last).toBe(5);
    await expect(issuePayrollVoucher(db, 'taebaek', { ...request, lines: [{ ...line, base: 3_100_000 }] })).rejects.toThrow('다른 급여');
  });

  it('동시 지급과 발생은 같은 월 작업 ID를 다투고 한 건만 발행한다', async () => {
    const { db, rows } = base();
    const results = await Promise.allSettled([
      issuePayrollVoucher(db, 'taebaek', { ...input, mode: 'cash' }),
      issuePayrollVoucher(db, 'taebaek', { ...input, mode: 'accrual' }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect([...rows.keys()].filter(key => key.startsWith('cashEntries/') || key.startsWith('issuedStatements/'))).toHaveLength(1);
    expect((rows.get(counter)?.last ?? 4) - 4 + (rows.get(accrualCounter)?.last ?? 8) - 8).toBe(1);
  });

  it('카운터가 없으면 대장과 전표를 모두 쓰지 않는다', async () => {
    const { db, rows } = base();
    rows.delete(counter);
    await expect(issuePayrollVoucher(db, 'taebaek', { ...input, mode: 'cash' })).rejects.toThrow('카운터');
    expect(rows.has('payrolls/pay-2026-10')).toBe(false);
    expect(rows.has('cashEntries/payroll-taebaek-2026-10-base')).toBe(false);
  });

  it('전환월이 없거나 과거 월이면 이전 발행 이력을 확인할 때까지 막는다', async () => {
    const { db, rows } = base();
    rows.delete('appMeta/payrollIssueCutover_taebaek');
    await expect(issuePayrollVoucher(db, 'taebaek', { ...input, mode: 'cash' })).rejects.toThrow('전환월');
    rows.set('appMeta/payrollIssueCutover_taebaek', { companyId: 'taebaek', firstYearMonth: '2026-11' });
    await expect(issuePayrollVoucher(db, 'taebaek', { ...input, mode: 'cash' })).rejects.toThrow('전환월');
    expect(rows.get(counter)?.last).toBe(4);
  });

  it('기존 미감사 대장이나 끊어진 연결은 재발행하지 않는다', async () => {
    const { db, rows } = base();
    rows.set('payrolls/pay-2026-10', { id: 'pay-2026-10', companyId: 'taebaek', yearMonth: '2026-10', lines: [line] });
    await expect(issuePayrollVoucher(db, 'taebaek', { ...input, mode: 'cash' })).rejects.toThrow('이력');
    rows.delete('payrolls/pay-2026-10');
    await issuePayrollVoucher(db, 'taebaek', { ...input, mode: 'cash' });
    rows.get('payrolls/pay-2026-10')!.cashEntryId = 'missing';
    await expect(issuePayrollVoucher(db, 'taebaek', { ...input, mode: 'cash' })).rejects.toThrow('연결');
  });

  it('발행 뒤 원전표 금액·줄·번호가 바뀌면 같은 요청도 성공으로 돌려주지 않는다', async () => {
    for (const change of [
      (row: Row) => { row.amount = 1; },
      (row: Row) => { row.lines[0].amount = 1; },
      (row: Row) => { row.docNo = '급여261025-999'; },
    ]) {
      const { db, rows } = base();
      const request = { ...input, mode: 'cash' as const };
      await issuePayrollVoucher(db, 'taebaek', request);
      change(rows.get('cashEntries/payroll-taebaek-2026-10-base')!);
      await expect(issuePayrollVoucher(db, 'taebaek', request)).rejects.toThrow('연결');
      expect(rows.get(counter)?.last).toBe(5);
    }
  });

  it('대장 단독 저장은 revision을 올리고 발행 연결을 보존한다', async () => {
    const { db, rows } = base();
    expect(await savePayrollDraft(db, 'taebaek', input)).toEqual({ revision: 1 });
    await expect(savePayrollDraft(db, 'taebaek', input)).rejects.toThrow('다른 화면');
    const updated = { ...input, expectedRevision: 1 };
    await issuePayrollVoucher(db, 'taebaek', { ...updated, mode: 'cash' });
    await expect(savePayrollDraft(db, 'taebaek', { ...updated, expectedRevision: 2 })).rejects.toThrow('직접 수정');
    expect(rows.get('payrolls/pay-2026-10')?.cashEntryId).toBe('payroll-taebaek-2026-10-base');
  });

  it('타회사 사원은 발행하지 않는다', async () => {
    const { db, rows } = base();
    rows.get('employees/emp-1')!.companyId = 'punghoe';
    await expect(issuePayrollVoucher(db, 'taebaek', { ...input, mode: 'cash' })).rejects.toThrow('사원');
    expect(rows.get(counter)?.last).toBe(4);
  });
  it('새 지급은 명시 메인 통장을 쓰고 같은 계좌로만 재시도한다', async () => {
    const { db, rows } = base();
    rows.set('cashAccounts/cashacct-temp-main', { companyId: 'taebaek', type: '통장', active: true });
    const request = { ...input, mode: 'cash' as const, cashAccountId: 'cashacct-temp-main' };
    const first = await issuePayrollVoucher(db, 'taebaek', request);
    expect(rows.get(`cashEntries/${first.id}`)?.cashAccountId).toBe('cashacct-temp-main');
    expect(rows.get('payrolls/pay-2026-10')?.issueCashAccountId).toBe('cashacct-temp-main');
    expect(await issuePayrollVoucher(db, 'taebaek', request)).toEqual(first);
    await expect(issuePayrollVoucher(db, 'taebaek', { ...request, cashAccountId: 'bank' })).rejects.toThrow('다른 급여');
    expect(rows.get(counter)?.last).toBe(5);
  });
  it('타회사·비활성·카드 지급 계좌는 발행 전에 거절한다', async () => {
    for (const bank of [
      { companyId: 'punghoe', type: '통장', active: true },
      { companyId: 'taebaek', type: '통장', active: false },
      { companyId: 'taebaek', type: '카드', active: true },
    ]) {
      const { db, rows } = base(); rows.set('cashAccounts/invalid', bank);
      await expect(issuePayrollVoucher(db, 'taebaek', { ...input, mode: 'cash', cashAccountId: 'invalid' })).rejects.toThrow('계좌');
      expect(rows.get(counter)?.last).toBe(4);
      expect(rows.has('payrolls/pay-2026-10')).toBe(false);
      expect(rows.has('cashEntries/payroll-taebaek-2026-10-base')).toBe(false);
    }
  });

  it.each(['taebaek', 'punghoe'])('%s의 명시 통장을 다른 회사와 분리하여 사용한다', async company => {
    const fixture = base();
    const initial = Object.fromEntries([...fixture.rows].map(([key, value]) => [key.replace(/_taebaek/g, `_${company}`), { ...value, ...(value.companyId ? { companyId: company } : {}) }]));
    initial['appMeta/releaseCutover'] = { ...initial['appMeta/releaseCutover'], voucherNotBefore: { [company]: '2026-10-03' } };
    initial['cashAccounts/main'] = { companyId: company, type: '통장', active: true };
    initial['cashAccounts/foreign'] = { companyId: company === 'taebaek' ? 'punghoe' : 'taebaek', type: '통장', active: true };
    const { db, rows } = fakeDb(initial);
    const result = await issuePayrollVoucher(db, company, { ...input, mode: 'cash', cashAccountId: 'main' });
    expect(rows.get(`cashEntries/${result.id}`)).toMatchObject({ companyId: company, cashAccountId: 'main' });
  });});
