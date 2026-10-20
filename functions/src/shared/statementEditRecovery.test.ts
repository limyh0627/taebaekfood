import { expect, it } from 'vitest';
import { normalizeStatementEditRecoveryReference as ref, normalizeStatementEditRecoveryResult as result, normalizeStatementEditRecoveryHistoryResult as history } from './statementEditRecovery';
const r = { companyId: 'taebaek' as const, operationId: 'operation-1', statementId: '한글-전표' };
const applied = { version: 1, reference: r, actorUid: 'uid', status: 'applied', requestHash: 'a'.repeat(64), revision: 1, message: '과거 수정 적용' };
it('참조는 회사·경로·요청 ID를 검증하고 한글 전표는 유지한다', () => {
    expect(ref(r)).toEqual(r);
    expect(() => ref({ ...r, statementId: '../bad' })).toThrow();
    expect(() => ref({ ...r, operationId: 'short' })).toThrow();
});
it('기존 duplicate는 엄격 근거 확인 후 과거 applied로 정규화한다', () => {
    expect(result({ ...applied, status: 'duplicate' }, r, 'uid').status).toBe('applied');
    for (const value of [{ ...applied, actorUid: 'other' }, { ...applied, reference: { ...r, companyId: 'punghoe' } }, { ...applied, requestHash: null }, { ...applied, revision: 0 }])
        expect(() => result(value, r, 'uid')).toThrow();
});
it('기록 없음과 원문 없는 중단은 hash null이며 적용으로 바꾸지 않는다', () => {
    for (const status of ['unknown', 'cancelled'])
        expect(result({ ...applied, status, revision: undefined, requestHash: null }, r, 'uid').status).toBe(status);
});
it('빈 이력도 다음 cursor를 보존하고 타회사·UID가 섞이면 거절한다', () => {
    expect(history({ version: 1, companyId: 'taebaek', actorUid: 'uid', entries: [], nextCursor: 'scan-next' }, 'taebaek', 'uid').nextCursor).toBe('scan-next');
    expect(() => history({ version: 1, companyId: 'taebaek', actorUid: 'uid', entries: [{ result: { ...applied, actorUid: 'other' }, createdAt: '' }], nextCursor: null }, 'taebaek', 'uid')).toThrow();
});
