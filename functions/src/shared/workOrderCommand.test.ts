import { it, expect } from 'vitest';
import { normalizeWorkOrderRequest, normalizeWorkOrderReference, serializeWorkOrderRequest, normalizeWorkOrderResult, normalizeWorkOrderOpenResult, workOrderExpected, decodeWorkOrderOpening, encodeCatalogValue, type WorkOrderRequest } from './workOrderCommand';
const reference = { companyId: 'taebaek' as const, planId: 'p' };
const expected = { items: [], groups: { exists: false, version: null }, reset: { exists: false, version: null } };
const request: WorkOrderRequest = { version: 1, reference, expected, action: 'apply', items: [] };
it('고정 요청은 안정 원문이며 그룹 생략과 빈 그룹을 구분한다', () => {
    expect(serializeWorkOrderRequest(request)).not.toBe(serializeWorkOrderRequest({ ...request, groups: [] }));
    expect(normalizeWorkOrderRequest(JSON.parse(serializeWorkOrderRequest(request)))).toEqual(request);
    expect(normalizeWorkOrderRequest({ version: 1, reference, expected, action: 'resetDaily', date: '2026-10-7' })).toMatchObject({ date: '2026-10-7' });
});
it('회사·계획·존재버전·허용필드가 다른 요청을 거절한다', () => {
    expect(() => normalizeWorkOrderReference({ ...reference, companyId: 'foreign' })).toThrow();
    expect(() => normalizeWorkOrderReference({ ...reference, planId: '../x' })).toThrow();
    expect(() => normalizeWorkOrderRequest({ ...request, expected: { ...expected, groups: { exists: true, version: null } } })).toThrow();
    expect(() => normalizeWorkOrderRequest({ ...request, stock: 1 })).toThrow();
    expect(() => normalizeWorkOrderRequest({ ...request, action: 'resetDaily', date: '2026-10-7' })).toThrow();
});
it('수량 0·음수와 빈 그룹명은 기존 값 그대로 두고 중복 ID·순번만 차단한다', () => {
    const item = { id: 'i', key: 'k', orderId: 'o', itemId: 'x', itemName: '', partnerName: '', category: '', qty: -1, sortIndex: 0, groupId: null };
    expect(normalizeWorkOrderRequest({ ...request, items: [item], groups: ['', '기름', '기름'] })).toMatchObject({ items: [{ qty: -1, groupId: null }] });
    expect(() => normalizeWorkOrderRequest({ ...request, items: [item, item] })).toThrow();
    expect(() => normalizeWorkOrderRequest({ ...request, items: [{ ...item, sortIndex: 1 }] })).toThrow();
});
it('표시 원문과 native 버전 집합을 분리하고 불법 존재 버전을 거절한다', () => {
    const opening = normalizeWorkOrderOpenResult({ reference, actorUid: 'u', items: [], groups: { ...expected.groups, data: null }, reset: { exists: true, version: '1:000000001', data: encodeCatalogValue({ companyId: 'taebaek', date: '' }) } }, reference, 'u');
    expect(workOrderExpected(opening).reset.version).toBe('1:000000001');
    expect(decodeWorkOrderOpening(opening).reset).toEqual({ companyId: 'taebaek', date: '' });
    expect(() => normalizeWorkOrderOpenResult({ ...opening, actorUid: 'other' }, reference, 'u')).toThrow();
});
it('결과의 회사 UID 해시를 엄격히 검증하고 미처리 중단만 null 해시를 허용한다', () => {
    const result = { version: 1, reference, actorUid: 'u', status: 'applied', requestHash: 'a'.repeat(64), message: '저장' };
    expect(normalizeWorkOrderResult(result, reference, 'u').status).toBe('applied');
    expect(() => normalizeWorkOrderResult({ ...result, requestHash: null }, reference, 'u')).toThrow();
    expect(() => normalizeWorkOrderResult(result, reference, 'other')).toThrow();
    expect(() => normalizeWorkOrderResult(result, reference, 'u', 'b'.repeat(64))).toThrow();
});
