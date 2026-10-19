/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
    auth: {
        currentUser: {
            uid: 'uid'
        }
    }, confirm: vi.fn(), prompt: vi.fn(), subscription: null as null | ((value: string[]) => void)
}));
vi.mock('../../../shared/firebase', () => ({
    auth: mocks.auth, authReady: Promise.resolve(), functions: {}
}));
vi.mock('../../../shared/components/appDialog', () => ({
    appConfirm: mocks.confirm, appPrompt: mocks.prompt
}));
vi.mock('../../../shared/services/firebaseService', () => ({
    subscribeToDocument: (_collection: string, _id: string, callback: (value: {
        names: string[];
    } | null) => void) => {
        return () => {
        };
    }
}));
import { useWorkOrderEditor, type WorkItem } from './useWorkOrderEditor';
import { encodeCatalogValue, type WorkOrderOpening, type WorkOrderRequest, type WorkOrderReference } from '../../../shared/workOrderCommand';
import { reportWorkOrderNotice, type WorkOrderBindings, type WorkOrderEntry, type WorkOrderObservation } from '../../../shared/services/workOrderWrites';
import { OrderStatus, type Order, type Item, type Partner } from '../../../shared/types';
const products = [{
        id: 'oil', name: '기름', category: '기름', type: 'product', stock: 10
    }, {
        id: 'sesame', name: '깨', category: '깨', type: 'product', stock: 1
    }, {
        id: 'goods', name: '상품', category: '기름', type: 'goods', stock: 10
    }] as Item[];
const order: Order = {
    id: 'order', status: OrderStatus.PENDING, partnerId: 'partner', partnerName: '거래처', createdAt: '2026-10-01', deliveryDate: '2026-10-20', items: [{
            lineId: 'line-oil', itemId: 'oil', name: '기름', quantity: 2, price: 100
        }, {
            lineId: 'line-sesame', itemId: 'sesame', name: '깨', quantity: 3, price: 100
        }, {
            lineId: 'line-goods', itemId: 'goods', name: '상품', quantity: 1, price: 100
        }], totalAmount: 600, email: '', source: '일반', shipMethod: '배송', region: '미지정', pallets: []
};
const saved: WorkItem[] = [{
        id: 'saved-oil', sortIndex: 0, key: 'order-oil', orderId: 'order', itemId: 'oil', lineKey: 'oil', itemName: '저장 당시 이름', partnerName: '저장 거래처', qty: 99, category: '기름'
    }, {
        id: 'saved-sesame', sortIndex: 1, key: 'order-sesame', orderId: 'order', itemId: 'sesame', lineKey: 'sesame', itemName: '깨', partnerName: '거래처', qty: 3, category: '깨'
    }];
