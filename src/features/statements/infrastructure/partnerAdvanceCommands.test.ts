// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { webcrypto, createHash } from 'node:crypto';
const mocks = vi.hoisted(() => ({
    call: vi.fn(), token: vi.fn(), auth: {
        currentUser: null as any
    }
}));
vi.mock('firebase/functions', () => ({
    httpsCallable: () => mocks.call
}));
vi.mock('../../../shared/firebase', () => ({
    auth: mocks.auth, authReady: Promise.resolve(), functions: {}
}));
import { applyPartnerAdvance, readPendingPartnerAdvance, preparePartnerAdvance, createPartnerAdvanceRecovery, advanceBodyKey, advanceReferenceKey, type PendingPartnerAdvance, type AdvanceRecoveryScope, type AdvanceRecoveryPort } from './partnerAdvanceCommands';
const input = {
    operationId: 'apply-1', partnerId: 'p', date: '2026-10-08', source: {
        collection: 'cashEntries' as const, id: 'cash', lineKey: '133'
    }, statementId: 'target', accountCode: '251' as const, amount: 60, expectedRevision: 0, releaseId: 'release', expectedSourceFingerprint: 'a'.repeat(64), expectedTargetFingerprint: 'b'.repeat(64)
};
const key = 'erp:partner-advance:taebaek:uid';
beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    Object.defineProperty(crypto, 'subtle', {
        configurable: true, value: webcrypto.subtle
    });
    vi.resetAllMocks();
    mocks.token.mockResolvedValue({
        claims: {
            isAdmin: true, companyId: 'taebaek'
        }
    });
    mocks.auth.currentUser = {
        uid: 'uid', getIdTokenResult: mocks.token
    };
});
it('응답 유실은 원문을 보존하고 다시 열린 화면이 같은 ID로 재개한다', async () => {
    mocks.call.mockRejectedValueOnce(new Error('network'));
    await expect(applyPartnerAdvance('taebaek', input)).rejects.toThrow();
    const pending = readPendingPartnerAdvance('taebaek')!;
    expect(pending.input).toEqual(input);
    mocks.call.mockResolvedValueOnce({
        data: {
            status: 'duplicate', id: 'advance-apply-1', docNo: '대체261008-001'
        }
    });
    await applyPartnerAdvance('taebaek', pending.input as typeof input);
    expect(mocks.call.mock.calls.map(row => row[0].operationId)).toEqual(['apply-1', 'apply-1']);
    expect(sessionStorage.getItem(key)).toBeNull();
});
it('결과불명 원문이 있을 때 변경한 금액은 보내지 않는다', async () => {
    mocks.call.mockRejectedValueOnce(new Error('network'));
    await expect(applyPartnerAdvance('taebaek', input)).rejects.toThrow();
    await expect(applyPartnerAdvance('taebaek', {
        ...input, amount: 40, operationId: 'apply-2'
    })).rejects.toThrow('이전');
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(readPendingPartnerAdvance('taebaek')?.input.operationId).toBe('apply-1');
});
it('서버 durable 거절의 정확 원문 증거만 대기를 해제한다', async () => {
    mocks.call.mockRejectedValueOnce({
        details: {
            partnerAdvanceFailure: {
                version: 1, companyId: 'taebaek', partnerId: 'p', actorId: 'uid', operationId: 'apply-1', operationRejected: true, financialWrites: false, commandHash: 'a'.repeat(64), command: input
            }
        }
    });
    await expect(applyPartnerAdvance('taebaek', input)).rejects.toBeDefined();
    expect(sessionStorage.getItem(key)).toBeNull();
});
it('다른 원문 거절 또는 native 오류는 대기원문을 지우지 않는다', async () => {
    mocks.call.mockRejectedValueOnce({
        details: {
            partnerAdvanceFailure: {
                version: 1, companyId: 'taebaek', partnerId: 'p', actorId: 'uid', operationId: 'apply-1', operationRejected: true, financialWrites: false, commandHash: 'a'.repeat(64), command: {
                    ...input, amount: 40
                }
            }
        }
    });
    await expect(applyPartnerAdvance('taebaek', input)).rejects.toBeDefined();
    expect(readPendingPartnerAdvance('taebaek')?.input).toEqual(input);
});
it('손상된 저장원문은 삭제하거나 새 요청으로 덮지 않는다', async () => {
    const encoded = JSON.stringify({
        version: 1, companyId: 'taebaek', actorId: 'uid', action: 'apply', input: {
            ...input, amount: '60'
        }
    });
    sessionStorage.setItem(key, encoded);
    expect(() => readPendingPartnerAdvance('taebaek')).toThrow('확인');
    await expect(applyPartnerAdvance('taebaek', input)).rejects.toThrow('이전');
    expect(mocks.call).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(key)).toBe(encoded);
});
it('회사 권한·유효 입력 검증 실패는 송신도 대기원문 생성도 하지 않는다', async () => {
    mocks.token.mockResolvedValue({
        claims: {
            isAdmin: true, companyId: 'punghoe'
        }
    });
    await expect(applyPartnerAdvance('taebaek', input)).rejects.toThrow('권한');
    expect(mocks.call).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    mocks.token.mockResolvedValue({
        claims: {
            isAdmin: true, companyId: 'taebaek'
        }
    });
    await expect(applyPartnerAdvance('taebaek', {
        ...input, amount: 0
    })).rejects.toThrow('입력');
    expect(sessionStorage.length).toBe(0);
});
it('늦은 응답은 다른 요청이 저장한 원문을 삭제하지 않는다', async () => {
    mocks.call.mockImplementationOnce(async () => {
        sessionStorage.setItem(key, 'other-pending');
        return {
            data: {
                status: 'applied', id: 'advance-apply-1', docNo: '대체261008-001'
            }
        };
    });
    await applyPartnerAdvance('taebaek', input);
    expect(sessionStorage.getItem(key)).toBe('other-pending');
});
it('송신 뒤 다른 로그인으로 바뀌면 성공 응답도 이전 원문을 지우지 않는다', async () => {
    mocks.call.mockImplementationOnce(async () => {
        mocks.auth.currentUser = {
            uid: 'other', getIdTokenResult: mocks.token
        };
        return {
            data: {
                status: 'applied', id: 'advance-apply-1', docNo: '대체261008-001'
            }
        };
    });
    await expect(applyPartnerAdvance('taebaek', input)).rejects.toThrow('로그인');
    expect(JSON.parse(localStorage.getItem(advanceBodyKey(scope, 'apply-1'))!).input).toEqual(input);
});
it('준비 조회가 끝난 뒤 회사 권한이 바뀌면 이전 결과를 반환하지 않는다', async () => {
    mocks.call.mockImplementationOnce(async () => {
        mocks.token.mockResolvedValue({
            claims: {
                isAdmin: true, companyId: 'punghoe'
            }
        });
        return {
            data: {
                enabled: true
            }
        };
    });
    await expect(preparePartnerAdvance('taebaek', 'p')).rejects.toThrow('권한');
});
const scope: AdvanceRecoveryScope = {
    companyId: 'taebaek', actorId: 'uid', partnerId: 'p'
};
const pending: PendingPartnerAdvance = {
    version: 1, companyId: 'taebaek', actorId: 'uid', action: 'apply', input
};
function recovery() {
    const hash = vi.fn(async (value: PendingPartnerAdvance) => createHash('sha256').update(JSON.stringify(value)).digest('hex'));
    let current = true, status: 'applied' | 'rejected' | 'cancelled' | 'unknown' = 'unknown', serverHash: string | null = null;
    const command = vi.fn<AdvanceRecoveryPort['command']>(async (value: any) => value.mode === 'listHistory' ? {
        version: 1, ...scope, entries: [], nextCursor: 'next'
    } : {
        version: 1, reference: value.reference, actorId: 'uid', status, requestHash: serverHash, message: '실제 서버 ' + status, ...(['applied', 'rejected'].includes(status) ? {
            action: 'apply', statementId: 'issued', docNo: '대체-1'
        } : {})
    });
    const apply = vi.fn(async () => {
        status = 'applied';
        serverHash = await hash(pending);
        return {
            status: 'applied', id: 'issued', docNo: '대체-1'
        };
    });
    const assertScope = vi.fn(async (s: AdvanceRecoveryScope, isCurrent: () => boolean) => {
        if (!current || !isCurrent() || s.actorId !== 'uid')
            throw Error('scope changed');
    });
    const service = createPartnerAdvanceRecovery({
        storage: localStorage, legacyStorage: sessionStorage, digest: hash, assertScope, command, apply
    });
    return {
        service, hash, command, apply, assertScope, setCurrent: (value: boolean) => { current = value; }, server: (value: typeof status, h: string | null) => { status = value; serverHash = h; }
    };
}
it('최초 송신 전에 본문과 독립 참조를 읽기대조하고 적용 뒤 readonly 조회로 종결한다', async () => {
    const r = recovery();
    r.apply.mockImplementationOnce(async () => {
        expect(localStorage.getItem(advanceBodyKey(scope, 'apply-1'))).not.toBeNull();
        expect(localStorage.getItem(advanceReferenceKey(scope, 'apply-1'))).not.toBeNull();
        r.server('applied', await r.hash(pending));
        return {
            status: 'applied', id: 'issued', docNo: '대체-1'
        };
    });
    const result = await r.service.submit(scope, pending);
    expect(result.outcome.status).toBe('saved');
    expect(r.command).toHaveBeenCalledWith({
        mode: 'inspect', reference: {
            companyId: 'taebaek', partnerId: 'p', operationId: 'apply-1'
        }
    });
    expect(localStorage.length).toBe(0);
});
it('실제 결과 확인과 미처리 중단은 금융 apply를 호출하지 않는다', async () => {
    const r = recovery(), entry = await r.service.persist(scope, pending, () => true);
    await r.service.resolve(scope, entry, 'inspect');
    r.server('cancelled', null);
    const result = await r.service.resolve(scope, entry, 'stop');
    expect(result.outcome.status).toBe('cancelled');
    expect(r.apply).not.toHaveBeenCalled();
    expect(r.command.mock.calls).toEqual([[{mode:'inspect',reference:entry.reference}],[{mode:'stop',reference:entry.reference}]]);
});
it('다른 유효 원문 hash의 완료는 현재 saved나 자동정리가 아니며 명시정리만 한다', async () => {
    const r = recovery(), entry = await r.service.persist(scope, pending, () => true);
    r.server('applied', 'b'.repeat(64));
    const result = await r.service.resolve(scope, entry, 'inspect');
    expect(result.copyMismatch).toBe(true);
    expect(result.outcome.status).toBe('rejected');
    expect(localStorage.getItem(entry.key)).toBe(entry.bodyText);
    expect((await r.service.discard(scope, entry)).status).toBe('cleared');
    expect(r.apply).not.toHaveBeenCalled();
});
it('해시 재계산 실패와 손상 본문도 reference-only 서버조회는 가능하고 자동정리하지 않는다', async () => {
    const r = recovery(), entry = await r.service.persist(scope, pending, () => true);
    localStorage.setItem(entry.key, '깨진 원문');
    r.server('applied', entry.requestHash);
    const damaged = (await r.service.read(scope))[0];
    const result = await r.service.resolve(scope, damaged, 'inspect');
    expect(result.copyMismatch).toBe(true);
    expect(localStorage.getItem(entry.key)).toBe('깨진 원문');
    expect((await r.service.discard(scope, damaged)).status).toBe('cleared');
});
it('원문과 참조가 없는 과거 서버 완료를 현재 초안의 ACK로 승격하지 않는다', async () => {
    const r = recovery();
    r.server('applied', 'a'.repeat(64));
    const result = await r.service.resolve(scope, {
        key: advanceBodyKey(scope, 'past'), bodyText: null, sidecarKey: null, sidecarText: null, reference: {
            companyId: 'taebaek', partnerId: 'p', operationId: 'past'
        }, request: null, requestHash: null, sidecarHash: null, status: 'missing', description: '과거'
    }, 'inspect');
    expect(result.copyMismatch).toBe(true);
    expect(result.terminal).toBe(false);
    expect(result.outcome.status).toBe('rejected');
    expect(result.outcome).toMatchObject({message:expect.stringContaining('보관 원문이 없습니다'),nextAction:expect.stringContaining('현재 입력은 그대로')});
    expect(JSON.stringify(result.outcome)).not.toContain('사본만 명시적으로 정리');
});
it('미확정 서버 상태에서는 명시 사본정리도 거절하고 보관한다', async () => {
    const r = recovery(), entry = await r.service.persist(scope, pending, () => true);
    expect((await r.service.discard(scope, entry)).status).toBe('blocked');
    expect(localStorage.getItem(entry.key)).toBe(entry.bodyText);
});
it('사본정리 응답 대기 중 참조 교체는 새 본문과 참조를 지우지 않는다', async () => {
    const r = recovery(), entry = await r.service.persist(scope, pending, () => true);
    r.command.mockImplementationOnce(async (value: any) => {
        localStorage.setItem(entry.sidecarKey!, '새 참조');
        return {
            version: 1, reference: value.reference, actorId: 'uid', status: 'cancelled', requestHash: null, message: '중단'
        };
    });
    expect((await r.service.discard(scope, entry)).status).toBe('blocked');
    expect(localStorage.getItem(entry.key)).toBe(entry.bodyText);
    expect(localStorage.getItem(entry.sidecarKey!)).toBe('새 참조');
});
it('보관 읽기대조 실패는 금융 요청을 보내지 않는다', async () => {
    const r = recovery(), spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { });
    try {
        const result = await r.service.submit(scope, pending);
        expect(result.outcome.status).toBe('rejected');
        expect(r.apply).not.toHaveBeenCalled();
    }
    finally {
        spy.mockRestore();
    }
});
it('서버 완료 뒤 기기 정리 실패는 partial이고 금융 재송신을 권하지 않는다', async () => {
    const r = recovery(), entry = await r.service.persist(scope, pending, () => true);
    r.server('applied', entry.requestHash);
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { });
    try {
        const result = await r.service.resolve(scope, entry, 'inspect');
        expect(result.outcome.status).toBe('partial');
        expect(result.terminal).toBe(false);
    }
    finally {
        spy.mockRestore();
    }
});
it('동일 원문 재시도 직전 인증 await 중 참조가 바뀌면 금융 apply는 0이다', async () => {
    const r = recovery(), entry = await r.service.persist(scope, pending, () => true);
    r.assertScope.mockImplementationOnce(async () => { localStorage.setItem(entry.sidecarKey!, '다른 참조'); });
    await r.service.retry(scope, entry);
    expect(r.apply).not.toHaveBeenCalled();
});
it('손상된 legacy도 번호를 식별하면 readonly 조회만 하며 완전 손상은 가짜조회하지 않는다', async () => {
    const r = recovery();
    sessionStorage.setItem(key, JSON.stringify({
        ...pending, input: {
            ...input, amount: '손상'
        }
    }));
    const entry = (await r.service.read(scope))[0];
    await r.service.resolve(scope, entry, 'inspect');
    expect(r.command).toHaveBeenCalledOnce();
    sessionStorage.setItem(key, '완전손상');
    const corrupt = (await r.service.read(scope))[0];
    await r.service.resolve(scope, corrupt, 'inspect');
    expect(r.command).toHaveBeenCalledOnce();
    expect((await r.service.discard(scope, corrupt)).status).toBe('cleared');
});
it('회사 UID 변경 뒤 응답을 버리고 명시 이력의 빈 페이지 cursor는 보존한다', async () => {
    const r = recovery(), entry = await r.service.persist(scope, pending, () => true);
    const page = await r.service.list(scope);
    expect(page.entries).toEqual([]);
    expect(page.nextCursor).toBe('next');
    r.command.mockImplementationOnce(async () => { r.setCurrent(false); return {}; });
    const result = await r.service.resolve(scope, entry, 'inspect');
    expect(result.outcome.status).toBe('unknown');
    expect(localStorage.getItem(entry.key)).toBe(entry.bodyText);
});
it('다른 거래처의 미완료 원문은 새 거래처의 요청을 막거나 덮지 않는다', async () => {
    const r = recovery();
    await r.service.persist(scope, pending, () => true);
    const other = {
        ...scope, partnerId: 'other'
    }, request = {
        ...pending, input: {
            ...input, partnerId: 'other', operationId: 'apply-other'
        }
    };
    await r.service.persist(other, request, () => true);
    expect(localStorage.getItem(advanceBodyKey(scope, 'apply-1'))).not.toBeNull();
    expect(localStorage.getItem(advanceBodyKey(other, 'apply-other'))).not.toBeNull();
});
it('동시에 다른 요청을 준비해도 같은 회사 UID 거래처의 한 원문만 확정한다', async () => {
    const r = recovery();
    const results = await Promise.allSettled([r.service.persist(scope, pending, () => true), r.service.persist(scope, {
            ...pending, input: {
                ...input, operationId: 'apply-two'
            }
        }, () => true)]);
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect((await r.service.read(scope))).toHaveLength(1);
});
it('digest await 중 같은 키 새 원문이 생기면 기존 사본을 덮거나 전송하지 않는다', async () => {
    const r = recovery();
    r.hash.mockImplementationOnce(async () => { localStorage.setItem(advanceBodyKey(scope, 'apply-1'), '교체된 원문'); return 'a'.repeat(64); });
    const result = await r.service.submit(scope, pending);
    expect(result.outcome.status).toBe('rejected');
    expect(localStorage.getItem(advanceBodyKey(scope, 'apply-1'))).toBe('교체된 원문');
    expect(r.apply).not.toHaveBeenCalled();
});
it('본문 operation과 독립 참조 번호가 다르면 유효한 형태여도 재송신하지 않는다', async () => {
    const r = recovery(), entry = await r.service.persist(scope, pending, () => true), other = {
        ...pending, input: {
            ...input, operationId: 'other'
        }
    };
    const hash = await r.hash(other);
    localStorage.setItem(entry.key, JSON.stringify(other));
    localStorage.setItem(entry.sidecarKey!, JSON.stringify({
        version: 1, actorId: 'uid', reference: entry.reference, requestHash: hash
    }));
    const row = (await r.service.read(scope))[0];
    expect(row.status).toBe('corrupt');
    await r.service.retry(scope, row);
    expect(r.apply).not.toHaveBeenCalled();
});
