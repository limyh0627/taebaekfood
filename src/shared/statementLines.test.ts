import { describe, it, expect } from 'vitest';
import { manualLines, orderLines, lineTotals } from './statementLines';

const 품목 = (o: any) => o as any;
const 주문 = (items: any[]) => ({ id: 'o1', items } as any);
const 단가 = (o: any) => o as any;

//  참기름 1750ml 낱개 / 그 10개들이 박스
const 낱개 = 품목({ id: 'loose', name: '참기름/1750ml', spec: '1750ml', unit: '개' });
const 박스 = 품목({ id: 'box', name: '참기름/1750ml 박스', unit: '박스', unpackTo: { itemId: 'loose', count: 10 } });
const 목록 = [낱개, 박스];

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

  it('찾는 품목이 이름으로라도 걸리면 푼다', () => {
    const r = orderLines({ ...공통, order: 주문([{ itemId: '바뀐id', name: '참기름/1750ml 박스', quantity: 1, price: 1000 }]) });
    expect(r[0].qty).toBe(10);
    expect(r[0].unknownItem).toBeUndefined();
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
      editablePrices: { '참기름/1750ml||1750ml': '12000' },
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
  const key = '참기름/1750ml||1750ml';

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
