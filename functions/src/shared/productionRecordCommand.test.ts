import { it, expect } from 'vitest';
import { normalizeProductionRecordReference, normalizeProductionRecordRequest, normalizeProductionRecordResult, productionRecordBody, productionRecordOpening, productionRecordSourceEvidence, serializeProductionRecordRequest } from './productionRecordCommand';
const reference = { companyId: 'taebaek' as const, planId: 'plan', targetId: 'pr-한글 주문-참기름' };
const record = { date: '2026-10-20', itemId: '참기름', itemName: '참기름', finishedQty: 0, cost: 0, createdAt: '최초시각' };
it('옛 한글 대상·품목은 허용하고 경로 구분자와 빈 번호는 거절한다', () => {
    expect(normalizeProductionRecordReference(reference)).toEqual(reference);
    for (const targetId of ['', 'a/b', '..', 'x'.repeat(1501)])
        expect(() => normalizeProductionRecordReference({ ...reference, targetId })).toThrow();
});
it('기존 수량·원가 원문을 보존하며 클라이언트 identity와 미지필드는 저장 본문에 넣지 않는다', () => {
    expect(productionRecordBody({ ...record, finishedQty: -2, id: '표시', companyId: 'punghoe', hidden: 1 })).toEqual({ ...record, finishedQty: -2 });
    const request = { version: 1 as const, reference, expectedVersion: null, action: 'create' as const, record };
    expect(JSON.parse(serializeProductionRecordRequest(request))).toEqual(request);
    expect(() => normalizeProductionRecordRequest({ ...request, record: { ...record, hidden: 1 } })).toThrow();
    expect(() => normalizeProductionRecordRequest({ ...request, expectedVersion: '1:000000001' })).toThrow();
    expect(() => normalizeProductionRecordRequest({ ...request, record: { ...record, note: '가'.repeat(250000) } })).toThrow('너무 큽니다');
});
it('주문 근거는 부재·undefined·null과 품목 배열 순서를 구분한다', () => {
    const base = { status: 'DELIVERED', partnerName: '거래처', items: [{ id: 'a' }, { id: 'b' }] };
    const absent = productionRecordSourceEvidence(base);
    expect(absent).not.toEqual(productionRecordSourceEvidence({ ...base, productionRecordIndex: undefined }));
    expect(absent).not.toEqual(productionRecordSourceEvidence({ ...base, productionRecordIndex: null }));
    expect(absent).not.toEqual(productionRecordSourceEvidence({ ...base, items: [...base.items].reverse() }));
    expect(productionRecordOpening({ ...record, id: 'a', companyId: 'taebaek', hidden: 1 })).toEqual(productionRecordOpening(record));
});
it('동기화 source native 버전과 응답의 회사 UID 해시를 엄격히 검증한다', () => {
    const request = { version: 1 as const, reference, expectedVersion: null, action: 'sync' as const, record, source: { orderId: '한글 주문', evidence: productionRecordSourceEvidence({}), expectedVersion: '1:000000001' } };
    expect(normalizeProductionRecordRequest(request)).toEqual(request);
    const result = { version: 1, reference, actorUid: 'u', status: 'applied', requestHash: 'a'.repeat(64), message: '완료' };
    expect(normalizeProductionRecordResult(result, reference, 'u').status).toBe('applied');
    expect(() => normalizeProductionRecordResult(result, reference, '다른계정')).toThrow();
    expect(() => normalizeProductionRecordResult({ ...result, requestHash: null }, reference, 'u')).toThrow();
});
