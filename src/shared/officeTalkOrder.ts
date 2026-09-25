import type { CompanyId, Order } from './types';
import { companyOf } from './types';

/** 완료 표시는 메시지를 수정하지 않고, 실제 저장된 같은 회사 주문에서만 읽는다. */
export const extractedOfficeTalkMessageIds = (
  orders: readonly Pick<Order, 'companyId' | 'sourceChatMessageId'>[],
  companyId: CompanyId,
): string[] => [...new Set(orders
  .filter(order => companyOf(order) === companyId)
  .map(order => order.sourceChatMessageId?.trim())
  .filter((id): id is string => !!id))];
