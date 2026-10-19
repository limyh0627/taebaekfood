import { expect, it, vi } from 'vitest';
import { executeAccountManagementCommand, accountManagementReceiptId } from './accountManagementCommand';
const reference = { companyId: 'taebaek' as const, planId: 'p', kind: 'code' as const, targetId: 'c' };
it('실 Rules와 같은 관리자·직원·회사 인증과 malformed는 TX 전에 거절한다', async () => {
  const runTransaction = vi.fn(), db = { runTransaction } as never;
  await expect(executeAccountManagementCommand(db, undefined, { mode: 'inspect', reference })).rejects.toMatchObject({ code: 'unauthenticated' });
  for (const token of [{ companyId: 'taebaek', employeeId: 'e' }, { companyId: 'punghoe', employeeId: 'e', isAdmin: true }]) {
    await expect(executeAccountManagementCommand(db, { uid: 'u', token }, { mode: 'inspect', reference })).rejects.toMatchObject({ code: 'permission-denied' });
  }
  await expect(executeAccountManagementCommand(db, { uid: 'u', token: { companyId: 'taebaek', employeeId: 'e', isAdmin: true } }, { mode: 'apply', request: {} } as never)).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(runTransaction).not.toHaveBeenCalled();
});
it('영수증 주소는 회사 UID 계획을 모두 결합한다', () => {
  expect(accountManagementReceiptId('taebaek', 'u', 'p')).not.toBe(accountManagementReceiptId('taebaek', 'v', 'p'));
  expect(accountManagementReceiptId('taebaek', 'u', 'p')).not.toBe(accountManagementReceiptId('punghoe', 'u', 'p'));
});
