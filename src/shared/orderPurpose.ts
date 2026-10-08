import type { Order } from './types';

export function isStockProduction(order: Pick<Order, 'purpose'>): boolean {
  return order.purpose === 'stock-production';
}
