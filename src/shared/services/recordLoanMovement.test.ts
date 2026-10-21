// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ read: vi.fn(), call: vi.fn(), token: vi.fn(), user: { uid: 'admin' } }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, collection: string, id: string) => ({ collection, id }), getDoc: m.read }));
vi.mock('firebase/functions', () => ({ httpsCallable: (_f: unknown, name: string) => {
  expect(name).toBe('recordLoanMovementCommand'); return m.call;
} }));
vi.mock('../firebase', () => ({ authReady: Promise.resolve(), db: {}, functions: {},
  auth: { currentUser: { ...m.user, getIdTokenResult: m.token } } }));
import { auth } from '../firebase';
import { recordLoanMovement, readMatchingLoanMovement, retryLoanMovement } from './recordLoanMovement';
const input = { loanId: 'loan-a', tradeDate: '2026-10-07', cashAccountId: 'bank-a', action: '상환' as const,
  principal: 100, interest: 5, note: ' 상환 ' };
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); Object.assign(auth.currentUser!, { uid: 'admin' });
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

const pendingKey = 'loan-movement-pending:taebaek:loan-a:admin';
async function observedRequest() {
  m.call.mockRejectedValueOnce(Error('response lost'));
  await expect(recordLoanMovement('taebaek', input)).rejects.toThrow('response lost');
  const observed = readMatchingLoanMovement('taebaek', input);
  if (!observed) throw Error('관측 요청 fixture 없음');
  return observed;
}
it('관측된 같은 원문은 새 조회·작업 없이 최초 요청으로 재확인한다', async () => {
  const observed = await observedRequest(), original = structuredClone(m.call.mock.calls[0][0]);
  m.call.mockClear(); m.read.mockClear();
  const uuid = vi.spyOn(crypto, 'randomUUID');
  await retryLoanMovement('taebaek', input, observed, () => true);
  expect(m.call).toHaveBeenCalledExactlyOnceWith(original); expect(m.read).not.toHaveBeenCalled(); expect(uuid).not.toHaveBeenCalled();
  expect(localStorage.getItem(pendingKey)).toBeNull();
});
it.each(['principal', 'interest', 'tradeDate', 'cashAccountId', 'note', 'action'] as const)('보관된 요청의 %s가 다르면 동일 요청으로 인정하지 않는다', async field => {
  await observedRequest(); const raw = localStorage.getItem(pendingKey);
  const changed = { ...input, [field]: field === 'principal' ? 101 : field === 'interest' ? 6 : field === 'tradeDate' ? '2026-10-08' : field === 'action' ? '차입' : '다른 값' };
  if (field === 'action') changed.interest = 0;
  expect(() => readMatchingLoanMovement('taebaek', changed as typeof input)).toThrow();
  expect(localStorage.getItem(pendingKey)).toBe(raw); expect(m.call).toHaveBeenCalledTimes(1);
});
it('다른 회사·대출·사용자의 원문은 현재 요청으로 반환하지 않는다', async () => {
  await observedRequest(); expect(readMatchingLoanMovement('punghoe', input)).toBeNull();
  expect(readMatchingLoanMovement('taebaek', { ...input, loanId: 'other' })).toBeNull();
  Object.assign(auth.currentUser!, { uid: 'other' }); expect(readMatchingLoanMovement('taebaek', input)).toBeNull();
});
it.each(['{bad', JSON.stringify({ fingerprint: 'wrong', request: {} })])('손상된 원문은 보존하고 재시도 관측을 만들지 않는다: %s', raw => {
  localStorage.setItem(pendingKey, raw); expect(() => readMatchingLoanMovement('taebaek', input)).toThrow();
  expect(localStorage.getItem(pendingKey)).toBe(raw); expect(m.call).not.toHaveBeenCalled();
});
it.each(['deleted', 'replaced'] as const)('관측 후 %s 사본은 새 작업 생성과 송신 없이 중단한다', async mode => {
  const observed = await observedRequest();
  if (mode === 'deleted') localStorage.removeItem(pendingKey); else localStorage.setItem(pendingKey, 'replacement');
  m.call.mockClear(); m.read.mockClear(); const uuid = vi.spyOn(crypto, 'randomUUID');
  await expect(retryLoanMovement('taebaek', input, observed, () => true)).rejects.toThrow('바뀌었습니다');
  expect(m.call).not.toHaveBeenCalled(); expect(m.read).not.toHaveBeenCalled(); expect(uuid).not.toHaveBeenCalled();
  expect(localStorage.getItem(pendingKey)).toBe(mode === 'deleted' ? null : 'replacement');
});
it.each(['deleted', 'replaced'] as const)('권한 await 중 %s 사본도 송신 직전 다시 막는다', async mode => {
  const observed = await observedRequest(); m.call.mockClear(); m.read.mockClear();
  m.token.mockImplementationOnce(async () => { if (mode === 'deleted') localStorage.removeItem(pendingKey); else localStorage.setItem(pendingKey, 'new-copy'); return { claims: { companyId: 'taebaek', isAdmin: true } }; });
  await expect(retryLoanMovement('taebaek', input, observed, () => true)).rejects.toThrow('바뀌었습니다');
  expect(m.call).not.toHaveBeenCalled(); expect(m.read).not.toHaveBeenCalled();
});
it.each(['uid', 'current', 'claims'] as const)('권한 await 중 %s 변경은 이전 요청을 보내지 않는다', async mode => {
  const observed = await observedRequest(); m.call.mockClear(); let current = true;
  m.token.mockImplementationOnce(async () => { if (mode === 'uid') Object.assign(auth.currentUser!, { uid: 'other' }); if (mode === 'current') current = false; return { claims: { companyId: mode === 'claims' ? 'punghoe' : 'taebaek', isAdmin: true } }; });
  await expect(retryLoanMovement('taebaek', input, observed, () => current)).rejects.toThrow(); expect(m.call).not.toHaveBeenCalled();
  expect(localStorage.getItem(pendingKey)).toBe(observed.raw);
});
it.each(['success', 'rejected'] as const)('서버 %s 응답 때 교체된 사본은 정리하지 않는다', async mode => {
  const observed = await observedRequest();
  m.call.mockImplementationOnce(async request => { localStorage.setItem(pendingKey, 'replacement');
    if (mode === 'rejected') throw Object.assign(Error('안전 거절'), { details: { loanMovementFailure: { version: 2, companyId: 'taebaek', loanId: input.loanId, operationId: request.operationId, operationRejected: true, financialWrites: false } } });
    return { data: { status: 'duplicate', id: request.operationId, docNo: 'fixed', balanceAfter: 900 } };
  });
  if (mode === 'success') await retryLoanMovement('taebaek', input, observed, () => true);
  else await expect(retryLoanMovement('taebaek', input, observed, () => true)).rejects.toThrow('안전 거절');
  expect(localStorage.getItem(pendingKey)).toBe('replacement');
});
it('권한 await 중 공개 observation을 바꿔도 최초 raw만 검사하고 새 사본을 보내지 않는다', async () => {
  const observed = await observedRequest(), original = observed.raw; m.call.mockClear();
  m.token.mockImplementationOnce(async () => { const changed = JSON.parse(original); changed.request.operationId = 'replacement-op'; const raw = JSON.stringify(changed); localStorage.setItem(pendingKey, raw); observed.raw = raw; return { claims: { companyId: 'taebaek', isAdmin: true } }; });
  await expect(retryLoanMovement('taebaek', input, observed, () => true)).rejects.toThrow('바뀌었습니다'); expect(m.call).not.toHaveBeenCalled(); expect(localStorage.getItem(pendingKey)).not.toBe(original);
});
it('엄격 재시도 중 같은 대출의 신규 호출은 동기 중복 잠금을 공유한다', async () => {
  const observed = await observedRequest(); let finish!: (value: unknown) => void;
  m.call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const retry = retryLoanMovement('taebaek', input, observed, () => true);
  await vi.waitFor(() => expect(m.call).toHaveBeenCalledTimes(2));
  await expect(recordLoanMovement('taebaek', input)).rejects.toThrow('처리 중');
  finish({ data: { status: 'duplicate', id: JSON.parse(observed.raw).request.operationId, docNo: 'fixed', balanceAfter: 900 } }); await retry;
  expect(localStorage.getItem(pendingKey)).toBeNull();
});
