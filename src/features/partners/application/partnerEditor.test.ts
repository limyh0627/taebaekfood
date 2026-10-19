import { expect, it } from 'vitest';
import type { Partner } from '../../../shared/types';
import { buildPartnerEditPatch } from './partnerEditor';
const initial: Partner = { id: 'p', name: '상호', type: '일반' };
it('표시 기본값을 넣지 않은 원문은 변경이 없고 hidden 값은 송신하지 않는다', () => {
    expect(buildPartnerEditPatch(initial, { ...initial, region: '새지역', isOemFactory: true })).toEqual({});
});
it('빈 이름과 공백은 기존 편집 정책 그대로 보존한다', () => {
    expect(buildPartnerEditPatch(initial, { ...initial, name: '  ' })).toEqual({ name: '  ' });
    expect(buildPartnerEditPatch(initial, { ...initial, name: '' })).toEqual({ name: '' });
});
it('휴대폰과 전화의 명시 동시 수정을 둘 다 보낸다', () => {
    expect(buildPartnerEditPatch(initial, { ...initial, mobile: '010', phone: '010' })).toEqual({ mobile: '010', phone: '010' });
});
it('존재하지 않은 은행 또는 배송 기본값을 자동 주입하지 않는다', () => {
    expect(buildPartnerEditPatch(initial, { ...initial, note: '비고' })).toEqual({ note: '비고' });
});
it('배송지 순서와 빈 rename을 보존하고 미지 필드를 패치에 싣지 않는다', () => {
    const a = { id: 'a', name: '가', secret: '보존' }, b = { id: 'b', name: '나' };
    const row = { ...initial, shipTos: [a, b] };
    expect(buildPartnerEditPatch(row, { ...row, shipTos: [b, { ...a, name: '' }] })).toEqual({ shipTos: [b, { id: 'a', name: '' }] });
});
it('다른 대상을 현재 선택으로 바꿔 보내지 않는다', () => {
    expect(() => buildPartnerEditPatch(initial, { ...initial, id: 'other' })).toThrow('처음 선택');
});
it('업무 이름501자는 표시메타 제한과 무관하게 그대로 dirty patch에 보존한다', () => {
    const name = '나'.repeat(501);
    expect(buildPartnerEditPatch(initial, { ...initial, name })).toEqual({ name });
});
