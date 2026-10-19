import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalPartnerPaymentValue, serializePartnerPaymentRequest, normalizePartnerPaymentRecoveryCommand, normalizePartnerPaymentRecoveryResult, normalizePartnerPaymentListResult } from './partnerPaymentRecovery';
const reference = { companyId: 'taebaek' as const, partnerId: '한글거래처', operationId: 'pay-1' };
const hash = 'a'.repeat(64);
const applied = { version: 1 as const, reference, actorUid: 'uid', status: 'applied', requestHash: hash, message: '확인', cashEntryId: 'pay-1', docNo: '번호', amount: 100, tradeDate: '2026-10-19', createdAt: '2026-10-19T00:00:00.000Z', cashAccountId: 'bank' };
describe('독립 수금 복구 wire', () => {
    it('기존 서버 fingerprint canonical 출력과 note 정규화가 동일하다', () => {
        const request = { operationId: 'pay-1', partnerId: '한글거래처', amount: 100, note: ' 메모 ', allocations: [{ statementId: 'b', amount: 50 }, { amount: 50, statementId: 'a' }] };
        const oldCanonical = (v: any): any => Array.isArray(v) ? v.map(oldCanonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, oldCanonical(x)])) : v;
        const old = JSON.stringify(oldCanonical({ ...request, note: '메모' }));
        expect(serializePartnerPaymentRequest(request)).toBe(old);
        expect(createHash('sha256').update(serializePartnerPaymentRequest(request)).digest('hex')).toBe(createHash('sha256').update(old).digest('hex'));
        expect(canonicalPartnerPaymentValue([2, 1])).toEqual([2, 1]);
    });
    it('참조만 조회·중단하고 원문이 있을 때 identity만 확인한다', () => {
        expect(normalizePartnerPaymentRecoveryCommand({ mode: 'inspect', reference })).toEqual({ mode: 'inspect', reference });
        expect(() => normalizePartnerPaymentRecoveryCommand({ mode: 'cancel', reference, requestText: JSON.stringify({ operationId: 'other', partnerId: reference.partnerId }) })).toThrow();
        expect(normalizePartnerPaymentRecoveryCommand({ mode: 'cancel', reference, requestText: JSON.stringify({ operationId: 'pay-1', partnerId: reference.partnerId, amount: 999 }) }).mode).toBe('cancel');
    });
    it('회사·사용자·hash·금융 ID 및 검증된 표시값을 엄격히 묶는다', () => {
        expect(normalizePartnerPaymentRecoveryResult(applied, reference, 'uid')).toEqual(applied);
        for (const patch of [{ actorUid: 'other' }, { requestHash: null }, { cashEntryId: 'other' }, { amount: -1 }, { amount: 3.5 }, { tradeDate: '임의문자' }, { tradeDate: '2026-02-30' }, { createdAt: '2026-02-30T00:00:00.000Z' }])
            expect(() => normalizePartnerPaymentRecoveryResult({ ...applied, ...patch }, reference, 'uid')).toThrow();
        expect(() => normalizePartnerPaymentRecoveryResult({ version: 1, reference, actorUid: 'uid', status: 'rejected', requestHash: null, message: '거절' }, reference, 'uid')).toThrow();
    });
    it('목록은 현재 거래처·UID의 최대20개만 허용한다', () => {
        const list = { version: 1, companyId: reference.companyId, partnerId: reference.partnerId, actorUid: 'uid', entries: [applied], nextCursor: null };
        expect(normalizePartnerPaymentListResult(list, reference.companyId, reference.partnerId, 'uid').entries).toHaveLength(1);
        for (const entries of [[applied, applied], [{ ...applied, reference: { ...reference, partnerId: 'other' } }], Array(21).fill(applied)])
            expect(() => normalizePartnerPaymentListResult({ ...list, entries }, reference.companyId, reference.partnerId, 'uid')).toThrow();
    });
});
