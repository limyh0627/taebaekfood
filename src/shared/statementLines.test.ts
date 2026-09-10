import { describe, it, expect } from 'vitest';
import { manualLines, orderLines, lineTotals, resolveOrderItem, orderItemPrice } from './statementLines';

const 품목 = (o: any) => o as any;
const 주문 = (items: any[]) => ({ id: 'o1', items } as any);
const 단가 = (o: any) => o as any;

//  참기름 1750ml 낱개 / 그 10개들이 박스
const 낱개 = 품목({ id: 'loose', name: '참기름/1750ml', spec: '1750ml', unit: '개' });
const 박스 = 품목({ id: 'box', name: '참기름/1750ml 박스', unit: '박스', unpackTo: { itemId: 'loose', count: 10 } });
const 목록 = [낱개, 박스];

/**
 * **이름을 직접 쳐도 그 거래처 품목이면 기록이 남아야 한다**(2026-09-10 사장님).
 *
 * 표 안의 `제품명...` 칸은 치면 드롭다운이 뜨고, **고르면** `itemId` 가 붙는다.
 * 그런데 다 치고 **안 고른 채 넘어가면** 안 붙는다. 그러면 `partnerPriceWrites` 가 그 줄을
 * 통째로 건너뛰어 **거래처 단가도 과세/면세도 조용히 저장되지 않는다.**
 * (9월 전표 줄 182개 중 `itemId` 있는 줄이 25개뿐이었다)
 */
describe('이름이 정확히 맞으면 그 품목으로 잇는다', () => {
  const 연결 = [
    { itemId: 'p-1', name: '참기름/A/모란/1750ml' },
    { itemId: 'p-2', name: '들기름/모란/1750ml' },
  ];
  const 줄 = (name: string, over: Record<string, unknown> = {}) =>
    ({ name, spec: '', qty: '10', price: '18000', isTaxExempt: false, ...over });

  it('연결된 품목과 글자가 같으면 itemId 를 이어 준다', () => {
    const r = manualLines([줄('참기름/A/모란/1750ml')], '매출', 연결);
    expect(r[0].itemId).toBe('p-1');
  });

  it('앞뒤 빈칸은 무시한다 — 사람이 치면 붙는다', () => {
    expect(manualLines([줄('  참기름/A/모란/1750ml  ')], '매출', 연결)[0].itemId).toBe('p-1');
  });

  it('**부분만 같으면 안 잇는다** — 비슷한 이름이 널렸다', () => {
    expect(manualLines([줄('참기름')], '매출', 연결)[0].itemId).toBeUndefined();
    expect(manualLines([줄('참기름/A/모란/1750ml 특')], '매출', 연결)[0].itemId).toBeUndefined();
  });

  it('**연결 안 된 품목은 안 잇는다** — 연결할지는 품목 선택에서 묻는다', () => {
    expect(manualLines([줄('고춧가루 1kg')], '매출', 연결)[0].itemId).toBeUndefined();
  });

  it('**같은 이름이 둘이면 안 잇는다** — 어느 것인지 모르면 그냥 둔다', () => {
    const 겹침 = [...연결, { itemId: 'p-3', name: '참기름/A/모란/1750ml' }];
    expect(manualLines([줄('참기름/A/모란/1750ml')], '매출', 겹침)[0].itemId).toBeUndefined();
  });

  it('이미 고른 줄은 그 itemId 를 그대로 쓴다 — 이름이 뭐든', () => {
    const r = manualLines([줄('아무거나', { itemId: 'p-9' })], '매출', 연결);
    expect(r[0].itemId).toBe('p-9');
  });

  it('연결 목록을 안 넘기면 예전 그대로다', () => {
    expect(manualLines([줄('참기름/A/모란/1750ml')], '매출')[0].itemId).toBeUndefined();
  });
});

