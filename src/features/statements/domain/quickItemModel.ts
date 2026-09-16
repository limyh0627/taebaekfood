import { lineAmount, priceParts } from '../../../shared/lineAmount';
import { marginOf } from '../../../shared/margin';

export type QuickItemMetrics = {
  supply: number;
  tax: number;
  marginRate: number;
  unitSupply: number;
  showUnitSupply: boolean;
};

/** 빠른 품목 입력과 전표 줄이 공급가·세액·마진을 서로 다르게 세지 않도록 공용 계산값을 만든다. */
export function quickItemMetrics(input: {
  quantity: number;
  unitPrice: number;
  cost: number;
  taxExempt: boolean;
}): QuickItemMetrics {
  const amount = lineAmount(input.quantity, input.unitPrice, input.taxExempt);
  const unit = priceParts(input.unitPrice, input.taxExempt);
  return {
    supply: amount.supply,
    tax: amount.tax,
    marginRate: marginOf(input.unitPrice, input.cost, input.taxExempt).marginRate,
    unitSupply: unit.supply,
    showUnitSupply: unit.showSupply,
  };
}
