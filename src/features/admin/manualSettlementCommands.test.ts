/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ call: vi.fn(), get: vi.fn(), user: { uid: 'u', getIdTokenResult: vi.fn() }, auth: { currentUser: null as unknown } }));
vi.mock('../../shared/firebase', () => ({ auth: m.auth, authReady: Promise.resolve(), db: {}, functions: {} }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, group: string, id: string) => ({ group, id }), getDoc: m.get }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => m.call }));
import { mutateManualSettlement } from './manualSettlementCommands';
const input = { action: 'add' as const, partnerId: 'p', cashEntryId: 'c', statementId: 's', amount: 80 };
const key = 'manual-settlement-pending:taebaek:u:c:s';
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); m.auth.currentUser = m.user;
  vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValueOnce('11111111-1111-4111-8111-111111111111').mockReturnValue('22222222-2222-4222-8222-222222222222') });
  m.user.getIdTokenResult.mockResolvedValue({ claims: { isAdmin: true, companyId: 'taebaek' } });
  m.get.mockImplementation(({ id }) => Promise.resolve({ exists: () => true, data: () => id === 'releaseCutover'
    ? { status: 'active', releaseId: 'rel' } : { companyId: 'taebaek', partnerId: 'p', revision: 4 } }));
  m.call.mockImplementation(request => Promise.resolve({ data: { status: 'applied', settlementId: `manual-${request.operationId}`, revision: request.expectedRevision + 1 } }));
});
it('정확 필드·회사·UID를 검사하고 한 callable 성공 뒤에만 기록을 지운다', async () => {
  await mutateManualSettlement('taebaek', input);
  expect(m.call).toHaveBeenCalledExactlyOnceWith({ ...input, operationId: 'manual-11111111-1111-4111-8111-111111111111', expectedRevision: 4, releaseId: 'rel' });
  expect(localStorage.length).toBe(0);
});
it('응답 유실은 원 release/revision/operation 전체를 그대로 재전송한다', async () => {
  m.call.mockRejectedValueOnce(new Error('timeout'));
  await expect(mutateManualSettlement('taebaek', input)).rejects.toThrow('timeout');
  const request = m.call.mock.calls[0][0]; m.get.mockRejectedValue(new Error('조회 금지'));
  await mutateManualSettlement('taebaek', input);
  expect(m.call.mock.calls[1][0]).toEqual(request); expect(localStorage.length).toBe(0);
});
it('확정 서버 거절만 해제하고 수정 입력은 새 UUID로 저장한다', async () => {
  m.call.mockImplementationOnce(request => Promise.reject(Object.assign(new Error('한도'), { details: { manualSettlementFailure: {
    version: 1, companyId: 'taebaek', partnerId: 'p', operationId: request.operationId, operationRejected: true, financialWrites: false } } })));
  await expect(mutateManualSettlement('taebaek', input)).rejects.toThrow('한도'); expect(localStorage.length).toBe(0);
  await mutateManualSettlement('taebaek', { ...input, amount: 60 });
  expect(m.call.mock.calls[1][0]).toMatchObject({ amount: 60, operationId: 'manual-22222222-2222-4222-8222-222222222222' });
});
it('불명확·틀린 terminal·변경 입력·손상 pending은 자동삭제하지 않는다', async () => {
  m.call.mockRejectedValue(new Error('failed-precondition'));
  await expect(mutateManualSettlement('taebaek', input)).rejects.toThrow(); const original = localStorage.getItem(key);
  await expect(mutateManualSettlement('taebaek', { ...input, amount: 81 })).rejects.toThrow('이전 정산');
  expect(m.call).toHaveBeenCalledTimes(1); expect(localStorage.getItem(key)).toBe(original);
  m.call.mockRejectedValue({ details: { manualSettlementFailure: { version: 1, companyId: 'punghoe', partnerId: 'p', operationRejected: true, financialWrites: false } } });
  await expect(mutateManualSettlement('taebaek', input)).rejects.toBeDefined(); expect(localStorage.getItem(key)).toBe(original);
  localStorage.setItem(key, JSON.stringify({ version: 1, fingerprint: JSON.stringify(input) }));
  await expect(mutateManualSettlement('taebaek', input)).rejects.toThrow('이전 정산'); expect(localStorage.length).toBe(1);
});
it('직원·다른 회사와 서버 호출 전 UID 변경을 막는다', async () => {
  for (const claims of [{ companyId: 'punghoe', isAdmin: true }, { companyId: 'taebaek', isAdmin: false }]) {
    m.user.getIdTokenResult.mockResolvedValue({ claims });
    await expect(mutateManualSettlement('taebaek', input)).rejects.toThrow('권한');
  }
  expect(m.call).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0);
});
it('늦은 응답은 새 UID·새 pending을 지우거나 성공으로 돌려주지 않는다', async () => {
  m.call.mockImplementation(async request => {
    m.auth.currentUser = { uid: 'new-user' }; localStorage.setItem(key, 'new-pending');
    return { data: { status: 'applied', settlementId: `manual-${request.operationId}`, revision: request.expectedRevision + 1 } };
  });
  await expect(mutateManualSettlement('taebaek', input)).rejects.toThrow('권한');
  expect(localStorage.getItem(key)).toBe('new-pending');
});
it('update/delete는 기존 행·기대 금액을 정확히 보내고 응답 ID를 확인한다', async () => {
  m.call.mockImplementation(async request => ({ data: { status: 'applied', settlementId: request.settlementId, revision: request.expectedRevision + 1 } }));
  await mutateManualSettlement('taebaek', { ...input, action: 'update', amount: 60, expectedAmount: 80, settlementId: 'manual-old' });
  expect(m.call.mock.calls[0][0]).toMatchObject({ action: 'update', amount: 60, expectedAmount: 80, settlementId: 'manual-old' });
  await mutateManualSettlement('taebaek', { ...input, action: 'delete', amount: 60, settlementId: 'manual-old' });
  expect(m.call.mock.calls[1][0]).toMatchObject({ action: 'delete', amount: 60, settlementId: 'manual-old' });
});
