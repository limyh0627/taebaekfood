import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } },
  onCall: (_options: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-admin', () => ({ firestore: () => ({}) }));

import { formatVoucherNo, issueVoucher } from './voucherIssue';
import { issueScheduledVoucher } from './autoVoucherCommand';
import { buildCashVoucher, buildStatementVoucher } from '../../src/shared/autoVoucher';
import type { FixedCostTemplate } from '../../src/shared/types';

type Row = Record<string, unknown>;
function fakeDb(initial: Record<string, Row>) {
  const rows = new Map(Object.entries(initial));
  let queue = Promise.resolve();
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => ({ key: `${name}/${id}` }),
      where: (field: string, op: string, value: unknown) => ({ collection: name, field, op, value }),
      get: async () => ({ docs: [...rows.entries()].filter(([key]) => key.startsWith(`${name}/`))
        .map(([key, value]) => ({ id: key.slice(name.length + 1), data: () => value })) }),
    }),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const pending: Array<() => void> = [];
      try {
        const result = await fn({
          get: async (ref: any) => ref.key ? ({ ref, exists: rows.has(ref.key), data: () => rows.get(ref.key) })
            : ({ docs: [...rows].filter(([key, row]) => key.startsWith(`${ref.collection}/`)
              && (ref.op === 'array-contains' ? Array.isArray(row[ref.field]) && (row[ref.field] as unknown[]).includes(ref.value)
                : row[ref.field] === ref.value)).map(([key, row]) => ({ id: key.split('/')[1], data: () => row })) }),
          update: (ref: { key: string }, value: Row) => pending.push(() => rows.set(ref.key, { ...rows.get(ref.key), ...value })),
          create: (ref: { key: string }, value: Row) => pending.push(() => rows.set(ref.key, value)),
        });
        pending.forEach(write => write());
        return result;
      } finally { release(); }
    },
  };
  return { db: db as any, rows };
}

const date = '2026-10-30';
const releaseId = 'test-release';
const counter = 'appMeta/voucherNo_taebaek_2026-10-30_general';
const seeded = () => fakeDb({ [counter]: { companyId: 'taebaek', tradeDate: date, prefix: '', last: 9 },
  'appMeta/releaseCutover': { status: 'active', releaseId: 'test-release', voucherNotBefore: { taebaek: date } } });
const cash = (id: string) => ({ kind: 'cashEntries' as const, operationId: id, tradeDate: date,
  releaseId, document: { date, amount: 100 } });
const statement = (id: string) => ({ kind: 'issuedStatements' as const, operationId: id, tradeDate: date,
  releaseId, document: { tradeDate: date, totalSupply: 100, totalTax: 0, totalAmount: 100 } });

