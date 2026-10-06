import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { buildNewOrderDraft } from './newOrderDraft';
import { buildPackIndex, resetPackIndex, setPackIndex } from './packIndex';
import { buildBomIndex, resetBomIndex, setBomIndex } from './bomIndex';
import type { Item, Partner, PartnerItem } from './types';

afterEach(() => { resetPackIndex(); resetBomIndex(); });
const partner = { id: 'partner', name: '거래처', type: '스마트스토어' } as Partner;
const loose = { id: 'loose', name: '참기름', type: 'product', unit: '병' } as Item;
const box = { id: 'box', name: '참기름', type: 'product', unit: '박스' } as Item;
beforeEach(() => setBomIndex(buildBomIndex([loose, box], [{ parent_id: 'box', child_id: 'loose', quantity: 20 }])));
const base = {
  partner, items: [loose, box], pallets: [], orderDate: '2026-10-06', deliveryDate: '2026-10-08',
  partnerItems: [{ id: 'price', itemId: 'loose', partnerId: 'partner', Direction: 'out', price: 1000, qtyPerBox: 99, boxTypeId: 'old-box' }] as PartnerItem[],
};

describe('직접 입력과 추출의 공통 주문 생성', () => {
  it('같은 낱개 박스 주문은 입력 경로와 관계없이 같은 수량·금액·배송형식으로 만든다', () => {
    setPackIndex(buildPackIndex([{ item_id: loose.id, units_per_box: 20 }]));
    const direct = buildNewOrderDraft({ ...base, lines: [{ itemId: 'loose', quantity: 3, isBoxUnit: true, unitsPerBox: 20, boxType: '' }] });
    const extracted = buildNewOrderDraft({ ...base, lines: [{ itemId: 'loose', quantity: 3, isBoxUnit: true }] });
    expect(extracted).toEqual(direct);
    expect(extracted.items[0]).toMatchObject({ quantity: 60, boxQuantity: 3, unitsPerBox: 20 });
    expect(extracted.totalAmount).toBe(60000);
    expect(extracted).toMatchObject({ source: '스마트스토어', shipMethod: '택배', deliveryBoxes: [] });
  });

  it('박스 SKU는 추출 결과가 박스로 표시돼도 낱개수로 다시 곱하지 않는다', () => {
    const direct = buildNewOrderDraft({ ...base, lines: [{ itemId: 'box', quantity: 3, isBoxUnit: false }] });
    const extracted = buildNewOrderDraft({ ...base, lines: [{ itemId: 'box', quantity: 3, isBoxUnit: true }] });
    expect(extracted).toEqual(direct);
    expect(extracted.items[0]).toMatchObject({ quantity: 3, price: 20000 });
    expect(extracted.items[0].unitsPerBox).toBeUndefined();
    expect(extracted.totalAmount).toBe(60000);
  });

  it('추출 원문은 수량을 바꾸지 않고 별도 참고값으로만 남긴다', () => {
    const draft = buildNewOrderDraft({ ...base, note: '  전달사항  ', noteImportant: true,
      lines: [{ itemId: 'loose', quantity: 3, isBoxUnit: false, orderedAs: '기름 세 병' }] });
    expect(draft.items[0]).toMatchObject({ quantity: 3, price: 1000, orderedAs: '기름 세 병' });
    expect(draft).toMatchObject({ totalAmount: 3000, note: '전달사항', noteImportant: true });
  });
});
