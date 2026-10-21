/** @vitest-environment jsdom */
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useLoanOpeningEditor, type LoanOpeningEditorOptions } from './useLoanOpeningEditor';
import type { LoanContract } from '../../../shared/loanLedger';
const io = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), confirm: vi.fn(), notice: vi.fn(), listeners: new Set<(user: {
        uid: string;
    } | null) => void>(), auth: { currentUser: { uid: 'A' } as {
            uid: string;
        } | null, onAuthStateChanged: vi.fn() } }));
vi.mock('../../../shared/firebase', () => ({ auth: io.auth }));
vi.mock('../../../shared/services/firebaseService', () => ({ createLoanWithOpening: io.create, updateLoanOpening: io.update }));
vi.mock('../../../shared/components/appDialog', () => ({ appConfirm: io.confirm, appNotice: io.notice }));
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };
const loan: LoanContract = { id: 'loan', companyId: 'taebaek', name: '원대출', lenderName: '은행', accountCode: '293', openingDate: '2026-01-01', openingPrincipal: 10000, createdAt: 'fixed' };
const emit = (uid: string) => { io.auth.currentUser = { uid }; io.listeners.forEach(listener => listener({ uid })); };
beforeEach(() => { io.auth.currentUser = { uid: 'A' }; io.create.mockReset().mockResolvedValue(undefined); io.update.mockReset().mockResolvedValue(undefined); io.confirm.mockReset().mockResolvedValue(true); io.notice.mockReset(); io.auth.onAuthStateChanged.mockImplementation(listener => { io.listeners.add(listener); listener(io.auth.currentUser); return () => { io.listeners.delete(listener); }; }); });
function setup(strict = false) { const refresh = vi.fn().mockResolvedValue(undefined), onCreated = vi.fn(); const initial: LoanOpeningEditorOptions = { companyId: 'taebaek', selectedId: 'loan', cashEntries: [], refresh, onCreated }; const hook = renderHook((props: LoanOpeningEditorOptions) => useLoanOpeningEditor(props), { initialProps: initial, ...(strict ? { wrapper: ({ children }: {
            children: React.ReactNode;
        }) => <React.StrictMode>{children}</React.StrictMode> } : {}) }); return { ...hook, refresh, onCreated, initial }; }
