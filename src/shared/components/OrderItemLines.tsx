import React from 'react';
import type { Item, OrderItem } from '../types';
import { orderItemQuantityLabel } from '../orderUnits';

interface OrderItemLinesProps {
  orderItems: readonly OrderItem[];
  itemById: ReadonlyMap<string, Item>;
  className?: string;
}

/** 펼쳐 본 주문 품목 — 상자 없이 작은 점·이름·수량으로 모든 주문 요약에서 같이 쓴다. */
const OrderItemLines: React.FC<OrderItemLinesProps> = ({ orderItems, itemById, className = '' }) => (
  <div className={`space-y-1 ${className}`}>
    {orderItems.map((line, index) => {
      const product = itemById.get(line.itemId);
      return (
        <div key={`${line.itemId || 'unknown'}-${index}`} className="flex min-w-0 items-baseline gap-2 text-[11px]">
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
          <span className="min-w-0 flex-1 break-words font-bold text-slate-600">
            {product?.name || line.name || '품목'}
          </span>
          <span className="shrink-0 whitespace-nowrap font-black text-slate-700">
            {orderItemQuantityLabel(line, product?.unit)}
          </span>
        </div>
      );
    })}
  </div>
);

export default OrderItemLines;
