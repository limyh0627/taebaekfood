import { describe, it, expect } from 'vitest';
import { validateExtract, catalogLine, historyLines, type HistoryOrder } from './orderExtract';

/**
 * AI 가 읽어 온 것을 **믿지 않고 검사한다**(2026-09-15 사장님: "api달아서 메시지에서 주문
 * 추출하는 기능"). 수량 하나가 틀리면 재고·전표가 다 틀어진다.
 */
const 품목 = [
  { id: 'p-oil', name: '참기름/골드', spec: '350ml' },
  { id: 'p-oil-box', name: '참기름/골드', spec: '350ml * 12' },
  { id: 'p-sesame', name: '볶음참깨/1kg' },
];
const 거래처 = [{ id: 'c-1', name: '완도식품' }];

describe('읽어 온 주문 검사', () => {
  it('제대로 온 것은 그대로 받는다', () => {
    const r = validateExtract({
      partnerId: 'c-1', deliveryDate: '2026-09-20',
      lines: [{ itemId: 'p-sesame', qty: 5, isBox: true, source: '볶음참깨 5박스' }],
    }, 품목, 거래처);
    expect(r.partnerName).toBe('완도식품');
    expect(r.deliveryDate).toBe('2026-09-20');
    expect(r.lines).toEqual([{ itemId: 'p-sesame', name: '볶음참깨/1kg', qty: 5, isBox: true, source: '볶음참깨 5박스' }]);
    expect(r.rejected).toEqual([]);
  });

  it('**우리 목록에 없는 품목은 버린다** — 이름이 그럴듯해도 지어낸 것이다', () => {
    const r = validateExtract({ lines: [{ itemId: 'p-없는것', name: '들기름', qty: 3 }] }, 품목);
    expect(r.lines).toEqual([]);
    expect(r.rejected[0].reason).toContain('품목 목록에 없는');
  });

  it('품목을 못 정한 줄도 버리되 **왜 걸렸는지 적는다** — 조용히 버리면 빠진 줄을 못 찾는다', () => {
    const r = validateExtract({ lines: [{ qty: 2, source: '그거 두 개' }] }, 품목);
    expect(r.lines).toEqual([]);
    expect(r.rejected).toEqual([{ text: '그거 두 개', reason: '품목을 못 정했습니다' }]);
  });

  it('수량이 없거나 0 이하면 버린다', () => {
    const r = validateExtract({ lines: [
      { itemId: 'p-oil', qty: 0, source: 'a' },
      { itemId: 'p-oil', qty: -1, source: 'b' },
      { itemId: 'p-oil', source: 'c' },
    ] }, 품목);
    expect(r.lines).toEqual([]);
    expect(r.rejected.map(x => x.reason)).toEqual(['수량을 못 읽었습니다', '수량을 못 읽었습니다', '수량을 못 읽었습니다']);
  });

  it('수량이 글자로 와도 숫자로 읽는다', () => {
    expect(validateExtract({ lines: [{ itemId: 'p-oil', qty: '3' }] }, 품목).lines[0].qty).toBe(3);
  });

  it('**이름은 우리 것을 쓴다** — AI 가 적은 이름을 두면 화면과 DB 가 다른 말을 한다', () => {
    const r = validateExtract({ lines: [{ itemId: 'p-oil', name: '참기름(골드) 350', qty: 1 }] }, 품목);
    expect(r.lines[0].name).toBe('참기름/골드');
  });

  it('날짜는 YYYY-MM-DD 만 받는다 — 달력에 그대로 꽂혀야 한다', () => {
    expect(validateExtract({ deliveryDate: '2026-09-20', lines: [] }, 품목).deliveryDate).toBe('2026-09-20');
    expect(validateExtract({ deliveryDate: '내일', lines: [] }, 품목).deliveryDate).toBeUndefined();
    expect(validateExtract({ deliveryDate: '2026-13-40', lines: [] }, 품목).deliveryDate).toBeUndefined();
  });

  it('모르는 거래처는 안 잡는다 — 엉뚱한 곳으로 주문이 들어가면 안 된다', () => {
    expect(validateExtract({ partnerId: 'c-없음', lines: [] }, 품목, 거래처).partnerId).toBeUndefined();
  });

  it('lines 가 아예 없거나 배열이 아니어도 안 죽는다', () => {
    expect(validateExtract({}, 품목).lines).toEqual([]);
    expect(validateExtract({ lines: '어쩌구' }, 품목).lines).toEqual([]);
  });

  it('박스 여부를 못 정했으면 비워 둔다 — 화면이 품목 기본값을 쓴다', () => {
    expect(validateExtract({ lines: [{ itemId: 'p-oil', qty: 1 }] }, 품목).lines[0].isBox).toBeUndefined();
  });
});

