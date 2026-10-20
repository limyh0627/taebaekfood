import { expect, it } from 'vitest';
import { cashOriginalHash } from './cashMutationReceipt';
import { recoverStatementEdit, statementEditReceiptResult } from './statementEditRecovery';
const reference = { companyId: 'taebaek' as const, operationId: 'operation-1', statementId: 'statement' };
const actor = { uid: 'uid', token: { companyId: 'taebaek', isAdmin: true, employeeId: 'employee' } };
const receipt = { companyId: 'taebaek', uid: 'uid', statementId: 'statement', action: 'edit-statement', kind: 'issuedStatements', status: 'applied', requestHash: 'a'.repeat(64), revision: 1, expectedRevision: 0, beforeSnapshot: { companyId: 'taebaek' }, beforeHash: cashOriginalHash({ companyId: 'taebaek' }), afterHash: 'b'.repeat(64) };
it('기존 감사 영수증의 회사·UID·종류·상태를 모두 대조한다', () => {
    expect(statementEditReceiptResult(receipt, reference, 'uid').status).toBe('applied');
    for (const patch of [{ companyId: 'punghoe' }, { uid: 'other' }, { action: 'delete' }, { kind: 'cashEntries' }, { status: 'rejected' }, { requestHash: null }])
        expect(() => statementEditReceiptResult({ ...receipt, ...patch }, reference, 'uid')).toThrow();
});
it('권한 없는 복구와 다른회사 요청은 DB접근 전 거절한다', async () => {
    for (const auth of [undefined, { ...actor, token: { ...actor.token, isAdmin: false } }, { ...actor, token: { ...actor.token, employeeId: undefined } }])
        await expect(recoverStatementEdit({} as never, { auth, data: { mode: 'inspect', reference } })).rejects.toThrow('권한');
    await expect(recoverStatementEdit({} as never, { auth: actor, data: { mode: 'cancel', reference: { ...reference, companyId: 'punghoe' } } })).rejects.toThrow('다른 회사');
});
it('원문 없이 unknown을 조회하며 쓰기는 하지 않는다', async () => {
    let writes = 0;
    const db = { collection: () => ({ doc: () => ({}) }), runTransaction: async (fn: any) => fn({ get: async () => ({ exists: false }), create: () => writes++ }) };
    expect((await recoverStatementEdit(db as never, { auth: actor, data: { mode: 'inspect', reference } })).status).toBe('unknown');
    expect(writes).toBe(0);
});
