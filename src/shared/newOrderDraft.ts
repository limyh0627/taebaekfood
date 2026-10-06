import type { Item, Order, OrderPallet, OrderSource, Partner, PartnerItem, ShipMethod } from './types';
import { boxDerivedUnitPrice, isBoxStockItem, unitsPerBoxOf } from './orderUnits';
import { defaultShipMethod, isDeliveryChannel } from './channelStyle';
import { clampNote } from './orderNote';

export interface NewOrderLineInput {
  itemId: string;
  quantity: number | '';
  isBoxUnit: boolean;
  unitsPerBox?: number;
  boxType?: string;
  boxSubId?: string;
  displaySize?: string;
  orderedAs?: string;
}

/** 직접 선택·추출은 입력만 다르고, 주문줄 환산과 최종 주문 생성은 이곳에서 함께 처리한다. */
export function buildNewOrderDraft(input: {
  partner: Partner; items: Item[]; partnerItems: PartnerItem[]; lines: NewOrderLineInput[];
  orderDate: string; deliveryDate: string; shipToId?: string; source?: OrderSource;
  shipMethod?: ShipMethod; note?: string; noteImportant?: boolean; pallets: OrderPallet[];
}): Omit<Order, 'id' | 'status'> {
  const { partner } = input;
  const links = input.partnerItems.filter(link => link.Direction === 'out' && link.partnerId === partner.id);
  const items = input.lines.flatMap(line => {
    if (!line.quantity || line.quantity <= 0) return [];
    const product = input.items.find(item => String(item.id).trim() === String(line.itemId).trim());
    if (!product) return [];
    // 박스 SKU는 이미 박스 단위다. 낱개 SKU를 박스로 주문할 때만 개입수를 곱한다.
    const boxedLoose = line.isBoxUnit && !isBoxStockItem(product);
    const perBox = boxedLoose ? (line.unitsPerBox ?? unitsPerBoxOf(product)) : 0;
    const quantity = boxedLoose && perBox > 0 ? line.quantity * perBox : line.quantity;
    const orderedAs = line.orderedAs?.trim();
    return [{
      itemId: product.id, name: product.name || '알 수 없는 상품', quantity,
      price: boxDerivedUnitPrice(product, partner.id, links) ?? links.find(link => link.itemId === product.id)?.price ?? 0,
      ...(boxedLoose ? { isBoxUnit: true, boxQuantity: line.quantity,
        ...(perBox > 0 ? { unitsPerBox: perBox, boxType: line.boxType ?? '' } : {}) } : {}),
      ...(!isBoxStockItem(product) && line.boxSubId ? { boxSubId: line.boxSubId } : {}),
      ...(line.displaySize ? { displaySize: line.displaySize } : {}),
      ...(orderedAs && orderedAs !== product.name ? { orderedAs: orderedAs.slice(0, 80) } : {}),
    }];
  });
  const source = input.source ?? (['일반', '택배', '스마트스토어'].includes(partner.type) ? partner.type as OrderSource : '일반');
  const note = input.note?.trim();
  return {
    partnerId: partner.id, partnerName: partner.name || '이름 없음', email: partner.email || '',
    ...(input.shipToId ? { shipToId: input.shipToId } : {}),
    createdAt: new Date(`${input.orderDate}T00:00:00+09:00`).toISOString(),
    deliveryDate: new Date(input.deliveryDate).toISOString(), items,
    totalAmount: items.reduce((sum, line) => sum + line.price * line.quantity, 0),
    ...(note ? { note: clampNote(note), ...(input.noteImportant ? { noteImportant: true } : {}) } : {}),
    source, shipMethod: input.shipMethod ?? defaultShipMethod(source), region: partner.region || '미지정',
    pallets: input.pallets.filter(pallet => pallet.quantity > 0),
    ...(isDeliveryChannel(source) ? { deliveryBoxes: [] } : {}),
  };
}