describe('shared voucher sequence', () => {
  it('uses separate shared additional counters for each day from 9/30 to cutover', async () => {
    const { db, rows } = seeded();
    rows.set('appMeta/releaseCutover', { status: 'active', releaseId,
      voucherNotBefore: { taebaek: '2026-10-03' },
      catchUp: { companyId: 'taebaek', fromDate: '2026-09-30', status: 'open' } });
    for (const extraDate of ['2026-09-30', '2026-10-01', '2026-10-02']) {
      const key = `appMeta/voucherNo_taebaek_${extraDate}_추가`;
      rows.set(key, { companyId: 'taebaek', tradeDate: extraDate, prefix: '추가', last: 0 });
      const number = extraDate.slice(2).replaceAll('-', '');
      expect((await issueVoucher(db, 'taebaek', { ...cash(`cash-${extraDate}`), tradeDate: extraDate,
        document: { date: extraDate, amount: 100 } })).docNo).toBe(`추가${number}-001`);
      expect((await issueVoucher(db, 'taebaek', { ...statement(`statement-${extraDate}`), tradeDate: extraDate,
        document: { tradeDate: extraDate, totalSupply: 100, totalTax: 0, totalAmount: 100 } })).docNo)
        .toBe(`추가${number}-002`);
      expect(rows.get(key)?.last).toBe(2);
    }
  });
  it('routes approved catch-up cash and statements through one additional counter without touching normal numbers', async () => {
    const { db, rows } = seeded();
    const extraDate = '2026-09-30';
    const extraCash = (id: string) => ({ ...cash(id), tradeDate: extraDate, document: { date: extraDate, amount: 100 } });
    const extraStatement = (id: string) => ({ ...statement(id), tradeDate: extraDate,
      document: { tradeDate: extraDate, totalSupply: 100, totalTax: 0, totalAmount: 100 } });
    const additional = 'appMeta/voucherNo_taebaek_2026-09-30_추가';
    rows.set('appMeta/releaseCutover', { status: 'active', releaseId, voucherNotBefore: { taebaek: '2026-10-03' },
      catchUp: { companyId: 'taebaek', tradeDate: extraDate, status: 'open' } });
    rows.set(additional, { companyId: 'taebaek', tradeDate: extraDate, prefix: '추가', last: 0 });
    expect((await issueVoucher(db, 'taebaek', extraCash('extra-cash'))).docNo).toBe('추가260930-001');
    expect((await issueVoucher(db, 'taebaek', extraStatement('extra-statement'))).docNo).toBe('추가260930-002');
    expect((await issueVoucher(db, 'taebaek', extraCash('extra-cash'))).docNo).toBe('추가260930-001');
    expect(rows.get(additional)?.last).toBe(2);
    expect(rows.get(counter)?.last).toBe(9);
    await expect(issueVoucher(db, 'taebaek', { ...extraStatement('special'), prefix: '반품' })).rejects.toThrow('추가 발행');
    await expect(issueVoucher(db, 'taebaek', { ...cash('blocked-date'), tradeDate: '2026-10-01',
      document: { date: '2026-10-01', amount: 100 } })).rejects.toThrow('전환일');
    rows.delete(additional);
    await expect(issueVoucher(db, 'taebaek', extraCash('missing-extra'))).rejects.toThrow('카운터');
    expect(rows.has('cashEntries/missing-extra')).toBe(false);
    rows.set('appMeta/releaseCutover', { status: 'active', releaseId, voucherNotBefore: { taebaek: '2026-10-03' },
      catchUp: { companyId: 'taebaek', tradeDate: extraDate, status: 'closed' } });
    await expect(issueVoucher(db, 'taebaek', extraCash('closed-extra'))).rejects.toThrow('추가 발행');
    rows.set('appMeta/releaseCutover', { status: 'active', releaseId, voucherNotBefore: { taebaek: extraDate } });
    await expect(issueVoucher(db, 'taebaek', extraCash('misconfigured-normal'))).rejects.toThrow('발행 가능일');
    expect(rows.has('cashEntries/misconfigured-normal')).toBe(false);
  });
  it.each(['2026-09-30', '2026-10-01'])('rejects Taebaek normal boundary %s before any October voucher', async notBefore => {
    const { db, rows } = seeded();
    rows.set('appMeta/releaseCutover', { status: 'active', releaseId, voucherNotBefore: { taebaek: notBefore },
      catchUp: { companyId: 'taebaek', tradeDate: '2026-09-30', status: 'open' } });
    for (const tradeDate of ['2026-10-01', '2026-10-02']) {
      await expect(issueVoucher(db, 'taebaek', { ...cash(`blocked-${tradeDate}`), tradeDate,
        document: { date: tradeDate, amount: 100 } })).rejects.toThrow('발행 가능일');
      expect(rows.has(`cashEntries/blocked-${tradeDate}`)).toBe(false);
    }
  });
  it('blocks generic cash with partner settlement, loan or return meaning before any write', async () => {
    const { db, rows } = seeded();
    const blocked = [
      { accountCode: '108', partnerId: 'p1' },
      { lines: [{ accountCode: '251', amount: 100 }] },
      { lines: [{ accountCode: '253', amount: 100 }] },
      { accountCode: '260' },
      { lines: [{ accountCode: '293', amount: 100 }] },
      { loanId: 'loan-1', accountCode: '811' },
      { reverse: true, accountCode: '811' },
      { settlementId: 'settlement-1', accountCode: '811' },
    ];
    for (const [index, fields] of blocked.entries()) {
      await expect(issueVoucher(db, 'taebaek', { ...cash(`protected-${index}`),
        document: { date, amount: 100, ...fields } })).rejects.toThrow('서버 원자 명령');
      expect(rows.has(`cashEntries/protected-${index}`)).toBe(false);
    }
    expect(rows.get(counter)?.last).toBe(9);
    expect((await issueVoucher(db, 'taebaek', { ...cash('ordinary'),
      document: { date, amount: 100, accountCode: '811', partnerId: 'rent-owner' } })).docNo).toBe('261030-010');
  });
  it('requires a valid company cutover date and blocks earlier dates including duplicate retries', async () => {
    const { db, rows } = seeded();
    const gate = 'appMeta/releaseCutover';
    const active = { status: 'active', releaseId, voucherNotBefore: { taebaek: date } };
    rows.set(gate, { status: 'active', releaseId });
    await expect(issueVoucher(db, 'taebaek', cash('missing'))).rejects.toThrow('발행 가능일');
    rows.set(gate, { ...active, voucherNotBefore: { taebaek: '2026-02-30' } });
    await expect(issueVoucher(db, 'taebaek', cash('invalid'))).rejects.toThrow('발행 가능일');
    rows.set(gate, { ...active, voucherNotBefore: { taebaek: '2026-10-31' } });
    await expect(issueVoucher(db, 'taebaek', cash('early'))).rejects.toThrow('전환일');
    expect(rows.get(counter)?.last).toBe(9);
    rows.set(gate, active);
    const issued = await issueVoucher(db, 'taebaek', cash('same-day'));
    expect(issued.docNo).toBe('261030-010');
    rows.set(gate, { ...active, voucherNotBefore: { taebaek: '2026-10-31' } });
    await expect(issueVoucher(db, 'taebaek', cash('same-day'))).rejects.toThrow('전환일');
    expect(rows.get(counter)?.last).toBe(10);
  });
  it('keeps old two-digit numbers and prints three-digit new numbers', () => {
    expect(formatVoucherNo(date, 10)).toBe('261030-010');
    expect(formatVoucherNo(date, 100, '반품')).toBe('반품261030-100');
  });
  it('shares the counter across cash and statements under concurrent calls', async () => {
    const { db, rows } = seeded();
    const values = await Promise.all([issueVoucher(db, 'taebaek', cash('cash-a')), issueVoucher(db, 'taebaek', statement('stmt-b'))]);
    expect(values.map(v => v.docNo).sort()).toEqual(['261030-010', '261030-011']);
    expect(rows.get(counter)?.last).toBe(11);
  });
  it('retries a completed operation without advancing and rejects a changed payload', async () => {
    const { db, rows } = seeded();
    const first = await issueVoucher(db, 'taebaek', cash('cash-a'));
    expect(await issueVoucher(db, 'taebaek', cash('cash-a'))).toEqual(first);
    rows.set('appMeta/releaseCutover', { status: 'paused', releaseId: 'test-release' });
    await expect(issueVoucher(db, 'taebaek', cash('cash-a'))).rejects.toThrow('활성화');
    rows.set('appMeta/releaseCutover', { status: 'active', releaseId: 'test-release', voucherNotBefore: { taebaek: date } });
    expect(rows.get(counter)?.last).toBe(10);
    await expect(issueVoucher(db, 'taebaek', { ...cash('cash-a'), document: { date, amount: 200 } })).rejects.toThrow('다른 전표');
  });
  it('rejects an in-flight scheduled issue after the active release changes', async () => {
    const { db, rows } = seeded();
    rows.set('accountCodes/520', { companyId: 'taebaek', code: '520', name: '임대비' });
    const template = { id: 'rent', companyId: 'taebaek', name: '임대료', amount: 1_100,
      accountCode: '520', autoIssue: true, issueDay: 30, dir: '줄돈', partnerId: 'owner' };
    rows.set('appMeta/releaseCutover', { status: 'active', releaseId: 'next-release', voucherNotBefore: { taebaek: date } });
    await expect(issueScheduledVoucher(db, template, '2026-10', date, releaseId)).rejects.toThrow('활성화');
    expect(rows.get(counter)?.last).toBe(9);
    expect(rows.has('issuedStatements/AUTO-rent-2026-10')).toBe(false);
  });
  it('returns the same monthly operation when only issuance time changes', async () => {
    const { db, rows } = seeded();
    const first = await issueVoucher(db, 'taebaek', { ...cash('AUTO-template-2026-10'), document: { date, amount: 100, createdAt: '2026-10-30T00:00:00Z' } });
    const retry = await issueVoucher(db, 'taebaek', { ...cash('AUTO-template-2026-10'), document: { date, amount: 100, createdAt: '2026-10-30T00:00:01Z' } });
    expect(retry).toEqual(first);
    expect(rows.get(counter)?.last).toBe(10);
  });
  it('uses one number for concurrent calls of the same monthly operation', async () => {
    const { db, rows } = seeded();
    const request = cash('AUTO-template-2026-10');
    const [a, b] = await Promise.all([issueVoucher(db, 'taebaek', request), issueVoucher(db, 'taebaek', request)]);
    expect(a).toEqual(b);
    expect(rows.get(counter)?.last).toBe(10);
    expect(rows.has('cashEntries/AUTO-template-2026-10')).toBe(true);
  });
  it('shares numbers between a scheduled statement and an app cash issue', async () => {
    const { db, rows } = seeded();
    const template = { id: 'rent', companyId: 'taebaek', name: '임대료', amount: 1_100,
      accountCode: '520', autoIssue: true, issueDay: 30, dir: '줄돈', partnerId: 'owner' };
    const [scheduled, app] = await Promise.all([
      issueScheduledVoucher(db, template, '2026-10', date, releaseId),
      issueVoucher(db, 'taebaek', cash('cash-app')),
    ]);
    expect('result' in scheduled && [scheduled.result.docNo, app.docNo].sort()).toEqual(['261030-010', '261030-011']);
    expect(rows.get(counter)?.last).toBe(11);
    const retry = await issueScheduledVoucher(db, template, '2026-10', date, releaseId);
    expect('result' in retry && retry.result.docNo).toBe('result' in scheduled && scheduled.result.docNo);
    expect(rows.get(counter)?.last).toBe(11);
  });
  it.each(['app-first', 'schedule-first'])('retries one AUTO cash issue across app and scheduler with an active account: %s', async order => {
    const { db, rows } = seeded();
    rows.set('cashAccounts/bank', { companyId: 'taebaek', active: true, type: '통장' });
    const template = { id: 'rent', companyId: 'taebaek', name: '임대료', amount: 1_100,
      accountCode: '520', autoIssue: true, issueDay: 30, dir: '출금' };
    const appVoucher = buildCashVoucher(template as FixedCostTemplate, '2026-10', { cashAccountId: 'bank' });
    const appIssue = () => issueVoucher(db, 'taebaek', { kind: 'cashEntries', operationId: appVoucher.id,
      tradeDate: appVoucher.date, releaseId, document: { ...appVoucher, companyId: 'taebaek' } });
    const scheduledIssue = async () => {
      const outcome = await issueScheduledVoucher(db, template, '2026-10', date, releaseId);
      if (!('result' in outcome)) throw new Error('unexpected skip');
      return outcome.result;
    };
    const first = await (order === 'app-first' ? appIssue() : scheduledIssue());
    const retry = await (order === 'app-first' ? scheduledIssue() : appIssue());
    expect(retry).toEqual(first);
    expect(rows.get(counter)?.last).toBe(10);
    expect(rows.get(`cashEntries/${appVoucher.id}`)?.cashAccountId).toBe('bank');
  });
  it.each(['app-first', 'schedule-first'])('retries one AUTO statement across app and scheduler with an account name: %s', async order => {
    const { db, rows } = seeded();
    rows.set('accountCodes/520', { companyId: 'taebaek', code: '520', name: '임대비' });
    const template = { id: 'rent', companyId: 'taebaek', name: '임대료', amount: 1_100,
      accountCode: '520', autoIssue: true, issueDay: 30, dir: '줄돈', partnerId: 'owner', partnerName: '임대인' };
    const appVoucher = buildStatementVoucher(template as FixedCostTemplate, '2026-10', { docNo: '', accountName: '임대비' });
    const appIssue = () => issueVoucher(db, 'taebaek', { kind: 'issuedStatements', operationId: appVoucher.id,
      tradeDate: appVoucher.tradeDate, releaseId, document: { ...appVoucher, companyId: 'taebaek' } });
    const scheduledIssue = async () => {
      const outcome = await issueScheduledVoucher(db, template, '2026-10', date, releaseId);
      if (!('result' in outcome)) throw new Error('unexpected skip');
      return outcome.result;
    };
    const first = await (order === 'app-first' ? appIssue() : scheduledIssue());
    expect(await (order === 'app-first' ? scheduledIssue() : appIssue())).toEqual(first);
    expect(rows.get(counter)?.last).toBe(10);
  });
  it('rejects changed template content and cash/statement reuse of one monthly ID', async () => {
    const { db, rows } = seeded();
    rows.set('accountCodes/520', { companyId: 'taebaek', code: '520', name: '임대비' });
    const template = { id: 'rent', companyId: 'taebaek', name: '임대료', amount: 1_100,
      accountCode: '520', autoIssue: true, issueDay: 30, dir: '줄돈', partnerId: 'owner' };
    await issueScheduledVoucher(db, template, '2026-10', date, releaseId);
    await expect(issueScheduledVoucher(db, { ...template, amount: 2_200 }, '2026-10', date, releaseId)).rejects.toThrow('다른 전표');
    await expect(issueScheduledVoucher(db, { ...template, dir: '출금' }, '2026-10', date, releaseId)).rejects.toThrow('다른 종류');
    expect(rows.get(counter)?.last).toBe(10);
  });
  it('refuses to overwrite a legacy document with the same monthly ID', async () => {
    const { db, rows } = seeded();
    rows.set('cashEntries/AUTO-template-2026-10', { companyId: 'taebaek', date, amount: 100, docNo: '261030-009' });
    await expect(issueVoucher(db, 'taebaek', cash('AUTO-template-2026-10'))).rejects.toThrow('다른 전표');
    expect(rows.get(counter)?.last).toBe(9);
  });
  it('does not consume a number when creating the voucher fails', async () => {
    const { db, rows } = seeded();
    db.runTransaction = async (fn: any) => {
      const writes: unknown[] = [];
      return fn({
        get: async (ref: { key?: string }) => ref.key
          ? ({ exists: rows.has(ref.key), data: () => rows.get(ref.key!) }) : ({ docs: [] }),
        update: (...args: unknown[]) => writes.push(args),
        create: () => { throw new Error('write failed'); },
      });
    };
    await expect(issueVoucher(db, 'taebaek', cash('cash-a'))).rejects.toThrow('write failed');
    expect(rows.get(counter)?.last).toBe(9);
  });
  it('fails closed for absent or damaged counters and other companies', async () => {
    const { db, rows } = seeded();
    await expect(issueVoucher(db, 'punghoe', cash('cash-a'))).rejects.toThrow('준비되지');
    await expect(issueVoucher(db, 'taebaek', { ...cash('cash-a'), document: { date, amount: 100, companyId: 'punghoe' } })).rejects.toThrow('다른 회사');
    rows.set(counter, { companyId: 'taebaek', tradeDate: date, prefix: '', last: '9' });
    await expect(issueVoucher(db, 'taebaek', cash('cash-a'))).rejects.toThrow('손상');
  });
  it('keeps company and prefix counters separate', async () => {
    const { db, rows } = seeded();
    rows.set('appMeta/releaseCutover', { status: 'active', releaseId, voucherNotBefore: { taebaek: date, punghoe: date } });
    rows.set('appMeta/voucherNo_punghoe_2026-10-30_general', { companyId: 'punghoe', tradeDate: date, prefix: '', last: 3 });
    rows.set('appMeta/voucherNo_taebaek_2026-10-30_반품', { companyId: 'taebaek', tradeDate: date, prefix: '반품', last: 1 });
    expect((await issueVoucher(db, 'taebaek', cash('cash-a'))).docNo).toBe('261030-010');
    expect((await issueVoucher(db, 'punghoe', cash('cash-b'))).docNo).toBe('261030-004');
    expect((await issueVoucher(db, 'taebaek', { ...statement('stmt-c'), prefix: '반품' })).docNo).toBe('반품261030-002');
  });
  it('retries a monthly payroll accrual in its own prefix pool', async () => {
    const { db, rows } = seeded();
    rows.set('appMeta/voucherNo_taebaek_2026-10-30_급여', { companyId: 'taebaek', tradeDate: date, prefix: '급여', last: 4 });
    const operationId = 'stmt-payroll-2026-10-taebaek';
    const payroll = (issuedAt: string) => ({ ...statement(operationId), prefix: '급여', document: {
      tradeDate: date, totalSupply: 100, totalTax: 0, totalAmount: 100,
      issuedAt, items: [{ name: '급여', total: 100, accountCode: '515', side: '차변' },
        { name: '미지급', total: 100, accountCode: '263', side: '대변' }],
    } });
    const first = await issueVoucher(db, 'taebaek', payroll('2026-10-30T00:00:00Z'));
    expect(first.docNo).toBe('급여261030-005');
    expect(await issueVoucher(db, 'taebaek', payroll('2026-10-30T00:01:00Z'))).toEqual(first);
    expect(rows.get('appMeta/voucherNo_taebaek_2026-10-30_급여')?.last).toBe(5);
    expect(rows.get(counter)?.last).toBe(9);
  });
  it('rejects zero, negative and invalid cash amounts before a write', async () => {
    const { db, rows } = seeded();
    for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(issueVoucher(db, 'taebaek', { ...cash('cash-a'), document: { date, amount } })).rejects.toThrow('0보다 큰');
    }
    expect(rows.get(counter)?.last).toBe(9);
    expect(rows.has('cashEntries/cash-a')).toBe(false);
  });
  it('rejects unbalanced statement totals but accepts a negative return', async () => {
    const { db, rows } = seeded();
    await expect(issueVoucher(db, 'taebaek', { ...statement('stmt-a'), document: {
      tradeDate: date, totalSupply: 100, totalTax: 10, totalAmount: 100,
    } })).rejects.toThrow('일치하지');
    expect(rows.get(counter)?.last).toBe(9);
    rows.set('appMeta/voucherNo_taebaek_2026-10-30_반품', { companyId: 'taebaek', tradeDate: date, prefix: '반품', last: 0 });
    const result = await issueVoucher(db, 'taebaek', { ...statement('stmt-return'), prefix: '반품', document: {
      tradeDate: date, totalSupply: -100, totalTax: -10, totalAmount: -110,
    } });
    expect(result.docNo).toBe('반품261030-001');
  });
});
