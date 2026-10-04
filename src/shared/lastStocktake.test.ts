import { describe, expect, it } from 'vitest';
import type { Item, RawMaterialEntry } from './types';
import { lastStocktakeDate } from './lastStocktake';

describe('lastStocktakeDate', () => {
  it('품목 실사 앵커의 최신 날짜를 보여준다', () => {
    const item = { id: 'box', name: '볶음참깨', type: 'product', stocktakeAnchors: [
      { id: 'a', date: '2026-09-20' }, { id: 'b', date: '2026-10-02' },
    ] } as Item;
    expect(lastStocktakeDate(item, [])).toBe('2026-10-02');
  });

  it('원료는 같은 회사·품목의 실제 실사정정만 고른다', () => {
    const item = { id: 'raw', name: '참깨', type: 'raw', subtype: '벌크', companyId: 'taebaek' } as Item;
    const rows = [
      { id: 'rm-stocktake-1', companyId: 'taebaek', rawItemId: 'raw', date: '2026-09-28', targetKg: 20 },
      { id: 'receipt-1', companyId: 'taebaek', rawItemId: 'raw', date: '2026-10-01', received: 30 },
      { id: 'rm-stocktake-2', companyId: 'punghoe', rawItemId: 'raw', date: '2026-10-03', targetKg: 40 },
    ] as RawMaterialEntry[];
    expect(lastStocktakeDate(item, rows)).toBe('2026-09-28');
  });
});
