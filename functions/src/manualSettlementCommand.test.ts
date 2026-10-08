import { describe, expect, it, vi } from 'vitest';
vi.mock('firebase-functions/v2/https', () => ({ HttpsError: class extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message); }
}, onCall: (_options: unknown, handler: unknown) => handler }));
vi.mock('firebase-admin', () => ({ firestore: () => ({}) }));
import { mutateManualSettlement } from './manualSettlementCommand';
import { issueVoucher } from './voucherIssue';

type Row = Record<string, any>;
function fixture() {
  const rows = new Map<string, Row>(Object.entries({
    'appMeta/releaseCutover': { status: 'active', releaseId: 'rel', voucherNotBefore: { taebaek: '2026-10-03' } },
    'appMeta/partnerPaymentCutover_taebaek': { companyId: 'taebaek', enabled: true, legacyWritersBlocked: true, auditPassed: true },
    'partners/p': { companyId: 'taebaek', name: '합성 거래처' },
    'issuedStatements/s': { companyId: 'taebaek', partnerId: 'p', type: '매출', tradeDate: '2026-10-07',
      totalAmount: 100, totalSupply: 100, totalTax: 0, items: [{ accountCode: '800', supply: 100, tax: 0, total: 100 }] },
    'cashEntries/c': { companyId: 'taebaek', partnerId: 'p', date: '2026-10-07', dir: '입금', amount: 100,
      accountCode: '108', issueOperationId: 'c', issuePayloadHash: 'historical-hash', docNo: '261007-001' },
    'appMeta/voucherNo_taebaek_2026-10-07_general': { companyId: 'taebaek', tradeDate: '2026-10-07', prefix: '', last: 1 },
  }));
  let readFailure = false, commitFailure = false;
  const collection = (name: string, filters: [string, unknown][] = []): any => ({ name, filters,
    doc: (id: string) => ({ path: `${name}/${id}`, id }),
    where: (field: string, _op: string, value: unknown) => collection(name, [...filters, [field, value]]) });
  const snap = (path: string) => ({ id: path.split('/').at(-1), exists: rows.has(path), data: () => rows.get(path), ref: { path } });
  const db: any = { collection, runTransaction: async (run: (tx: any) => Promise<unknown>) => {
    const writes: (() => void)[] = [];
    const result = await run({ get: async (ref: any) => {
      if (readFailure) throw new Error('read failure');
      return ref.path ? snap(ref.path) : { docs: [...rows.keys()].filter(path => path.startsWith(`${ref.name}/`)
        && ref.filters.every(([field, value]: [string, unknown]) => rows.get(path)![field] === value)).map(snap) };
    }, create: (ref: any, row: Row) => writes.push(() => rows.set(ref.path, row)),
    update: (ref: any, row: Row) => writes.push(() => rows.set(ref.path, { ...rows.get(ref.path), ...row })),
    delete: (ref: any) => writes.push(() => rows.delete(ref.path)) });
    if (commitFailure) throw new Error('commit failure');
    writes.forEach(write => write()); return result;
  } };
  const run = (operationId: string, extra: Row = {}) => mutateManualSettlement(db, 'taebaek', 'actor', {
    operationId, action: 'add', partnerId: 'p', cashEntryId: 'c', statementId: 's', amount: 80,
    expectedRevision: 0, releaseId: 'rel', ...extra } as Parameters<typeof mutateManualSettlement>[3]);
  return { rows, db, run, readFail: () => { readFailure = true; }, commitFail: () => { commitFailure = true; } };
}

