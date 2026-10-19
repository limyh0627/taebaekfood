/** @vitest-environment jsdom */
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { encodeCatalogValue, type WorkOrderReference, type WorkOrderRequest } from '../workOrderCommand';
import { resetDailyWorkOrder } from './workOrderResetService';
const state = vi.hoisted(() => ({
    lock: undefined as {
        date: string;
        companyId?: string;
    } | undefined, open: vi.fn(), prepare: vi.fn(), command: vi.fn(), notice: vi.fn(), hasCopy: vi.fn(() => false)
}));
vi.mock('../firebase', () => ({
    auth: {
        currentUser: {
            uid: 'uid'
        }
    }, authReady: Promise.resolve()
}));
vi.mock('./workOrderWrites', () => ({
    workOrderWrites: {
        open: state.open, prepare: state.prepare, command: state.command
    }, reportWorkOrderNotice: state.notice, hasWorkOrderCopy: state.hasCopy
}));
beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-07T03:00:00Z'));
    state.lock = undefined;
    vi.clearAllMocks();
    state.open.mockImplementation(async (scope: {
        companyId: string;
    }, reference: WorkOrderReference) => {
        if (state.lock && state.lock.companyId !== scope.companyId)
            throw Error('다른 회사 또는 회사 표시 없는 도장');
        return {
            reference, actorUid: 'uid', items: [{
                    id: 'one', data: encodeCatalogValue({
                        companyId: scope.companyId
                    }), version: '1:000000000'
                }, {
                    id: 'two', data: encodeCatalogValue({
                        companyId: scope.companyId
                    }), version: '2:000000000'
                }], groups: {
                exists: false, data: null, version: null
            }, reset: state.lock ? {
                exists: true, data: encodeCatalogValue(state.lock), version: '3:000000000'
            } : {
                exists: false, data: null, version: null
            }
        };
    });
    state.prepare.mockImplementation(async (_scope: unknown, request: WorkOrderRequest) => ({
        request
    }));
    state.command.mockResolvedValue({
        terminal: true, outcome: {
            status: 'saved'
        }
    });
    vi.spyOn(console, 'error').mockImplementation(() => {
    });
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});
it('업무 적용 뒤 사본 정리 partial은 정상 서버 문구보다 실패 원인과 다음 조치를 보존한다', async () => {
    state.command.mockResolvedValueOnce({
        terminal: false, result: {
            status: 'applied', message: '초기화가 완료됐습니다.'
        }, outcome: {
            status: 'partial', reason: 'followup-unconfirmed', committedIds: ['plan'], unconfirmedIds: [], message: '기기 사본 정리를 확인하지 못했습니다.', nextAction: '업무를 다시 보내지 말고 같은 결과를 확인해 주세요.'
        }
    });
    await resetDailyWorkOrder('taebaek');
    const message = state.notice.mock.calls.at(-1)![1];
    expect(message).toContain('기기 사본 정리를 확인하지 못했습니다.');
    expect(message).toContain('업무를 다시 보내지 말고');
    expect(message).not.toBe('초기화가 완료됐습니다.');
    expect(state.command).toHaveBeenCalledTimes(1);
});
it('prepare 중 참조만 보관된 실패는 미송신 새 요청 버튼 대신 그 plan 복구에 연결한다', async () => {
    state.hasCopy.mockReturnValueOnce(true);
    state.prepare.mockRejectedValueOnce(Error('본문 보관 실패'));
    await resetDailyWorkOrder('taebaek');
    expect(state.command).not.toHaveBeenCalled();
    expect(state.notice).toHaveBeenCalledWith(expect.anything(), '본문 보관 실패', expect.objectContaining({
        companyId: 'taebaek', planId: expect.any(String)
    }));
});
it('원본 조회 대기 중 현재 회사 세대가 바뀌면 보관과 송신0', async () => {
    let finish!: (value: Awaited<ReturnType<typeof state.open>>) => void;
    const opening = await state.open({
        companyId: 'taebaek'
    }, {
        companyId: 'taebaek', planId: 'plan'
    });
    state.open.mockImplementationOnce(() => new Promise(resolve => {
        finish = resolve;
    }));
    let active = true;
    const task = resetDailyWorkOrder('taebaek', () => active);
    await Promise.resolve();
    await Promise.resolve();
    active = false;
    finish(opening);
    await task;
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.command).not.toHaveBeenCalled();
});
it('초기화 보관 오류는 업무송신0·관측 원인을 별도 안내한다', async () => {
    state.prepare.mockRejectedValueOnce(Error('보관 공간 부족'));
    await resetDailyWorkOrder('taebaek');
    expect(state.command).not.toHaveBeenCalled();
    expect(state.notice).toHaveBeenCalledWith(expect.anything(), '보관 공간 부족', null);
});
it('잠금 획득 실패는 다른 기기의 도장을 복원하지 않는다', async () => {
    state.open.mockRejectedValueOnce(Error('claim failed'));
    await resetDailyWorkOrder('taebaek');
    expect(state.open).toHaveBeenCalledTimes(1);
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.command).not.toHaveBeenCalled();
    expect(state.notice).toHaveBeenCalledWith(expect.anything(), 'claim failed', null);
});
it('오늘 잠금이 있으면 조회와 삭제를 하지 않는다', async () => {
    state.lock = {
        date: '2026-10-7', companyId: 'taebaek'
    };
    await resetDailyWorkOrder('taebaek');
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.command).not.toHaveBeenCalled();
});
it('풍회 회사 조회와 공용 원자 초기화 경로를 유지한다', async () => {
    await resetDailyWorkOrder('punghoe');
    expect(state.open).toHaveBeenCalledWith({
        companyId: 'punghoe', actorUid: 'uid'
    }, expect.objectContaining({
        companyId: 'punghoe'
    }), expect.any(Function));
    expect(state.prepare.mock.calls[0][1]).toMatchObject({
        action: 'resetDaily', date: '2026-10-7', expected: {
            items: [{
                    id: 'one', version: '1:000000000'
                }, {
                    id: 'two', version: '2:000000000'
                }]
        }
    });
    expect(state.command).toHaveBeenCalledWith({
        companyId: 'punghoe', actorUid: 'uid'
    }, expect.anything(), 'apply', expect.any(Function));
});
it('삭제 실패는 선행 도장을 남기거나 별도 되돌리기 없이 동일 원문 조회로 이어진다', async () => {
    state.command.mockResolvedValue({
        terminal: false, outcome: {
            status: 'unknown', message: 'delete failed', nextAction: '조회'
        }
    });
    await resetDailyWorkOrder('taebaek');
    expect(state.open).toHaveBeenCalledTimes(1);
    expect(state.prepare).toHaveBeenCalledTimes(1);
    expect(state.command).toHaveBeenCalledTimes(1);
    expect(state.lock).toBeUndefined();
    expect(state.notice).toHaveBeenLastCalledWith(expect.anything(), expect.stringContaining('delete failed'), expect.objectContaining({
        companyId: 'taebaek'
    }));
});
it.each([{
        date: '2026-10-8', companyId: 'taebaek'
    }, {
        date: '2026-10-7', companyId: 'punghoe'
    }, undefined])('삭제 실패 사이 바뀐 잠금 %j는 되돌리지 않는다', async (changed) => {
    state.command.mockImplementation(async () => {
        state.lock = changed;
        throw Error('delete failed');
    });
    await resetDailyWorkOrder('taebaek');
    expect(state.lock).toEqual(changed);
    expect(state.open).toHaveBeenCalledTimes(1);
    expect(state.prepare).toHaveBeenCalledTimes(1);
});
it('다른 회사 잠금 문서는 덮어쓰지 않는다', async () => {
    state.lock = {
        date: '2026-10-6', companyId: 'punghoe'
    };
    await resetDailyWorkOrder('taebaek');
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.command).not.toHaveBeenCalled();
    expect(state.open).toHaveBeenCalledTimes(1);
});
it('조회 실패는 오늘 도장과 항목을 건드리지 않고 원인을 남긴다', async () => {
    state.open.mockRejectedValueOnce(Error('read failed'));
    await resetDailyWorkOrder('taebaek');
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.command).not.toHaveBeenCalled();
    expect(state.notice).toHaveBeenCalledWith(expect.anything(), 'read failed', null);
});
// 옛 fixture는 실제 Rules에 없는 회사 생략 허용을 가정했다. 명시 회사 정책을 넓히지 않는다.
it('회사 필드 없는 옛 회사별 잠금도 회사 표시를 추정해 초기화하지 않는다', async () => {
    state.lock = {
        date: '2026-10-6'
    };
    await resetDailyWorkOrder('punghoe');
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.command).not.toHaveBeenCalled();
    expect(state.lock).toEqual({
        date: '2026-10-6'
    });
});
