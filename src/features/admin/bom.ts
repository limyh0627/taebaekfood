import * as shared from '../../../functions/src/shared/itemFormula';
const implementation=(Reflect.get(shared,'default')??shared) as typeof shared;
export const formulaRowsOf=implementation.formulaRowsOf;
export const buildFormula=implementation.buildFormula;