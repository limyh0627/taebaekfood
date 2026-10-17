import React from 'react';
import type { Order } from '../../../shared/types';
import { orderInventoryErrorMessage } from '../../../shared/orderInventoryError';

export function OrderRecoveryEntry({order,renderOrderRecovery}:{order:Order;renderOrderRecovery?: (order:Order)=>React.ReactNode}) {
  const failed=order.inventoryOperation?.state==='failed';
  const action=order.inventoryOperation?.state==='processing' ? null : renderOrderRecovery?.(order);
  if(!failed&&!action)return null;
  return <section aria-label="주문 재고 작업 상태" className="mx-3 my-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs">
    {failed&&<><p className="font-bold text-amber-900">재고 작업 실패</p><p className="mt-1 break-words">{orderInventoryErrorMessage(order.inventoryOperation?.error)}</p></>}
    {action}
  </section>;
}
