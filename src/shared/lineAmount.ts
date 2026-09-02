/**
 * **세금 포함 단가에서 공급가액과 세액을 푼다.**
 *
 * 이 앱에서 사람이 치는 단가는 **언제나 세금 포함 값**이다(거래처와 주고받는 값이 그거라서).
 * 전표에 남겨야 하는 건 공급가액과 세액이라 거꾸로 풀어야 한다.
 *
 *   과세 : 공급가액 = 반올림(합계 ÷ 1.1) · 세액 = 합계 − 공급가액
 *   면세 : 공급가액 = 합계 · 세액 = 0
 *
 * ---
 * **합계를 나눈다 — 단가를 먼저 나누지 않는다.**
 *
 * 이 셈이 앱 안에 아홉 군데로 흩어져 있었고 두 갈래로 갈려 있었다.
 *
 *   ① 반올림(수량 × 단가 ÷ 1.1)    합계를 나눈다   ← 품목표·템플릿·OEM
 *   ② 반올림(단가 ÷ 1.1) × 수량    단가를 나눈다   ← 주문 불러오기
 *
 * 단가 1,070원 × 7개면 ①은 6,809, ②는 6,811이다. 같은 전표를 주문에서 불러오느냐
 * 손으로 치느냐에 따라 공급가액이 갈렸다. 세금계산서는 **공급대가 합계에서 역산**하므로
 * ①이 맞고, 여기서는 ①만 쓴다.
 *
 * ②를 쓰던 자리도 저장하는 단가는 세금 포함 값이었다(중간 계산에만 썼다).
 * 그래서 통일해도 **전표에 찍히는 단가는 안 바뀌고** 공급가액·세액만 1~2원 움직인다.
 *
 * ---
 * **반품은 음수 그대로 둔다.** 수량이 음수면 공급가액·세액·합계가 다 음수다.
 * `> 0`으로 거르면 반품 전표의 세 칸이 통째로 비어 보인다.
 */
export interface LineAmount {
  /** 세금 포함 합계 (수량 × 단가) */
  gross: number;
  supply: number;
  tax: number;
}

/** 부가가치세율 — 한 곳에만 적는다 */
export const VAT_RATE = 0.1;

/**
 * @param qty      수량. 반품이면 음수다.
 * @param price    **세금 포함** 단가
 * @param exempt   면세면 true
 */
export function lineAmount(qty: number, price: number, exempt?: boolean): LineAmount {
  const gross = Math.round((Number(qty) || 0) * (Number(price) || 0));
  if (exempt) return { gross, supply: gross, tax: 0 };
  const supply = Math.round(gross / (1 + VAT_RATE));
  //  세액은 빼서 낸다 — 따로 반올림하면 공급가액 + 세액 ≠ 합계 가 된다
  return { gross, supply, tax: gross - supply };
}

/** 글자로 들어오는 자리가 많다(입력칸은 전부 글자다) */
export function lineAmountOf(
  qty: string | number, price: string | number, exempt?: boolean,
): LineAmount {
  const n = (v: string | number) => Number(String(v ?? '').replace(/[,\s원]/g, '')) || 0;
  return lineAmount(n(qty), n(price), exempt);
}

/**
 * 줄들을 더한다 — **줄마다 반올림한 값을 더한다.**
 * 합계를 다시 나누면 줄 합과 전표 합이 안 맞는다.
 */
export function sumLines(lines: LineAmount[]): LineAmount {
  return lines.reduce<LineAmount>(
    (a, l) => ({ gross: a.gross + l.gross, supply: a.supply + l.supply, tax: a.tax + l.tax }),
    { gross: 0, supply: 0, tax: 0 },
  );
}