function opening(reference: WorkOrderReference): WorkOrderOpening {
    return {
        reference, actorUid: 'uid', items: saved.map(row => ({
            id: row.id!, version: '1:000000000', data: encodeCatalogValue({
                ...row, companyId: reference.companyId
            })
        })), groups: {
            exists: true, version: '2:000000000', data: encodeCatalogValue({
                companyId: reference.companyId, names: ['기름', '깨', '미분류']
            })
        }, reset: {
            exists: false, version: null, data: null
        }
    };
}
function fixture() {
    const entries: WorkOrderEntry[] = [];
    const bindings: WorkOrderBindings = {
        subscribeGroups: vi.fn((_scope, onNames) => {
            mocks.subscription = onNames;
            onNames(['기름', '깨', '미분류']);
            return () => {
            };
        }), open: vi.fn(async (_scope, ref) => opening(ref)), read: vi.fn(async () => entries), prepare: vi.fn(async (_scope, request) => {
            const entry: WorkOrderEntry = {
                key: 'key-' + request.reference.planId, reference: request.reference, request, requestHash: 'a'.repeat(64), referenceHash: 'a'.repeat(64), observedLocalText: JSON.stringify(request), observedReferenceText: '참조', status: 'valid', description: '작업순서'
            };
            entries.push(entry);
            return entry;
        }), command: vi.fn(async (): Promise<WorkOrderObservation> => ({
            terminal: false, outcome: {
                status: 'unknown', message: '응답 미확인', nextAction: '조회'
            }
        })), discard: vi.fn(async (): ReturnType<WorkOrderBindings['discard']> => ({
            status: 'cleared', message: '기기 사본만 정리'
        })), history: vi.fn(async (scope) => ({
            version: 1, ...scope, entries: [], nextCursor: null
        }))
    };
    const props = {
        companyId: 'taebaek' as const, actorUid: 'uid', enabled: true, workOrderItems: saved, items: products, partners: [] as Partner[], orders: [order], pickableOrders: [order], bindings
    };
    return {
        bindings, entries, props
    };
}
async function ready() {
    const f = fixture(), view = renderHook(() => useWorkOrderEditor(f.props));
    await waitFor(() => expect(view.result.current.openingBusy).toBe(false));
    await waitFor(() => expect(view.result.current.workItems).toHaveLength(2));
    return {
        ...f, view
    };
}
const terminal = (entry: WorkOrderEntry, status: 'applied' | 'rejected' = 'applied'): WorkOrderObservation => ({
    terminal: true, result: {
        version: 1, reference: entry.reference!, actorUid: 'uid', status, requestHash: entry.requestHash, message: '확인한 결과'
    }, outcome: status === 'applied' ? {
        status: 'saved'
    } : {
        status: 'rejected', message: '원본이 바뀌었습니다.', nextAction: '현재 원본 확인'
    }
});
beforeEach(() => {
    mocks.auth.currentUser.uid = 'uid';
    reportWorkOrderNotice({
        companyId: 'taebaek', actorUid: 'uid'
    }, '');
    vi.clearAllMocks();
    mocks.confirm.mockResolvedValue(true);
    mocks.prompt.mockResolvedValue('새 이름');
});
afterEach(cleanup);
it('초기 원본 읽기 중 초기화 재확인과 참조 작업은 공용 동기 진입 잠금으로 송신0', async () => {
    const f = fixture();
    let finish!: (value: WorkOrderOpening) => void;
    vi.mocked(f.bindings.open).mockImplementationOnce(() => new Promise(resolve => {
        finish = resolve;
    }));
    const view = renderHook(() => useWorkOrderEditor(f.props));
    await waitFor(() => expect(f.bindings.open).toHaveBeenCalledTimes(1));
    act(() => reportWorkOrderNotice({
        companyId: 'taebaek', actorUid: 'uid'
    }, '원본 재확인 필요'));
    await waitFor(() => expect(view.result.current.error).toContain('원본 재확인 필요'));
    expect(view.result.current.canRetryReset).toBe(false);
    const row: WorkOrderEntry = {
        key: 'old', reference: {
            companyId: 'taebaek', planId: 'old'
        }, request: null, requestHash: null, referenceHash: null, observedLocalText: '원문', observedReferenceText: '참조', status: 'corrupt', description: '이전 요청'
    };
    await act(async () => {
        await view.result.current.retryResetDaily();
        await view.result.current.inspect(row);
    });
    expect(f.bindings.open).toHaveBeenCalledTimes(1);
    expect(f.bindings.prepare).not.toHaveBeenCalled();
    expect(f.bindings.command).not.toHaveBeenCalled();
    const reference = vi.mocked(f.bindings.open).mock.calls[0][1];
    await act(async () => finish(opening(reference)));
    expect(view.result.current.openingBusy).toBe(false);
    expect(view.result.current.canRetryReset).toBe(true);
});
it('같은 tick의 picker 중복 열기는 첫 capture token과 잠금을 보존한다', async () => {
    const f = await ready();
    let finish!: (value: WorkOrderOpening) => void;
    vi.mocked(f.bindings.open).mockImplementationOnce(() => new Promise(resolve => {
        finish = resolve;
    }));
    let first!: Promise<boolean>, second!: Promise<boolean>;
    act(() => {
        first = f.view.result.current.openPicker();
        second = f.view.result.current.openPicker();
    });
    const reference = vi.mocked(f.bindings.open).mock.calls.at(-1)![1];
    await act(async () => {
        finish(opening(reference));
        expect(await first).toBe(true);
        expect(await second).toBe(false);
    });
    expect(f.view.result.current.openingBusy).toBe(false);
    expect(f.view.result.current.showWorkOrderPicker).toBe(true);
});
it('초기 capture 중 열기는 원본 token을 바꾸지 않고 완료 뒤 다시 열 수 있다', async () => {
    const f = fixture();
    let finish!: (value: WorkOrderOpening) => void;
    vi.mocked(f.bindings.open).mockImplementationOnce(() => new Promise(resolve => {
        finish = resolve;
    }));
    const view = renderHook(() => useWorkOrderEditor(f.props));
    await waitFor(() => expect(f.bindings.open).toHaveBeenCalled());
    expect(await view.result.current.openPicker()).toBe(false);
    const reference = vi.mocked(f.bindings.open).mock.calls[0][1];
    await act(async () => finish(opening(reference)));
    expect(view.result.current.openingBusy).toBe(false);
    await act(async () => expect(await view.result.current.openPicker()).toBe(true));
});
it('회사 교체의 옛 capture finally는 새 회사 원본 읽기 잠금을 풀지 않는다', async () => {
    const f = fixture(), finishes = new Map<string, (value: WorkOrderOpening) => void>();
    vi.mocked(f.bindings.open).mockImplementation((_scope, reference) => new Promise(resolve => {
        finishes.set(reference.companyId, resolve);
    }));
    const view = renderHook(({ companyId }: {
        companyId: 'taebaek' | 'punghoe';
    }) => useWorkOrderEditor({
        ...f.props, companyId
    }), {
        initialProps: {
            companyId: 'taebaek'
        }
    });
    await waitFor(() => expect(finishes.has('taebaek')).toBe(true));
    const oldRef = vi.mocked(f.bindings.open).mock.calls[0][1];
    view.rerender({
        companyId: 'punghoe'
    });
    await waitFor(() => expect(finishes.has('punghoe')).toBe(true));
    const newRef = vi.mocked(f.bindings.open).mock.calls.at(-1)![1];
    await act(async () => finishes.get('taebaek')!(opening(oldRef)));
    expect(view.result.current.openingBusy).toBe(true);
    await act(async () => finishes.get('punghoe')!(opening(newRef)));
    expect(view.result.current.openingBusy).toBe(false);
});
it('원본 open 대기 중 더 최신 그룹 구독을 받으면 늦은 capture가 최신 표시를 덮지 않는다', async () => {
    const f = await ready();
    let finish!: (value: WorkOrderOpening) => void;
    vi.mocked(f.bindings.open).mockImplementationOnce(() => new Promise(resolve => {
        finish = resolve;
    }));
    let task!: Promise<boolean>;
    act(() => {
        task = f.view.result.current.openPicker();
    });
    const reference = vi.mocked(f.bindings.open).mock.calls.at(-1)![1];
    act(() => mocks.subscription?.(['최신 구독 그룹']));
    await act(async () => {
        finish(opening(reference));
        await task;
    });
    expect(f.view.result.current.workGroups).toEqual(['최신 구독 그룹']);
    expect(f.view.result.current.pickerGroups).toEqual(['최신 구독 그룹']);
    expect(f.bindings.prepare).not.toHaveBeenCalled();
});
it('행없는 초기화 open오류만 명시 다시 확인하고 보관된 unknown은 동일ref복구로 전환한다', async () => {
    const f = await ready();
    act(() => reportWorkOrderNotice({
        companyId: 'taebaek', actorUid: 'uid'
    }, '초기 원본 읽기 실패'));
    await waitFor(() => expect(f.view.result.current.canRetryReset).toBe(true));
    expect(f.view.result.current.failureCount).toBe(0);
    await act(async () => f.view.result.current.retryResetDaily());
    expect(f.entries[0].request).toMatchObject({
        action: 'resetDaily'
    });
    expect(f.view.result.current.canRetryReset).toBe(false);
    expect(f.view.result.current.failureCount).toBe(1);
    expect(f.bindings.command).toHaveBeenCalledTimes(1);
});
it('초기화 재확인에서 이미 오늘 원자 처리된 도장을 읽으면 새 요청0·옛 안내 종료', async () => {
    const f = await ready(), today = new Date().toLocaleDateString('ko-KR', {
        timeZone: 'Asia/Seoul'
    }).replace(/\. /g, '-').replace('.', '');
    vi.mocked(f.bindings.open).mockImplementation(async (_scope, ref) => ({
        ...opening(ref), reset: {
            exists: true, version: '7:000000000', data: encodeCatalogValue({
                companyId: ref.companyId, date: today
            })
        }
    }));
    act(() => reportWorkOrderNotice({
        companyId: 'taebaek', actorUid: 'uid'
    }, '초기 원본 읽기 실패'));
    await waitFor(() => expect(f.view.result.current.canRetryReset).toBe(true));
    await act(async () => f.view.result.current.retryResetDaily());
    expect(f.bindings.prepare).not.toHaveBeenCalled();
    expect(f.bindings.command).not.toHaveBeenCalled();
    expect(f.view.result.current.canRetryReset).toBe(false);
    expect(f.view.result.current.error).toBe('');
});
it('다른 기기의 빈 그룹 변경은 표시 원본을 다시 읽되 열린 picker 초안은 자동 rebase하지 않는다', async () => {
    const f = await ready();
    vi.mocked(f.bindings.open).mockImplementation(async (_scope, ref) => ({
        ...opening(ref), groups: {
            exists: true, version: '9:000000000', data: encodeCatalogValue({
                companyId: ref.companyId, names: ['기름', '깨', '미분류', '빈 그룹']
            })
        }
    }));
    act(() => mocks.subscription?.(['기름', '깨', '미분류', '빈 그룹']));
    await waitFor(() => expect(f.view.result.current.workGroups).toContain('빈 그룹'));
    await act(async () => f.view.result.current.openPicker());
    act(() => f.view.result.current.setPickerGroups(['사용자 초안']));
    const calls = vi.mocked(f.bindings.open).mock.calls.length;
    const displayedBefore = [...f.view.result.current.workGroups];
    act(() => mocks.subscription?.(['서버의 다른 그룹']));
    expect(f.view.result.current.workGroups).toEqual(displayedBefore);
    expect(f.bindings.open).toHaveBeenCalledTimes(calls);
    expect(f.view.result.current.pickerGroups).toEqual(['사용자 초안']);
    act(() => f.view.result.current.closePicker());
    await waitFor(() => expect(f.view.result.current.workGroups).toEqual(['서버의 다른 그룹']));
    expect(f.bindings.open).toHaveBeenCalledTimes(calls);
});
it('같은 품목 두 줄도 기존 lineKeyAt 이름표와 이름 꼬리로 분리한다', async () => {
    const f = fixture(), duplicate = {
        ...order, items: [{
                itemId: 'oil', name: '기름', quantity: 1, price: 100
            }, {
                itemId: 'oil', name: '기름', quantity: 2, price: 100
            }]
    };
    const view = renderHook(() => useWorkOrderEditor({
        ...f.props, orders: [duplicate], pickableOrders: [duplicate]
    }));
    await waitFor(() => expect(view.result.current.openingBusy).toBe(false));
    expect(view.result.current.allPickableItems.map(row => [row.key, row.itemName])).toEqual([['order-oil#1', '기름-1'], ['order-oil#2', '기름-2']]);
});
it('품목 이름이 아니라 실제 category로 그룹을 정하고 삭제된 그룹은 마지막으로 보낸다', async () => {
    const f = await ready();
    expect(f.view.result.current.workCategoryOf({
        ...saved[0], category: '깨', itemId: '없는품목', itemName: '참기름'
    })).toBe('깨');
    expect(f.view.result.current.workCategoryOf({
        ...saved[0], workGroup: '지운 그룹'
    })).toBe('미분류');
    expect(f.view.result.current.workCategoryOf({
        ...saved[0], category: 'product', itemId: '없는품목'
    })).toBe('미분류');
});
it('선행 prepare 거절은 가짜 실패행 없이 입력과 재저장 동선을 유지한다', async () => {
    const f = await ready();
    await act(async () => f.view.result.current.openPicker());
    act(() => f.view.result.current.setPickerGroups(['현재 초안']));
    vi.mocked(f.bindings.prepare).mockRejectedValueOnce(Error('기기 보관 실패'));
    await act(async () => f.view.result.current.savePicker());
    expect(f.view.result.current.error).toContain('기기 보관 실패');
    expect(f.view.result.current.pickerGroups).toEqual(['현재 초안']);
    expect(f.view.result.current.canSavePicker).toBe(true);
    expect(f.view.result.current.failureCount).toBe(0);
    expect(f.bindings.command).not.toHaveBeenCalled();
});
it('확인 대기에는 두 번째 확인과 명시 닫기도 같은 동기 잠금으로 막는다', async () => {
    const f = await ready();
    await act(async () => f.view.result.current.openPicker());
    let finish!: (value: string) => void;
    mocks.prompt.mockImplementation(() => new Promise(resolve => {
        finish = resolve;
    }));
    let task!: Promise<void>;
    act(() => {
        task = f.view.result.current.그룹이름바꾸기('기름');
        void f.view.result.current.그룹이름바꾸기('깨');
    });
    expect(mocks.prompt).toHaveBeenCalledTimes(1);
    expect(f.view.result.current.closePicker()).toBe(false);
    await act(async () => {
        finish('새 기름');
        await task;
    });
    expect(f.view.result.current.canClose).toBe(true);
    expect(f.view.result.current.pickerGroups[0]).toBe('새 기름');
});
it('정확 사본이 없는 식별불가 기기 정리도 새 초안을 잠그거나 닫지 않는다', async () => {
    const f = await ready();
    await act(async () => f.view.result.current.openPicker());
    const damaged: WorkOrderEntry = {
        key: '손상키', reference: null, request: null, requestHash: null, referenceHash: null, observedLocalText: '손상', observedReferenceText: null, status: 'corrupt', description: '식별 불가'
    };
    await act(async () => f.view.result.current.discardCopy(damaged));
    expect(f.view.result.current.locked).toBe(false);
    expect(f.view.result.current.showWorkOrderPicker).toBe(true);
    expect(f.view.result.current.canSavePicker).toBe(true);
});
it('기록 조회 지연 중 회사가 바뀌면 새 scope의 조회 잠금과 cursor를 초기화한다', async () => {
    const f = fixture();
    let finish!: (value: Awaited<ReturnType<WorkOrderBindings['history']>>) => void;
    vi.mocked(f.bindings.history).mockImplementationOnce(() => new Promise(resolve => {
        finish = resolve;
    }));
    const view = renderHook(({ companyId }: {
        companyId: 'taebaek' | 'punghoe';
    }) => useWorkOrderEditor({
        ...f.props, companyId
    }), {
        initialProps: {
            companyId: 'taebaek'
        }
    });
    await waitFor(() => expect(view.result.current.openingBusy).toBe(false));
    let task!: Promise<void>;
    act(() => {
        task = view.result.current.loadHistory();
    });
    expect(view.result.current.historyLoading).toBe(true);
    view.rerender({
        companyId: 'punghoe'
    });
    expect(view.result.current.historyLoading).toBe(false);
    await act(async () => {
        finish({
            version: 1, companyId: 'taebaek', actorUid: 'uid', entries: [], nextCursor: 'b'.repeat(64)
        });
        await task;
    });
    expect(view.result.current.historyMore).toBeNull();
});
it('연속 수정은 props 옛 사본이 아니라 앞 ACK 이후 현재 원본과 native 버전을 사용한다', async () => {
    const f = await ready();
    let server = [...saved], version = '4:000000000';
    vi.mocked(f.bindings.open).mockImplementation(async (_scope, ref) => ({
        ...opening(ref), items: server.map(row => ({
            id: row.id!, version, data: encodeCatalogValue({
                ...row, companyId: ref.companyId
            })
        }))
    }));
    vi.mocked(f.bindings.command).mockImplementation(async (_scope, entry) => {
        if (entry.request?.action === 'apply') {
            server = entry.request.items;
            version = '5:000000000';
        }
        return terminal(entry);
    });
    await act(async () => f.view.result.current.setWorkItems(previous => previous.map(row => ({
        ...row, groupId: 'first-bundle'
    }))));
    await act(async () => f.view.result.current.setWorkItems(previous => previous.map(row => ({
        ...row, workGroup: '기름'
    }))));
    const second = f.entries[1].request!;
    if (second.action === 'apply') {
        expect(second.items[0]).toMatchObject({
            groupId: 'first-bundle', workGroup: '기름'
        });
        expect(second.expected.items[0].version).toBe('5:000000000');
    }
    expect(f.props.workOrderItems[0].groupId).toBeUndefined();
});
it('그룹 기본값·줄 식별·저장목록만 표시·상품 제외의 기존 계산을 보존한다', async () => {
    const f = await ready();
    expect(f.view.result.current.workGroups).toEqual(['기름', '깨', '미분류']);
    expect(f.view.result.current.validWorkItems.map(row => row.key)).toEqual(['order-oil', 'order-sesame']);
    expect(f.view.result.current.validWorkItems[0]).toMatchObject({
        itemName: '기름', qty: 2
    });
    expect(f.view.result.current.allPickableItems).toHaveLength(3);
    expect(f.view.result.current.workCategoryOf(f.view.result.current.validWorkItems[0])).toBe('기름');
    expect(f.bindings.history).not.toHaveBeenCalled();
});
it('끌어오기 초안은 전체그룹으로 열고 취소 전에는 저장하지 않는다', async () => {
    const f = await ready();
    await act(async () => f.view.result.current.openPicker());
    expect(f.view.result.current.pickerGroup).toBe('');
    expect(f.view.result.current.pickerOrdering).toEqual(['order-oil', 'order-sesame']);
    act(() => {
        f.view.result.current.set새그룹이름('새 그룹');
    });
    act(() => f.view.result.current.그룹추가());
    expect(f.bindings.prepare).not.toHaveBeenCalled();
    act(() => f.view.result.current.closePicker());
    expect(f.view.result.current.showWorkOrderPicker).toBe(false);
});
it('그룹 차례와 항목 순서를 한 고정 요청으로 저장하고 ACK 전 닫지 않는다', async () => {
    const f = await ready();
    await act(async () => f.view.result.current.openPicker());
    act(() => {
        f.view.result.current.setPickerGroup('기름');
        f.view.result.current.togglePickerItem(f.view.result.current.allPickableItems[2], false);
    });
    let finish!: (value: WorkOrderObservation) => void;
    vi.mocked(f.bindings.command).mockImplementation(() => new Promise(resolve => {
        finish = resolve;
    }));
    let task!: Promise<boolean>;
    act(() => {
        task = f.view.result.current.savePicker();
    });
    await waitFor(() => expect(f.entries).toHaveLength(1));
    expect(f.view.result.current.showWorkOrderPicker).toBe(true);
    expect(f.view.result.current.closePicker()).toBe(false);
    expect(f.view.result.current.canClose).toBe(false);
    const request = f.entries[0].request!;
    expect(request).toMatchObject({
        action: 'apply', groups: ['기름', '깨', '미분류']
    });
    if (request.action === 'apply')
        expect(request.items.map(row => row.sortIndex)).toEqual([0, 1, 2]);
    await act(async () => {
        finish(terminal(f.entries[0]));
        await task;
    });
    expect(f.view.result.current.showWorkOrderPicker).toBe(false);
});
it('직접 묶기 저장은 기존 문서 ID·허용 변경 칸만 준비하고 동기 중복을 막는다', async () => {
    const f = await ready();
    let finish!: (value: WorkOrderObservation) => void;
    vi.mocked(f.bindings.command).mockImplementation(() => new Promise(resolve => {
        finish = resolve;
    }));
    let task!: Promise<boolean>;
    act(() => {
        task = f.view.result.current.setWorkItems(previous => previous.map(row => ({
            ...row, groupId: 'bundle'
        })));
        void f.view.result.current.setWorkItems(previous => previous.reverse());
    });
    await waitFor(() => expect(f.entries).toHaveLength(1));
    const request = f.entries[0].request!;
    if (request.action === 'apply') {
        expect(request.items.map(row => row.id)).toEqual(['saved-oil', 'saved-sesame']);
        expect(request.items[0]).toMatchObject({
            groupId: 'bundle', itemName: '저장 당시 이름', qty: 99
        });
    }
    await act(async () => {
        finish(terminal(f.entries[0]));
        await task;
    });
    expect(f.bindings.prepare).toHaveBeenCalledTimes(1);
});
it('unknown은 동일 원문을 보존·잠그고 결과 확인은 같은 관측 entry만 보낸다', async () => {
    const f = await ready();
    await act(async () => f.view.result.current.openPicker());
    await act(async () => f.view.result.current.savePicker());
    expect(f.view.result.current.locked).toBe(true);
    expect(f.view.result.current.failureCount).toBe(1);
    expect(f.view.result.current.canReopenCurrent).toBe(false);
    await act(async () => f.view.result.current.inspect(f.entries[0]));
    expect(f.bindings.command).toHaveBeenLastCalledWith(expect.anything(), f.entries[0], 'inspect', expect.any(Function));
    expect(f.bindings.prepare).toHaveBeenCalledTimes(1);
});
it('확정 거절은 원 picker 초안을 보존하고 명시 현재 원본 재열기 후 새 요청을 허용한다', async () => {
    const f = await ready();
    await act(async () => f.view.result.current.openPicker());
    act(() => f.view.result.current.setPickerGroups(['새 그룹', '기름', '깨']));
    vi.mocked(f.bindings.command).mockImplementation(async (_scope, entry) => {
        f.entries.length = 0;
        return terminal(entry, 'rejected');
    });
    await act(async () => f.view.result.current.savePicker());
    expect(f.view.result.current.showWorkOrderPicker).toBe(true);
    expect(f.view.result.current.pickerGroups).toEqual(['새 그룹', '기름', '깨']);
    expect(f.view.result.current.canReopenCurrent).toBe(true);
    await act(async () => f.view.result.current.reopenCurrent());
    expect(f.view.result.current.pickerGroups).toEqual(['새 그룹', '기름', '깨']);
    expect(f.view.result.current.locked).toBe(false);
    expect(f.view.result.current.canSavePicker).toBe(true);
});
it('정리 실패 partial은 원인·조치와 초안을 보존하며 현재 재열기·자동 재전송0', async () => {
    const f = await ready();
    await act(async () => f.view.result.current.openPicker());
    vi.mocked(f.bindings.command).mockResolvedValue({
        terminal: false, outcome: {
            status: 'partial', reason: 'followup-unconfirmed', committedIds: ['plan'], unconfirmedIds: [], message: '기기 정리 실패', nextAction: '같은 결과 확인'
        }
    });
    await act(async () => f.view.result.current.savePicker());
    expect(f.view.result.current.showWorkOrderPicker).toBe(true);
    expect(f.view.result.current.message).toContain('기기 정리 실패');
    expect(f.view.result.current.message).toContain('같은 결과 확인');
    expect(f.view.result.current.canReopenCurrent).toBe(false);
    expect(f.bindings.command).toHaveBeenCalledTimes(1);
});
it('그룹 삭제 확인 대기 중 UID가 바뀌면 초안 변경·후속 송신0', async () => {
    const f = await ready();
    await act(async () => f.view.result.current.openPicker());
    let finish!: (value: boolean) => void;
    mocks.confirm.mockImplementation(() => new Promise(resolve => {
        finish = resolve;
    }));
    let task!: Promise<void>;
    act(() => {
        task = f.view.result.current.그룹지우기('기름', 1);
    });
    expect(f.view.result.current.busy).toBe(true);
    mocks.auth.currentUser.uid = 'other';
    f.view.rerender();
    await act(async () => {
        finish(true);
        await task;
    });
    expect(f.bindings.prepare).not.toHaveBeenCalled();
    expect(f.view.result.current.workGroups).toEqual([]);
});
it('그룹 이름은 trim·중복방지·할당이동의 기존 원문 규칙을 유지한다', async () => {
    const f = await ready();
    await act(async () => f.view.result.current.openPicker());
    mocks.prompt.mockResolvedValue('  새 기름  ');
    await act(async () => f.view.result.current.그룹이름바꾸기('기름'));
    expect(f.view.result.current.pickerGroups[0]).toBe('새 기름');
    expect(f.view.result.current.pickerAssign['order-oil']).toBe('새 기름');
    act(() => f.view.result.current.set새그룹이름('새 기름'));
    act(() => f.view.result.current.그룹추가());
    expect(f.view.result.current.error).toContain('같은 이름');
});
it('상품도 picker에는 있지만 완료줄은 새로 담지 않는 기존 규칙을 유지한다', async () => {
    const f = await ready();
    await act(async () => f.view.result.current.openPicker());
    act(() => {
        f.view.result.current.setPickerGroup('기름');
        f.view.result.current.togglePickerItem(f.view.result.current.allPickableItems[2], true);
    });
    expect(f.view.result.current.pickerOrdering).not.toContain('order-line-goods');
});
it('명시 이력 빈 페이지도 다음 cursor를 유지하고 완료 이력은 실패·사본정리0', async () => {
    const f = await ready();
    vi.mocked(f.bindings.history).mockResolvedValueOnce({
        version: 1, companyId: 'taebaek', actorUid: 'uid', entries: [], nextCursor: 'a'.repeat(64)
    });
    await act(async () => f.view.result.current.loadHistory());
    expect(f.view.result.current.historyMore).toBe('a'.repeat(64));
    const result = {
        version: 1 as const, reference: {
            companyId: 'taebaek' as const, planId: 'old'
        }, actorUid: 'uid', status: 'applied' as const, requestHash: 'b'.repeat(64), message: '과거 완료'
    };
    vi.mocked(f.bindings.history).mockResolvedValueOnce({
        version: 1, companyId: 'taebaek', actorUid: 'uid', entries: [{
                result, action: 'apply', createdAt: '2026-10-20'
            }], nextCursor: null
    });
    await act(async () => f.view.result.current.nextHistory());
    expect(f.bindings.history).toHaveBeenLastCalledWith(expect.anything(), 'a'.repeat(64), expect.any(Function));
    expect(f.view.result.current.failureCount).toBe(0);
    const row = f.view.result.current.historyRows[0];
    expect(row.currentState).toContain('완료');
    expect(f.view.result.current.canCancel(row.entry)).toBe(false);
    expect(f.view.result.current.canDiscard(row.entry)).toBe(false);
});
it('사본 정리는 현재 새 picker 초안을 닫거나 업무 ACK로 오인하지 않는다', async () => {
    const f = await ready();
    await act(async () => f.view.result.current.openPicker());
    const old: WorkOrderEntry = {
        key: 'old', reference: {
            companyId: 'taebaek', planId: 'old'
        }, request: null, requestHash: null, referenceHash: null, observedLocalText: '원문', observedReferenceText: '참조', status: 'corrupt', description: '옛 원문'
    };
    await act(async () => f.view.result.current.discardCopy(old));
    expect(f.bindings.discard).toHaveBeenCalledWith(expect.anything(), old, expect.any(Function));
    expect(f.view.result.current.showWorkOrderPicker).toBe(true);
    expect(f.view.result.current.message).toContain('기기 사본만');
});
it('회사 교체 후 옛 함수와 늦은 finally는 새 scope 작업에 영향을 주지 않는다', async () => {
    const f = fixture();
    const view = renderHook(({ companyId }: {
        companyId: 'taebaek' | 'punghoe';
    }) => useWorkOrderEditor({
        ...f.props, companyId
    }), {
        initialProps: {
            companyId: 'taebaek'
        }
    });
    await waitFor(() => expect(view.result.current.openingBusy).toBe(false));
    const old = view.result.current.setWorkItems;
    view.rerender({
        companyId: 'punghoe'
    });
    await act(async () => old([]));
    expect(f.bindings.prepare).not.toHaveBeenCalled();
});