describe('manualLines — 손으로 적은 줄', () => {
  it('이름이 빈 줄은 버린다 — 아직 안 적은 것이다', () => {
    expect(manualLines([{ name: '', spec: '', qty: '5', price: '1000', isTaxExempt: false }], '매출')).toEqual([]);
  });

  it('부가세 포함 단가에서 공급가를 거꾸로 푼다', () => {
    const r = manualLines([{ name: '참기름', spec: '', qty: '10', price: '11000', isTaxExempt: false }], '매출');
    expect(r[0]).toMatchObject({ qty: 10, price: 11000, supply: 100000, tax: 10000, total: 110000 });
  });

  it('면세면 세액이 0이고 단가가 그대로 공급가다', () => {
    const r = manualLines([{ name: '참깨', spec: '', qty: '3', price: '10000', isTaxExempt: true }], '매출');
    expect(r[0]).toMatchObject({ supply: 30000, tax: 0, total: 30000 });
  });

  it('소수 수량이 끼어도 원 단위로 떨어진다 — 전표에 1,234.56원이 찍히면 안 된다', () => {
    const r = manualLines([{ name: '벌크', spec: '', qty: '0.277', price: '1070', isTaxExempt: false }], '매출');
    expect(Number.isInteger(r[0].supply)).toBe(true);
    expect(Number.isInteger(r[0].tax)).toBe(true);
  });

  it('매출은 계정 800이 기본, 매입은 비어 있다 — 골라야 한다', () => {
    const row = { name: 'x', spec: '', qty: '1', price: '1000', isTaxExempt: false };
    expect(manualLines([row], '매출')[0].accountCode).toBe('800');
    expect(manualLines([row], '매입')[0].accountCode).toBeUndefined();
  });

  it('줄에 적힌 계정이 기본보다 앞선다', () => {
    const r = manualLines([{ name: 'x', spec: '', qty: '1', price: '1000', isTaxExempt: false, accountCode: '404' }], '매출');
    expect(r[0].accountCode).toBe('404');
  });
});

describe('orderLines — 박스를 낱개로 푼다', () => {
  const 공통 = { stmtType: '매출' as const, allItems: 목록, partnerItems: [], partnerId: 'A' };

  it('박스 1개 = 낱개 10개로 바뀐다 — 전표는 낱개 기준이다', () => {
    const r = orderLines({ ...공통, order: 주문([{ itemId: 'box', name: '박스', quantity: 1, price: 10000 }]) });
    expect(r[0]).toMatchObject({ name: '참기름/1750ml', qty: 10 });
  });

  it('박스 단위로 적힌 주문은 boxQuantity 를 쓴다', () => {
    const r = orderLines({ ...공통, order: 주문([{ itemId: 'box', name: '박스', quantity: 3, isBoxUnit: true, boxQuantity: 2, price: 10000 }]) });
    expect(r[0].qty).toBe(20);   // 2박스 × 10
  });

  it('품목을 못 찾으면 표시를 단다 — 박스가 안 풀린 채 들어가면 수량이 10배 틀린다', () => {
    const r = orderLines({ ...공통, order: 주문([{ itemId: '없는것', name: '없는품목', quantity: 5, price: 1000 }]) });
    expect(r[0].unknownItem).toBe(true);
    expect(r[0].qty).toBe(5);
  });

  it('ID가 없거나 바뀌었으면 같은 이름으로 박스를 추정하지 않는다', () => {
    const r = orderLines({ ...공통, order: 주문([{ itemId: '바뀐id', name: '참기름/1750ml 박스', quantity: 1, price: 1000 }]) });
    expect(r[0].qty).toBe(1);
    expect(r[0].unknownItem).toBe(true);
  });
});

