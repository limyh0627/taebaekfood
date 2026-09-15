import { describe, it, expect } from 'vitest';
import { validateExtract, catalogLine } from './orderExtract';

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
