import type { CompanyId } from './types';

/** 원료가 아닌 품목의 입고 한 줄. 제품별원장이 이걸 읽어 '입고'로 그린다. */
export interface ItemReceipt {
  id: string;
  itemId: string;
  itemName: string;
  quantity: number;
  unit?: string;
  partnerId?: string;
  partnerName: string;
  /** 입고일 'YYYY-MM-DD' */
  date: string;
  poId?: string;
  companyId?: CompanyId;
  addedBy?: string;
  createdAt: string;
}
