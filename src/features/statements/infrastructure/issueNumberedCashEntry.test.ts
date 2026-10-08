import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ read: vi.fn(), call: vi.fn(), scoped: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, collection: string, id: string) => ({ collection, id }), getDoc: m.read }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => m.call }));
vi.mock('../../../shared/firebase', () => ({ authReady: Promise.resolve(), db: {}, functions: {}, auth: { currentUser: { uid: 'uid' } } }));
vi.mock('../../../shared/services/firebaseService', () => ({ companyScopedWriteData: m.scoped }));
import { issueNumberedCashEntry } from './issueTradeStatementCommand';
const entry = { id: 'cash-original', companyId: 'taebaek' as const, date: '2026-10-03', amount: 100, dir: '출금' as const, cashAccountId: 'bank', accountCode: '251', createdAt: '2026-10-03T00:00:00Z' };
beforeEach(() => { vi.clearAllMocks(); m.read.mockResolvedValue({ data: () => ({ status: 'active', releaseId: 'release' }) }); m.scoped.mockImplementation(async (_kind, row) => row); m.call.mockResolvedValue({ data: { id: entry.id, docNo: '261003-001' } }); });
describe('신규 현금 callable 송신 경계', () => {
  it.each(['gate', 'scope'])('송신 전 %s 실패만 같은 회사·ID 쓰기0 proof를 준다', async failure => {
    if (failure === 'gate') m.read.mockRejectedValue(new Error('gate read failed'));
    else m.scoped.mockRejectedValue(new Error('scope rejected'));
    await expect(issueNumberedCashEntry(entry)).rejects.toMatchObject({ details: { operationStatus: 'rejected', version: 1, financialWrites: false, companyId: 'taebaek', operationId: entry.id } });
    expect(m.call).not.toHaveBeenCalled();
  });
  it('송신 이후 응답 유실은 no-write proof로 바꾸지 않는다', async () => {
    const unknown = new Error('response lost'); m.call.mockRejectedValue(unknown);
    await expect(issueNumberedCashEntry(entry)).rejects.toBe(unknown);
    expect((unknown as any).details).toBeUndefined(); expect(m.call).toHaveBeenCalledTimes(1);
  });
  it('선택 원문 ID·계정·날짜·계좌를 서버 요청에 그대로 보낸다', async () => {
    await issueNumberedCashEntry(entry);
    expect(m.call).toHaveBeenCalledWith({ kind: 'cashEntries', operationId: entry.id, tradeDate: entry.date, prefix: '', document: entry, releaseId: 'release' });
  });
});
