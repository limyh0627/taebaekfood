import * as recordModule from '../../functions/src/shared/orderProductionRecordPlan';
import type {Order,Item} from './types';
import {orderStockUnitInputs,type OrderUnitInputs} from './orderUnits';
import {dateOfLocal} from './day';
import type {OrderInventoryGeneration} from './orderInventoryGeneration';
const shared=(Reflect.get(recordModule,'default')??recordModule) as typeof recordModule;
export type {ProductionRecordIndexEntry,ProductionRecordIndex,LegacyProductionSourceCandidate,OrderGeneratedProductionRecord,OrderProductionRecordPlan,OrderProductionRecordReceipt} from '../../functions/src/shared/orderProductionRecordPlan';
export const {orderProductionRecordId,validateOrderProductionRecordPlan,makeOrderProductionRecordReceipt,validateProductionRecordIndex,deriveNextProductionRecordIndex}=shared;
/** 생략한 기준정보는 각 resolver 읽기 시점의 기존 레지스트리를 사용한다. */
export function buildOrderProductionRecordPlan(order:Order,allItems:readonly Item[],inputs:OrderUnitInputs|undefined,generation:OrderInventoryGeneration):recordModule.OrderProductionRecordPlan {
 return shared.buildOrderProductionRecordPlan(order,allItems,orderStockUnitInputs(inputs),generation,{dateOf:dateOfLocal});
}
