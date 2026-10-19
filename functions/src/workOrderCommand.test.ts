import { it, expect, vi } from 'vitest';
import { executeWorkOrderCommand, workOrderReceiptId, workOrderToday } from './workOrderCommand';
const reference = { companyId: 'taebaek' as const, planId: 'p' };
it('미인증·타회사·형식 오류는 업무 트랜잭션 전에 거절한다', async () => {
    const runTransaction = vi.fn(), db = { runTransaction } as never;
    await expect(executeWorkOrderCommand(db, undefined, { mode: 'inspect', reference })).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(executeWorkOrderCommand(db, { uid: 'u', token: { employeeId: 'e', companyId: 'punghoe' } }, { mode: 'inspect', reference })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(executeWorkOrderCommand(db, { uid: 'u', token: { employeeId: 1, companyId: 'taebaek' } }, { mode: 'inspect', reference })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(executeWorkOrderCommand(db, { uid: 'u', token: { employeeId: 'e', companyId: 'taebaek' } }, { mode: 'apply', request: {} } as never)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(runTransaction).not.toHaveBeenCalled();
});
it('영수증은 회사 UID 계획을 결합하며 공장 날짜는 기존 무패딩을 유지한다', () => {
    expect(workOrderReceiptId('taebaek', 'u', 'p')).not.toBe(workOrderReceiptId('taebaek', 'v', 'p'));
    expect(workOrderReceiptId('taebaek', 'u', 'p')).not.toBe(workOrderReceiptId('punghoe', 'u', 'p'));
    expect(workOrderToday(new Date('2026-10-06T16:00:00Z'))).toBe('2026-10-7');
});