describe('일반 발행 자금의 수동 연결', () => {
  it('기존 generic 소유 자금의 수동 행만 추가·수정·삭제하고 원전표·번호·자금 본문을 보존한다', async () => {
    const f = fixture(); const originals = structuredClone(Object.fromEntries(f.rows));
    const replay = () => issueVoucher(f.db, 'taebaek', { kind: 'cashEntries', operationId: 'c', tradeDate: '2026-10-07',
      releaseId: 'rel', document: { date: '2026-10-07', dir: '입금', amount: 100, partnerId: 'p', accountCode: '108' } });
    // 현재 issuer의 보호계정 정책은 과거 generic 문서에도 동일하게 거절한다. 임의로 정책을 풀지 않는다.
    await expect(replay()).rejects.toThrow('원자 명령');
    expect(await f.run('add')).toMatchObject({ status: 'applied', revision: 1 });
    expect(await f.run('add')).toMatchObject({ status: 'duplicate', revision: 1 });
    expect(await f.run('update', { action: 'update', settlementId: 'manual-add', expectedAmount: 80, amount: 60, expectedRevision: 1 })).toMatchObject({ revision: 2 });
    expect(await f.run('delete', { action: 'delete', settlementId: 'manual-add', amount: 60, expectedRevision: 2 })).toMatchObject({ revision: 3 });
    for (const path of ['cashEntries/c', 'issuedStatements/s', 'appMeta/voucherNo_taebaek_2026-10-07_general']) expect(f.rows.get(path)).toEqual(originals[path]);
    expect(f.rows.has('settlements/manual-add')).toBe(false);
    await expect(replay()).rejects.toThrow('원자 명령');
  });
  it.each(['operationId', 'returnOperationId', 'transferOperationId', 'issueOperationId', 'serverOwned'])('명령 소유 정산 %s는 변경하지 않는다', async field => {
    const f = fixture(); const row = { companyId: 'taebaek', cashEntryId: 'c', statementId: 's', amount: 80, [field]: field === 'serverOwned' ? true : 'owned' };
    f.rows.set('settlements/owned', row);
    await expect(f.run('edit', { action: 'update', settlementId: 'owned', expectedAmount: 80, amount: 60 })).rejects.toThrow('명령 소유');
    expect(f.rows.get('settlements/owned')).toEqual(row);
    expect(f.rows.get('manualSettlementOperations/edit')?.status).toBe('rejected');
  });
  it('확정 거절은 감사만 남기고 같은 ID를 봉쇄하며 새 시도는 수정한 입력을 적용한다', async () => {
    const f = fixture(); const before = structuredClone(Object.fromEntries(f.rows));
    await expect(f.run('bad', { amount: 101 })).rejects.toMatchObject({ details: { manualSettlementFailure: { operationRejected: true, financialWrites: false } } });
    expect(f.rows.get('manualSettlementOperations/bad')).toMatchObject({ companyId: 'taebaek', partnerId: 'p', status: 'rejected', settlementId: 'manual-bad' });
    for (const [path, value] of Object.entries(before)) expect(f.rows.get(path)).toEqual(value);
    expect([...f.rows.keys()].filter(path => path.startsWith('settlements/'))).toEqual([]);
    await expect(f.run('bad', { amount: 101 })).rejects.toMatchObject({ details: { manualSettlementFailure: { operationRejected: true } } });
    expect(await f.run('new', { amount: 100 })).toMatchObject({ status: 'applied', revision: 1 });
  });
  it('일반 출금의 251·253 분할은 각 원전표 계정 한도 내에서 수동 연결한다', async () => {
    const f = fixture();
    f.rows.set('issuedStatements/s', { companyId: 'taebaek', partnerId: 'p', type: '매입', tradeDate: '2026-10-07', totalAmount: 60, totalSupply: 60, totalTax: 0, items: [{ accountCode: '500', supply: 60, tax: 0, total: 60 }] });
    f.rows.set('issuedStatements/s2', { companyId: 'taebaek', partnerId: 'p', type: '매입', tradeDate: '2026-10-07', totalAmount: 40, totalSupply: 40, totalTax: 0, items: [{ accountCode: '520', supply: 40, tax: 0, total: 40 }] });
    Object.assign(f.rows.get('cashEntries/c')!, { dir: '출금', lines: [{ accountCode: '251', amount: 60 }, { accountCode: '253', amount: 40 }] });
    expect(await f.run('trade', { amount: 60 })).toMatchObject({ status: 'applied' });
    expect(await f.run('expense', { statementId: 's2', amount: 40, expectedRevision: 1 })).toMatchObject({ status: 'applied' });
    expect(f.rows.get('settlements/manual-trade')?.amount).toBe(60);
    expect(f.rows.get('settlements/manual-expense')?.amount).toBe(40);
  });
  it('side 혼합의 같은 계정 순액으로만 배분하고 현금 순액 초과는 거절한다', async () => {
    const f = fixture();
    f.rows.get('cashEntries/c')!.lines = [{ accountCode: '108', amount: 120, side: '대변' }, { accountCode: '108', amount: -20, side: '차변' }];
    const cash = structuredClone(f.rows.get('cashEntries/c'));
    expect(await f.run('mixed', { amount: 100 })).toMatchObject({ status: 'applied' });
    expect(f.rows.get('cashEntries/c')).toEqual(cash);
    const g = fixture();
    g.rows.get('cashEntries/c')!.lines = [{ accountCode: '108', amount: 120, side: '대변' }, { accountCode: '520', amount: 20, side: '차변' }];
    await expect(g.run('over', { amount: 100 })).rejects.toThrow('방향');
    expect([...g.rows.keys()].some(path => path.startsWith('settlements/'))).toBe(false);
    expect(g.rows.get('manualSettlementOperations/over')?.status).toBe('rejected');
  });
  it('거절 감사의 actor·operation·action이 다르면 안전한 거절 detail을 재사용하지 않는다', async () => {
    for (const field of ['createdBy', 'operationId', 'action']) {
      const f = fixture();
      await expect(f.run('bad', { amount: 101 })).rejects.toMatchObject({ details: { manualSettlementFailure: { operationRejected: true } } });
      f.rows.get('manualSettlementOperations/bad')![field] = 'other';
      const before = structuredClone(Object.fromEntries(f.rows));
      await expect(f.run('bad', { amount: 101 })).rejects.toMatchObject({ details: undefined });
      expect(Object.fromEntries(f.rows)).toEqual(before);
    }
  });
  it('다른 회사·st- 행·방향·revision 거절은 금융문서를 바꾸지 않는다', async () => {
    for (const kind of ['company', 'st', 'direction', 'revision']) {
      const f = fixture();
      if (kind === 'company') f.rows.get('cashEntries/c')!.companyId = 'punghoe';
      if (kind === 'direction') f.rows.get('cashEntries/c')!.dir = '출금';
      if (kind === 'st') f.rows.set('settlements/st-owned', { companyId: 'taebaek', cashEntryId: 'c', statementId: 's', amount: 80 });
      const before = structuredClone(Object.fromEntries(f.rows));
      await expect(f.run(kind, kind === 'st' ? { action: 'delete', settlementId: 'st-owned' } : kind === 'revision' ? { expectedRevision: 1 } : {})).rejects.toThrow();
      for (const [path, value] of Object.entries(before)) expect(f.rows.get(path)).toEqual(value);
      expect(f.rows.get(`manualSettlementOperations/${kind}`)?.status).toBe('rejected');
    }
  });
  it('native 읽기 및 commit 실패는 terminal detail·감사·금융 쓰기를 만들지 않는다', async () => {
    for (const where of ['read', 'commit']) {
      const f = fixture(); const before = structuredClone(Object.fromEntries(f.rows));
      if (where === 'read') f.readFail(); else f.commitFail();
      await expect(f.run('unknown')).rejects.toMatchObject({ message: `${where} failure` });
      expect(Object.fromEntries(f.rows)).toEqual(before);
    }
  });
});
