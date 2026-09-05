import { describe, it, expect } from 'vitest';
import { mergeStatementItems, mergeAndSplit } from './mergeStatementItems';

const 줄 = (o: any) => ({
  name: '참기름', spec: '350ml', qty: 1, supply: 10000, tax: 1000, total: 11000,
  isTaxExempt: false, ...o,
});
const 전표 = (...items: any[]) => ({ id: 's', items } as any);

describe('mergeStatementItems', () => {
  it('전표 하나면 그대로', () => {
    expect(mergeStatementItems([전표(줄({}))])).toEqual([{
      name: '참기름', spec: '350ml', qty: 1, supply: 10000, tax: 1000, total: 11000, isTaxExempt: false,
    }]);
  });

  it('여러 전표에 흩어진 같은 품목을 한 줄로 모은다', () => {
    const r = mergeStatementItems([
      전표(줄({ qty: 3, supply: 30000, tax: 3000, total: 33000 })),
      전표(줄({ qty: 2, supply: 20000, tax: 2000, total: 22000 })),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ qty: 5, supply: 50000, tax: 5000, total: 55000 });
  });

  it('규격이 다르면 다른 줄', () => {
    const r = mergeStatementItems([전표(줄({ spec: '350ml' }), 줄({ spec: '1750ml' }))]);
    expect(r).toHaveLength(2);
  });

  it('**과세와 면세는 안 합친다** — 세금계산서가 둘을 따로 적는다', () => {
    const r = mergeStatementItems([전표(
      줄({ isTaxExempt: false, supply: 10000, tax: 1000 }),
      줄({ isTaxExempt: true, supply: 10000, tax: 0 }),
    )]);
    expect(r).toHaveLength(2);
  });

  it('처음 나온 차례를 지킨다', () => {
    const r = mergeStatementItems([전표(줄({ name: '들기름' }), 줄({ name: '참기름' }))]);
    expect(r.map(i => i.name)).toEqual(['들기름', '참기름']);
  });

  it('품목이 없는 전표가 섞여도 넘어간다', () => {
    expect(mergeStatementItems([{ id: 'x' } as any, 전표(줄({}))])).toHaveLength(1);
  });

  it('빈 목록은 빈 결과', () => {
    expect(mergeStatementItems([])).toEqual([]);
  });

  it('원본 전표를 안 건드린다', () => {
    const s = 전표(줄({ qty: 1 }));
    mergeStatementItems([s, 전표(줄({ qty: 4 }))]);
    expect(s.items[0].qty).toBe(1);
  });
});

describe('mergeAndSplit', () => {
  it('합친 뒤 과세·면세로 가른다', () => {
    const { taxable, exempt } = mergeAndSplit([전표(
      줄({ name: '참기름', isTaxExempt: false }),
      줄({ name: '참깨', isTaxExempt: true, tax: 0 }),
      줄({ name: '참기름', isTaxExempt: false, qty: 2, supply: 20000, tax: 2000, total: 22000 }),
    )]);
    expect(taxable).toHaveLength(1);
    expect(taxable[0]).toMatchObject({ qty: 3, supply: 30000, tax: 3000 });
    expect(exempt.map(i => i.name)).toEqual(['참깨']);
  });

  it('한쪽이 없어도 빈 배열로 온다', () => {
    const { taxable, exempt } = mergeAndSplit([전표(줄({ isTaxExempt: false }))]);
    expect(exempt).toEqual([]);
    expect(taxable).toHaveLength(1);
  });
});
