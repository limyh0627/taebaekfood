import type {EditorItem} from './itemEditorDomain';
import type {InventoryKindItem} from './itemInventoryKind';
import type {OrderEditItem} from './orderEditUnits';
import type {BomIndex} from './bomIndex';
import type {OrderStockUnitInputs} from './orderStockUnits';

export type ProductionItem=Pick<EditorItem,'id'|'name'|'type'|'품목'|'spec'|'phantom'> & Pick<InventoryKindItem,'unit'|'subtype'> & {category?:string;procureType?:string};
export type ProductionLine=Pick<OrderEditItem,'itemId'|'quantity'|'isBoxUnit'|'boxQuantity'|'unitsPerBox'>;
export interface ProductionOrder {items:ProductionLine[];purpose?:'stock-production'}
export interface ProductionInputs<TItem extends ProductionItem> {bom:Pick<BomIndex<TItem>,'of'>;pack:OrderStockUnitInputs['pack']}


/** 실제 생산 계산 순간의 입력과 결과. 과거 기록에는 없을 수 있다. */
export interface OrderRawCalculationEvidence {
  productId: string;
  spec: string;
  units: number;
  raw: string;
  kg: number;
  path: 'bom-direct' | 'bom-formula' | 'formula-fallback' | 'bulk';
  childItemId?: string;
  bomQuantityKg?: number;
  formulaName?: string;
  ratio?: number;
  convertedKg?: number;
}

export const stock3 = (value: number) => Math.round(value * 1000) / 1000;

export function isStockProduction(order: Pick<ProductionOrder, 'purpose'>): boolean {
  return order.purpose === 'stock-production';
}
