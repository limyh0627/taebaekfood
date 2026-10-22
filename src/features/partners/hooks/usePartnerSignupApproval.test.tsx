import { StrictMode, type PropsWithChildren } from 'react';
/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PartnerSignupUser } from '../../../shared/services/partnerSignupApprovalService';
const m = vi.hoisted(() => ({ user: { uid: 'admin' }, subscribe: vi.fn(), write: vi.fn(), read: vi.fn(), confirm: vi.fn(), events: new Set<(u: unknown) => void>() }));
vi.mock('../../../shared/firebase', () => ({ auth: { get currentUser() { return m.user; } } }));
vi.mock('firebase/auth', () => ({ onIdTokenChanged: (_a: unknown, cb: (u: unknown) => void) => { m.events.add(cb); queueMicrotask(() => { if (m.events.has(cb))
        cb(m.user); }); return () => m.events.delete(cb); } }));
vi.mock('../../../shared/components/appDialog', () => ({ appConfirm: m.confirm }));
vi.mock('../../../shared/services/partnerSignupApprovalService', async (original) => ({ ...await original<typeof import('../../../shared/services/partnerSignupApprovalService')>(), subscribePendingPartnerSignups: m.subscribe, decidePartnerSignup: m.write, readPartnerSignup: m.read }));
import { usePartnerSignupApproval } from './usePartnerSignupApproval';
import { PartnerSignupError } from '../../../shared/services/partnerSignupApprovalService';
const row: PartnerSignupUser = { id: 'u', companyId: 'taebaek', name: '신청자', status: 'pending' };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
beforeEach(() => { m.user = { uid: 'admin' }; m.events.clear(); m.subscribe.mockReset(); m.write.mockReset(); m.read.mockReset(); m.confirm.mockReset(); m.confirm.mockResolvedValue(true); m.write.mockResolvedValue(undefined); m.subscribe.mockImplementation((_s, cb) => { cb([row, { ...row, id: 'other' }]); return () => { }; }); });
afterEach(cleanup);
it('확인전동기예약은 같은행만 잠그고 다른행업무는 허용한다', async () => { const d = deferred<boolean>(); m.confirm.mockReturnValue(d.promise); const h = renderHook(() => usePartnerSignupApproval('taebaek')); let first!: Promise<void>; act(() => { first = h.result.current.reject(row); void h.result.current.reject(row); }); expect(m.confirm).toHaveBeenCalledOnce(); expect(h.result.current.busy('u')).toBe(true); await act(async () => h.result.current.approve({ ...row, id: 'other' }, 'p')); expect(m.write).toHaveBeenCalledOnce(); await act(async () => { d.resolve(false); await first; }); expect(h.result.current.busy('u')).toBe(false); });
it('실UID변경은 확인후송신을 막는다', async () => { const d = deferred<boolean>(); m.confirm.mockReturnValue(d.promise); const h = renderHook(() => usePartnerSignupApproval('taebaek')); let run!: Promise<void>; act(() => { run = h.result.current.reject(row); }); m.user = { uid: 'other' }; await act(async () => { d.resolve(true); await run; }); expect(m.write).not.toHaveBeenCalled(); });
it('회사왕복 뒤 옛 finally는 새행 실행잠금을 풀지 않는다', async () => { const a = deferred<void>(), b = deferred<void>(); m.write.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise); const h = renderHook(company => usePartnerSignupApproval(company), { initialProps: 'taebaek' as 'taebaek' | 'punghoe' }); let first!: Promise<void>, next!: Promise<void>; act(() => { first = h.result.current.approve(row, 'p'); }); h.rerender('punghoe'); h.rerender('taebaek'); act(() => { next = h.result.current.approve({ ...row, id: 'other' }, 'p'); }); await act(async () => { a.reject(Error('옛 오류')); await first; }); expect(h.result.current.busy('other')).toBe(true); await act(async () => { b.resolve(); await next; }); expect(h.result.current.busy('u')).toBe(false); });
it('unknown은 목록밖에서도 보관하며 현재상태는 내요청증명으로 표시하지 않는다', async () => { m.write.mockRejectedValue(new PartnerSignupError('결과 미확인', 'unknown')); const h = renderHook(() => usePartnerSignupApproval('taebaek')); await act(async () => h.result.current.approve(row, 'p')); expect(h.result.current.records.has('u')).toBe(true); m.read.mockResolvedValue({ ...row, status: 'approved', linkedPartnerId: 'p' }); await act(async () => h.result.current.inspect('u')); expect(h.result.current.records.get('u')?.message).toContain('증명은 아닙니다'); act(() => h.result.current.closeObserved('u')); expect(h.result.current.records.has('u')).toBe(false); expect(m.write).toHaveBeenCalledOnce(); });
it('pending실조회후 retry미시작도 최초unknown원문을 지우지 않는다', async () => { m.write.mockRejectedValueOnce(new PartnerSignupError('응답 유실', 'unknown')).mockRejectedValueOnce(new PartnerSignupError('권한을 다시 확인', 'not-started')); const h = renderHook(() => usePartnerSignupApproval('taebaek')); await act(async () => h.result.current.reject(row)); m.read.mockResolvedValue(row); await act(async () => h.result.current.inspect('u')); act(() => h.result.current.closeObserved('u')); expect(h.result.current.records.has('u')).toBe(true); await act(async () => h.result.current.retryDecision('u')); expect(h.result.current.records.has('u')).toBe(true); expect(h.result.current.records.get('u')?.retryAllowed).toBe(false); });
it('삭제된현재상태확인후닫기는 새문서를 만들지 않는다', async () => { m.write.mockRejectedValue(new PartnerSignupError('유실', 'unknown')); const h = renderHook(() => usePartnerSignupApproval('taebaek')); await act(async () => h.result.current.reject(row)); m.read.mockResolvedValue(null); await act(async () => h.result.current.inspect('u')); expect(h.result.current.records.get('u')?.message).toContain('삭제'); act(() => h.result.current.closeObserved('u')); expect(m.write).toHaveBeenCalledOnce(); });
it('unmount뒤확인승인은송신0이다', async () => { const d = deferred<boolean>(); m.confirm.mockReturnValue(d.promise); const h = renderHook(() => usePartnerSignupApproval('taebaek')); let run!: Promise<void>; act(() => { run = h.result.current.reject(row); }); h.unmount(); d.resolve(true); await run; expect(m.write).not.toHaveBeenCalled(); });
it('ABA 뒤 새 inspect/retry unknown 기록은 옛 ACK가 삭제하지 않는다', async () => {
    const old = deferred<void>(), fresh = deferred<void>();
    m.write.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const h = renderHook(company => usePartnerSignupApproval(company), { initialProps: 'taebaek' as 'taebaek' | 'punghoe' });
    let a!: Promise<void>, b!: Promise<void>;
    act(() => { a = h.result.current.approve(row, 'p'); });
    h.rerender('punghoe');
    h.rerender('taebaek');
    m.read.mockResolvedValue(row);
    await act(async () => h.result.current.inspect('u'));
    act(() => { b = h.result.current.retryDecision('u'); });
    await act(async () => { fresh.reject(new PartnerSignupError('새 응답 유실', 'unknown')); await b; });
    const observed = h.result.current.records.get('u');
    await act(async () => { old.resolve(); await a; });
    expect(h.result.current.records.get('u')).toBe(observed);
    expect(observed?.message).toBe('새 응답 유실');
});
it.each([undefined, 'legacy'])('알수없는 현재status %s는 확인한내용닫기로 버리지 않는다', async (status) => {
    m.write.mockRejectedValue(new PartnerSignupError('유실', 'unknown'));
    const h = renderHook(() => usePartnerSignupApproval('taebaek'));
    await act(async () => h.result.current.reject(row));
    m.read.mockResolvedValue({ ...row, status });
    await act(async () => h.result.current.inspect('u'));
    act(() => h.result.current.closeObserved('u'));
    expect(h.result.current.records.has('u')).toBe(true);
});
it('StrictMode 실제 마운트에서도 현재 목록을 준비한다', () => { const h = renderHook(() => usePartnerSignupApproval('taebaek'), { wrapper: ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode> }); expect(h.result.current.status).toBe('ready'); expect(h.result.current.rows).toHaveLength(2); });
