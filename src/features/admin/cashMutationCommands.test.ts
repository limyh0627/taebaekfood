/** @vitest-environment jsdom */
import { createHash, webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ call: vi.fn(), get: vi.fn(), claims: { companyId: 'taebaek', isAdmin: true }, user: null as any }));
vi.mock('../../shared/firebase', () => ({ auth: { get currentUser() { return m.user; } }, authReady: Promise.resolve(), db: {}, functions: {} }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, collection: string, id: string) => ({ collection, id }), getDoc: m.get }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => m.call }));
import { mutateCash, loadPayrollCashEdit, prepareTransferCash, matchCashAllocations, resumeCashMutation } from './cashMutationCommands';
import type { CashEntry } from '../../shared/types';
const original = { id: 'cash', companyId: 'taebaek', date: '2026-10-03', dir: '출금', amount: 100, accountCode: '802', docNo: '261003-001' } as CashEntry;
beforeEach(() => {
  localStorage.clear(); vi.stubGlobal('crypto', webcrypto); m.call.mockReset(); m.get.mockReset();
  m.claims = { companyId: 'taebaek', isAdmin: true };
  m.user = { uid: 'uid', getIdTokenResult: async () => ({ claims: m.claims }) };
  m.get.mockResolvedValue({ data: () => ({ status: 'active', releaseId: 'release' }) });
  m.call.mockImplementation(async (command: any) => ({ data: { status: 'applied', id: command.cashEntryId, action: command.action, revision: command.expectedRevision + 1, docNo: original.docNo } }));
});
describe('cash mutation captured UI intent', () => {
  const stable = (value: any): any => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])])) : value;
  const rejected = (command: any, override: Record<string, unknown> = {}) => Object.assign(new Error('계좌 거절'), {
    details: { cashAccountAssignmentRejected: { version: 1, terminalConfirmed: true, status: 'rejected', financialWrites: false, companyId: 'taebaek', actorId: 'uid',
      operationId: command.operationId, cashEntryId: command.cashEntryId, command,
      requestHash: createHash('sha256').update(JSON.stringify(stable({ companyId: 'taebaek', actorId: 'uid', ...command }))).digest('hex'), ...override } },
  });
  it('unlocks an exact durable bank rejection and sends a changed choice with a new operation', async () => {
    m.call.mockImplementationOnce(async command => { throw rejected(command); });
    await expect(mutateCash('taebaek', original, 'edit', { cashAccountId: 'bad-bank' })).rejects.toThrow('계좌 거절');
    expect(localStorage.length).toBe(0);
    const first = m.call.mock.calls[0][0];
    await mutateCash('taebaek', original, 'edit', { cashAccountId: 'good-bank' });
    expect(m.call.mock.calls[1][0].operationId).not.toBe(first.operationId);
  });
  it('does not overwrite another tab pending while the initial release read is delayed', async () => {
    let release!: (value: any) => void;
    m.get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const work = mutateCash('taebaek', original, 'edit', { cashAccountId: 'bank' });
    const rejectedWork = expect(work).rejects.toThrow('다른 계좌 지정');
    await vi.waitFor(() => expect(m.get).toHaveBeenCalledOnce());
    localStorage.setItem('cash-mutation-pending:taebaek:cash:uid', 'other-tab');
    release({ data: () => ({ status: 'active', releaseId: 'release' }) });
    await rejectedWork;
    expect(m.call).not.toHaveBeenCalled();
    expect(localStorage.getItem('cash-mutation-pending:taebaek:cash:uid')).toBe('other-tab');
  });
  it('does not send or clear old metadata after another tab replaces pending during the auth await', async () => {
    let release!: (value: any) => void, checks = 0;
    m.user.getIdTokenResult = () => ++checks === 2 ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ claims: m.claims });
    const work = mutateCash('taebaek', original, 'edit', { cashAccountId: 'bank' });
    const rejectedWork = expect(work).rejects.toThrow('다른 계좌 지정');
    await vi.waitFor(() => expect(checks).toBe(2));
    localStorage.setItem('cash-mutation-pending:taebaek:cash:uid', 'other-tab');
    release({ claims: m.claims });
    await rejectedWork;
    expect(m.call).not.toHaveBeenCalled();
    expect(localStorage.getItem('cash-mutation-pending:taebaek:cash:uid')).toBe('other-tab');
  });
  it('resumes the exact unknown bank request and clears only its immutable rejected proof', async () => {
    m.call.mockRejectedValueOnce(new Error('lost response'));
    await expect(mutateCash('taebaek', original, 'edit', { cashAccountId: 'bank' })).rejects.toThrow();
    const first = m.call.mock.calls[0][0];
    m.call.mockImplementationOnce(async command => { throw rejected(command); });
    await expect(resumeCashMutation('taebaek', original.id)).rejects.toThrow('계좌 거절');
    expect(m.call.mock.calls[1][0]).toEqual(first); expect(localStorage.length).toBe(0);
  });
  it.each([{ terminalConfirmed: false }, { requestHash: '0'.repeat(64) }, { actorId: 'other' }, { command: {} }])('preserves bank pending for unmatched rejection %j', async override => {
    m.call.mockImplementationOnce(async command => { throw rejected(command, override); });
    await expect(mutateCash('taebaek', original, 'edit', { cashAccountId: 'bank' })).rejects.toThrow();
    expect(localStorage.getItem('cash-mutation-pending:taebaek:cash:uid')).not.toBeNull();
  });
  it('preserves exact bank pending after actor switch and preserves a replacement request during rejection CAS', async () => {
    m.call.mockImplementationOnce(async command => { m.user = { ...m.user, uid: 'other' }; throw rejected(command); });
    await expect(mutateCash('taebaek', original, 'edit', { cashAccountId: 'bank' })).rejects.toThrow('권한');
    expect(localStorage.getItem('cash-mutation-pending:taebaek:cash:uid')).not.toBeNull();
    m.user = { ...m.user, uid: 'uid' };
    m.call.mockImplementationOnce(async command => { localStorage.setItem('cash-mutation-pending:taebaek:cash:uid', 'replacement'); throw rejected(command); });
    await expect(resumeCashMutation('taebaek', original.id)).rejects.toThrow('계좌 거절');
    expect(localStorage.getItem('cash-mutation-pending:taebaek:cash:uid')).toBe('replacement');
  });
  it('confirms the original uncertain request after reopening without approving a newer cash revision', async () => {
    m.call.mockRejectedValueOnce(new Error('response lost'));
    await expect(mutateCash('taebaek', original, 'edit', { amount: 120 })).rejects.toThrow();
    const command = m.call.mock.calls[0][0];
    m.get.mockRejectedValue(new Error('new source must not replace the stored request'));
    await resumeCashMutation('taebaek', original.id);
    expect(m.call.mock.calls[1][0]).toEqual(command);
    expect(m.call.mock.calls[1][0].expectedRevision).toBe(0);
    expect(localStorage.length).toBe(0);
  });
  it('retries the same separately approved matching batch without re-reading its revision', async () => {
    m.get.mockImplementation(async (ref: any) => ({ data: () => ref.id === 'releaseCutover'
      ? { status: 'active', releaseId: 'release' } : { companyId: 'taebaek', partnerId: 'partner', revision: 3 } }));
    m.call.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ data: { status: 'duplicate', revision: 4 } });
    const cash = { ...original, partnerId: 'partner' };
    const allocations = [{ statementId: 'statement', amount: 100 }];
    await expect(matchCashAllocations('taebaek', cash, allocations)).rejects.toThrow('timeout');
    const first = m.call.mock.calls[0][0];
    m.get.mockRejectedValue(new Error('must not replace original revision'));
    await matchCashAllocations('taebaek', cash, allocations);
    expect(m.call.mock.calls[1][0]).toEqual(first);
    expect(first).toMatchObject({ expectedPartnerRevision: 3, allocations, releaseId: 'release' });
    expect(localStorage.length).toBe(0);
  });
  it('reads the linked payroll once and preserves its draft revision and employee lines', async () => {
    const row = { companyId: 'taebaek', cashEntryId: original.id, issueKind: 'cashEntries', revision: 7,
      yearMonth: '2026-10', payDate: '2026-10-25', lines: [{ employeeId: 'employee', employeeName: '합성 사원', base: 100 }] };
    m.get.mockResolvedValue({ data: () => row });
    const source = { ...original, payrollId: 'pay-2026-10' } as CashEntry;
    expect(await loadPayrollCashEdit('taebaek', source)).toEqual({ yearMonth: row.yearMonth, payDate: row.payDate, lines: row.lines, expectedRevision: 7 });
    m.get.mockResolvedValue({ data: () => ({ ...row, companyId: 'punghoe' }) });
    await expect(loadPayrollCashEdit('taebaek', source)).rejects.toThrow('연결');
    expect(m.call).not.toHaveBeenCalled();
  });
  it('rejects a company change while the server prepares the other-company original', async () => {
    m.call.mockImplementation(async () => {
      m.claims.companyId = 'punghoe';
      return { data: { counterpart: { ...original, id: 'other', companyId: 'punghoe' }, expectedRevision: 2, expectedCashHash: 'a'.repeat(64) } };
    });
    await expect(prepareTransferCash('taebaek', original)).rejects.toThrow('권한');
    expect(localStorage.length).toBe(0);
  });
  it('sends the complete patch and original revision without fetching fresh cash', async () => {
    const patch = { amount: 120, date: '2026-10-04', lines: [], accountCode: '802', partnerId: '', note: '수정' };
    await mutateCash('taebaek', original, 'edit', patch);
    expect(m.call.mock.calls[0][0]).toMatchObject({ cashEntryId: 'cash', expectedRevision: 0, action: 'edit', patch, releaseId: 'release' });
    expect(m.get.mock.calls).toHaveLength(1); expect(m.get.mock.calls[0][0]).toMatchObject({ collection: 'appMeta', id: 'releaseCutover' });
    expect(localStorage.length).toBe(0);
  });
  it('retains the exact operation, release and full payload after an uncertain response', async () => {
    m.call.mockRejectedValueOnce(new Error('timeout'));
    const patch = { amount: 120, lines: [{ accountCode: '802', amount: 120 }], note: '초안' };
    await expect(mutateCash('taebaek', original, 'edit', patch)).rejects.toThrow('timeout');
    const command = m.call.mock.calls[0][0];
    m.get.mockRejectedValue(new Error('must not refetch'));
    await mutateCash('taebaek', original, 'edit', patch);
    expect(m.call.mock.calls[1][0]).toEqual(command); expect(localStorage.length).toBe(0);
  });
  it('preserves pending and refuses changed input, stale source or wrong company claims', async () => {
    m.call.mockRejectedValue(new Error('timeout'));
    await expect(mutateCash('taebaek', original, 'delete')).rejects.toThrow();
    const saved = localStorage.getItem('cash-mutation-pending:taebaek:cash:uid');
    await expect(mutateCash('taebaek', original, 'edit', { note: '다른 의도' })).rejects.toThrow('이전 변경');
    await expect(mutateCash('taebaek', { ...original, amount: 200 }, 'delete')).rejects.toThrow('이전 변경');
    m.claims.companyId = 'punghoe';
    await expect(mutateCash('taebaek', original, 'delete')).rejects.toThrow('권한');
    expect(localStorage.getItem('cash-mutation-pending:taebaek:cash:uid')).toBe(saved); expect(m.call).toHaveBeenCalledOnce();
  });
});