describe('AI 에게 줄 품목 줄', () => {
  it('규격까지 붙인다 — 낱개와 박스가 같은 이름을 쓴다', () => {
    expect(catalogLine(품목[0])).toBe('p-oil\t참기름/골드 350ml');
    expect(catalogLine(품목[1])).toBe('p-oil-box\t참기름/골드 350ml * 12');
    expect(catalogLine(품목[2])).toBe('p-sesame\t볶음참깨/1kg');
  });
});

const TAB = String.fromCharCode(9);

describe('이 거래처가 전에 시킨 것', () => {
  const 주문: HistoryOrder[] = [
    { partnerId: 'c-가득찬', createdAt: '2026-09-10T00:00:00Z', items: [
      { itemId: 'p-oil', name: '참기름/골드', quantity: 340, orderedAs: '참기름 340개 부탁드려요' },
      { itemId: 'p-sesame', name: '볶음참깨/1kg', quantity: 50 },
    ] },
    { partnerId: 'c-가득찬', createdAt: '2026-08-02T00:00:00Z', items: [
      { itemId: 'p-oil-box', name: '참기름/골드 박스', quantity: 36, isBoxUnit: true, boxQuantity: 3 },
    ] },
    { partnerId: 'c-딴집', createdAt: '2026-09-11T00:00:00Z', items: [
      { itemId: 'p-oil', name: '참기름/골드', quantity: 10 },
    ] },
  ];

  it('그 거래처 것만 가져온다 — 남의 집 버릇을 배우면 안 된다', () => {
    const 줄 = historyLines(주문, 'c-가득찬');
    expect(줄.some(l => l.includes('p-oil'))).toBe(true);
    expect(줄).toHaveLength(3);
  });

  it('그 집이 쓴 말을 큰따옴표로 붙인다 — 이게 말버릇을 전하는 유일한 길이다', () => {
    const 줄 = historyLines(주문, 'c-가득찬');
    expect(줄[0]).toBe('2026-09-10' + TAB + 'p-oil' + TAB + '참기름/골드' + TAB + '340  "참기름 340개 부탁드려요"');
  });

  it('원문이 없는 옛 주문은 품목·수량만 적는다', () => {
    expect(historyLines(주문, 'c-가득찬')[1]).toBe('2026-09-10' + TAB + 'p-sesame' + TAB + '볶음참깨/1kg' + TAB + '50');
  });

  it('박스로 시킨 줄은 박스 수로 적는다 — 낱개로 환산한 수를 보여 주면 버릇을 잘못 배운다', () => {
    expect(historyLines(주문, 'c-가득찬')[2]).toContain(TAB + '3박스');
  });

  it('최근 것부터 준다 — 넘쳐 잘리는 쪽이 오래된 것이어야 한다', () => {
    const 줄 = historyLines(주문, 'c-가득찬');
    expect(줄[0].startsWith('2026-09-10')).toBe(true);
    expect(줄[2].startsWith('2026-08-02')).toBe(true);
  });

  it('주문 수로 자른다 — 품목 줄 수가 아니다', () => {
    expect(historyLines(주문, 'c-가득찬', 1)).toHaveLength(2);
  });

  it('거래처를 안 골랐거나 거래가 없으면 빈 목록 — 그 대목을 아예 안 보낸다', () => {
    expect(historyLines(주문, '')).toEqual([]);
    expect(historyLines(주문, 'c-처음보는곳')).toEqual([]);
    expect(historyLines([], 'c-가득찬')).toEqual([]);
  });
});
