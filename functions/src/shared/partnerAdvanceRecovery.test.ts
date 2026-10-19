import { describe, expect, it } from 'vitest';
import { semanticHash } from './partnerAdvanceReceipt';
import { createHash } from 'node:crypto';
import { normalizePartnerAdvanceRecoveryReference, normalizePartnerAdvanceRecoveryResult, normalizePartnerAdvanceRecoveryHistoryResult, serializePartnerAdvanceRecoveryRequest } from './partnerAdvanceRecovery';
const reference = { companyId: 'taebaek' as const, partnerId: 'partner', operationId: 'operation' };
const result = { version: 1, reference, actorId: 'actor', status: 'applied', action: 'apply', requestHash: 'a'.repeat(64), statementId: 'advance-operation', docNo: '대체-1', amount: 60, date: '2026-10-08', message: '완료' };
describe('상계 복구 공용 계약', () => {
    it('기존 requestHash canonical 원문과 정확히 같다', () => {
        const value = { companyId: 'taebaek', actorId: 'actor', action: 'apply' as const, command: { z: undefined, nested: { b: 2, a: 1 } } };
        expect(createHash('sha256').update(serializePartnerAdvanceRecoveryRequest(value)).digest('hex')).toBe(semanticHash(value));
    });
    it('완료·중단·기록 부재를 구분한다', () => {
        expect(normalizePartnerAdvanceRecoveryResult(result, reference, 'actor').status).toBe('applied');
        for (const status of ['cancelled', 'unknown'])
            expect(normalizePartnerAdvanceRecoveryResult({ version: 1, reference, actorId: 'actor', status, requestHash: null, message: status }, reference, 'actor').status).toBe(status);
    });
    it('회사·작성자·요청 및 완료 전표 증거가 다르면 거절한다', () => {
        expect(() => normalizePartnerAdvanceRecoveryReference({ ...reference, operationId: '../x' })).toThrow();
        for (const patch of [{ actorId: 'other' }, { reference: { ...reference, partnerId: 'other' } }, { requestHash: null }, { statementId: undefined }])
            expect(() => normalizePartnerAdvanceRecoveryResult({ ...result, ...patch }, reference, 'actor')).toThrow();
    });
    it('빈 이력도 다음 페이지를 유지하며 다른 범위를 반환하지 않는다', () => {
        const scope = { companyId: reference.companyId, partnerId: reference.partnerId, actorId: 'actor' };
        expect(normalizePartnerAdvanceRecoveryHistoryResult({ version: 1, ...scope, entries: [], nextCursor: 'next' }, scope).nextCursor).toBe('next');
        expect(() => normalizePartnerAdvanceRecoveryHistoryResult({ version: 1, ...scope, entries: [{ ...result, actorId: 'other' }], nextCursor: null }, scope)).toThrow();
    });
});
