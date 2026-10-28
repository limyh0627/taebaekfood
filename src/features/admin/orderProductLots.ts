import type {Item,Order,OrderItem,RawMaterialLot} from '../../shared/types';
import {buildProductLot,withCarryOverProductLot} from '../../shared/lotUtils';
import {orderStockUnitInputs,type OrderUnitInputs} from '../../shared/orderUnits';
import {createOrderProductLotPlanner} from '../../../functions/src/shared/orderProductLotPlan';
export {OrderInventoryPreconditionError} from '../../../functions/src/shared/orderProductLotPlan';
export type {OrderProductLotMutation,OrderProductLotMutationResult} from '../../../functions/src/shared/orderProductLotPlan';
const planner=(allItems:Item[]=[],inputs?:OrderUnitInputs,shipQtyOf:(row:OrderItem,item:Item)=>number=row=>row.quantity)=>createOrderProductLotPlanner({allItems,unitInputs:orderStockUnitInputs(inputs),shipQtyOf:(row,product)=>shipQtyOf(row as OrderItem,product as Item),lotPolicy:{buildProductLot,withCarryOverProductLot}});
export const productionProductLotMutation=(itemId:string,lot:RawMaterialLot)=>planner().productionProductLotMutation(itemId,lot);
export const productionProductLots=(allItems:Item[],deltas:ReadonlyMap<string,number>,operationId:string,inputs?:OrderUnitInputs)=>planner(allItems,inputs).productionProductLots(deltas,operationId);
export const reverseProductionProductLots=(traces:{itemId:string;lotId:string;qty:number}[]=[])=>planner().reverseProductionProductLots(traces);
export const combineProductLotMutations=(mutations:readonly import('../../../functions/src/shared/orderProductLotPlan').OrderProductLotMutation[])=>planner().combineProductLotMutations(mutations);
export interface OrderProductLotDeps {allItems:Item[];shipQtyOf:(item:OrderItem,product:Item)=>number}
export function createOrderProductLotOperations(deps:OrderProductLotDeps){const core=planner(deps.allItems,undefined,deps.shipQtyOf);return {deductProductLotsForOrder:(order:Order)=>core.deductProductLotsForOrder(order),restoreProductLotsForOrder:(order:Order)=>core.restoreProductLotsForOrder(order)};}
