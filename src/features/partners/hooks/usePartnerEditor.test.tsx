/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { Partner } from '../../../shared/types';
const mock = vi.hoisted(() => ({ auth: { currentUser: { uid: 'uid' } as {
            uid: string;
        } | null }, listener: null as null | ((user: {
        uid: string;
    } | null) => void) }));
vi.mock('../../../shared/firebase', () => ({ auth: mock.auth }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_a: unknown, cb: typeof mock.listener) => {
        mock.listener = cb;
        return () => {
        };
    } }));
import { usePartnerEditor, type PartnerEditorOptions } from './usePartnerEditor';
import { partnerEditKey, type PartnerEditBindings, type PartnerEditEntry, type PartnerEditObservation } from '../../../shared/services/partnerEditWrites';
import { serializePartnerEditRequest, type PartnerEditResult } from '../../../shared/partnerEditCommand';
const partner: Partner = { id: 'p', name: '최초상호', type: '일반', note: '원비고' };
function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>(r => resolve = r);
    return { promise, resolve };
}
function fixture(extra: Partial<PartnerEditorOptions> = {}) {
    const entries: PartnerEditEntry[] = [];
    const ports: PartnerEditBindings = {
        open: vi.fn(async (_s, reference, opening) => ({ reference, actorUid: 'uid', opening, expectedVersion: '1:000000000' })),
        prepare: vi.fn(async (scope, request) => {
            const raw = serializePartnerEditRequest(request);
            const row: PartnerEditEntry = { key: partnerEditKey(scope, request.reference), reference: request.reference, request: JSON.parse(raw), requestHash: 'a'.repeat(64), referenceHash: 'a'.repeat(64), observedLocalText: raw, observedReferenceText: '참조원문', status: 'valid', description: '최초상호' };
            entries.push(row);
            return row;
        }),
        read: vi.fn(async (scope) => entries.filter(row => row.reference?.companyId === scope.companyId)),
        command: vi.fn(async (_s, row): Promise<PartnerEditObservation> => {
            entries.splice(entries.indexOf(row), 1);
            return { terminal: true, result: { version: 1, reference: row.reference!, actorUid: 'uid', status: 'applied', requestHash: row.requestHash, message: '수정완료' }, outcome: { status: 'saved' } };
        }),
        discard: vi.fn(async () => ({ status: 'cleared' as const, message: '기기 사본 정리' })),
        history: vi.fn(async (scope) => ({ version: 1 as const, ...scope, entries: [], nextCursor: null }))
    };
    const options: PartnerEditorOptions = { companyId: 'taebaek', actorUid: 'uid', partners: [partner], partnerEditBindings: ports, ...extra };
    return { entries, ports, options };
}
beforeEach(() => {
    vi.clearAllMocks();
    mock.auth.currentUser = { uid: 'uid' };
});
afterEach(cleanup);
async function ready(h: {
    result: {
        current: ReturnType<typeof usePartnerEditor>;
    };
}) {
    await waitFor(() => expect(h.result.current.readLoading).toBe(false));
}
async function open(h: {
    result: {
        current: ReturnType<typeof usePartnerEditor>;
    };
}) {
    await ready(h);
    await act(async () => {
        await h.result.current.openEditing(partner);
    });
}
function edit(h: {
    result: {
        current: ReturnType<typeof usePartnerEditor>;
    };
}, note = '새비고') {
    act(() => h.result.current.setEditForm(p => p ? { ...p, note } : p));
}
it('첫선택 원문을 한번 열고 props 변경으로 native를 재구성하지 않는다', async () => {
    const f = fixture();
    const h = renderHook((o: PartnerEditorOptions) => usePartnerEditor(o), { initialProps: f.options });
    await open(h);
    h.rerender({ ...f.options, partners: [{ ...partner, name: '동시수정' }] });
    edit(h);
    await act(async () => {
        await h.result.current.saveEditing();
    });
    expect(f.ports.open).toHaveBeenCalledTimes(1);
    expect(f.ports.prepare).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ expectedVersion: '1:000000000', patch: { note: '새비고' } }), expect.any(Function), '최초상호');
});
it('ACK대기와 동일tick 중복저장 잠금 뒤 현재폼만 닫는다', async () => {
    const f = fixture(), d = deferred<PartnerEditObservation>();
    vi.mocked(f.ports.command).mockReturnValue(d.promise);
    const h = renderHook(() => usePartnerEditor(f.options));
    await open(h);
    edit(h);
    let task!: Promise<void>;
    act(() => {
        task = h.result.current.saveEditing();
        void h.result.current.saveEditing();
    });
    await waitFor(() => expect(f.ports.command).toHaveBeenCalledTimes(1));
    expect(h.result.current.editForm).not.toBeNull();
    await act(async () => {
        d.resolve({ terminal: true, outcome: { status: 'saved' } });
        await task;
    });
    expect(h.result.current.editForm).toBeNull();
});
it('unknown은 폼과 원문을 유지하고 동일요청 조회만으로 종결한다', async () => {
    const f = fixture();
    vi.mocked(f.ports.command).mockResolvedValueOnce({ terminal: false, outcome: { status: 'unknown', message: '응답 유실', nextAction: '결과 확인' } });
    const h = renderHook(() => usePartnerEditor(f.options));
    await open(h);
    edit(h);
    await act(async () => {
        await h.result.current.saveEditing();
    });
    expect(h.result.current.locked).toBe(true);
    expect(h.result.current.inlineError).toBe('');
    expect(h.result.current.failureRows[0].cause).toBe('응답 유실');
    await act(async () => {
        await h.result.current.inspect(f.entries[0]);
    });
    expect(f.ports.command).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'inspect', expect.any(Function));
    expect(h.result.current.editForm).toBeNull();
});
it('회사 교체는 busy를 초기화하고 oldACK/finally가 새폼을 닫지 않는다', async () => {
    const f = fixture(), d = deferred<PartnerEditObservation>();
    vi.mocked(f.ports.command).mockReturnValueOnce(d.promise);
    const h = renderHook((o: PartnerEditorOptions) => usePartnerEditor(o), { initialProps: f.options });
    await open(h);
    edit(h);
    let task!: Promise<void>;
    act(() => {
        task = h.result.current.saveEditing();
    });
    await waitFor(() => expect(f.ports.command).toHaveBeenCalled());
    h.rerender({ ...f.options, companyId: 'punghoe' });
    await open(h);
    edit(h, '다른회사');
    expect(h.result.current.busy).toBe(false);
    await act(async () => {
        d.resolve({ terminal: true, outcome: { status: 'saved' } });
        await task;
    });
    expect(h.result.current.editForm?.note).toBe('다른회사');
});
it('실UID가 바뀌면 부모prop보다 먼저 원문과 오류를 숨긴다', async () => {
    const f = fixture();
    const h = renderHook(() => usePartnerEditor(f.options));
    await open(h);
    act(() => {
        mock.auth.currentUser = { uid: 'other' };
        mock.listener?.(mock.auth.currentUser);
    });
    expect(h.result.current.editForm).toBeNull();
    expect(h.result.current.isCurrentActor()).toBe(false);
    expect(h.result.current.failureRows).toEqual([]);
});
it('주소 응답은 같은 scope/target/draft 세대에서만 반영한다', async () => {
    let callback!: (d: {
        address: string;
    }) => void;
    window.daum = { Postcode: class {
            constructor(o: {
                oncomplete: typeof callback;
            }) {
                callback = o.oncomplete;
            }
            open() {
            }
        } } as typeof window.daum;
    const f = fixture();
    const h = renderHook(() => usePartnerEditor(f.options));
    await open(h);
    act(() => h.result.current.searchAddress());
    edit(h, '주소대기뒤수정');
    act(() => callback({ address: '이전주소' }));
    expect(h.result.current.editForm?.address).toBeUndefined();
});
it('삭제 확인 당시 guard는 새 편집 draft를 닫지 않는다', async () => {
    const f = fixture();
    const h = renderHook(() => usePartnerEditor(f.options));
    await open(h);
    const guard = h.result.current.captureDeleteGuard();
    act(() => h.result.current.closeEditing());
    await open(h);
    edit(h);
    act(() => guard('p'));
    expect(h.result.current.editForm?.note).toBe('새비고');
});
it('외부삭제 busy는 setter와 주소callback도 즉시 차단한다', async () => {
    const f = fixture();
    const h = renderHook((o: PartnerEditorOptions) => usePartnerEditor(o), { initialProps: f.options });
    await open(h);
    h.rerender({ ...f.options, externalBusy: true });
    edit(h);
    expect(h.result.current.editForm?.note).toBe('원비고');
    expect(h.result.current.isBusy()).toBe(true);
});
it('초기읽기와 open실패는 mutation을 만들지 않으며 명시재열기가 가능하다', async () => {
    const f = fixture();
    vi.mocked(f.ports.open).mockRejectedValueOnce(Error('원문 변경'));
    const h = renderHook(() => usePartnerEditor(f.options));
    await open(h);
    expect(h.result.current.inlineError).toBe('원문 변경');
    expect(f.ports.prepare).not.toHaveBeenCalled();
    await act(async () => {
        await h.result.current.openEditing(partner);
    });
    expect(h.result.current.inlineError).toBe('');
});
it('정상서버이력은 실패0/원문없는 조회는 현재새폼을 닫지 않는다', async () => {
    const f = fixture();
    const result: PartnerEditResult = { version: 1, reference: { companyId: 'taebaek', planId: 'past', targetId: 'p' }, actorUid: 'uid', status: 'applied', requestHash: 'b'.repeat(64), message: '과거수정' };
    vi.mocked(f.ports.history).mockResolvedValue({ version: 1, companyId: 'taebaek', actorUid: 'uid', entries: [{ result, createdAt: '2026-10-20' }], nextCursor: null });
    vi.mocked(f.ports.command).mockResolvedValue({ terminal: false, copyMismatch: true, result, outcome: { status: 'rejected', message: '과거수정', nextAction: '현재입력그대로' } });
    const h = renderHook(() => usePartnerEditor(f.options));
    await open(h);
    edit(h);
    expect(f.ports.history).not.toHaveBeenCalled();
    await act(async () => {
        await h.result.current.loadHistory();
    });
    expect(h.result.current.failureCount).toBe(0);
    const row = h.result.current.historyRows[0];
    expect(h.result.current.canDiscard(row.entry)).toBe(false);
    await act(async () => {
        await h.result.current.inspect(row.entry);
    });
    expect(h.result.current.editForm?.note).toBe('새비고');
    expect(h.result.current.recoveryError).toBe('');
});
it('빈페이지 cursor는 다음조회 유지하고 scope변경시 늦은history를 버린다', async () => {
    const f = fixture();
    vi.mocked(f.ports.history).mockResolvedValueOnce({ version: 1, companyId: 'taebaek', actorUid: 'uid', entries: [], nextCursor: 'a'.repeat(64) });
    const h = renderHook((o: PartnerEditorOptions) => usePartnerEditor(o), { initialProps: f.options });
    await ready(h);
    await act(async () => {
        await h.result.current.loadHistory();
    });
    expect(h.result.current.historyMore).toBe(true);
    await act(async () => {
        await h.result.current.nextHistory();
    });
    expect(f.ports.history).toHaveBeenLastCalledWith(expect.anything(), 'a'.repeat(64), expect.any(Function));
    const d = deferred<Awaited<ReturnType<PartnerEditBindings['history']>>>();
    vi.mocked(f.ports.history).mockReturnValueOnce(d.promise);
    let task!: Promise<void>;
    act(() => {
        task = h.result.current.loadHistory();
    });
    h.rerender({ ...f.options, companyId: 'punghoe' });
    await ready(h);
    expect(h.result.current.historyLoading).toBe(false);
    await act(async () => {
        d.resolve({ version: 1, companyId: 'taebaek', actorUid: 'uid', entries: [], nextCursor: 'b'.repeat(64) });
        await task;
    });
    expect(h.result.current.historyMore).toBe(false);
});
it('partial 사본정리 실패는 현재폼을 닫지 않고 잠금을 유지한다', async () => {
    const f = fixture();
    vi.mocked(f.ports.command).mockResolvedValue({ terminal: false, outcome: { status: 'partial', reason: 'followup-unconfirmed', committedIds: ['plan'], unconfirmedIds: [], message: '기기정리실패', nextAction: '다시보내지말기' } });
    const h = renderHook(() => usePartnerEditor(f.options));
    await open(h);
    edit(h);
    await act(async () => {
        await h.result.current.saveEditing();
    });
    expect(h.result.current.editForm?.note).toBe('새비고');
    expect(h.result.current.locked).toBe(true);
    expect(h.result.current.failureRows[0].nextAction).toBe('다시보내지말기');
});
it('확정거절은 현재폼을 보존하고 명시최신재열기 뒤에만 새수정한다', async () => {
    const f = fixture();
    vi.mocked(f.ports.command).mockImplementationOnce(async (_scope, row) => {
        f.entries.splice(0);
        return { terminal: true, outcome: { status: 'rejected', message: '다른기기에서변경', nextAction: '최신자료재열기' } };
    });
    const h = renderHook(() => usePartnerEditor(f.options));
    await open(h);
    edit(h);
    await act(async () => {
        await h.result.current.saveEditing();
    });
    expect(h.result.current.editForm?.note).toBe('새비고');
    expect(h.result.current.canReopenCurrent).toBe(true);
    await act(async () => {
        await h.result.current.reopenCurrent();
    });
    expect(h.result.current.editForm?.note).toBe('원비고');
    expect(h.result.current.locked).toBe(false);
    expect(f.ports.open).toHaveBeenCalledTimes(2);
});
it('원문무변경 저장은 서버 apply나 가짜 saved ACK를 만들지 않는다', async () => {
    const f = fixture();
    const h = renderHook(() => usePartnerEditor(f.options));
    await open(h);
    await act(async () => {
        await h.result.current.saveEditing();
    });
    expect(f.ports.prepare).not.toHaveBeenCalled();
    expect(f.ports.command).not.toHaveBeenCalled();
    expect(h.result.current.inlineMessage).toBe('변경한 내용이 없습니다.');
});
it('주소 완료는 기존 address 값 그대로 저장하고 최초선택 raw를 덮지 않는다', async () => {
    let callback!: (d: {
        address: string;
    }) => void;
    window.daum = { Postcode: class {
            constructor(o: {
                oncomplete: typeof callback;
            }) {
                callback = o.oncomplete;
            }
            open() {
            }
        } } as typeof window.daum;
    const f = fixture();
    const h = renderHook(() => usePartnerEditor(f.options));
    await open(h);
    act(() => h.result.current.searchAddress());
    act(() => callback({ address: '완료주소' }));
    expect(h.result.current.editForm?.address).toBe('완료주소');
    expect(h.result.current.openingPartner?.address).toBeUndefined();
});
it('동일tick open 중복은 최초 native capture를 취소하거나 busy를 고정하지 않는다', async () => {
    const f = fixture(), d = deferred<Awaited<ReturnType<PartnerEditBindings['open']>>>();
    vi.mocked(f.ports.open).mockReturnValueOnce(d.promise);
    const h = renderHook(() => usePartnerEditor(f.options));
    await ready(h);
    let task!: Promise<void>;
    act(() => {
        task = h.result.current.openEditing(partner);
        void h.result.current.openEditing({ ...partner, id: 'other' });
    });
    expect(f.ports.open).toHaveBeenCalledTimes(1);
    const call = vi.mocked(f.ports.open).mock.calls[0];
    await act(async () => {
        d.resolve({ reference: call[1], opening: call[2], actorUid: 'uid', expectedVersion: '1:000000000' });
        await task;
    });
    expect(h.result.current.busy).toBe(false);
    expect(h.result.current.editForm?.id).toBe('p');
});
it('초기읽기 실패와 미완료요청은 무관 거래처 편집을 영구 차단하지 않는다', async () => {
    const f = fixture();
    vi.mocked(f.ports.read).mockRejectedValueOnce(Error('읽기 실패'));
    const h = renderHook(() => usePartnerEditor(f.options));
    await ready(h);
    await act(async () => {
        await h.result.current.openEditing(partner);
    });
    expect(f.ports.open).not.toHaveBeenCalled();
    await act(async () => {
        await h.result.current.refresh();
    });
    await open(h);
    expect(h.result.current.editForm?.id).toBe('p');
});
it('사본정리 포트 예외는 unhandled 없이 해당행 원인과 다음조치로 남긴다', async () => {
    const f = fixture();
    const scope = { companyId: 'taebaek' as const, actorUid: 'uid' };
    const row = await f.ports.prepare(scope, { version: 1, reference: { companyId: 'taebaek', planId: 'old', targetId: 'old' }, expectedVersion: '1:000000000', patch: { note: '과거' } });
    vi.mocked(f.ports.discard).mockRejectedValue(Error('사본교체'));
    const h = renderHook(() => usePartnerEditor(f.options));
    await ready(h);
    await act(async () => {
        await h.result.current.discardCopy(row);
    });
    expect(h.result.current.failureRows[0].cause).toBe('사본교체');
    expect(h.result.current.failureRows[0].nextAction).toContain('다시 확인');
    expect(f.entries).toContain(row);
    expect(h.result.current.busy).toBe(false);
});
it('옛UID의 사본정리 예외는 새 계정의 안내나 busy를 변경하지 않는다', async () => {
    const f = fixture(), d = deferred<Awaited<ReturnType<PartnerEditBindings['discard']>>>();
    vi.mocked(f.ports.discard).mockReturnValueOnce(d.promise);
    const row = await f.ports.prepare({ companyId: 'taebaek', actorUid: 'uid' }, { version: 1, reference: { companyId: 'taebaek', planId: 'old', targetId: 'old' }, expectedVersion: '1:000000000', patch: { note: '과거' } });
    const h = renderHook((o: PartnerEditorOptions) => usePartnerEditor(o), { initialProps: f.options });
    await ready(h);
    let task!: Promise<void>;
    act(() => {
        task = h.result.current.discardCopy(row);
    });
    act(() => {
        mock.auth.currentUser = { uid: 'new' };
        mock.listener?.(mock.auth.currentUser);
    });
    h.rerender({ ...f.options, actorUid: 'new' });
    await ready(h);
    await act(async () => {
        d.resolve({ status: 'blocked', message: '옛계정정리실패' });
        await task;
    });
    expect(h.result.current.recoveryError).toBe('');
    expect(h.result.current.recoveryMessage).toBe('');
    expect(h.result.current.busy).toBe(false);
});
it('최초 상호501자도 비고수정을 막지 않고 표시메타만500자로 줄인다', async () => {
    const f = fixture();
    const long = { ...partner, name: '가'.repeat(501) };
    const h = renderHook(() => usePartnerEditor({ ...f.options, partners: [long] }));
    await ready(h);
    await act(async () => {
        await h.result.current.openEditing(long);
    });
    edit(h);
    await act(async () => {
        await h.result.current.saveEditing();
    });
    expect(f.ports.prepare).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ patch: { note: '새비고' } }), expect.any(Function), '가'.repeat(500));
    expect(f.ports.command).toHaveBeenCalledTimes(1);
});