describe('orderLines — 같은 품목은 한 줄로 합친다', () => {
  const 공통 = { stmtType: '매출' as const, allItems: 목록, partnerItems: [], partnerId: 'A' };

  it('한 주문에 같은 품목이 두 번 들어도 한 줄이다', () => {
    const r = orderLines({ ...공통, order: 주문([
      { itemId: 'loose', name: '참기름/1750ml', quantity: 5, price: 11000 },
      { itemId: 'loose', name: '참기름/1750ml', quantity: 3, price: 11000 },
    ]) });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ qty: 8, supply: 80000, tax: 8000 });
  });

  it('규격이 다르면 다른 줄이다', () => {
    const 다른 = 품목({ id: 'l2', name: '참기름/1750ml', spec: '350ml' });
    const r = orderLines({ ...공통, allItems: [...목록, 다른], order: 주문([
      { itemId: 'loose', name: 'a', quantity: 1, price: 1100 },
      { itemId: 'l2', name: 'b', quantity: 1, price: 1100 },
    ]) });
    expect(r).toHaveLength(2);
  });

  it('합친 줄도 번호는 이어진다', () => {
    const 다른 = 품목({ id: 'l2', name: '들기름', spec: '350ml' });
    const r = orderLines({ ...공통, allItems: [...목록, 다른], order: 주문([
      { itemId: 'loose', name: 'a', quantity: 1, price: 1100 },
      { itemId: 'l2', name: 'b', quantity: 1, price: 1100 },
      { itemId: 'loose', name: 'a', quantity: 1, price: 1100 },
    ]) });
    expect(r.map(x => x.no)).toEqual([1, 2]);
  });
});

describe('orderLines — 단가 우선순위', () => {
  const 공통 = { stmtType: '매출' as const, allItems: 목록, partnerId: 'A' };
  const 주 = 주문([{ itemId: 'loose', name: '참기름/1750ml', quantity: 1, price: 9900 }]);

  it('거래처 단가가 주문에 적힌 값보다 앞선다', () => {
    const r = orderLines({ ...공통, order: 주, partnerItems: [단가({ itemId: 'loose', partnerId: 'A', Direction: 'out', price: 11000 })] });
    expect(r[0].price).toBe(11000);
  });

  it('거래처 단가가 없으면 주문에 적힌 값', () => {
    expect(orderLines({ ...공통, order: 주, partnerItems: [] })[0].price).toBe(9900);
  });

  it('이번에 고친 값이 제일 앞선다', () => {
    const r = orderLines({
      ...공통, order: 주,
      partnerItems: [단가({ itemId: 'loose', partnerId: 'A', Direction: 'out', price: 11000 })],
      editablePrices: { 'loose||1750ml': '12000' },
    });
    expect(r[0].price).toBe(12000);
  });

  it('박스를 풀었으면 주문 단가를 개입수로 나눈다 — 안 나누면 열 배로 끊긴다', () => {
    //  주문에 적힌 180,000 은 10개들이 **박스** 값이다. 낱개 10개로 풀었으니 18,000 이다.
    const r = orderLines({
      ...공통,
      order: 주문([{ itemId: 'box', name: '참기름/1750ml 박스', quantity: 1, price: 180000 }]),
      partnerItems: [],
    });
    expect(r[0]).toMatchObject({ qty: 10, price: 18000 });
    expect(r[0].total).toBe(180000);   // 전표 금액은 주문과 같아야 한다
  });

  it('박스가 아니면 주문 단가를 그대로 쓴다', () => {
    const r = orderLines({ ...공통, order: 주, partnerItems: [] });
    expect(r[0].price).toBe(9900);
  });

  it('다른 거래처 단가는 안 쓴다 — 남한테 팔던 값으로 끊기면 안 된다', () => {
    const r = orderLines({ ...공통, order: 주, partnerItems: [단가({ itemId: 'loose', partnerId: 'B', Direction: 'out', price: 99999 })] });
    expect(r[0].price).toBe(9900);
  });
});

