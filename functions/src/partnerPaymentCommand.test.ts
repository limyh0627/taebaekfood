import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } },
  onCall: (_options: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-admin', () => ({ firestore: () => ({}) }));

import { cashFromEntry, claimFromStatement, recordPartnerPayment } from './partnerPaymentCommand';

type Row = Record<string, any>;
type Ref = { key: string };
type Query = { collection: string; field?: string; value?: unknown };
function fakeDb(initial: Record<string, Row>) {
  const rows = new Map(Object.entries(initial));
  const ref = (key: string): Ref => ({ key });
  const db = {
    collection: (collection: string) => ({
      collection,
      doc: (id: string) => ref(`${collection}/${id}`),
      where: (field: string, _op: string, value: unknown): Query => ({ collection, field, value }),
    }),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => {
      const pending: (() => void)[] = [];
      const result = await fn({
        get: async (target: Ref | Query) => 'key' in target
          ? { ref: target, exists: rows.has(target.key), data: () => rows.get(target.key) }
          : { docs: [...rows.entries()].filter(([key, value]) => key.startsWith(`${target.collection}/`)
            && (target.field ? value[target.field] === target.value : true))
            .map(([key, value]) => ({ id: key.slice(target.collection.length + 1), data: () => value })) },
        update: (target: Ref, value: Row) => pending.push(() => rows.set(target.key, { ...rows.get(target.key), ...value })),
        create: (target: Ref, value: Row) => pending.push(() => {
          if (rows.has(target.key)) throw new Error('already exists');
          rows.set(target.key, value);
        }),
      });
      pending.forEach(write => write());
      return result;
    },
  };
  return { db: db as any, rows };
}

const date = '2026-10-03';
const counter = `appMeta/voucherNo_taebaek_${date}_general`;
const source = {
  'appMeta/releaseCutover': { releaseId: 'test-release', status: 'active', voucherNotBefore: { taebaek: '2026-10-03' } },
  'appMeta/partnerPaymentCutover_taebaek': { companyId: 'taebaek', enabled: true, legacyWritersBlocked: true, auditPassed: true },
  'cashAccounts/bank': { companyId: 'taebaek', active: true, type: '통장' },
  'partners/p1': { companyId: 'taebaek', name: '거래처' },
  'issuedStatements/s1': { companyId: 'taebaek', partnerId: 'p1', type: '매출', tradeDate: date, totalAmount: 100,
    items: [{ accountCode: '800', supply: 100, tax: 0, total: 100 }] },
  [counter]: { companyId: 'taebaek', tradeDate: date, prefix: '', last: 9 },
};
const input = { operationId: 'pay-1', tradeDate: date, partnerId: 'p1', direction: '입금' as const,
  amount: 100, cashAccountId: 'bank', pin: true, allocations: [{ statementId: 's1', amount: 100 }],
  expectedRevision: 0, releaseId: 'test-release' };

function auditOnly(rows: Map<string, Row>, initial: Record<string, Row>, request: typeof input, message: string) {
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  const requestHash = createHash('sha256').update(JSON.stringify(canonical({ ...request, note: '' }))).digest('hex');
  const operationKey = `partnerPaymentOperations/${request.operationId}`;
  expect([...rows.keys()].sort()).toEqual([...Object.keys(initial), operationKey].sort());
  for (const [key, original] of Object.entries(initial)) expect(rows.get(key)).toEqual(original);
  expect(rows.get(operationKey)).toMatchObject({ companyId: 'taebaek', partnerId: request.partnerId, requestHash,
    status: 'rejected', failureCode: 'failed-precondition', failureMessage: expect.stringContaining(message), createdBy: 'admin' });
  expect(rows.get(operationKey)?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(rows.has(`cashEntries/${request.operationId}`)).toBe(false);
  expect(rows.has(`issuedStatements/${request.operationId}`)).toBe(false);
  expect([...rows.keys()].some(key => key.startsWith(`settlements/st-${request.operationId}-`))).toBe(false);
  expect(rows.has(`appMeta/partnerPaymentState_taebaek_${request.partnerId}`)).toBe(false);
}
describe('partner payment transaction', () => {
  it('uses the same catch-up number pool and rejects a missing additional counter', async () => {
    const extraDate = '2026-09-30';
    const extraInput = { ...input, tradeDate: extraDate };
    const additional = 'appMeta/voucherNo_taebaek_2026-09-30_추가';
    const catchUp = { ...source,
      'appMeta/releaseCutover': { releaseId: 'test-release', status: 'active', voucherNotBefore: { taebaek: '2026-10-03' },
        catchUp: { companyId: 'taebaek', tradeDate: extraDate, status: 'open' } },
      [additional]: { companyId: 'taebaek', tradeDate: extraDate, prefix: '추가', last: 2 } };
    const { db, rows } = fakeDb(catchUp);
    expect((await recordPartnerPayment(db, 'taebaek', 'admin', extraInput)).docNo).toBe('추가260930-003');
    expect((await recordPartnerPayment(db, 'taebaek', 'admin', extraInput)).docNo).toBe('추가260930-003');
    expect(rows.get(additional)?.last).toBe(3);
    expect(rows.get(counter)?.last).toBe(9);
    const { [additional]: _missing, ...noAdditional } = catchUp;
    const missing = fakeDb(noAdditional);
    await expect(recordPartnerPayment(missing.db, 'taebaek', 'admin', extraInput)).rejects.toThrow('카운터');
    auditOnly(missing.rows, noAdditional, extraInput, '카운터');
  });
  it('issues a 10/02 payment only in the explicit payment catch-up window', async () => {
    const extraDate = '2026-10-02';
    const additional = 'appMeta/voucherNo_taebaek_2026-10-02_추가';
    const fixture = { ...source,
      'appMeta/releaseCutover': { releaseId: 'test-release', status: 'active', voucherNotBefore: { taebaek: date },
        catchUp: { companyId: 'taebaek', fromDate: '2026-09-30', status: 'open' } },
      [additional]: { companyId: 'taebaek', tradeDate: extraDate, prefix: '추가', last: 0 } };
    const { db, rows } = fakeDb(fixture);
    expect((await recordPartnerPayment(db, 'taebaek', 'admin', { ...input, tradeDate: extraDate })).docNo)
      .toBe('추가261002-001');
    expect(rows.get(additional)?.last).toBe(1);
    const closed = fakeDb({ ...fixture, 'appMeta/releaseCutover': { ...fixture['appMeta/releaseCutover'],
      catchUp: { ...fixture['appMeta/releaseCutover'].catchUp, status: 'closed' } } });
    await expect(recordPartnerPayment(closed.db, 'taebaek', 'admin', { ...input, tradeDate: extraDate }))
      .rejects.toThrow('전환일');
  });
  it('rejects with audit only before financial writes without cutover or counter', async () => {
    const { ['appMeta/partnerPaymentCutover_taebaek']: _cutover, ...withoutCutover } = source;
    const first = fakeDb(withoutCutover);
    await expect(recordPartnerPayment(first.db, 'taebaek', 'admin', input)).rejects.toThrow('전환');
    auditOnly(first.rows, withoutCutover, input, '전환');
    const { [counter]: _counter, ...withoutCounter } = source;
    const second = fakeDb(withoutCounter);
    await expect(recordPartnerPayment(second.db, 'taebaek', 'admin', input)).rejects.toThrow('카운터');
    auditOnly(second.rows, withoutCounter, input, '카운터');
  });

  it('commits number, cash, settlement, operation and revision together, then reuses the result', async () => {
    const { db, rows } = fakeDb(source);
    const result = await recordPartnerPayment(db, 'taebaek', 'admin', input);
    expect(result).toEqual({ status: 'applied', id: 'pay-1', docNo: '261003-010' });
    expect(rows.get(counter)?.last).toBe(10);
    expect(rows.get('cashEntries/pay-1')).toMatchObject({ amount: 100, docNo: '261003-010', lines: [{ accountCode: '108', amount: 100 }] });
    expect(rows.get('settlements/st-pay-1-s1')).toMatchObject({ companyId: 'taebaek', operationId: 'pay-1', amount: 100 });
    expect(rows.get('appMeta/partnerPaymentState_taebaek_p1')?.revision).toBe(1);
    expect(await recordPartnerPayment(db, 'taebaek', 'admin', input)).toEqual({ status: 'duplicate', id: 'pay-1', docNo: '261003-010' });
    expect(rows.get(counter)?.last).toBe(10);
    await expect(recordPartnerPayment(db, 'taebaek', 'admin', { ...input, amount: 90, allocations: [{ statementId: 's1', amount: 90 }] })).rejects.toThrow('다릅니다');
    rows.set('cashEntries/pay-1', { ...rows.get('cashEntries/pay-1'), amount: 101 });
    await expect(recordPartnerPayment(db, 'taebaek', 'admin', input)).rejects.toThrow('다릅니다');
  });

  it('rejects stale revision and cross-company account without writing', async () => {
    const stale = fakeDb({ ...source, 'appMeta/partnerPaymentState_taebaek_p1': { revision: 1 } });
    await expect(recordPartnerPayment(stale.db, 'taebaek', 'admin', input)).rejects.toThrow('변경');
    expect(stale.rows.get(counter)?.last).toBe(9);
    const other = fakeDb({ ...source, 'cashAccounts/bank': { companyId: 'punghoe', active: true } });
    await expect(recordPartnerPayment(other.db, 'taebaek', 'admin', input)).rejects.toThrow('계좌');
    expect(other.rows.get(counter)?.last).toBe(9);
  });

  it('ignores malformed other-company rows with the same partner ID before projecting journals', async () => {
    const { db, rows } = fakeDb({ ...source,
      'issuedStatements/foreign': { companyId: 'punghoe', partnerId: 'p1', type: '매출', items: [{}] },
      'cashEntries/foreign': { companyId: 'punghoe', partnerId: 'p1', amount: -1 },
      'returnApplications/foreign': { companyId: 'punghoe', partnerId: 'p1', statementId: 'missing', amount: -1 },
    });
    expect((await recordPartnerPayment(db, 'taebaek', 'admin', input)).status).toBe('applied');
    expect(rows.get(counter)?.last).toBe(10);
  });

  it('normalizes only supported original claims and cash reduction', () => {
    expect(claimFromStatement('s1', source['issuedStatements/s1'])).toMatchObject({ accountCode: '108', amount: 100 });
    expect(claimFromStatement('opening', { partnerId: 'p1', type: '비용', tradeDate: date, totalAmount: 100,
      items: [{ accountCode: '108', side: '차변', total: 100 }, { accountCode: '375', side: '대변', total: 100 }] }))
      .toMatchObject({ accountCode: '108', amount: 100 });
    expect(() => claimFromStatement('fake', { partnerId: 'p1', type: '매출', tradeDate: date, totalAmount: 100,
      items: [{}] })).toThrow('원분개');
    expect(() => claimFromStatement('unbalanced', { partnerId: 'p1', type: '매출', tradeDate: date, totalAmount: 100,
      items: [{ accountCode: '800', supply: 90, tax: 0, total: 90 }] })).toThrow('차변·대변');
    expect(cashFromEntry('c1', { partnerId: 'p1', companyId: 'taebaek', dir: '출금', amount: 100, accountCode: '251' })?.parts)
      .toEqual([{ accountCode: '251', reduce: 100 }]);
  });
});
