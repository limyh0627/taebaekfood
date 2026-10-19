/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
const m = vi.hoisted(() => ({ auth: { currentUser: { uid: 'actor' } as {
            uid: string;
        } | null }, callback: undefined as undefined | ((user: User | null) => void) }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (u: User | null) => void) => {
        m.callback = callback;
        return () => { };
    } }));
vi.mock('../../../shared/firebase', () => ({ auth: m.auth, authReady: Promise.resolve() }));
vi.mock('../../../shared/components/appDialog', () => ({ appConfirm: vi.fn(async () => true) }));
vi.mock('../infrastructure/issueTradeStatementCommand', () => ({
    recordPartnerPayment: vi.fn(), readPartnerPaymentRecoveries: vi.fn(), resolvePartnerPaymentRecovery: vi.fn(), retryPartnerPaymentRecovery: vi.fn(), discardPartnerPaymentCopy: vi.fn(), listPartnerPaymentHistory: vi.fn()
}));
vi.mock('../infrastructure/partnerPaymentRecovery', async (importOriginal) => ({
    ...await importOriginal<typeof import('../infrastructure/partnerPaymentRecovery')>(), readPartnerPaymentRecoveries: vi.fn(), resolvePartnerPaymentRecovery: vi.fn(), retryPartnerPaymentRecovery: vi.fn(), discardPartnerPaymentCopy: vi.fn(), listPartnerPaymentHistory: vi.fn()
}));
import { usePartnerPaymentRecovery } from './usePartnerPaymentRecovery';
import {PartnerPaymentTerminalError} from '../infrastructure/partnerPaymentRecovery';
import type { PartnerPaymentRecoveryEntry, PartnerPaymentRecoveryOutcome } from '../infrastructure/issueTradeStatementCommand';
const options = {
    companyId: 'taebaek' as const, partnerId: 'partner', partnerName: '거래처', type: '매출' as const, balance: 500, cashAccounts: [{
            id: 'bank', companyId: 'taebaek' as const, name: '통장', active: true
        }] as Parameters<typeof usePartnerPaymentRecovery>[0]['cashAccounts']
};
const request = {
    tradeDate: '2026-10-18', partnerId: 'partner', direction: '입금' as const, amount: 100, cashAccountId: 'bank', pin: false, allocations: [], note: '최초원문', operationId: 'old', expectedRevision: 2, releaseId: 'release'
};
const entry: PartnerPaymentRecoveryEntry = {
    key: 'body', bodyText: '최초raw', sidecarKey: 'side', sidecarText: '참조raw', reference: {
        companyId: 'taebaek', partnerId: 'partner', operationId: 'old'
    }, request, requestHash: 'a'.repeat(64), sidecarHash: 'a'.repeat(64), status: 'valid', description: '원100원'
};
type Services = NonNullable<Parameters<typeof usePartnerPaymentRecovery>[1]>;
function services() {
    return {
        save: vi.fn<Services['save']>(async () => { }), read: vi.fn<Services['read']>(async () => [] as PartnerPaymentRecoveryEntry[]), resolve: vi.fn<Services['resolve']>(async (): Promise<PartnerPaymentRecoveryOutcome> => ({ terminal: false, outcome: {
                status: 'unknown', message: '서버확인중', nextAction: '원문보존'
            } })), retry: vi.fn<Services['retry']>(async (): Promise<PartnerPaymentRecoveryOutcome> => ({ terminal: false, outcome: {
                status: 'unknown', message: '확인중', nextAction: '확인'
            } })), discard: vi.fn<Services['discard']>(async () => ({ status: 'cleared' as const, message: '기기사본만 정리' })), list: vi.fn<Services['list']>(async () => ({
            version: 1 as const, companyId: 'taebaek' as const, partnerId: 'partner', actorUid: 'actor', entries: [], nextCursor: null
        }))
    };
}
beforeEach(() => {
    m.auth.currentUser = { uid: 'actor' };
    m.callback = undefined;
});
it('최초 보관조회가 끝나기 전 save는 송신하지 않고 정상 준비 뒤 기존 잔액을 표시한다', async () => {
    const p = services();
    let done!: (rows: PartnerPaymentRecoveryEntry[]) => void;
    p.read.mockImplementationOnce(() => new Promise(r => done = r));
    const hook = renderHook(() => usePartnerPaymentRecovery(options, p));
    await waitFor(() => expect(p.read).toHaveBeenCalledOnce());
    expect(hook.result.current.ready).toBe(false);
    await act(async () => {
        await hook.result.current.save();
    });
    expect(p.save).not.toHaveBeenCalled();
    await act(async () => done([]));
    expect(hook.result.current.ready).toBe(true);
    expect(hook.result.current.amount).toBe('500');
});
it('잔액날짜가 바뀐 재열기에도 최초100원 원문을 표시하고 미확정 입력을 잠근다', async () => {
    const p = services();
    p.read.mockResolvedValue([entry]);
    const hook = renderHook(() => usePartnerPaymentRecovery({ ...options, initialDate: '2026-10-19' }, p));
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(hook.result.current.amount).toBe('100');
    expect(hook.result.current.date).toBe('2026-10-18');
    act(() => hook.result.current.setAmount('999'));
    expect(hook.result.current.amount).toBe('100');
    await act(async () => {
        await hook.result.current.save();
    });
    expect(p.save).not.toHaveBeenCalled();
});
it('정확 원문 inspect saved만 해당 창을 완료하고 사본정리는 업무완료로 닫지 않는다', async () => {
    const p = services(), onClose = vi.fn();
    p.read.mockResolvedValue([entry]);
    p.resolve.mockImplementation(async () => {
        p.read.mockResolvedValue([]);
        return { terminal: true, outcome: { status: 'saved' } };
    });
    const hook = renderHook(() => usePartnerPaymentRecovery({ ...options, onClose }, p));
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    await act(async () => {
        await hook.result.current.inspect();
    });
    expect(onClose).toHaveBeenCalledOnce();
    expect(p.resolve.mock.calls[0][1]).toBe(entry);
});
it('다른 사본의 서버 성공은 원인만 표시하고 현재 초안을 완료하지 않는다', async () => {
    const p = services(), onClose = vi.fn();
    p.read.mockResolvedValue([entry]);
    p.resolve.mockResolvedValue({
        terminal: false, copyMismatch: true, outcome: { status: 'rejected', message: '다른원문 먼저완료' }
    });
    const hook = renderHook(() => usePartnerPaymentRecovery({ ...options, onClose }, p));
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    await act(async () => {
        await hook.result.current.inspect();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(hook.result.current.message).toContain('다른원문');
    expect(hook.result.current.locked).toBe(true);
});
it('선택한 둘째 요청은 unknown조회 뒤에도 같은 원문표시와 선택을 유지한다', async () => {
    const p = services(), second = {
        ...entry, key: 'body2', reference: { ...entry.reference!, operationId: 'second' }, request: {
            ...request, operationId: 'second', amount: 200, tradeDate: '2026-10-17'
        }
    };
    p.read.mockResolvedValue([entry, second]);
    const hook = renderHook(() => usePartnerPaymentRecovery(options, p));
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    act(() => hook.result.current.selectEntry(second));
    expect(hook.result.current.amount).toBe('200');
    await act(async () => {
        await hook.result.current.inspect();
    });
    expect(hook.result.current.selectedEntry).toBe(second);
    expect(hook.result.current.amount).toBe('200');
    expect(hook.result.current.date).toBe('2026-10-17');
});
it('동일UID 거래처 변경 뒤 옛 save 참조는 새 거래처에 이전 초안을 보내지 않는다', async () => {
    const p = services(), hook = renderHook(({ partnerId }) => usePartnerPaymentRecovery({ ...options, partnerId }, p), { initialProps: { partnerId: 'partner' } });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    const oldSave = hook.result.current.save;
    hook.rerender({ partnerId: 'other' });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    await act(async () => {
        await oldSave();
    });
    expect(p.save).not.toHaveBeenCalled();
});
it('UID전환은 이전요청과 늦은 ACK를 새계정 폼에 노출하거나 닫지 않는다', async () => {
    const p = services(), onClose = vi.fn();
    let done!: () => void;
    p.save.mockImplementationOnce(() => new Promise(r => done = r));
    const hook = renderHook(() => usePartnerPaymentRecovery({ ...options, onClose }, p));
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    let saving!: Promise<void>;
    act(() => {
        saving = hook.result.current.save();
    });
    await waitFor(() => expect(p.save).toHaveBeenCalledOnce());
    act(() => {
        m.auth.currentUser = { uid: 'other' };
        m.callback?.(m.auth.currentUser as User);
    });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    act(() => hook.result.current.setAmount('700'));
    await act(async () => {
        done();
        await saving;
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(hook.result.current.amount).toBe('700');
    expect(hook.result.current.busy).toBe(false);
});
it('보관목록 읽기 실패는 저장을 막고 명시 재조회 성공 뒤에만 준비한다', async () => {
    const p = services();
    p.read.mockRejectedValueOnce(Error('저장소거절'));
    const hook = renderHook(() => usePartnerPaymentRecovery(options, p));
    await waitFor(() => expect(hook.result.current.readFailed).toBe(true));
    await act(async () => {
        await hook.result.current.save();
    });
    expect(p.save).not.toHaveBeenCalled();
    await act(async () => {
        await hook.result.current.refresh();
    });
    expect(hook.result.current.ready).toBe(true);
    expect(hook.result.current.readFailed).toBe(false);
});
it('사본정리는 관측entry를 그대로 전달하고 새 현금기록·상계·창완료를 호출하지 않는다', async () => {
    const p = services(), onClose = vi.fn();
    p.read.mockResolvedValue([entry]);
    p.discard.mockImplementation(async () => {
        p.read.mockResolvedValue([]);
        return { status: 'cleared', message: '이기기사본만 정리' };
    });
    const hook = renderHook(() => usePartnerPaymentRecovery({ ...options, onClose }, p));
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    await act(async () => {
        await hook.result.current.discardCopy();
    });
    expect(p.discard.mock.calls[0][1]).toBe(entry);
    expect(p.save).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(hook.result.current.message).toContain('사본만');
});
it('서버 목록0건도 조회완료와 미처리추정금지를 명시하고 현재 입력을 보존한다', async () => {
    const p = services(), hook = renderHook(() => usePartnerPaymentRecovery(options, p));
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    act(() => hook.result.current.setAmount('777'));
    await act(async () => {
        await hook.result.current.loadHistory();
    });
    expect(hook.result.current.message).toContain('조회 0건');
    expect(hook.result.current.message).toContain('미처리의 증거가 아닙니다');
    expect(hook.result.current.amount).toBe('777');
});
it('새 송신 뒤 보관목록 읽기까지 실패하면 입력을 잠그고 명시 재조회만 허용한다', async () => {
    const p = services();
    p.save.mockRejectedValueOnce(Error('응답유실'));
    const hook = renderHook(() => usePartnerPaymentRecovery(options, p));
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    p.read.mockRejectedValueOnce(Error('읽기거절'));
    await act(async () => {
        await hook.result.current.save();
    });
    expect(hook.result.current.readFailed).toBe(true);
    expect(hook.result.current.locked).toBe(true);
    act(() => hook.result.current.setAmount('999'));
    expect(hook.result.current.amount).toBe('500');
    expect(p.save).toHaveBeenCalledOnce();
});

it('검증된 미처리중단은 unknown 오류로 덮지 않고 원인과 새작성 안내를 표시한다',async()=>{const p=services(),onClose=vi.fn();p.save.mockRejectedValueOnce(new PartnerPaymentTerminalError({status:'cancelled',message:'서버 미처리 요청 중단',nextAction:'현재 목록 확인 후 새작성'}));const hook=renderHook(()=>usePartnerPaymentRecovery({...options,onClose},p));await waitFor(()=>expect(hook.result.current.ready).toBe(true));await act(async()=>{await hook.result.current.save();});expect(hook.result.current.message).toContain('서버 미처리 요청 중단');expect(hook.result.current.error).toBe('');expect(hook.result.current.locked).toBe(false);expect(onClose).not.toHaveBeenCalled();});

it('결제ACK 뒤 사본정리 partial은 안내를 유지하고 같은 업무를 다시 보내지 않는다',async()=>{const p=services(),onClose=vi.fn();p.read.mockResolvedValue([entry]);p.resolve.mockResolvedValue({terminal:true,serverResult:{version:1,reference:entry.reference!,actorUid:'actor',status:'applied',requestHash:'a'.repeat(64),message:'서버결제완료',cashEntryId:'old',docNo:'R1'},outcome:{status:'partial',reason:'followup-unconfirmed',committedIds:['old'],unconfirmedIds:[],message:'결제는 완료됐지만 사본정리 실패',nextAction:'다시결제하지말고정리'}});const hook=renderHook(()=>usePartnerPaymentRecovery({...options,onClose},p));await waitFor(()=>expect(hook.result.current.ready).toBe(true));await act(async()=>{await hook.result.current.inspect();});expect(onClose).not.toHaveBeenCalled();expect(hook.result.current.message).toContain('사본정리 실패');expect(hook.result.current.canRetryEntry(entry)).toBe(false);await act(async()=>{await hook.result.current.retry(entry);});expect(p.retry).not.toHaveBeenCalled();expect(p.resolve).toHaveBeenCalledTimes(2);expect(onClose).not.toHaveBeenCalled();});

it('최초 retry의 결제ACK·정리실패 partial은 창을 유지하고 다음 확인은 inspect만 수행한다',async()=>{
 const p=services(),onClose=vi.fn();p.read.mockResolvedValue([entry]);
 p.retry.mockResolvedValue({terminal:true,serverResult:{version:1,reference:entry.reference!,actorUid:'actor',status:'applied',requestHash:'a'.repeat(64),message:'서버결제완료',cashEntryId:'old',docNo:'R1'},outcome:{status:'partial',reason:'followup-unconfirmed',committedIds:['old'],unconfirmedIds:[],message:'결제 완료 · 사본정리 미확인',nextAction:'결제를 다시 보내지 말고 결과 확인'}});
 const hook=renderHook(()=>usePartnerPaymentRecovery({...options,onClose},p));await waitFor(()=>expect(hook.result.current.ready).toBe(true));
 await act(async()=>{await hook.result.current.retry(entry);});
 expect(onClose).not.toHaveBeenCalled();expect(hook.result.current.message).toContain('사본정리 미확인');expect(hook.result.current.canRetryEntry(entry)).toBe(false);expect(p.retry).toHaveBeenCalledOnce();
 await act(async()=>{await hook.result.current.retry(entry);});
 expect(onClose).not.toHaveBeenCalled();expect(p.retry).toHaveBeenCalledOnce();expect(p.resolve).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({actorUid:'actor',partnerId:'partner'}),entry,'inspect',expect.any(Function));
});

it('복구 전용은 현재 금액을 사용하지 않고 신규저장·입력변경·자동닫기를 하지 않는다', async () => {
    const p = services(), onClose = vi.fn();
    const hook = renderHook(() => usePartnerPaymentRecovery({ ...options, balance: 2891460, recoveryOnly: true, onClose }, p));
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(hook.result.current.amount).toBe('');
    expect(hook.result.current.date).toBe('');
    act(() => hook.result.current.setAmount('2891460'));
    await act(async () => { await hook.result.current.save(); });
    expect(p.save).not.toHaveBeenCalled();
    expect(hook.result.current.amount).toBe('');
    expect(hook.result.current.canStartNew()).toBe(true);
    act(() => { hook.result.current.close(); });
    expect(onClose).not.toHaveBeenCalled();
});

it('복구 전용은 과거 원문만 조회하고 applied 뒤에도 현재 전표창을 닫지 않는다', async () => {
    const p = services(), onClose = vi.fn();
    p.read.mockResolvedValueOnce([entry]).mockResolvedValue([]);
    p.resolve.mockResolvedValue({ terminal: true, outcome: { status: 'saved' } });
    const hook = renderHook(() => usePartnerPaymentRecovery({ ...options, balance: 2891460, recoveryOnly: true, onClose }, p));
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(hook.result.current.amount).toBe('100');
    expect(hook.result.current.canStartNew()).toBe(false);
    await act(async () => { await hook.result.current.inspect(); });
    expect(p.resolve.mock.calls[0][1]).toBe(entry);
    expect(p.save).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(hook.result.current.canStartNew()).toBe(true);
});

it('비활성·거래처 미선택에서는 조회와 복구 송신을 하지 않는다', async () => {
    const p = services();
    const hook = renderHook(() => usePartnerPaymentRecovery({ ...options, enabled: false, recoveryOnly: true }, p));
    await act(async () => { await Promise.resolve(); await hook.result.current.refresh(); await hook.result.current.loadHistory(); await hook.result.current.save(); });
    expect(p.read).not.toHaveBeenCalled(); expect(p.list).not.toHaveBeenCalled(); expect(p.save).not.toHaveBeenCalled();
    expect(hook.result.current.canStartNew()).toBe(false);
});

it('신규저장 진입 검사는 첫 조회와 같은 tick 복구 busy를 동기로 차단한다', async () => {
    const p = services();
    let finish!: (rows: PartnerPaymentRecoveryEntry[]) => void;
    p.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const hook = renderHook(() => usePartnerPaymentRecovery({ ...options, recoveryOnly: true }, p));
    await waitFor(() => expect(p.read).toHaveBeenCalledOnce());
    expect(hook.result.current.canStartNew()).toBe(false);
    await act(async () => finish([]));
    expect(hook.result.current.canStartNew()).toBe(true);
    let done!: (rows: PartnerPaymentRecoveryEntry[]) => void;
    p.read.mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
    let operation!: Promise<void>;
    act(() => { operation = hook.result.current.refresh(); expect(hook.result.current.isBusy()).toBe(true); expect(hook.result.current.canStartNew()).toBe(false); });
    await act(async () => { done([]); await operation; });
    expect(hook.result.current.canStartNew()).toBe(true);
});
