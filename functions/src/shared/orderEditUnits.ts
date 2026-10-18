export interface OrderEditItem {
  lineId?: string;
  itemId: string;
  name: string;
  quantity: number;
  price: number;
  orderedAs?: string;
  checked?: boolean;
  checkedBy?: string;
  checkedAt?: string;
  mfgDate?: string;
  mfgBy?: string;
  mfgAt?: string;
  labelType?: '대기' | '날인' | '부착';
  labelBy?: string;
  labelAt?: string;
  isBoxUnit?: boolean;
  boxQuantity?: number;
  unitsPerBox?: number;
  boxType?: string;
  boxSubId?: string;
  displaySize?: string;
}
/** 주문 입력 당시 수량 표기를 보존한다. BOM이나 현재 포장표를 다시 계산하지 않는다. */
export const boxCountOf = (item: Pick<OrderEditItem,'quantity'|'boxQuantity'>): number => item.boxQuantity ?? item.quantity;
export function orderItemQuantityLabel(item: Pick<OrderEditItem,'quantity'|'isBoxUnit'|'boxQuantity'|'unitsPerBox'>,unit='개'): string {
  if (item.isBoxUnit && item.boxQuantity) return `${item.boxQuantity}박스`;
  return `${item.quantity}${unit || '개'}`;
}