// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
vi.mock('../../../shared/firebase', () => ({
    auth: { currentUser: null }, authReady: Promise.resolve(), db: {}, functions: {}
}));
vi.mock('../../../shared/services/firebaseService', () => ({ companyScopedWriteData: vi.fn() }));
import { createPartnerPaymentRecovery, type PartnerPaymentRecoveryPort, type PartnerPaymentRecoveryEntry } from './partnerPaymentRecovery';
import { serializePartnerPaymentRequest } from '../../../shared/partnerPaymentRecovery';
const scope = {
    companyId: 'taebaek' as const, actorUid: 'actor', partnerId: 'partner'
};
const key = 'partner-payment-pending:taebaek:partner:actor';
const request = {
    tradeDate: '2026-10-19', partnerId: 'partner', direction: '입금' as const, amount: 100, cashAccountId: 'bank', pin: false, allocations: [], note: '최초100원', operationId: 'op', expectedRevision: 2, releaseId: 'release'
};
const reference = {
    companyId: 'taebaek' as const, partnerId: 'partner', operationId: 'op'
};
const hash = async (value: Record<string, unknown>) => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serializePartnerPaymentRequest(value)))).toString('hex');
let map: Map<string, string>, port: PartnerPaymentRecoveryPort;
beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto);
    map = new Map();
    port = {
        storage: {
            get length() {
                return map.size;
            }, key: i => [...map.keys()][i] ?? null, getItem: k => map.get(k) ?? null, setItem: (k, v) => {
                map.set(k, v);
            }, removeItem: k => {
                map.delete(k);
            }
        }, assertScope: vi.fn(async () => { }), command: vi.fn(), apply: vi.fn(async () => ({ status: 'duplicate', id: 'op' }))
    };
});
async function seed() {
    const { operationId, expectedRevision, releaseId, ...business } = request;
    map.set(key, JSON.stringify({
        version: 2, fingerprint: JSON.stringify(business), request
    }));
    return (await createPartnerPaymentRecovery(port).read(scope))[0];
}
async function reply(status = 'applied') {
    return {
        version: 1, reference, actorUid: 'actor', status, requestHash: status === 'cancelled' || status === 'unknown' ? null : await hash(request), message: '실서버 ' + status, ...(status === 'applied' ? { cashEntryId: 'op', docNo: 'REC-1' } : {})
    };
}
it('잔액과 날짜가 바뀌어도 보관된 최초100원 원문을 읽고 서버 완료 뒤 정확 사본만 정리한다', async () => {
    const entry = await seed(), service = createPartnerPaymentRecovery(port);
    expect(entry.request).toEqual(request);
    vi.mocked(port.command).mockResolvedValue(await reply());
    expect(await service.resolve(scope, entry, 'inspect')).toMatchObject({ terminal: true, outcome: { status: 'saved' } });
    expect(port.command).toHaveBeenCalledExactlyOnceWith({ mode: 'inspect', reference });
    expect(map.size).toBe(0);
    expect(port.apply).not.toHaveBeenCalled();
});
it('동일 요청 retry는 현재 입력 재구성·release 재조회 없이 최초 원문만 전송한다', async () => {
    const entry = await seed(), service = createPartnerPaymentRecovery(port);
    vi.mocked(port.command).mockResolvedValue(await reply());
    expect((await service.retry(scope, entry)).outcome.status).toBe('saved');
    expect(port.apply).toHaveBeenCalledExactlyOnceWith(request);
    expect(map.size).toBe(0);
});
it('retry auth대기 중 새 참조가 바뀌면 본문을 보존하고 송신하지 않는다', async () => {
    const entry = await seed(), service = createPartnerPaymentRecovery(port);
    let checks = 0;
    port.assertScope = vi.fn(async () => {
        if (++checks === 2)
            map.set(key + ':ref:op', '교체참조');
    });
    expect((await service.retry(scope, entry)).outcome.status).toBe('unknown');
    expect(port.apply).not.toHaveBeenCalled();
    expect(map.get(key)).toBe(entry.bodyText);
    expect(map.get(key + ':ref:op')).toBe('교체참조');
});
it('다른 유효 해시와 손상 원문은 서버 applied를 현재 saved로 오판하거나 자동 삭제하지 않는다', async () => {
    const entry = await seed(), service = createPartnerPaymentRecovery(port);
    vi.mocked(port.command).mockResolvedValue({ ...await reply(), requestHash: 'f'.repeat(64) });
    expect(await service.resolve(scope, entry, 'inspect')).toMatchObject({
        copyMismatch: true, terminal: false, outcome: { status: 'rejected' }
    });
    expect(map.get(key)).toBe(entry.bodyText);
    map.set(key, '{"operationId":"op", broken');
    const damaged = (await service.read(scope))[0];
    expect(damaged.request).toBeNull();
    expect((await service.resolve(scope, damaged, 'cancel')).copyMismatch).toBe(true);
    expect(map.get(key)).toBe(damaged.bodyText);
});
it('명시 사본 정리는 terminal 재확인 뒤 정확 관측 사본만 지우며 업무는 재송신하지 않는다', async () => {
    const entry = await seed(), service = createPartnerPaymentRecovery(port);
    vi.mocked(port.command).mockResolvedValue(await reply());
    expect((await service.discard(scope, entry)).status).toBe('cleared');
    expect(map.size).toBe(0);
    expect(port.apply).not.toHaveBeenCalled();
});
it('unknown·잘못된 UID응답·조회 중 교체된 사본은 정리하지 않는다', async () => {
    const entry = await seed(), service = createPartnerPaymentRecovery(port);
    vi.mocked(port.command).mockResolvedValue(await reply('unknown'));
    expect((await service.discard(scope, entry)).status).toBe('blocked');
    vi.mocked(port.command).mockResolvedValue({ ...await reply(), actorUid: 'other' });
    expect((await service.resolve(scope, entry, 'inspect')).outcome.status).toBe('unknown');
    vi.mocked(port.command).mockImplementation(async () => {
        map.set(key, '교체사본');
        return reply();
    });
    expect((await service.discard(scope, entry)).status).toBe('unknown');
    expect(map.get(key)).toBe('교체사본');
});
it('v1은 번호조회·중단만 허용하고 release나 원문을 추정해 retry하지 않는다', async () => {
    map.set(key, JSON.stringify({
        operationId: 'op', revision: 2, fingerprint: 'legacy'
    }));
    const service = createPartnerPaymentRecovery(port), entry = (await service.read(scope))[0];
    expect(entry.reference).toEqual(reference);
    expect(entry.status).toBe('legacy');
    expect((await service.retry(scope, entry)).outcome.status).toBe('unknown');
    expect(port.apply).not.toHaveBeenCalled();
    vi.mocked(port.command).mockResolvedValue(await reply('cancelled'));
    expect((await service.resolve(scope, entry, 'cancel')).copyMismatch).toBe(true);
    expect(map.size).toBe(1);
    expect((await service.discard(scope, entry)).status).toBe('cleared');
});
it('완전 손상은 서버20건 이력의 후보와 자동 연결하지 않고 사본정리의 한계를 알린다', async () => {
    map.set(key, '{broken');
    const service = createPartnerPaymentRecovery(port), entry = (await service.read(scope))[0];
    expect(entry.reference).toBeNull();
    vi.mocked(port.command).mockResolvedValue({
        version: 1, companyId: 'taebaek', partnerId: 'partner', actorUid: 'actor', entries: [await reply()], nextCursor: 'op'
    });
    expect((await service.list(scope)).entries).toHaveLength(1);
    expect(map.get(key)).toBe('{broken');
    expect((await service.discard(scope, entry)).message).toContain('서버 요청 중단');
    expect(port.command).toHaveBeenCalledTimes(1);
});
it('다른 계정·거래처 키로 사본을 정리하려 하면 실제 명령이나 삭제를 하지 않는다', async () => {
    const entry = await seed(), service = createPartnerPaymentRecovery(port);
    expect((await service.discard(scope, { ...entry, key: 'partner-payment-pending:taebaek:other:actor' })).status).toBe('unknown');
    expect(port.command).not.toHaveBeenCalled();
    expect(map.get(key)).toBe(entry.bodyText);
});
it('손상된 별도참조도 서버 상태와 현재 사본 ACK를 구분하고 명시정리만 허용한다', async () => {
    await seed();
    map.set(key + ':ref:op', '{broken');
    const service = createPartnerPaymentRecovery(port), entry = (await service.read(scope))[0];
    vi.mocked(port.command).mockResolvedValue(await reply());
    expect((await service.resolve(scope, entry, 'inspect')).copyMismatch).toBe(true);
    expect(map.size).toBe(2);
    expect((await service.retry(scope, entry)).outcome.status).toBe('unknown');
    expect(port.apply).not.toHaveBeenCalled();
    expect((await service.discard(scope, entry)).status).toBe('cleared');
    expect(map.size).toBe(0);
});
it('번호를 해석할 수 없는 참조도 현재scope 사본으로만 보이며 다른계정 자료를 건드리지 않는다', async () => {
    map.set(key + ':ref:%bad', '손상');
    map.set('partner-payment-pending:taebaek:partner:other:ref:op', '다른계정');
    const service = createPartnerPaymentRecovery(port), entry = (await service.read(scope))[0];
    expect(entry.reference).toBeNull();
    expect((await service.discard(scope, entry)).status).toBe('cleared');
    expect(port.command).not.toHaveBeenCalled();
    expect(map.size).toBe(1);
});
it.each(['cancelled', 'rejected'] as const)('retry의 구조화 %s 예외는 refonly 조회의 실제 종결을 소비한다', async (status) => {
    const entry = await seed(), service = createPartnerPaymentRecovery(port);
    port.apply = vi.fn(async () => {
        throw { details: { [status === 'cancelled' ? 'partnerPaymentCancelled' : 'partnerPaymentFailure']: {
                    version: 1, companyId: 'taebaek', partnerId: 'partner', operationId: 'op', [status === 'cancelled' ? 'operationCancelled' : 'operationRejected']: true, financialWrites: false
                } } };
    });
    vi.mocked(port.command).mockResolvedValue(await reply(status));
    const outcome = await service.retry(scope, entry);
    expect(outcome).toMatchObject({ terminal: true, outcome: { status } });
    expect(port.command).toHaveBeenCalledExactlyOnceWith({ mode: 'inspect', reference });
    expect(map.size).toBe(0);
});

it('재시도는 변경 가능한 화면request객체가 아닌 관측한 최초 저장본문을 읽어 보낸다',async()=>{const entry=await seed(),service=createPartnerPaymentRecovery(port);entry.request!.amount=999;vi.mocked(port.command).mockResolvedValue(await reply());expect((await service.retry(scope,entry)).outcome.status).toBe('saved');expect(port.apply).toHaveBeenCalledExactlyOnceWith(request);});
it('다른회사 목록응답은 현재거래처 후보로 노출하지 않는다',async()=>{const service=createPartnerPaymentRecovery(port);vi.mocked(port.command).mockResolvedValue({version:1,companyId:'punghoe',partnerId:'partner',actorUid:'actor',entries:[],nextCursor:null});await expect(service.list(scope)).rejects.toThrow('목록');});
