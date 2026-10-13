import { describe, expect, it } from 'vitest';
import { buildNewOrderDraft, type NewOrderLineInput } from './newOrderDraft';
import { buildBomIndex } from './bomIndex';
import { buildPackIndex } from './packIndex';
import type { Item, Partner, PartnerItem } from './types';
import { clearOrderCopyAttempt, decodeOrderCopyAttempt, encodeOrderCopyAttempt, prepareOrderCopyAttempt } from './orderCopyAttempt';

const scope = { companyId: 'taebaek' as const, actorUid: 'actor' };
function fixture() {
  const items = [{ id: 'oil', name: '참기름 350ml', type: 'product', unit: '병' },
    { id: 'box', name: '참기름 350ml 박스', type: 'product', unit: '박스' }] as Item[];
  const lines: NewOrderLineInput[] = [{ itemId: 'oil', quantity: 3, isBoxUnit: true, unitsPerBox: 12,
    boxType: '포장', boxSubId: 'container', displaySize: '350ml', orderedAs: '참기름350밀리 3박스' },
  { itemId: 'box', quantity: 2, isBoxUnit: true, displaySize: '350ml' }];
  const draft = buildNewOrderDraft({ partner: { id: 'partner', name: '시험 거래처', type: '스마트스토어', email: 'test@example.invalid', region: '지역' } as Partner,
    items, lines, partnerItems: [{ id: 'price', itemId: 'oil', partnerId: 'partner', Direction: 'out', price: 1000 }] as PartnerItem[],
    orderUnitInputs: { bom: buildBomIndex(items, [{ parent_id: 'box', child_id: 'oil', quantity: 12 }]), pack: buildPackIndex([{ item_id: 'oil', units_per_box: 12 }]) },
    orderDate: '2026-10-13', deliveryDate: '2026-10-15', shipToId: 'ship-to', shipMethod: '택배', note: '배송 요청', noteImportant: true,
    pallets: [{ id: 'pallet', type: '일반', quantity: 2 }] as any });
  const request = { version: 1, requestId: 'copy-1', ...scope, createdAt: '2026-10-13T10:00:00.000Z', sourceText: '  참기름350밀리 3박스\r\n박스상품 2박스  ',
    firstAnalysis: { rule: { raw: '최초 규칙 결과', validated: [{ itemId: 'oil', quantity: 3 }], rejected: [{ text: '모호한 항목', reason: '여러 후보' }] },
      ai: { raw: '{"rows":[]}', validated: [{ itemId: 'box', quantity: 2 }], rejected: [{ text: '추정 항목', reason: '근거 없음' }] } },
    confirmed: { inputLines: lines, orderDraft: draft } };
  return { request, lines, draft };
}

describe('복사 주문 최초 사본의 순수 CAS', () => {
  it('실제 공용 draft의 포장·배송·가격·350ml 메타데이터와 환산 전 입력을 그대로 왕복한다', () => {
    const { request, lines, draft } = fixture(), encoded = encodeOrderCopyAttempt(request, scope), decoded = decodeOrderCopyAttempt(encoded, scope);
    expect(decoded).toEqual(request); expect(decoded.confirmed.inputLines).toEqual(lines); expect(decoded.confirmed.orderDraft).toEqual(draft);
    expect(lines[0].quantity).toBe(3); expect(draft.items[0]).toMatchObject({ quantity: 36, boxQuantity: 3, unitsPerBox: 12,
      boxType: '포장', boxSubId: 'container', displaySize: '350ml', orderedAs: '참기름350밀리 3박스', price: 1000 });
    expect(draft.items[1]).toMatchObject({ quantity: 2, price: 12000 }); expect(draft.totalAmount).toBe(60000);
    expect(decoded.confirmed.orderDraft).toMatchObject({ shipToId: 'ship-to', shipMethod: '택배', deliveryBoxes: [], noteImportant: true, pallets: draft.pallets });
  });
  it('입력과 decode 결과가 후행 변경돼도 저장된 최초 원문은 변하지 않는다', () => {
    const { request } = fixture(), encoded = prepareOrderCopyAttempt(null, request, scope), decoded = decodeOrderCopyAttempt(encoded, scope);
    request.sourceText = '다른 원문'; request.confirmed.inputLines[0].quantity = 99; request.firstAnalysis.ai.rejected[0].reason = '변경';
    decoded.confirmed.orderDraft.totalAmount = 1;
    expect(decodeOrderCopyAttempt(encoded, scope).sourceText).toBe('  참기름350밀리 3박스\r\n박스상품 2박스  ');
    expect(decodeOrderCopyAttempt(encoded, scope).confirmed.orderDraft.totalAmount).toBe(60000);
  });
  it('같은 요청은 기존 문자열의 공백·키 순서까지 그대로 반환한다', () => {
    const { request } = fixture(), old = JSON.stringify(request, null, 2);
    expect(prepareOrderCopyAttempt(old, request, scope)).toBe(old);
  });
  it('다른 ID·시각·확정 입력·분석·원문은 기존 사본을 덮어쓰지 않는다', () => {
    const { request } = fixture(), old = encodeOrderCopyAttempt(request, scope);
    for (const changed of [{ ...request, requestId: 'copy-2' }, { ...request, createdAt: '2026-10-13T10:00:01.000Z' },
      { ...request, sourceText: request.sourceText.trim() }, { ...request, firstAnalysis: { ...request.firstAnalysis, another: true } },
      { ...request, confirmed: { ...request.confirmed, inputLines: [] } }]) expect(() => prepareOrderCopyAttempt(old, changed, scope)).toThrow('원문을 보존');
    expect(decodeOrderCopyAttempt(old, scope)).toEqual(request);
  });
  it('손상된 기존 사본이나 다른 사용자·회사는 새 요청으로 대체하지 않는다', () => {
    const { request } = fixture(), old = encodeOrderCopyAttempt(request, scope);
    for (const broken of ['', 'not-json', '{}', JSON.stringify({ ...request, extra: true })]) expect(() => prepareOrderCopyAttempt(broken, request, scope)).toThrow('원문을 보존');
    expect(() => decodeOrderCopyAttempt(old, { ...scope, actorUid: 'other' })).toThrow();
    expect(() => decodeOrderCopyAttempt(old, { ...scope, companyId: 'punghoe' })).toThrow();
  });
  it('명시적 undefined 입력은 capture adapter 없이 조용히 제거하지 않는다', () => {
    const { request } = fixture(); request.confirmed.inputLines[0].boxType = undefined;
    expect(() => encodeOrderCopyAttempt(request, scope)).toThrow('JSON');
  });
  it('정확한 최초 문자열만 CAS로 지우며 의미가 같은 새 문자열·null·다른 사본은 보존한다', () => {
    const { request } = fixture(), old = encodeOrderCopyAttempt(request, scope), formatted = JSON.stringify(request, null, 2);
    expect(clearOrderCopyAttempt(old, old)).toBeNull();
    for (const current of [formatted, null, old + ' ']) expect(() => clearOrderCopyAttempt(current, old)).toThrow('원문을 보존');
  });
});
