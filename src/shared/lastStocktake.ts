import type { Item, RawMaterialEntry } from './types';
import { companyOf } from './types';
import { baseRawName } from '../constants/formula';
import { isRawHolder } from './rawHolder';

/** 재고 상세에는 해당 품목에 실제로 반영된 마지막 실사일만 표시한다. */
export function lastStocktakeDate(item: Item, ledger: RawMaterialEntry[]): string | null {
  const dates = isRawHolder(item)
    ? ledger.filter(entry => companyOf(entry) === companyOf(item)
      && (entry.rawItemId === item.id || (!entry.rawItemId && entry.material === baseRawName(item.name)))
      && (Number.isFinite(entry.targetKg) || /^rm-stocktake-/.test(entry.id) || /^재고실사/.test(entry.note ?? '')))
      .map(entry => entry.date)
    : (item.stocktakeAnchors ?? []).map(anchor => anchor.date);
  return dates.filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort().at(-1) ?? null;
}
