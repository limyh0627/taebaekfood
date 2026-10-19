import { it, expect } from 'vitest';
import { PARTNER_EDIT_FIELDS, partnerEditOpening, partnerEditPatch, partnerEditShipTos, decodePartnerEditOpening, normalizePartnerEditRequest, normalizePartnerEditReference, normalizePartnerEditResult, serializePartnerEditRequest } from './partnerEditCommand';
const reference = { companyId: 'taebaek' as const, planId: 'p', targetId: '옛 거래처' };
const request = { version: 1 as const, reference, expectedVersion: '1:000000001', patch: { name: '' } };
it('배송지 미소유 객체는 공개 대조에서 제외하고 조회에는 저장 ID 검증을 적용하지 않는다', () => {
    class Hidden { value = 1; }
    const initial = { name: '상호', shipTos: [{ id: '', name: null, hidden: new Hidden() }] };
    expect(decodePartnerEditOpening(partnerEditOpening(initial))).toEqual({ name: '상호', shipTos: [{ id: '', name: null }] });
    expect(partnerEditPatch(initial, { ...initial, note: '메모' })).toEqual({ note: '메모' });
    expect(partnerEditPatch(initial, { ...initial, shipTos: [{ ...initial.shipTos[0], hidden: new Hidden() }] })).toEqual({});
});
it('수정 공개15필드만 허용하고 빈 이름·공백·명시 빈값에 새 정책을 만들지 않는다', () => {
    expect(PARTNER_EDIT_FIELDS).toHaveLength(15);
    expect(normalizePartnerEditRequest(request).patch).toEqual({ name: '' });
    expect(normalizePartnerEditRequest({ ...request, patch: { name: ' ', note: '' } }).patch).toEqual({ name: ' ', note: '' });
    for (const key of ['id', 'companyId', 'archived', 'region', 'isOemFactory', 'purchaseItems'])
        expect(() => normalizePartnerEditRequest({ ...request, patch: { [key]: '숨은변경' } })).toThrow();
    expect(() => normalizePartnerEditRequest({ ...request, patch: {} })).toThrow();
});
it('첫 선택은 회사와 보관 여부·공개값의 존재를 구분하고 숨은 필드를 노출하지 않는다', () => {
    const raw = { companyId: 'taebaek', name: '상호', archived: false, region: '숨음', isOemFactory: true };
    expect(decodePartnerEditOpening(partnerEditOpening(raw))).toEqual({ companyId: 'taebaek', name: '상호', archived: false });
    expect(partnerEditOpening({ name: '상호' })).not.toEqual(partnerEditOpening({ name: '상호', note: null }));
    expect(partnerEditOpening(raw)).not.toEqual(partnerEditOpening({ ...raw, archived: true }));
});
it('원문 dirty만 만들고 배송지 순서·ID·옛 이상값은 정규화하지 않으며 미지행 필드는 송신하지 않는다', () => {
    const initial = { name: '상호', shipTos: [{ id: 'a', name: '', defaultShipMethod: '옛방식', hidden: 1 }] };
    const form = { ...initial, name: '', region: '새숨은값', shipTos: [{ id: 'b', name: '새곳', defaultShipMethod: '택배' }, initial.shipTos[0]] };
    expect(partnerEditPatch(initial, initial)).toEqual({});
    expect(partnerEditPatch(initial, form)).toEqual({ name: '', shipTos: [{ id: 'b', name: '새곳', defaultShipMethod: '택배' }, { id: 'a', name: '', defaultShipMethod: '옛방식' }] });
    expect(partnerEditShipTos(initial.shipTos)[0]).not.toHaveProperty('hidden');
    expect(() => normalizePartnerEditRequest({ ...request, patch: { shipTos: initial.shipTos } })).toThrow('공개 편집');
});
it('한글 대상과 전체 native 버전·응답 UID 해시를 보존하고 경로와 과대 원문을 거절한다', () => {
    expect(normalizePartnerEditReference(reference)).toEqual(reference);
    expect(JSON.parse(serializePartnerEditRequest(request))).toEqual(request);
    expect(() => normalizePartnerEditReference({ ...reference, targetId: 'a/b' })).toThrow();
    expect(() => normalizePartnerEditRequest({ ...request, expectedVersion: null })).toThrow();
    expect(() => normalizePartnerEditRequest({ ...request, patch: { note: '가'.repeat(100000) } })).toThrow('너무 큽니다');
    const result = { version: 1, reference, actorUid: 'u', status: 'applied', requestHash: 'a'.repeat(64), message: '완료' };
    expect(normalizePartnerEditResult(result, reference, 'u').status).toBe('applied');
    expect(() => normalizePartnerEditResult(result, reference, 'other')).toThrow();
});
