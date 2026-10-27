import {isBulkItem,isGoodsItem} from './itemInventoryKind';
import {boxCountOf,type OrderEditItem} from './orderEditUnits';
import {unpackStockComponent,type StockComponent} from './stockUnitMeasure';

export interface OrderStockUnitInputs {
  bom:{of(parentId:string):readonly StockComponent[]};
  pack:{of(itemId:string):number};
}

type BoxLike={id:string};

export function unpackComponent(product: BoxLike | undefined, inputs: OrderStockUnitInputs): { itemId: string; count: number } | null {
  return unpackStockComponent(product ? inputs.bom.of(product.id) : []);
}

export function isBoxStockItem(product: BoxLike | undefined, inputs: OrderStockUnitInputs): boolean {
  return unpackComponent(product, inputs) !== null;
}

export function stockUnits(
  item: Pick<OrderEditItem, 'quantity' | 'isBoxUnit' | 'boxQuantity'>,
  product: BoxLike | undefined,
  inputs: OrderStockUnitInputs,
): number {
  if (!isBoxStockItem(product, inputs)) return item.quantity;
  /*
   * **박스 품목이면 `isBoxUnit` 은 안 본다**(2026-09-09 사장님:
   * "박스 품목으로 주문 들어오면 isBoxUnit 이 true 일 필요는 없는거야?").
   *
   * 품목이 이미 "나는 박스다" 라고 말하고 있으니 그 사실이 줄에도 또 있는 셈이었고,
   * **그 둘이 갈린 게 사고였다** — 박스 20으로 넣은 뒤 낱개로 토글하면
   * `isBoxUnit` 만 꺼지고 `quantity` 는 낱개(200)로 남아, 여기서 200을 박스로 읽었다.
   * 무경유통 볶음참깨가 그렇게 2,000kg 빠졌다.
   *
   * 이제 박스 수가 적혀 있으면(`boxQuantity`) 그게 임자고, 없으면 `quantity` 가 박스 수다
   * — 운영 데이터의 박스 품목 주문줄 309개가 전부 그 모양이다(2026-09-09 실측).
   */
  return boxCountOf(item);
}

export function unitsPerBoxOf(product: BoxLike | undefined, inputs: OrderStockUnitInputs): number {
  if (!product) return 0;
  const packed = unpackComponent(product, inputs);
  if (packed) return packed.count;
  return inputs.pack.of(product.id);
}

export function unpackQty(qty: number, product: Parameters<typeof unitsPerBoxOf>[0], isBox: boolean|undefined, inputs: OrderStockUnitInputs): number {
  const n = Number(qty) || 0;
  if (!isBox) return n;
  const per = unitsPerBoxOf(product, inputs);
  return per > 1 ? n * per : n;
}

export const goodsShipQty = (item: Pick<OrderEditItem,'quantity'|'isBoxUnit'|'boxQuantity'|'unitsPerBox'>, product: {id:string;type?:string;subtype?:string;category?:string;procureType?:string}, inputs: OrderStockUnitInputs): number => {
  if (isBoxStockItem(product, inputs)) return stockUnits(item, product, inputs);
  const uPerBox = item.unitsPerBox || unitsPerBoxOf(product, inputs) || 1;
  //  **몇 박스인가는 `boxCountOf` 만 답한다** — 여기서 또 따지면 재고와 전표가 갈린다
  //  (`boxCount.test.ts` 가 막는다). 여기서 내는 값은 박스 수가 아니라 **낱개 수**다.
  return item.isBoxUnit && item.boxQuantity ? boxCountOf(item) * uPerBox : item.quantity;
};

export const shipQtyOfLine = (item: Pick<OrderEditItem,'quantity'|'isBoxUnit'|'boxQuantity'|'unitsPerBox'>, product: {id:string;type?:string;subtype?:string;category?:string;procureType?:string} | undefined, inputs: OrderStockUnitInputs): number => {
  if (!product || isBulkItem(product)) return 0;
  return isGoodsItem(product) ? goodsShipQty(item, product, inputs) : stockUnits(item, product, inputs);
};
