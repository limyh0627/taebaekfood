import { it, expect, vi } from 'vitest';
import { executePartnerEditCommand, partnerEditReceiptId } from './partnerEditCommand';
const reference = { companyId: 'taebaek' as const, planId: 'p', targetId: '상호' };
it('로그인·직원 claim·회사·형식을 업무 조회 전에 검증하며 관리자 전용으로 강화하지 않는다', async () => {
    const runTransaction = vi.fn(), collection = vi.fn(), db = { runTransaction, collection } as never;
    await expect(executePartnerEditCommand(db, undefined, { mode: 'inspect', reference })).rejects.toMatchObject({ code: 'unauthenticated' });
    for (const token of [{ employeeId: 1, companyId: 'taebaek' }, { employeeId: 'e', companyId: 'punghoe' }])
        await expect(executePartnerEditCommand(db, { uid: 'u', token }, { mode: 'inspect', reference })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(executePartnerEditCommand(db, { uid: 'u', token: { employeeId: '', companyId: 'taebaek', isAdmin: false } }, { mode: 'apply', request: {} } as never)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(runTransaction).not.toHaveBeenCalled();
    expect(collection).not.toHaveBeenCalled();
});
it('처리 영수증은 회사·UID·계획·대상을 모두 결합한다', () => {
    const key = partnerEditReceiptId('taebaek', 'u', 'p', 'a');
    expect(key).not.toBe(partnerEditReceiptId('taebaek', 'v', 'p', 'a'));
    expect(key).not.toBe(partnerEditReceiptId('punghoe', 'u', 'p', 'a'));
    expect(key).not.toBe(partnerEditReceiptId('taebaek', 'u', 'p', 'b'));
});
