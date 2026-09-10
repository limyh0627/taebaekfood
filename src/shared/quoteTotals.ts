import { lineAmount } from './lineAmount';
import { marginFromSupply } from './margin';

/**
 * **견적서 합계 셈.**
 *
 * 화면([QuotationManager](../../components/QuotationManager.tsx)) 안에 있던 것을 떼어 왔다 —
 * 화면 안에 있으면 시험할 수가 없어서, 아래 "안 고른 줄은 안 더한다" 같은 규칙을 못 박을 데가 없었다.
 *
 * 부수효과 없음(입력 → 값).
 */

/** 견적 한 줄 — 셈에 필요한 것만 */
export interface QuoteLineLike {
  name?: string;
  qty?: number;
  /**
   * **판매단가**(부가세 포함) — 사람이 협상하고 기억하는 그 숫자다.
   *
   * 2026-09-10 사장님: "단가는 판매단가고 공급가액은 공급가액이지."
   * 예전엔 이 칸이 세별도였다. 그래서 거래처 단가(세포함)를 가져다 넣으면 부가세를 **또** 얹어
   * 과세 품목 견적이 10% 비싸게 나갔다 — 18,000원짜리가 19,800원으로 찍혔다.
   * 한 앱에서 '단가' 가 두 뜻이면 언젠가 또 틀린다. 공급가액은 여기서 **역산해서** 낸다.
   */
  price?: number;
  cost?: number;
  /** 면세면 부가세를 안 붙인다. **안 정했으면 undefined** */
  isTaxExempt?: boolean;
}

export interface QuoteTotals {
  supply: number;
  tax: number;
  total: number;
  cost: number;
  margin: number;
  marginRate: number;
  /** 과세·면세를 아직 안 고른 줄 수 — 0 이 아니면 저장을 막는다 */
  undecided: number;
}

/**
 * 줄들의 공급가·세액·합계·원가. 면세 줄은 세액이 0이다.
 *
 * **과세·면세를 안 고른 줄은 안 더한다**(2026-09-09 사장님: "-가 디폴트고 사용자가 고르게 만들어").
 * 과세로 쳐서 더하면 화면에 그럴듯한 숫자가 떠서 **안 골랐다는 걸 못 알아챈다** —
 * 고르게 하려고 비워 둔 뜻이 사라진다. 대신 몇 줄이 안 정해졌는지 같이 돌려준다.
 */
export function quoteTotals(lines: readonly QuoteLineLike[]): QuoteTotals {
  let supply = 0, tax = 0, cost = 0, undecided = 0;
  for (const l of lines) {
    if (l.isTaxExempt === undefined) {
      if (String(l.name ?? '').trim()) undecided++;   // 빈 줄은 안 센다
      continue;
    }
    const qty = Number(l.qty) || 0;
    //  **단가는 판매단가**(세포함) — 공급가액·세액은 여기서 역산한다. 셈은 shared/lineAmount 하나다.
    const a = lineAmount(qty, Number(l.price) || 0, l.isTaxExempt);
    supply += a.supply;
    tax += a.tax;
    cost += Math.round(qty * (Number(l.cost) || 0));
  }
  //  마진은 **공급가 기준**이다 — 부가세는 받아서 그대로 내는 돈이라 남는 게 아니다.
  //  셈은 shared/margin 한 곳에 있다. 여기는 줄마다 세액을 따로 셌으니 공급가를 그대로 넘긴다.
  const m = marginFromSupply(supply, cost);
  return { supply, tax, total: supply + tax, cost, margin: m.margin, marginRate: m.marginRate, undecided };
}