function createDraft(result: ReturnType<typeof setup>['result']) { act(() => { result.current.create.open(); }); act(() => { result.current.create.change('name', '새 대출'); result.current.create.change('lenderName', '농협'); result.current.create.change('openingPrincipal', '1000'); }); }
it('등록 원문 ID와 createdAt은 실패 뒤 동일 초안 재시도에서 완전히 같다', async () => {
    const { result, onCreated, refresh } = setup();
    io.create.mockRejectedValueOnce(Error('응답 유실'));
    createDraft(result);
    await act(async () => { await result.current.create.submit(); });
    const first = structuredClone(io.create.mock.calls[0][1]);
    expect(result.current.create.opened).toBe(true);
    expect(result.current.create.draft.name).toBe('새 대출');
    await act(async () => { await result.current.create.submit(); });
    expect(io.create.mock.calls[1][1]).toEqual(first);
    expect(onCreated).toHaveBeenCalledExactlyOnceWith(first.id);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.current.create.opened).toBe(false);
});
it('확인 전 동기 잠금은 중복 확인·입력·닫기를 막는다', async () => {
    const wait = deferred<boolean>();
    io.confirm.mockReturnValue(wait.promise);
    const { result } = setup();
    createDraft(result);
    let submit!: Promise<void>;
    act(() => { submit = result.current.create.submit(); void result.current.create.submit(); result.current.create.close(); result.current.create.change('name', '다른 이름'); });
    expect(io.confirm).toHaveBeenCalledTimes(1);
    expect(result.current.isBusy()).toBe(true);
    expect(result.current.create.opened).toBe(true);
    expect(result.current.create.draft.name).toBe('새 대출');
    await act(async () => { wait.resolve(false); await submit; });
    expect(result.current.isBusy()).toBe(false);
    expect(io.create).not.toHaveBeenCalled();
});
it.each(['company', 'unmount'] as const)('등록 확인 중 %s 전환은 SDK를 시작하지 않는다', async (mode) => {
    const wait = deferred<boolean>();
    io.confirm.mockReturnValue(wait.promise);
    const { result, rerender, initial, unmount } = setup();
    createDraft(result);
    let pending!: Promise<void>;
    act(() => { pending = result.current.create.submit(); });
    if (mode === 'unmount')
        unmount();
    else
        rerender({ ...initial, companyId: 'punghoe' });
    await act(async () => { wait.resolve(true); await pending; });
    expect(io.create).not.toHaveBeenCalled();
});
it.each(['resolve', 'reject'] as const)('실제 UID A→B→A 뒤 이전 %s는 새 폼과 저장 잠금을 바꾸지 않는다', async (kind) => {
    const old = deferred<void>(), fresh = deferred<void>();
    io.create.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const { result, onCreated, refresh } = setup();
    createDraft(result);
    let a!: Promise<void>, b!: Promise<void>;
    act(() => { a = result.current.create.submit(); });
    await act(async () => { });
    act(() => { emit('B'); });
    expect(result.current.create.opened).toBe(false);
    act(() => { emit('A'); });
    createDraft(result);
    act(() => { b = result.current.create.submit(); });
    await act(async () => { });
    await act(async () => { if (kind === 'resolve')
        old.resolve();
    else
        old.reject(Error('옛 오류')); await a; });
    expect(result.current.create.saving).toBe(true);
    expect(result.current.create.draft.name).toBe('새 대출');
    expect(onCreated).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(io.notice).not.toHaveBeenCalled();
    await act(async () => { fresh.resolve(); await b; });
    expect(onCreated).toHaveBeenCalledTimes(1);
});
it('회사 왕복 뒤 이전 수정 finally는 새 수정 잠금을 해제하지 않는다', async () => {
    const old = deferred<void>(), fresh = deferred<void>();
    io.update.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const { result, rerender, initial } = setup();
    act(() => { result.current.edit.open(loan); });
    let a!: Promise<void>, b!: Promise<void>;
    act(() => { a = result.current.edit.submit(); });
    await act(async () => { });
    rerender({ ...initial, companyId: 'punghoe' });
    rerender(initial);
    act(() => { result.current.edit.open(loan); });
    act(() => { b = result.current.edit.submit(); });
    await act(async () => { });
    await act(async () => { old.resolve(); await a; });
    expect(result.current.edit.saving).toBe(true);
    await act(async () => { fresh.resolve(); await b; });
    expect(result.current.edit.original).toBeNull();
});
it('수정은 처음 선택한 원본을 쓰며 새 props 원본으로 재포장하지 않는다', async () => {
    const { result, rerender, initial } = setup();
    const selected = { ...loan };
    act(() => { result.current.edit.open(selected); });
    selected.openingPrincipal = 99999;
    rerender({ ...initial, cashEntries: [] });
    expect(result.current.edit.original?.openingPrincipal).toBe(10000);
    await act(async () => { await result.current.edit.submit(); });
    expect(io.update).toHaveBeenCalledWith('taebaek', loan, loan.openingDate, 10000);
});
it('저장 ACK 뒤 목록 조회 실패는 저장을 다시 보내지 않고 목록만 재확인한다', async () => {
    const { result, refresh, onCreated } = setup();
    refresh.mockRejectedValueOnce(Error('목록 오류'));
    createDraft(result);
    await act(async () => { await result.current.create.submit(); });
    expect(result.current.create.opened).toBe(true);
    expect(result.current.create.locked).toBe(true);
    expect(io.notice).toHaveBeenCalledWith(expect.stringContaining('저장은 완료됐지만'), '목록 조회 실패');
    expect(onCreated).not.toHaveBeenCalled();
    await act(async () => { await result.current.create.submit(); });
    expect(io.create).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(onCreated).toHaveBeenCalledTimes(1);
});
it('목록 갱신 중 UID 변경 뒤에는 이전 등록 콜백을 부르지 않는다', async () => {
    const wait = deferred<void>();
    const { result, refresh, onCreated } = setup();
    refresh.mockReturnValue(wait.promise);
    createDraft(result);
    let pending!: Promise<void>;
    act(() => { pending = result.current.create.submit(); });
    await act(async () => { });
    const guard = refresh.mock.calls[0][0] as () => boolean;
    act(() => { emit('B'); });
    expect(guard()).toBe(false);
    await act(async () => { wait.resolve(); await pending; });
    expect(onCreated).not.toHaveBeenCalled();
    expect(result.current.create.opened).toBe(false);
});
it('수정 중 빈 금액은 미리보기 오류를 보존하고 저장하지 않는다', async () => {
    const { result } = setup();
    act(() => { result.current.edit.open(loan); result.current.edit.change('opening', ''); });
    expect(result.current.edit.preview.principal).toBeUndefined();
    expect(result.current.edit.preview.error).toContain('입력');
    await act(async () => { await result.current.edit.submit(); });
    expect(io.update).not.toHaveBeenCalled();
    expect(io.confirm).not.toHaveBeenCalled();
});
it('StrictMode 재설치 뒤 현재 등록은 정상 진행한다', async () => {
    const { result, onCreated } = setup(true);
    createDraft(result);
    await act(async () => { await result.current.create.submit(); });
    expect(onCreated).toHaveBeenCalledTimes(1);
});
it('구독 이벤트 전 실제 UID가 바뀌면 옛 handler는 송신하지 않는다', async () => {
    const { result } = setup();
    createDraft(result);
    io.auth.currentUser = { uid: 'B' };
    await act(async () => { await result.current.create.submit(); });
    expect(io.confirm).not.toHaveBeenCalled();
    expect(io.create).not.toHaveBeenCalled();
});
