// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ read: vi.fn(), call: vi.fn(), token: vi.fn(), user: { uid: 'admin' } }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, collection: string, id: string) => ({ collection, id }), getDoc: m.read }));
vi.mock('firebase/functions', () => ({ httpsCallable: (_f: unknown, name: string) => {
  expect(name).toBe('recordLoanMovementCommand'); return m.call;
} }));
vi.mock('../firebase', () => ({ authReady: Promise.resolve(), db: {}, functions: {},
  auth: { currentUser: { ...m.user, getIdTokenResult: m.token } } }));
import { recordLoanMovement } from './recordLoanMovement';
const input = { loanId: 'loan-a', tradeDate: '2026-10-07', cashAccountId: 'bank-a', action: '상환' as const,
  principal: 100, interest: 5, note: ' 상환 ' };
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  m.token.mockResolvedValue({ claims: { companyId: 'taebaek', isAdmin: true } });
  m.read.mockImplementation(async ({ collection }) => ({ exists: () => true, data: () => collection === 'appMeta'
    ? { status: 'active', releaseId: 'release-a' } : { companyId: 'taebaek', movementRevision: 3 } }));
  m.call.mockImplementation(async request => ({ data: { status: 'applied', id: request.operationId, docNo: '261007-001', balanceAfter: 900 } }));
});
it('전용 명령 성공은 실제 서버 잔액과 번호를 반환하고 pending을 지운다', async () => {
  const result = await recordLoanMovement('taebaek', input);
  expect(result.balanceAfter).toBe(900); expect(localStorage.length).toBe(0);
  expect(m.call.mock.calls[0][0]).toMatchObject({ expectedRevision: 3, principal: 100, interest: 5, note: '상환' });
});
it('응답 유실 재시도는 작업 ID·기준 버전·release를 그대로 재사용한다', async () => {
  m.call.mockRejectedValueOnce(new Error('response lost'));
  await expect(recordLoanMovement('taebaek', input)).rejects.toThrow('response lost');
  const first = m.call.mock.calls[0][0];
  m.read.mockRejectedValue(new Error('fresh revision must not read'));
  m.call.mockImplementation(async request => ({ data: { status: 'duplicate', id: request.operationId, docNo: '261007-001', balanceAfter: 900 } }));
  await recordLoanMovement('taebaek', input);
  expect(m.call.mock.calls[1][0]).toEqual(first); expect(m.read).toHaveBeenCalledTimes(2);
});
it('불확실한 이전 요청 뒤 금액 변경은 새 번호/작업을 만들지 않는다', async () => {
  m.call.mockRejectedValueOnce(new Error('lost'));
  await expect(recordLoanMovement('taebaek', input)).rejects.toThrow();
  await expect(recordLoanMovement('taebaek', { ...input, principal: 101 })).rejects.toThrow('불확실');
  expect(m.call).toHaveBeenCalledTimes(1); expect(localStorage.length).toBe(1);
});
it('다른 회사 계약은 서버 발행을 시작하지 않는다', async () => {
  m.read.mockResolvedValue({ exists: () => true, data: () => ({ status: 'active', releaseId: 'release-a', companyId: 'punghoe' }) });
  await expect(recordLoanMovement('taebaek', input)).rejects.toThrow('회사'); expect(m.call).not.toHaveBeenCalled();
});
it('조회 도중 권한 회사가 변경되면 쓰기를 시작하지 않는다', async () => {
  m.token.mockResolvedValueOnce({ claims: { companyId: 'taebaek', isAdmin: true } })
    .mockResolvedValueOnce({ claims: { companyId: 'punghoe', isAdmin: true } });
  await expect(recordLoanMovement('taebaek', input)).rejects.toThrow('권한'); expect(m.call).not.toHaveBeenCalled();
});
it('서버 잔액/전환 거절은 입력을 보존하고 직접 저장으로 우회하지 않는다', async () => {
  m.call.mockRejectedValue(new Error('대출 계약 잔액과 원장 합계가 다릅니다.'));
  await expect(recordLoanMovement('taebaek', input)).rejects.toThrow('원장'); expect(localStorage.length).toBe(1);
});
it('손상 pending은 fail closed한다', async () => {
  localStorage.setItem('loan-movement-pending:taebaek:loan-a:admin', '{bad');
  await expect(recordLoanMovement('taebaek', input)).rejects.toThrow('기록'); expect(m.call).not.toHaveBeenCalled();
});
it('서버가 현재 작업 부재·무쓰기를 명시한 거절은 수정 후 새 요청을 허용한다', async () => {
  m.call.mockImplementationOnce(async request => { throw Object.assign(new Error('preflight rejected'), {
    details: { loanMovementFailure: { version: 2, companyId: 'taebaek', loanId: 'loan-a',
      operationId: request.operationId, operationRejected: true, financialWrites: false } },
  }); });
  await expect(recordLoanMovement('taebaek', input)).rejects.toThrow();
  expect(localStorage.length).toBe(0);
  await recordLoanMovement('taebaek', { ...input, cashAccountId: 'bank-b' });
  expect(m.call.mock.calls[1][0].operationId).not.toBe(m.call.mock.calls[0][0].operationId);
});
it('다른 작업의 안전 실패 detail은 현재 pending을 지우지 않는다', async () => {
  m.call.mockRejectedValue(Object.assign(new Error('rejected'), { details: { loanMovementFailure: {
    version: 2, companyId: 'taebaek', loanId: 'loan-a', operationId: 'different', operationRejected: true, financialWrites: false,
  } } }));
  await expect(recordLoanMovement('taebaek', input)).rejects.toThrow(); expect(localStorage.length).toBe(1);
});
for (const bad of [{ tradeDate: '2026-02-30' }, { principal: Number.MAX_SAFE_INTEGER, interest: 1 },
  { principal: -1 }, { principal: 0, interest: 0 }, { note: 'x'.repeat(501) },
  { action: '대체' }, { loanId: 'a/b' }])
  it(`서버 외부 입력거절 ${JSON.stringify(bad).slice(0, 45)} 전 pending을 만들지 않는다`, async () => {
    await expect(recordLoanMovement('taebaek', { ...input, ...bad } as any)).rejects.toThrow();
    expect(localStorage.length).toBe(0); expect(m.call).not.toHaveBeenCalled();
  });