describe('orderLines — 과세·계정', () => {
  const 공통 = { stmtType: '매출' as const, allItems: 목록, partnerId: 'A' };
  const 주 = 주문([{ itemId: 'loose', name: '참기름/1750ml', quantity: 1, price: 11000 }]);
  const key = 'loose||1750ml';

  it('거래처가 면세면 면세다', () => {
    const r = orderLines({ ...공통, order: 주, partnerItems: [단가({ itemId: 'loose', partnerId: 'A', Direction: 'out', taxType: '면세' })] });
    expect(r[0].isTaxExempt).toBe(true);
  });

  it('안 적혀 있으면 과세가 기본이다', () => {
    expect(orderLines({ ...공통, order: 주, partnerItems: [] })[0].isTaxExempt).toBe(false);
  });

  it('사람이 뒤집은 게 제일 앞선다 — false 로 뒤집은 것도 지킨다', () => {
    const r = orderLines({
      ...공통, order: 주,
      partnerItems: [단가({ itemId: 'loose', partnerId: 'A', Direction: 'out', taxType: '면세' })],
      taxExemptOverrides: { [key]: false },
    });
    expect(r[0].isTaxExempt).toBe(false);
  });

  it('전에 끊었던 계정을 이어 쓴다', () => {
    const r = orderLines({ ...공통, order: 주, partnerItems: [단가({ itemId: 'loose', partnerId: 'A', Direction: 'out', Account_Code: '404' })] });
    expect(r[0].accountCode).toBe('404');
  });

  it('이번에 고른 계정이 앞선다', () => {
    const r = orderLines({
      ...공통, order: 주,
      partnerItems: [단가({ itemId: 'loose', partnerId: 'A', Direction: 'out', Account_Code: '404' })],
      accountCodeOverrides: { [key]: '401' },
    });
    expect(r[0].accountCode).toBe('401');
  });
});

describe('lineTotals', () => {
  const 줄 = (o: any) => ({ supply: 0, tax: 0, ...o } as any);

  it('보통 전표는 전 줄을 더한다', () => {
    expect(lineTotals([줄({ supply: 100, tax: 10 }), 줄({ supply: 200, tax: 20 })]))
      .toEqual({ isTwoSided: false, supply: 300, tax: 30, amount: 330 });
  });

  it('양변 전표는 차변만 센다 — 다 더하면 두 배가 된다(거산농산 123만 → 246만)', () => {
    const t = lineTotals([
      줄({ supply: 1230000, side: '차변' }),
      줄({ supply: 1230000, side: '대변' }),
    ]);
    expect(t).toMatchObject({ isTwoSided: true, supply: 1230000, amount: 1230000 });
  });

  it('빈 전표는 0', () => {
    expect(lineTotals([])).toEqual({ isTwoSided: false, supply: 0, tax: 0, amount: 0 });
  });
});

describe('resolveOrderItem — 주문 줄이 실제로 무엇인가', () => {
  it('박스면 낱개로 바꾸고 개입수를 알려준다', () => {
    const r = resolveOrderItem({ itemId: 'box', name: '박스', quantity: 2 } as any, 목록);
    expect(r).toMatchObject({ qty: 20, perBox: 10, unknownItem: false });
    expect(r.product?.id).toBe('loose');
  });

  it('낱개면 그대로, 개입수는 1', () => {
    const r = resolveOrderItem({ itemId: 'loose', name: '낱개', quantity: 3 } as any, 목록);
    expect(r).toMatchObject({ qty: 3, perBox: 1 });
  });

  it('못 찾으면 표시를 달고 수량을 그대로 둔다', () => {
    const r = resolveOrderItem({ itemId: '없음', name: '없음', quantity: 4 } as any, 목록);
    expect(r).toMatchObject({ qty: 4, perBox: 1, unknownItem: true, product: undefined });
  });
});

describe('orderItemPrice — 박스 단가를 낱개로 나눈다', () => {
  it('거래처 단가가 있으면 그게 이긴다 (이미 낱개 값이라 안 나눈다)', () => {
    expect(orderItemPrice({ perBox: 10 }, { price: 180000 } as any, 18500)).toBe(18500);
  });

  it('거래처 단가가 없으면 주문 단가를 개입수로 나눈다 — 안 나누면 열 배다', () => {
    expect(orderItemPrice({ perBox: 10 }, { price: 180000 } as any, undefined)).toBe(18000);
  });

  it('박스가 아니면 그대로', () => {
    expect(orderItemPrice({ perBox: 1 }, { price: 9900 } as any, undefined)).toBe(9900);
  });

  it('둘 다 없으면 0', () => {
    expect(orderItemPrice({ perBox: 1 }, {} as any, undefined)).toBe(0);
  });
});

