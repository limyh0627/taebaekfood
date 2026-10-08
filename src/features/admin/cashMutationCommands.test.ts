/** @vitest-environment jsdom */
import { webcrypto } from 'node:crypto';
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
