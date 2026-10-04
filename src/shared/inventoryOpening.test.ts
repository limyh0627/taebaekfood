import { describe, expect, it } from 'vitest';
import type { Item } from './types';
import { inventoryOpeningStatement } from './inventoryOpening';
import { journalizeTransfer } from './autoJournal';

const item = { id: 'wip1', name: '참기름 캔', type: 'wip', unit: '캔', spec: '16.5kg' } as Item;

describe('기초 재고 전표', () => {
  it('품목 수량·평가액을 남기고 146 재고자산과 상대 자본이 일치한다', () => {
    const voucher = inventoryOpeningStatement('punghoe', '2026-07-31', item, 15, 247_500);
    expect(voucher).toMatchObject({ id: 'opening-inventory-punghoe-wip1', tradeDate: '2026-07-31', totalAmount: 247_500 });
    expect(journalizeTransfer(voucher)?.lines).toEqual([
      { accountCode: '146', debit: 247_500, credit: 0 },
      { accountCode: '375', debit: 0, credit: 247_500 },
    ]);
  });
  it('수량 또는 평가액이 없으면 등록하지 않는다', () => {
    expect(() => inventoryOpeningStatement('punghoe', '2026-07-31', item, 0, 10)).toThrow();
    expect(() => inventoryOpeningStatement('punghoe', '2026-07-31', item, 1, 0)).toThrow();
  });
});
