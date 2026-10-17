import type {CompanyId} from '../../../shared/types';

/**
 * **견적서** — 팔기 전에 얼마에 줄지 적어 내미는 종이.
 *
 * 전표(거래명세서)와 다른 점은 **아직 판 게 아니라는 것**이다. 그래서 회계에 아무것도 안 남긴다 —
 * 분개도, 채권도, 재고도 안 움직인다. 나중에 그 값으로 실제로 팔면 그때 전표를 끊는다.
 *
 * 그리고 견적은 대개 **안 팔던 걸 새로 팔 때** 낸다. 그래서 품목 고르는 자리가
 * 거래처에 등록된 것 위주면 안 된다 — 전 품목을 빠르게 뒤질 수 있어야 한다.
 * 값을 매기려면 원가가 보여야 하고, 단가를 넣으면 남는 게 바로 보여야 한다.
 */
export interface QuotationLine {
  /** 품목에서 골랐으면 그 id — 원가를 되찾는 데 쓴다. 직접 적은 줄은 없다. */
  itemId?: string;
  name: string;
  spec: string;
  /** 견적 당시 단위 스냅샷 — 품목의 단위가 나중에 바뀌어도 발행본은 그대로 남긴다. */
  unit?: string;
  qty: number;
  price: number;
  /** 낼 때의 원가 — 나중에 원료값이 바뀌어도 그때 얼마로 셈했는지 남는다 */
  cost?: number;
  /**
   * 면세면 부가세를 안 붙인다. **안 정했으면 `undefined`** —
   * 과세를 기본으로 두면 안 고르고 그냥 지나간다(2026-09-09 사장님).
   */
  isTaxExempt?: boolean;
  note?: string;
}

export interface Quotation {
  id: string;
  companyId?: CompanyId;
  quoteNo: string;
  date: string;                 // 'YYYY-MM-DD'
  /** 이 날까지 이 값이다 — 비우면 안 적는다 */
  validUntil?: string;
  /** 등록 거래처면 ID, 미등록 문의처 견적이면 빈 문자열 */
  partnerId: string;
  partnerName: string;
  /** 받는 업체 연락처 — 등록 거래처 값 또는 미등록 업체에 직접 적은 값을 견적에 남긴다. */
  recipientPhone?: string;
  /**
   * 담당자 — **이 견적을 낸 우리 쪽 사람.** 받는 쪽이 물어볼 데가 있어야 한다.
   * 새로 쓸 때는 쓰는 사람 이름이 저절로 들어간다(2026-09-05 사장님).
   */
  attention?: string;
  deliveryTerms?: string;
  paymentTerms?: string;
  lines: QuotationLine[];
  totalSupply: number;
  totalTax: number;
  totalAmount: number;
  /** 낼 때의 원가 합 — 나중에 "이 견적 남는 거였나"를 되짚을 수 있게 */
  totalCost?: number;
  note?: string;
  createdAt: string;
  createdBy?: string;
}