/**
 * **과세·면세를 정한 적 없는 품목은 `-` 로 보인다.**
 *
 * 거래처–품목 연결에 `taxType` 이 없으면 그냥 **과세로 떨어뜨렸다**. 그래서 정한 적 없는
 * 것과 과세로 정한 것이 화면에서 똑같이 보였고, 안 정한 채로 전표가 나가도 몰랐다
 * (2026-09-06 사장님). 셈은 그대로 과세로 한다 — 합계가 비면 그게 더 나쁘다.
 * 대신 `taxUnknown` 을 달아 화면이 `-` 로 띄운다.
 */
describe('과세·면세를 정했나', () => {
  const 주문 = (itemId: string) => ({
    id: 'o1', items: [{ itemId, quantity: 1 }],
  } as never);
  const 품목 = [{ id: 'A', name: '참기름', spec: '350ml', type: 'product' }] as never;
  const 셈 = (partnerItems: unknown[], overrides = {}) => orderLines({
    order: 주문('A'), stmtType: '매출', allItems: 품목,
    partnerItems: partnerItems as never, partnerId: 'p1',
    taxExemptOverrides: overrides,
  } as never)[0];

  it('연결에 taxType 이 없으면 아직 안 정한 것이다', () => {
    const l = 셈([{ itemId: 'A', partnerId: 'p1', price: 1000 }]);
    expect(l.taxUnknown).toBe(true);
    expect(l.isTaxExempt, '셈은 그대로 과세로 한다').toBe(false);
  });

  it('연결이 아예 없어도 안 정한 것이다', () => {
    expect(셈([]).taxUnknown).toBe(true);
  });

  it('과세로 정해 뒀으면 정해진 것이다 — `-` 가 아니다', () => {
    const l = 셈([{ itemId: 'A', partnerId: 'p1', price: 1000, taxType: '과세' }]);
    expect(l.taxUnknown).toBeUndefined();
    expect(l.isTaxExempt).toBe(false);
  });

  it('면세로 정해 뒀으면 면세다', () => {
    const l = 셈([{ itemId: 'A', partnerId: 'p1', price: 1000, taxType: '면세' }]);
    expect(l.taxUnknown).toBeUndefined();
    expect(l.isTaxExempt).toBe(true);
  });

  it('이번에 손으로 정했으면 그때부터 정해진 것이다', () => {
    const l = 셈([{ itemId: 'A', partnerId: 'p1', price: 1000 }], { 'A||350ml': false });
    expect(l.taxUnknown).toBeUndefined();
    expect(l.isTaxExempt).toBe(false);
  });
});

describe('전표 줄의 품목 ID', () => {
  it('같은 이름·규격이라도 ID가 다르면 합치지 않는다', () => {
    const r = orderLines({ stmtType: '매출', partnerId: 'p1', partnerItems: [],
      allItems: [{ ...낱개, id: 'first' }, { ...낱개, id: 'second' }],
      order: 주문([{ itemId: 'first', name: 낱개.name, quantity: 1, price: 1000 },
        { itemId: 'second', name: 낱개.name, quantity: 2, price: 2000 }]),
    });
    expect(r.map(x => [x.itemId, x.qty, x.price])).toEqual([['first', 1, 1000], ['second', 2, 2000]]);
  });

  it('박스를 푼 뒤에는 낱개 ID가 전표에 남는다', () => {
    const r = orderLines({ stmtType: '매출', partnerId: 'p1', partnerItems: [], allItems: 목록,
      order: 주문([{ itemId: 'box', name: '박스', quantity: 1, price: 10000 }]),
    });
    expect(r[0].itemId).toBe('loose');
  });
});
