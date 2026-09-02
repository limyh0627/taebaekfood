import { lineAmount } from './lineAmount';

/**
 * **얼마 남나 — 마진은 공급가에서 센다.**
 *
 * 이 앱에서 사람이 치는 단가는 **언제나 세금 포함**이다(`lineAmount` 참고).
 * 그런데 부가세는 손님한테 받아서 그대로 내는 돈이라 **우리한테 남는 게 아니다.**
 * 그걸 분모에 두면 마진이 부풀어 보인다.
 *
 *   볶음참깨/1kg   단가 5,600  원가 5,510
 *     판매가 기준   (5600−5510)/5600 = **+1.6%**   ← 남는다고 보인다
 *     공급가 기준   (5091−5510)/5091 = **−8.2%**   ← 실제로는 밑진다
 *
 * 부호가 뒤집힌다. 실제 거래처 단가 328줄 중 **308줄이 갈렸고 평균 36.7%p** 차이였다.
 *
 * ---
 * 셈이 네 벌로 흩어져 있었다 — 견적서와 원가계산기는 공급가로 옳게 셌는데,
 * 품목단가 화면과 거래명세서의 빠른입력은 **세금 포함 단가를 그대로 나눴다.**
 * 여기 하나로 모은다.
 *
 * **마진율과 원가율(markup)은 다른 것이다.**
 *   마진율   남는 돈 ÷ **판 값**    "100원 팔면 20원 남는다"
 *   원가율   남는 돈 ÷ **든 값**    "1,000원 들여 200원 붙였다"
 * 장사에서 말하는 '마진'은 대개 앞엣것이라 그쪽을 기본으로 둔다.
 */
export interface Margin {
  /** 부가세를 뺀 판 값 — 마진의 근거 */
  supply: number;
  cost: number;
  /** 남는 돈 = 공급가 − 원가. 밑지면 음수다(감추지 않는다) */
  margin: number;
  /** 마진율 (0.2 = 20%). 공급가가 0이면 0 */
  marginRate: number;
  /** 원가 대비 붙인 율 (0.2 = 20%). 원가가 0이면 0 */
  markupRate: number;
}

const rate = (num: number, den: number) => (den > 0 ? num / den : 0);

/**
 * @param price   **세금 포함** 판매가. 수량이 여럿이면 합계를 넣는다.
 * @param cost    원가(부가세 없음). 수량이 여럿이면 합계.
 * @param exempt  면세면 true — 그때는 판매가가 곧 공급가다.
 */
export function marginOf(price: number, cost: number, exempt?: boolean): Margin {
  const supply = lineAmount(1, Number(price) || 0, exempt).supply;
  const c = Math.round(Number(cost) || 0);
  const m = supply - c;
  return { supply, cost: c, margin: m, marginRate: rate(m, supply), markupRate: rate(m, c) };
}

/**
 * 공급가를 이미 손에 들고 있을 때 — 견적서처럼 줄마다 세액을 따로 센 화면이 쓴다.
 * 부가세를 두 번 빼지 않으려고 갈라 둔다.
 */
export function marginFromSupply(supply: number, cost: number): Margin {
  const s = Math.round(Number(supply) || 0);
  const c = Math.round(Number(cost) || 0);
  const m = s - c;
  return { supply: s, cost: c, margin: m, marginRate: rate(m, s), markupRate: rate(m, c) };
}

/** 화면에 찍을 백분율 — `12.3%`. 소수 자리는 부르는 쪽이 정한다. */
export const ratePct = (r: number, digits = 1): string => `${(r * 100).toFixed(digits)}%`;
