/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
    auth: {
        currentUser: {
            uid: 'uid', getIdTokenResult: async () => ({
                claims: {
                    companyId: 'taebaek', employeeId: 'employee', isAdmin: true
                }
            })
        }
    }, call: vi.fn(), get: vi.fn()
}));
vi.mock('../firebase', () => ({
    auth: mocks.auth, authReady: Promise.resolve(), functions: {}, db: {}
}));
vi.mock('firebase/functions', () => ({
    httpsCallable: () => mocks.call
}));
vi.mock('firebase/firestore', () => ({
    doc: () => ({}), getDoc: mocks.get
}));
import { submitOrderCopy, listPendingOrderCopies, deletePendingOrderCopy, readOrderCopyRecoveries, resolveOrderCopyRecovery, discardOrderCopyRecovery, listOrderCopyRecoveryHistory, sendOrderCopyRecovery, reconnectOrderCopyRecovery } from './orderCopyService';
const request = () => ({
    version: 1 as const, companyId: 'taebaek' as const, actorUid: 'uid', requestId: 'request', createdAt: '2026-10-14T00:00:00Z', sourceText: '  주문 원문\n', firstAnalysis: {
        kind: 'rules', raw: []
    }, confirmed: {
        inputLines: [], orderDraft: {
            id: 'ORD-test'
        }
    }
});
const scope = {
    companyId: 'taebaek' as const, actorUid: 'uid'
};
it('명시 동일 작성 재연결은 양 사본 부재와 최초 canonical 해시를 확인하고 참조만 조회한다', async () => { const entry = await retained(); localStorage.clear(); mocks.call.mockClear(); mocks.call.mockResolvedValue({
    data: server(entry)
}); expect(await reconnectOrderCopyRecovery(request())).toMatchObject({
    terminal: true, outcome: {
        status: 'saved'
    }
}); expect(mocks.call).toHaveBeenCalledExactlyOnceWith({
    action: 'inspect', reference: entry.reference
}); });
it('명시 재연결 중 새 사본 발생은 현재 작성 종결0·새 사본 보존', async () => { const entry = await retained(); localStorage.clear(); mocks.call.mockImplementation(async () => { localStorage.setItem(entry.key + ':reference', '새 사본'); return {
    data: server(entry)
}; }); expect(await reconnectOrderCopyRecovery(request())).toMatchObject({
    terminal: false
}); expect(localStorage.getItem(entry.key + ':reference')).toBe('새 사본'); });
it('명시 재연결도 다른 해시 성공은 현재 저장 완료로 승격하지 않는다', async () => { const entry = await retained(); localStorage.clear(); mocks.call.mockResolvedValue({
    data: server(entry, 'applied', 'b'.repeat(64))
}); expect(await reconnectOrderCopyRecovery(request())).toMatchObject({
    terminal: false, copyMismatch: true
}); });
it('ACK 중 본문만 없어져도 동일 참조는 실제 정리한 뒤에만 완료한다', async () => {
    mocks.call.mockImplementation(async (input: any) => {
        const key = 'order-copy-v1:taebaek:uid:request';
        localStorage.removeItem(key);
        return {
            data: {
                status: 'applied', requestId: 'request', orderId: 'ORD-test', requestHash: input.requestHash
            }
        };
    });
    expect(await sendOrderCopyRecovery(request())).toMatchObject({
        terminal: true, outcome: {
            status: 'saved'
        }
    });
    expect(localStorage.getItem('order-copy-v1:taebaek:uid:request:reference')).toBeNull();
});
it('ACK 중 본문 부재와 교체 참조는 새 사본 보존·현재 성공 승격 금지', async () => {
    mocks.call.mockImplementation(async (input: any) => {
        const key = 'order-copy-v1:taebaek:uid:request';
        if (input.action === 'submit') {
            localStorage.removeItem(key);
            localStorage.setItem(key + ':reference', '다른 참조');
            return {
                data: {
                    status: 'applied', requestId: 'request', orderId: 'ORD-test', requestHash: input.requestHash
                }
            };
        }
        return {
            data: {
                version: 1, reference: input.reference, actorUid: 'uid', status: 'applied', requestHash: 'a'.repeat(64), message: '과거 완료', orderId: 'ORD-test'
            }
        };
    });
    expect(await sendOrderCopyRecovery(request())).toMatchObject({
        terminal: false, copyMismatch: true
    });
    expect(localStorage.getItem('order-copy-v1:taebaek:uid:request:reference')).toBe('다른 참조');
});
it('ACK 중 양 사본이 이미 없으면 잔여 사본을 만들지 않고 완료한다', async () => {
    mocks.call.mockImplementation(async (input: any) => {
        localStorage.clear();
        return {
            data: {
                status: 'applied', requestId: 'request', orderId: 'ORD-test', requestHash: input.requestHash
            }
        };
    });
    expect(await sendOrderCopyRecovery(request())).toMatchObject({
        terminal: true, outcome: {
            status: 'saved'
        }
    });
    expect(await readOrderCopyRecoveries(scope)).toEqual([]);
});
async function retained() { mocks.call.mockRejectedValueOnce(Error('응답 유실')); await expect(submitOrderCopy(request())).rejects.toThrow(); return (await readOrderCopyRecoveries(scope))[0]; }
function server(entry: Awaited<ReturnType<typeof retained>>, status: 'applied' | 'unknown' | 'stopped' = 'applied', hash = entry.requestHash) {
    return {
        version: 1, reference: entry.reference, actorUid: 'uid', status, requestHash: status === 'stopped' ? null : hash, message: '실제 처리 결과', ...(status === 'applied' ? {
            orderId: 'ORD-test'
        } : {})
    };
}
beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.auth.currentUser.uid = 'uid';
    Object.defineProperty(navigator, 'locks', {
        configurable: true, value: {
            request: (_key: string, _options: unknown, work: () => unknown) => work()
        }
    });
    mocks.get.mockResolvedValue({
        data: () => ({
            releaseId: 'release'
        })
    });
});
it('응답 유실은 최초 전체원문을 보존하고 삭제는 목록에서만 숨긴다', async () => {
    mocks.call.mockRejectedValue(Error('응답 유실'));
    await expect(submitOrderCopy(request())).rejects.toThrow();
    const [entry] = listPendingOrderCopies('taebaek', 'uid');
    expect(entry.request?.sourceText).toBe('  주문 원문\n');
    await deletePendingOrderCopy(entry);
    expect(listPendingOrderCopies('taebaek', 'uid')[0]).toMatchObject({
        text: entry.text, deleted: true
    });
});
it('같은 ID의 변경 원문은 기존 사본을 덮어쓰지 않는다', async () => {
    mocks.call.mockRejectedValue(Error('응답 유실'));
    await expect(submitOrderCopy(request())).rejects.toThrow();
    const text = listPendingOrderCopies('taebaek', 'uid')[0].text;
    mocks.call.mockClear();
    await expect(submitOrderCopy({
        ...request(), sourceText: '변경'
    })).rejects.toThrow();
    expect(mocks.call).not.toHaveBeenCalled();
    expect(listPendingOrderCopies('taebaek', 'uid')[0].text).toBe(text);
});
it('UID 변경은 전송하지 않는다', async () => { mocks.auth.currentUser.uid = 'other'; await expect(submitOrderCopy(request())).rejects.toThrow('계정'); expect(mocks.call).not.toHaveBeenCalled(); });
it('실제 ACK와 원문해시 동치가 확인된 경우만 정확 사본을 정리한다', async () => {
    mocks.call.mockImplementation(async (input: any) => ({
        data: {
            status: 'applied', requestId: 'request', orderId: 'ORD-test', requestHash: input.requestHash
        }
    }));
    expect((await submitOrderCopy(request())).status).toBe('applied');
    expect(listPendingOrderCopies('taebaek', 'uid')).toEqual([]);
});
it('늦은 ACK의 계정변경과 잘못된 원문해시는 정리하지 않는다', async () => {
    mocks.call.mockImplementationOnce(async (input: any) => {
        mocks.auth.currentUser.uid = 'other';
        return {
            data: {
                status: 'applied', requestId: 'request', orderId: 'ORD-test', requestHash: input.requestHash
            }
        };
    });
    await expect(submitOrderCopy(request())).rejects.toThrow('계정');
    mocks.auth.currentUser.uid = 'uid';
    expect(listPendingOrderCopies('taebaek', 'uid')).toHaveLength(1);
    mocks.call.mockResolvedValue({
        data: {
            status: 'duplicate', requestId: 'request', orderId: 'ORD-test', requestHash: '다른해시'
        }
    });
    await expect(submitOrderCopy(request())).rejects.toThrow('응답');
    expect(listPendingOrderCopies('taebaek', 'uid')).toHaveLength(1);
});
it('ACK 대기중 바뀐 저장사본은 CAS 정리하지 않는다', async () => {
    mocks.call.mockImplementation(async (input: any) => {
        const entry = listPendingOrderCopies('taebaek', 'uid')[0];
        localStorage.setItem(entry.key, entry.text + ' ');
        return {
            data: {
                status: 'duplicate', requestId: 'request', orderId: 'ORD-test', requestHash: input.requestHash
            }
        };
    });
    await expect(submitOrderCopy(request())).rejects.toThrow();
    expect(listPendingOrderCopies('taebaek', 'uid')).toHaveLength(1);
});
it('확정표현 원문 전체를 전송·보존하며 같은ID 확정값 변경은 재전송0', async () => {
    const r = {
        ...request(), sourceText: '스티커X', confirmed: {
            inputLines: [], orderDraft: {
                id: 'ORD-test', note: '스티커 없음'
            }, expressionConfirmations: [{
                    sourceStart: 0, sourceEnd: 4, sourceText: '스티커X', scope: 'partner' as const, target: 'note' as const, value: '스티커 없음'
                }]
        }
    };
    mocks.call.mockRejectedValue(Error('응답 유실'));
    await expect(submitOrderCopy(r)).rejects.toThrow();
    expect(JSON.parse(mocks.call.mock.calls[0][0].requestText).confirmed.expressionConfirmations).toEqual(r.confirmed.expressionConfirmations);
    mocks.call.mockClear();
    await expect(submitOrderCopy({
        ...r, confirmed: {
            ...r.confirmed, orderDraft: {
                id: 'ORD-test', note: '스티커 붙임'
            }, expressionConfirmations: [{
                    ...r.confirmed.expressionConfirmations[0], value: '스티커 붙임'
                }]
        }
    })).rejects.toThrow();
    expect(mocks.call).not.toHaveBeenCalled();
});
it('결과 확인은 참조만 보내고 동일 원문 확정 결과만 정리한다', async () => {
    const entry = await retained();
    mocks.call.mockClear();
    mocks.call.mockResolvedValue({
        data: server(entry)
    });
    const result = await resolveOrderCopyRecovery(scope, entry, 'inspect');
    expect(mocks.call).toHaveBeenCalledExactlyOnceWith({
        action: 'inspect', reference: entry.reference
    });
    expect(result).toMatchObject({
        terminal: true, outcome: {
            status: 'saved'
        }
    });
    expect(await readOrderCopyRecoveries(scope)).toEqual([]);
});
it('다른 원문 실제 성공은 현재 사본 성공과 자동 정리로 승격하지 않는다', async () => {
    const entry = await retained();
    mocks.call.mockResolvedValue({
        data: server(entry, 'applied', 'a'.repeat(64))
    });
    expect(await resolveOrderCopyRecovery(scope, entry, 'inspect')).toMatchObject({
        terminal: false, copyMismatch: true, outcome: {
            status: 'rejected'
        }, result: {
            status: 'applied'
        }
    });
    expect(localStorage.getItem(entry.key)).toBe(entry.bodyText);
    expect(await discardOrderCopyRecovery(scope, entry)).toMatchObject({
        status: 'cleared'
    });
});
it('미확정 서버 결과는 명시 사본 정리도 거절한다', async () => {
    const entry = await retained();
    mocks.call.mockResolvedValue({
        data: server(entry, 'unknown')
    });
    expect(await discardOrderCopyRecovery(scope, entry)).toMatchObject({
        status: 'blocked'
    });
    expect(localStorage.getItem(entry.key)).toBe(entry.bodyText);
});
it('조회 중 참조 사본 교체는 변경된 사본을 삭제하지 않는다', async () => {
    const entry = await retained();
    mocks.call.mockImplementation(async () => {
        localStorage.setItem(entry.key + ':reference', '교체된 참조');
        return {
            data: server(entry)
        };
    });
    expect(await discardOrderCopyRecovery(scope, entry)).toMatchObject({
        status: 'blocked'
    });
    expect(localStorage.getItem(entry.key + ':reference')).toBe('교체된 참조');
    expect(localStorage.getItem(entry.key)).toBe(entry.bodyText);
});
it('손상 본문은 참조 조회 가능하지만 성공으로 올리지 않고 명시 정리한다', async () => {
    const original = await retained();
    localStorage.setItem(original.key, '손상');
    const entry = (await readOrderCopyRecoveries(scope))[0];
    mocks.call.mockResolvedValue({
        data: server(original)
    });
    expect(await resolveOrderCopyRecovery(scope, entry, 'inspect')).toMatchObject({
        terminal: false, copyMismatch: true
    });
    expect(localStorage.getItem(entry.key)).toBe('손상');
    expect(await discardOrderCopyRecovery(scope, entry)).toMatchObject({
        status: 'cleared'
    });
});
it('원문 없는 이력은 실제 결과만 표시하고 없는 사본 정리를 요구하지 않는다', async () => {
    const original = await retained();
    localStorage.clear();
    const entry = {
        ...original, bodyText: null, referenceText: null, request: null, requestHash: null, referenceHash: null
    };
    mocks.call.mockResolvedValue({
        data: server(original)
    });
    const result = await resolveOrderCopyRecovery(scope, entry, 'inspect');
    expect(result).toMatchObject({
        terminal: false, outcome: {
            status: 'rejected'
        }
    });
    expect(result.outcome).toHaveProperty('nextAction', expect.stringContaining('새 업무'));
});
it('미처리 중단은 원자 fence 결과를 소비하며 주문 삭제를 호출하지 않는다', async () => {
    const entry = await retained();
    mocks.call.mockClear();
    mocks.call.mockResolvedValue({
        data: server(entry, 'stopped')
    });
    expect(await resolveOrderCopyRecovery(scope, entry, 'stop')).toMatchObject({
        terminal: true, outcome: {
            status: 'cancelled'
        }
    });
    expect(mocks.call).toHaveBeenCalledExactlyOnceWith({
        action: 'stop', reference: entry.reference
    });
});
it('빈 이력 페이지도 후속 cursor를 유지한다', async () => {
    mocks.call.mockResolvedValue({
        data: {
            version: 1, ...scope, entries: [], nextCursor: 'opaque_cursor'
        }
    });
    expect(await listOrderCopyRecoveryHistory(scope)).toMatchObject({
        entries: [], nextCursor: 'opaque_cursor'
    });
    expect(mocks.call).toHaveBeenCalledWith({
        action: 'listHistory', companyId: 'taebaek'
    });
});
