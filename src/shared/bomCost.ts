import * as shared from '../../functions/src/shared/bomCost';
const implementation=(Reflect.get(shared,'default')??shared) as typeof shared;
export const buildCostFn=implementation.buildCostFn;
export const rawCostPerKg=implementation.rawCostPerKg;
import type {Item} from './types';
export type BomCostCtx=shared.BomCostCtx<Item>;
export type CostFn=shared.CostFn<Item>;