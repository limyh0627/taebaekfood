/** @vitest-environment jsdom */
import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
    auth: {
        currentUser: {
            uid: 'uid'
        }
    }, listener: null as null | ((user: {
        uid: string;
    }) => void)
}));
vi.mock('../../../shared/firebase', () => ({
    auth: mocks.auth, authReady: Promise.resolve()
}));
vi.mock('firebase/auth', () => ({
    onAuthStateChanged: (_auth: unknown, listener: (user: {
        uid: string;
    }) => void) => { mocks.listener = listener; return () => { }; }
}));
vi.mock('../../../shared/services/orderCopyService', () => ({
    orderCopyRecoveryServices: {}, orderCopyRecoveryKey: (scope: {
        companyId: string;
        actorUid: string;
    }, id: string) => `order-copy-v1:${scope.companyId}:${scope.actorUid}:${id}`
}));
import { useOrderCopyRecovery } from './useOrderCopyRecovery';
import type { Order } from '../../../shared/types';
import type { orderCopyRecoveryServices, OrderCopyRecoveryEntry, OrderCopyRecoveryObservation } from '../../../shared/services/orderCopyService';
const ref = {
    companyId: 'taebaek' as const, requestId: 'past'
};
const entry: OrderCopyRecoveryEntry = {
    key: 'order-copy-v1:taebaek:uid:past', bodyText: '원문', referenceText: '참조', reference: ref, request: null, requestHash: 'a'.repeat(64), referenceHash: 'a'.repeat(64), orderId: 'old-order', status: 'corrupt', description: '과거 주문'
};
function observed(status: 'applied' | 'unknown' | 'rejected' = 'applied'): OrderCopyRecoveryObservation {
    return {
        terminal: false, copyMismatch: true, result: {
            version: 1, reference: ref, actorUid: 'uid', status, requestHash: 'a'.repeat(64), message: '실제 과거 결과', ...(status === 'applied' ? {
                orderId: 'old-order'
            } : {})
        }, outcome: {
            status: 'rejected', message: '사본은 보존했습니다.', nextAction: '명시 정리'
        }
    };
}
function ports() {
    return {
        read: vi.fn().mockResolvedValue([]), send: vi.fn(), reconnect: vi.fn().mockResolvedValue(observed()), resolve: vi.fn().mockResolvedValue(observed()), retry: vi.fn(), discard: vi.fn().mockResolvedValue({
            status: 'cleared', message: '기기 사본만 정리'
        }), list: vi.fn().mockResolvedValue({
            version: 1, companyId: 'taebaek', actorUid: 'uid', entries: [], nextCursor: null
        })
    } satisfies typeof orderCopyRecoveryServices;
}
async function ready(service = ports(), onCommitted = vi.fn()) {
    const hook = renderHook(() => useOrderCopyRecovery({
        companyId: 'taebaek', orders: [], onCommitted
    }, service));
    await waitFor(() => expect(hook.result.current.readLoading).toBe(false));
    return {
        ...hook, service, onCommitted
    };
}
beforeEach(() => { mocks.auth.currentUser.uid = 'uid'; });
afterEach(cleanup);
it('초기 signature 통지 없이 송신 뒤 첫 실입력 변경도 지연 ACK의 창종결을 막는다', async () => { const hook = await ready(); let finish!: (value: OrderCopyRecoveryObservation) => void; hook.service.send.mockImplementation(() => new Promise(resolve => { finish = resolve; })); act(() => hook.result.current.openDraft(evidence.sourceText)); let task!: Promise<void>; act(() => { task = hook.result.current.save(draft, evidence); }); const request = hook.service.send.mock.calls[0][0]; act(() => hook.result.current.updateDraftSignature('첫 품목·날짜 변경')); const observation: OrderCopyRecoveryObservation = {
    terminal: true, outcome: {
        status: 'saved'
    }, result: {
        version: 1, reference: {
            companyId: 'taebaek', requestId: request.requestId
        }, actorUid: 'uid', status: 'applied', requestHash: 'a'.repeat(64), message: '완료', orderId: String(request.confirmed.orderDraft.id)
    }
}; await act(async () => { finish(observation); await task; }); expect(hook.result.current.draftOpen).toBe(true); expect(hook.onCommitted).toHaveBeenCalledWith(request.confirmed.orderDraft.id, false); hook.service.reconnect.mockResolvedValue(observation); await act(async () => hook.result.current.save(draft, evidence)); expect(hook.result.current.draftOpen).toBe(false); expect(hook.service.send).toHaveBeenCalledTimes(1); expect(hook.service.reconnect).toHaveBeenCalledTimes(1); });
it('재열기한 동일 전체입력은 생성 lineId와 무관하게 새 요청0·같은 채팅 원문을 보존한다', async () => {
    const service = ports(), entries: OrderCopyRecoveryEntry[] = [];
    service.read.mockImplementation(async () => entries);
    service.send.mockImplementation(async (request) => {
        entries.push({
            ...entry, key: 'same-key', reference: {
                companyId: 'taebaek', requestId: request.requestId
            }, request, bodyText: JSON.stringify(request), referenceText: '참조', status: 'valid'
        });
        return {
            terminal: false, outcome: {
                status: 'unknown', message: '미확인', nextAction: '조회'
            }
        };
    });
    const hook = await ready(service), value = {
        ...draft, items: [{
                itemId: 'oil', name: '기름', quantity: 1, price: 100
            }]
    };
    act(() => hook.result.current.openDraft(evidence.sourceText, 'chat-first'));
    await act(async () => hook.result.current.save(value, evidence));
    act(() => { hook.result.current.closeDraft(); hook.result.current.openDraft(evidence.sourceText, 'chat-first'); });
    await act(async () => hook.result.current.save(value, evidence));
    expect(service.send).toHaveBeenCalledTimes(1);
    expect(hook.result.current.selectedEntry).toBe(entries[0]);
});
it('source callback이 매 render 바뀌어도 같은 문자열 effect는 no-op으로 수렴한다', async () => {
    const service = ports();
    let renders = 0;
    const hook = renderHook(() => {
        renders++;
        const result = useOrderCopyRecovery({
            companyId: 'taebaek', orders: []
        }, service);
        useEffect(() => result.updateSourceText('같은 원문'), [result.updateSourceText]);
        return result;
    });
    await waitFor(() => expect(hook.result.current.readLoading).toBe(false));
    expect(hook.result.current.sourceText).toBe('같은 원문');
    expect(renders).toBeLessThan(10);
    const before = renders;
    act(() => { hook.result.current.updateSourceText('같은 원문'); hook.result.current.updateDraftSignature('전체'); hook.result.current.updateDraftSignature('전체'); });
    expect(renders).toBe(before);
});
it.each(['품목·단가', '배송 날짜'])('송신 중 %s 전체입력 변경은 source동일이어도 옛 ACK로 닫지 않는다', async (field) => {
    const hook = await ready();
    let finish!: (value: OrderCopyRecoveryObservation) => void;
    hook.service.send.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    act(() => { hook.result.current.openDraft(evidence.sourceText); hook.result.current.updateDraftSignature('전체 입력 A'); });
    let task!: Promise<void>;
    act(() => { task = hook.result.current.save(draft, evidence); });
    const request = hook.service.send.mock.calls[0][0];
    act(() => hook.result.current.updateDraftSignature('변경된 ' + field));
    await act(async () => {
        finish({
            terminal: true, outcome: {
                status: 'saved'
            }, result: {
                version: 1, reference: {
                    companyId: 'taebaek', requestId: request.requestId
                }, actorUid: 'uid', status: 'applied', requestHash: 'a'.repeat(64), message: '완료', orderId: String(request.confirmed.orderDraft.id)
            }
        });
        await task;
    });
    expect(hook.result.current.draftOpen).toBe(true);
    expect(hook.onCommitted).toHaveBeenCalledWith(request.confirmed.orderDraft.id, false);
});
it('전체입력 signature 초기등록과 같은내용 반복은 현재 ACK의 소유세대를 무효화하지 않는다', async () => {
    const hook = await ready();
    hook.service.send.mockImplementation(async (request) => ({
        terminal: true, outcome: {
            status: 'saved'
        }, result: {
            version: 1, reference: {
                companyId: 'taebaek', requestId: request.requestId
            }, actorUid: 'uid', status: 'applied', requestHash: 'a'.repeat(64), message: '완료', orderId: String(request.confirmed.orderDraft.id)
        }
    }));
    act(() => { hook.result.current.openDraft(evidence.sourceText); hook.result.current.updateDraftSignature('같은 전체 입력'); hook.result.current.updateDraftSignature('같은 전체 입력'); });
    await act(async () => hook.result.current.save(draft, evidence));
    expect(hook.result.current.draftOpen).toBe(false);
});
it('명시 재연결 대기 중 품목입력이 바뀌면 현재창 종결을 취소한다', async () => { const hook = await oldDraft(); let finish!: (value: OrderCopyRecoveryObservation) => void; hook.service.reconnect.mockImplementation(() => new Promise(resolve => { finish = resolve; })); act(() => hook.result.current.updateDraftSignature('전체 입력 A')); let task!: Promise<void>; act(() => { task = hook.result.current.save(draft, evidence); }); act(() => hook.result.current.updateDraftSignature('품목 B')); await act(async () => { finish(hook.observation); await task; }); expect(hook.result.current.draftOpen).toBe(true); expect(hook.onCommitted).toHaveBeenCalledTimes(1); });
const draft: Omit<Order, 'id' | 'status'> = {
    partnerId: 'partner', partnerName: '거래처', createdAt: '2026-10-14T00:00:00Z', deliveryDate: '2026-10-15T00:00:00Z', items: [], totalAmount: 0, email: '', source: '일반', shipMethod: '배송', region: '미지정', pallets: []
};
const evidence = {
    sourceText: '최초 원문', firstAnalysis: {
        kind: 'rules'
    }, inputLines: []
};
async function oldDraft() {
    const hook = await ready();
    let finish!: (value: OrderCopyRecoveryObservation) => void;
    hook.service.send.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    act(() => hook.result.current.openDraft(evidence.sourceText));
    let task!: Promise<void>;
    act(() => { task = hook.result.current.save(draft, evidence); });
    const request = hook.service.send.mock.calls[0][0];
    act(() => { hook.result.current.updateSourceText('B'); hook.result.current.updateSourceText(evidence.sourceText); });
    const result: OrderCopyRecoveryObservation = {
        terminal: true, outcome: {
            status: 'saved'
        }, result: {
            version: 1, reference: {
                companyId: 'taebaek', requestId: request.requestId
            }, actorUid: 'uid', status: 'applied', requestHash: 'a'.repeat(64), message: '완료', orderId: String(request.confirmed.orderDraft.id)
        }
    };
    await act(async () => { finish(result); await task; });
    return {
        ...hook, request, observation: result
    };
}
it('A→B→A 뒤 동일 전체입력 명시 저장은 기존 ref readonly 재연결만으로 종결한다', async () => { const hook = await oldDraft(); hook.service.reconnect.mockResolvedValue(hook.observation); await act(async () => hook.result.current.save(draft, evidence)); expect(hook.service.send).toHaveBeenCalledTimes(1); expect(hook.service.reconnect).toHaveBeenCalledWith(hook.request, expect.any(Function)); expect(hook.result.current.draftOpen).toBe(false); expect(hook.onCommitted).toHaveBeenLastCalledWith(hook.request.confirmed.orderDraft.id, true); });
it('전체본문이 다른 명시 새 작성은 기존 ref 재연결 없이 새 요청으로 보낸다', async () => {
    const hook = await oldDraft();
    hook.service.send.mockResolvedValue({
        terminal: false, outcome: {
            status: 'unknown', message: '새 요청 미확인', nextAction: '조회'
        }
    });
    await act(async () => hook.result.current.save({
        ...draft, note: '새 값'
    }, evidence));
    expect(hook.service.send).toHaveBeenCalledTimes(2);
    expect(hook.service.send.mock.calls[1][0].requestId).not.toBe(hook.request.requestId);
    expect(hook.service.reconnect).not.toHaveBeenCalled();
    expect(hook.result.current.draftOpen).toBe(true);
});
it('같은 source의 품목·날짜 다른 B는 A 영속 원문을 남기고 별도 ID로 저장한다', async () => {
    const service = ports(), entries: OrderCopyRecoveryEntry[] = [];
    service.read.mockImplementation(async () => entries);
    service.send.mockImplementation(async (request) => {
        entries.push({
            ...entry, key: 'key-' + request.requestId, reference: {
                companyId: 'taebaek', requestId: request.requestId
            }, request, bodyText: JSON.stringify(request), referenceText: 'ref-' + request.requestId, orderId: String(request.confirmed.orderDraft.id), status: 'valid'
        });
        return {
            terminal: false, outcome: {
                status: 'unknown', message: '응답 미확인', nextAction: '조회'
            }
        };
    });
    const hook = await ready(service);
    act(() => hook.result.current.openDraft(evidence.sourceText));
    await act(async () => hook.result.current.save(draft, evidence));
    const original = entries[0], raw = original.bodyText;
    act(() => hook.result.current.updateDraftSignature('전체 A'));
    act(() => hook.result.current.updateDraftSignature('전체 B'));
    await act(async () => hook.result.current.save({
        ...draft, deliveryDate: '2026-11-01', items: [{
                itemId: 'oil', name: '기름', quantity: 1, price: 100
            }]
    }, evidence));
    expect(service.send).toHaveBeenCalledTimes(2);
    expect(entries[0].bodyText).toBe(raw);
    expect(entries[1].reference?.requestId).not.toBe(original.reference?.requestId);
    expect(entries).toHaveLength(2);
    service.resolve.mockResolvedValue({
        ...observed(), terminal: true, outcome: {
            status: 'saved'
        }, result: {
            ...observed().result!, reference: original.reference!, orderId: original.orderId!
        }
    });
    await act(async () => hook.result.current.inspect(original));
    expect(hook.result.current.draftOpen).toBe(true);
    expect(hook.onCommitted).toHaveBeenLastCalledWith(original.orderId, false);
});
it('재연결 조회 중 A→B→A 변경도 새 클릭 token을 무효화한다', async () => { const hook = await oldDraft(); let finish!: (value: OrderCopyRecoveryObservation) => void; hook.service.reconnect.mockImplementation(() => new Promise(resolve => { finish = resolve; })); let task!: Promise<void>; act(() => { task = hook.result.current.save(draft, evidence); }); act(() => { hook.result.current.updateSourceText('B'); hook.result.current.updateSourceText(evidence.sourceText); }); await act(async () => { finish(hook.observation); await task; }); expect(hook.result.current.draftOpen).toBe(true); expect(hook.onCommitted).toHaveBeenCalledTimes(1); expect(hook.service.send).toHaveBeenCalledTimes(1); });
it('재연결 partial은 현재창을 보존하고 다음 명시 저장도 readonly만 재확인한다', async () => {
    const hook = await oldDraft();
    hook.service.reconnect.mockResolvedValue({
        ...hook.observation, terminal: false, outcome: {
            status: 'partial', reason: 'followup-unconfirmed', committedIds: ['request'], unconfirmedIds: [], message: '정리 실패', nextAction: '다시 확인'
        }
    });
    await act(async () => hook.result.current.save(draft, evidence));
    await act(async () => hook.result.current.save(draft, evidence));
    expect(hook.result.current.draftOpen).toBe(true);
    expect(hook.service.send).toHaveBeenCalledTimes(1);
    expect(hook.service.reconnect).toHaveBeenCalledTimes(2);
    expect(hook.result.current.notice).toContain('정리 실패');
});
it('현재 작성의 정확 ACK만 창을 닫고 최초 고정 주문 ID를 사용한다', async () => {
    const hook = await ready();
    hook.service.send.mockImplementation(async (request) => ({
        terminal: true, outcome: {
            status: 'saved'
        }, result: {
            version: 1, reference: {
                companyId: request.companyId, requestId: request.requestId
            }, actorUid: 'uid', status: 'applied', requestHash: 'a'.repeat(64), message: '완료', orderId: String(request.confirmed.orderDraft.id)
        }
    }));
    act(() => hook.result.current.openDraft(evidence.sourceText));
    await act(async () => hook.result.current.save(draft, evidence));
    expect(hook.result.current.draftOpen).toBe(false);
    const sent = hook.service.send.mock.calls[0][0];
    expect(sent.confirmed.orderDraft.id).toBe(`ORD-COPY-${sent.requestId}`);
    expect(hook.onCommitted).toHaveBeenCalledWith(sent.confirmed.orderDraft.id, true);
});
it('현재 송신 뒤 source A→B→A 변경은 이전 ACK로 창을 닫지 않는다', async () => {
    const hook = await ready();
    let finish!: (value: OrderCopyRecoveryObservation) => void;
    hook.service.send.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    act(() => hook.result.current.openDraft(evidence.sourceText));
    let task!: Promise<void>;
    act(() => { task = hook.result.current.save(draft, evidence); });
    const sent = hook.service.send.mock.calls[0][0];
    act(() => { hook.result.current.updateSourceText('다른 원문'); hook.result.current.updateSourceText(evidence.sourceText); });
    await act(async () => {
        finish({
            terminal: true, outcome: {
                status: 'saved'
            }, result: {
                version: 1, reference: {
                    companyId: 'taebaek', requestId: sent.requestId
                }, actorUid: 'uid', status: 'applied', requestHash: 'a'.repeat(64), message: '완료', orderId: String(sent.confirmed.orderDraft.id)
            }
        });
        await task;
    });
    expect(hook.result.current.draftOpen).toBe(true);
    expect(hook.onCommitted).toHaveBeenCalledWith(sent.confirmed.orderDraft.id, false);
});
it('로컬 정리된 거절 원문은 실패 가짜 집계 없이 명시 다시 작성할 수 있다', async () => {
    const hook = await ready();
    hook.service.send.mockImplementation(async (request) => ({
        terminal: true, outcome: {
            status: 'rejected', message: '거절', nextAction: '다시 작성'
        }, result: {
            version: 1, reference: {
                companyId: 'taebaek', requestId: request.requestId
            }, actorUid: 'uid', status: 'rejected', requestHash: 'a'.repeat(64), message: '거절'
        }
    }));
    act(() => hook.result.current.openDraft(evidence.sourceText));
    await act(async () => hook.result.current.save(draft, evidence));
    expect(hook.result.current.failureCount).toBe(0);
    const row = hook.result.current.historyRows[0];
    expect(hook.result.current.canRewrite(row.entry)).toBe(true);
    act(() => hook.result.current.rewrite(row.entry));
    expect(hook.result.current.initialText).toBe(evidence.sourceText);
    expect(hook.result.current.saveBlocked).toBe(false);
});
it('초기 보관 조회 전 저장을 잠그고 서버 전체 이력을 자동 조회하지 않는다', async () => {
    let finish!: (rows: [
    ]) => void;
    const service = ports();
    service.read.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const hook = renderHook(() => useOrderCopyRecovery({
        companyId: 'taebaek', orders: []
    }, service));
    expect(hook.result.current.saveBlocked).toBe(true);
    await waitFor(() => expect(service.read).toHaveBeenCalled());
    expect(service.list).not.toHaveBeenCalled();
    await act(async () => finish([]));
    expect(hook.result.current.saveBlocked).toBe(false);
});
it('보관 조회 실패는 신규 저장을 막고 명시 새로 읽기로 복구한다', async () => { const service = ports(); service.read.mockRejectedValueOnce(Error('기기 읽기 실패')); const hook = await ready(service); expect(hook.result.current.saveBlocked).toBe(true); expect(hook.result.current.readError).toContain('기기 읽기 실패'); await act(async () => hook.result.current.refresh()); expect(hook.result.current.saveBlocked).toBe(false); });
it('과거 성공 조회는 현재 원문 창을 닫거나 입력을 지우지 않는다', async () => { const hook = await ready(); act(() => hook.result.current.openDraft('새 주문')); await act(async () => hook.result.current.inspect(entry)); expect(hook.result.current.draftOpen).toBe(true); expect(hook.result.current.sourceText).toBe('새 주문'); expect(hook.onCommitted).toHaveBeenCalledWith('old-order', false); expect(hook.service.send).not.toHaveBeenCalled(); });
it('기기 사본 정리는 관측 객체를 그대로 보내며 업무 완료 callback을 부르지 않는다', async () => { const hook = await ready(); act(() => hook.result.current.openDraft('새 입력')); await act(async () => hook.result.current.discardCopy(entry)); expect(hook.service.discard.mock.calls[0][1]).toBe(entry); expect(hook.onCommitted).not.toHaveBeenCalled(); expect(hook.result.current.sourceText).toBe('새 입력'); expect(hook.result.current.draftOpen).toBe(true); });
it('명시 이력의 실제 완료는 실패0이며 중단과 없는 사본 정리를 제안하지 않는다', async () => {
    const service = ports();
    service.list.mockResolvedValue({
        ...await service.list(), entries: [observed().result!]
    });
    const hook = await ready(service);
    await act(async () => hook.result.current.loadHistory());
    expect(hook.result.current.failureCount).toBe(0);
    const row = hook.result.current.historyRows[0];
    expect(row.currentState).toBe('주문 저장 완료');
    expect(hook.result.current.canStop(row.entry)).toBe(false);
    expect(hook.result.current.canDiscard(row.entry)).toBe(false);
    expect(row.nextAction).toContain('새 업무');
});
it('빈 페이지의 cursor를 유지하고 다음 페이지를 명시 조회한다', async () => {
    const service = ports();
    service.list.mockResolvedValue({
        ...await service.list(), nextCursor: 'opaque'
    });
    const hook = await ready(service);
    await act(async () => hook.result.current.loadHistory());
    expect(hook.result.current.historyMore).toBe('opaque');
    await act(async () => hook.result.current.nextHistory());
    expect(service.list.mock.calls.at(-1)?.[1]).toBe('opaque');
});
it('이전 회사 render의 함수는 새 회사 작업을 시작하지 않는다', async () => {
    const service = ports();
    const hook = renderHook(({ companyId }: {
        companyId: 'taebaek' | 'punghoe';
    }) => useOrderCopyRecovery({
        companyId, orders: []
    }, service), {
        initialProps: {
            companyId: 'taebaek'
        }
    });
    await waitFor(() => expect(hook.result.current.readLoading).toBe(false));
    const old = hook.result.current.inspect;
    hook.rerender({
        companyId: 'punghoe'
    });
    await act(async () => old(entry));
    expect(service.resolve).not.toHaveBeenCalled();
});
it('UID 전환 뒤 늦은 결과는 새 작성창과 callback에 반영하지 않는다', async () => {
    const service = ports();
    let finish!: (value: OrderCopyRecoveryObservation) => void;
    service.resolve.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const hook = await ready(service);
    let task!: Promise<void>;
    act(() => { task = hook.result.current.inspect(entry); });
    act(() => {
        mocks.auth.currentUser.uid = 'other';
        mocks.listener?.({
            uid: 'other'
        });
    });
    await waitFor(() => expect(hook.result.current.readLoading).toBe(false));
    act(() => hook.result.current.openDraft('다른 계정 입력'));
    await act(async () => { finish(observed()); await task; });
    expect(hook.onCommitted).not.toHaveBeenCalled();
    expect(hook.result.current.sourceText).toBe('다른 계정 입력');
    expect(hook.result.current.busy).toBe(false);
});
it('중복 클릭은 같은 tick에 조회를 한 번만 시작한다', async () => { const hook = await ready(); await act(async () => { await Promise.all([hook.result.current.inspect(entry), hook.result.current.inspect(entry)]); }); expect(hook.service.resolve).toHaveBeenCalledTimes(1); });
