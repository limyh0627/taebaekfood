import { ensureOrderLineIds } from '../orderLineInventory';
import { addItem, companyScopedWriteData, confirmUnitPurchaseOrderReceipt } from './firebaseService';
import type { OrderUnitInputs } from '../orderUnits';
import type { Item } from '../types';

type CreateCommand = {
  kind: 'create'; collection: 'orders' | 'purchaseOrders' | 'returnRequests';
  data: Record<string, any>;
};
type ReceiveCommand = { kind: 'receive'; poId: string; actorName?: string; items: Item[]; orderUnitInputs?: OrderUnitInputs };

/** 직원·관리자의 주문/발주/반품은 재고 단위로 정규화한 뒤 같은 저장 경계를 지난다. */
export async function executeEmployeeCommand(command: CreateCommand | ReceiveCommand) {
  if (command.kind === 'receive') {
    if (!command.poId) throw new Error('입고할 발주를 선택해 주세요.');
    return command.orderUnitInputs
      ? confirmUnitPurchaseOrderReceipt(command.poId, command.actorName, command.items, command.orderUnitInputs)
      : confirmUnitPurchaseOrderReceipt(command.poId, command.actorName, command.items);
  }
  const { collection } = command;
  const data = await companyScopedWriteData(collection, command.data);
  const rows = Array.isArray(data.items) && data.items.length
    ? data.items : collection === 'purchaseOrders' ? [data] : [];
  if (!rows.length || rows.some((row: Record<string, any>) => !row.itemId
    || typeof row.quantity !== 'number' || !Number.isFinite(row.quantity) || row.quantity <= 0)) {
    throw new Error('품목과 0보다 큰 수량을 입력해 주세요.');
  }
  if (collection !== 'purchaseOrders' && !data.partnerId) throw new Error('거래처를 선택해 주세요.');
  // 박스 입력은 폼에서 이미 재고 단위로 변환했다. 여기서 다시 곱하지 않는다.
  return addItem(collection, {
    ...data,
    ...(collection === 'orders' ? { items: ensureOrderLineIds(rows) } : {}),
    createdAt: data.createdAt || new Date().toISOString(),
  });
}
