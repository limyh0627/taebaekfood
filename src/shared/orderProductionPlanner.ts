import type {Item} from './types';
import {orderStockUnitInputs,type OrderUnitInputs} from './orderUnits';
import * as coreModule from '../../functions/src/shared/orderProductionPlanner';
const core=(Reflect.get(coreModule,'default')??coreModule) as typeof coreModule;
export type {StockUseChoice,StockUsePlan,RawUsageKg} from '../../functions/src/shared/orderProductionPlanner';
import type {RawUsageKg} from '../../functions/src/shared/orderProductionPlanner';
export const {perUnitOilKg,addDelta,createOrderProductionPlanner}=core;

export function oemLedgerKg(
  product: Pick<Item, 'id' | 'spec'>,
  units: number,
  formula: readonly { raw: string; ratio: number }[],
  inputs?: OrderUnitInputs,
): RawUsageKg {
  return core.oemLedgerKg(product,units,formula,orderStockUnitInputs(inputs));
}
