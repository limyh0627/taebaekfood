import { describe, it, expect } from 'vitest';
import {
  hasShipTos, activeShipTos, defaultShipToId, shipToOf,
  partnerLabel, orderPartnerLabel, shipToSummary, itemGoesTo, linksForShipTo,
} from './shipTo';
import type { Partner } from './types';

//  운영 데이터 그대로 — 해피유통 하나에 배송지 셋
const 해피 = {
  id: 'happy', name: '해피유통',
  shipTos: [
    { id: 'C080', name: '포천' },
    { id: 'C081', name: '쿠팡' },
    { id: 'c-1784010198853', name: '네이버커머스' },
  ],
} as unknown as Partner;

const 배송지없는곳 = { id: 'sooka', name: '수카페' } as unknown as Partner;
const by = (id: string | undefined) => [해피, 배송지없는곳].find(p => p.id === id);

describe('배송지를 쓰는 거래처인가', () => {
  it('배송지가 있으면 쓴다', () => {
    expect(hasShipTos(해피)).toBe(true);
  });

  it('**대부분의 거래처는 안 쓴다** — 그쪽은 예전과 똑같이 돈다', () => {
    expect(hasShipTos(배송지없는곳)).toBe(false);
    expect(hasShipTos(undefined)).toBe(false);
  });

  it('보관한 배송지는 안 센다 — 지우지는 않는다(지난 주문이 가리킨다)', () => {
    const p = { shipTos: [{ id: 'a', name: '옛곳', archived: true }] } as unknown as Partner;
    expect(hasShipTos(p)).toBe(false);
    expect(activeShipTos(p)).toEqual([]);
    //  가리키는 주문이 있으니 찾기는 된다
    expect(shipToOf(p, 'a')?.name).toBe('옛곳');
  });
});

describe('기본 배송지는 목록의 맨 앞이다', () => {
  it('사람이 정한 순서를 쓴다 — 포천이 앞이면 포천', () => {
    expect(defaultShipToId(해피)).toBe('C080');
  });

  it('배송지가 없으면 없다', () => {
    expect(defaultShipToId(배송지없는곳)).toBeUndefined();
  });

  it('보관된 것은 기본이 안 된다', () => {
    const p = { shipTos: [{ id: 'a', name: '옛곳', archived: true }, { id: 'b', name: '지금' }] } as unknown as Partner;
    expect(defaultShipToId(p)).toBe('b');
  });
});

describe('화면에 찍는 이름 — 한 곳에서만 만든다', () => {
  it('배송지가 있으면 괄호로 붙인다 — **지금 보이는 글자 그대로**', () => {
    expect(partnerLabel('해피유통', '쿠팡')).toBe('해피유통(쿠팡)');
  });

  it('배송지가 없으면 거래처명만', () => {
    expect(partnerLabel('수카페')).toBe('수카페');
    expect(partnerLabel('수카페', '')).toBe('수카페');
    expect(partnerLabel('수카페', '   ')).toBe('수카페');
  });

  it('이름이 없어도 안 죽는다', () => {
    expect(partnerLabel(undefined)).toBe('');
    expect(partnerLabel(undefined, '쿠팡')).toBe('(쿠팡)');
  });

  it('주문에서 바로 뽑는다', () => {
    const o = { partnerId: 'happy', partnerName: '해피유통', shipToId: 'C081' };
    expect(orderPartnerLabel(o, by)).toBe('해피유통(쿠팡)');
  });

  it('**거래처를 못 찾아도 주문에 박힌 이름으로 찍는다** — 빈칸으로 두면 어느 주문인지 모른다', () => {
    const o = { partnerId: '지워진거래처', partnerName: '없어진곳', shipToId: 'x' };
    expect(orderPartnerLabel(o, by)).toBe('없어진곳');
  });

  it('배송지를 안 쓰는 거래처는 그냥 이름', () => {
    expect(orderPartnerLabel({ partnerId: 'sooka', partnerName: '수카페' }, by)).toBe('수카페');
  });

  it('주문이 없어도 안 죽는다', () => {
    expect(orderPartnerLabel(undefined, by)).toBe('');
  });
});

describe('전표 머리에 적을 배송지', () => {
  it('하나면 그 이름', () => {
    expect(shipToSummary(['포천'])).toBe('포천');
    expect(shipToSummary(['포천', '포천'])).toBe('포천');
  });

  it('섞이면 `포천 외 2` — 실무에선 배송지별로 끊으니 드문 일이다', () => {
    expect(shipToSummary(['포천', '쿠팡', '네이버커머스'])).toBe('포천 외 2');
  });

  it('없으면 빈 글자 — 부르는 쪽이 줄을 아예 안 그린다', () => {
    expect(shipToSummary([])).toBe('');
    expect(shipToSummary([undefined, ''])).toBe('');
  });
});

describe('배송지마다 다른 취급 품목', () => {
  const 포천만 = { shipToIds: ['C080'] };
  const 포천쿠팡 = { shipToIds: ['C080', 'C081'] };
  const 전부 = { shipToIds: [] };
  const 안적힘 = {};

  it('적힌 배송지에만 나간다', () => {
    expect(itemGoesTo(포천만, 'C080')).toBe(true);
    expect(itemGoesTo(포천만, 'C081')).toBe(false);
    expect(itemGoesTo(포천쿠팡, 'C081')).toBe(true);
  });

  it('**비어 있으면 전 배송지다** — 배송지를 안 쓰는 거래처가 대부분이다', () => {
    //  비었을 때를 "아무 데도 안 나감"으로 읽으면 그 거래처들의 품목이 통째로 사라진다.
    expect(itemGoesTo(전부, 'C080')).toBe(true);
    expect(itemGoesTo(안적힘, 'C080')).toBe(true);
    expect(itemGoesTo(안적힘, undefined)).toBe(true);
  });

  it('배송지를 안 골랐으면 배송지 전용 품목은 안 보인다', () => {
    expect(itemGoesTo(포천만, undefined)).toBe(false);
  });

  it('주문 화면 품목 목록이 이걸로 걸러진다 — 포천 29 · 쿠팡 25 처럼', () => {
    const links: { itemId: string; shipToIds?: string[] }[] = [
      { itemId: '볶음참깨-낱개', ...포천만 },
      { itemId: 'box-20', shipToIds: ['C081'] },
      { itemId: '참기름350', ...포천쿠팡 },
      { itemId: '전거래처공통', ...안적힘 },
    ];
    expect(linksForShipTo(links, 'C080').map(l => l.itemId)).toEqual(['볶음참깨-낱개', '참기름350', '전거래처공통']);
    expect(linksForShipTo(links, 'C081').map(l => l.itemId)).toEqual(['box-20', '참기름350', '전거래처공통']);
  });
});
