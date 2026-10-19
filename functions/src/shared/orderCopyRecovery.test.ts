import { describe, expect, it } from 'vitest';
import { normalizeOrderCopyRecoveryReference, normalizeOrderCopyRecoveryResult, normalizeOrderCopyRecoveryHistoryResult } from './orderCopyRecovery';
const reference = { companyId: 'taebaek' as const, requestId: 'request' };
const applied = { version: 1, reference, actorUid: 'actor', status: 'applied', requestHash: 'a'.repeat(64), message: '주문 등록 완료', orderId: 'order', cardNo: '카드-1' };
describe('복사 주문 복구 응답 정본', () => {
    it('기존 요청 ID 문자·공백 정책을 보존하고 잘못된 식별을 거절한다', () => { expect(normalizeOrderCopyRecoveryReference({ ...reference, requestId: '한글-요청' }).requestId).toBe('한글-요청'); for (const requestId of ['', ' request', '../request'])
        expect(() => normalizeOrderCopyRecoveryReference({ ...reference, requestId })).toThrow(); });
    it('완료·원문 없는 미처리 중단·기록 부재를 서로 구분한다', () => { expect(normalizeOrderCopyRecoveryResult(applied, reference, 'actor').status).toBe('applied'); for (const status of ['stopped', 'unknown'])
        expect(normalizeOrderCopyRecoveryResult({ version: 1, reference, actorUid: 'actor', status, requestHash: null, message: status }, reference, 'actor').status).toBe(status); });
    it('다른 회사·UID·요청과 불완전한 성공은 거절한다', () => { for (const patch of [{ actorUid: 'other' }, { reference: { ...reference, companyId: 'punghoe' } }, { reference: { ...reference, requestId: 'other' } }, { requestHash: null }, { orderId: undefined }])
        expect(() => normalizeOrderCopyRecoveryResult({ ...applied, ...patch }, reference, 'actor')).toThrow(); });
    it('빈 처리기록 페이지의 cursor를 보존하고 다른 회사 이력을 섞지 않는다', () => { const scope = { companyId: reference.companyId, actorUid: 'actor' }; expect(normalizeOrderCopyRecoveryHistoryResult({ version: 1, ...scope, entries: [], nextCursor: 'next' }, scope).nextCursor).toBe('next'); expect(() => normalizeOrderCopyRecoveryHistoryResult({ version: 1, ...scope, entries: [{ ...applied, reference: { ...reference, companyId: 'punghoe' } }], nextCursor: null }, scope)).toThrow(); });
});
