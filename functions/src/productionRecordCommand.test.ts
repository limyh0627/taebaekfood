import { it, expect, vi } from 'vitest';
import { executeProductionRecordCommand, productionRecordReceiptId } from './productionRecordCommand';
const reference = { companyId: 'taebaek' as const, planId: 'p', targetId: '한글 생산실적' };
it('미인증·회사·직원 claim과 형식 오류는 업무 조회 전에 거절한다', async () => {
    const runTransaction = vi.fn(), collection = vi.fn(), db = { runTransaction, collection } as never;
    await expect(executeProductionRecordCommand(db, undefined, { mode: 'inspect', reference })).rejects.toMatchObject({ code: 'unauthenticated' });
    for (const token of [{ employeeId: 1, companyId: 'taebaek' }, { employeeId: 'e', companyId: 'punghoe' }])
        await expect(executeProductionRecordCommand(db, { uid: 'u', token }, { mode: 'inspect', reference })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(executeProductionRecordCommand(db, { uid: 'u', token: { employeeId: '', companyId: 'taebaek' } }, { mode: 'apply', request: {} } as never)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(runTransaction).not.toHaveBeenCalled();
    expect(collection).not.toHaveBeenCalled();
});
it('영수증 키는 회사·UID·계획·대상을 모두 결합한다', () => {
    const key = productionRecordReceiptId(reference, 'u');
    expect(key).not.toBe(productionRecordReceiptId(reference, 'v'));
    expect(key).not.toBe(productionRecordReceiptId({ ...reference, companyId: 'punghoe' }, 'u'));
    expect(key).not.toBe(productionRecordReceiptId({ ...reference, targetId: '다른실적' }, 'u'));
    expect(key).not.toBe(productionRecordReceiptId({ ...reference, planId: 'q' }, 'u'));
});
