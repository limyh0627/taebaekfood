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
 * ---
 * **단가라는 말이 두 뜻으로 쓰인다 — 이름으로 가른다.**
 *
 *   판매단가(세포함)   손님한테 부르는 값. 전표·거래명세서·주문이 쓴다.   `lineAmount`
 *   공급가 단가(세별도) 원가에 마진을 얹은 값. 견적서가 쓴다.           `lineAmountFromSupply`
 *
 * 견적서는 사장님이 셈하는 순서를 그대로 따른다 —
 *
 *     원가(세별도) 10,000 → 마진 30% 3,000 → 공급가액 13,000 → 부가세 1,300 → 판매가 14,300
 *
 * 같은 칸을 두 뜻으로 쓰면 어느 쪽인지 화면에서도 코드에서도 안 보인다. 그래서 함수를
 * 둘로 두고, 화면도 **둘 다 보여준다**(공급가액과 판매가를 나란히).
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

/**
 * **공급가 단가에서 세액과 판매가를 얹는다** — `lineAmount` 의 거울.
 *
 * 견적서처럼 원가에 마진을 얹어 값을 만드는 자리가 쓴다. 치는 값이 **세별도**다.
 *
 *   과세 : 공급가액 = 반올림(수량 × 단가) · 세액 = 반올림(공급가액 × 0.1)
 *   면세 : 세액 0
 *
 * 여기서는 **공급가액을 반올림한 뒤 세액을 얹는다.** `lineAmount` 는 반대로 합계를
 * 나눠 내려오므로, 같은 줄을 두 함수에 태우면 1원쯤 갈릴 수 있다 — 그게 정상이다.
 * 어느 쪽이 근거인지는 **그 화면이 무엇을 받아 적었느냐**가 정한다.
 *
 * @param qty     수량. 반품이면 음수다.
 * @param supply  **세금 별도** 단가(공급가 기준)
 * @param exempt  면세면 true
 */
export function lineAmountFromSupply(qty: number, supply: number, exempt?: boolean): LineAmount {
  const s = Math.round((Number(qty) || 0) * (Number(supply) || 0));
  if (exempt) return { gross: s, supply: s, tax: 0 };
  const tax = Math.round(s * VAT_RATE);
  return { gross: s + tax, supply: s, tax };
}

/**
 * **한 줄로 보여줄 단가 딱지** — 과세면 공급가액을 곁들인다.
 *
 * 화면 여기저기서 '판매단가'라고 한 숫자만 보여주는데, 그게 세포함이라 원가와 나란히
 * 두면 마진이 부풀어 보인다(원가는 세별도다). 그래서 과세 품목은 둘 다 적는다.
 *
 *   과세  `99,000` + `공급가 90,000`
 *   면세  `99,000`              ← 곁들일 게 없다
 *
 * @param price  **세금 포함** 판매단가
 */
export function priceParts(price: number | undefined | null, exempt?: boolean): {
  sale: number; supply: number; showSupply: boolean;
} {
  const sale = Math.round(Number(price) || 0);
  const { supply } = lineAmount(1, sale, exempt);
  return { sale, supply, showSupply: !exempt && supply !== sale };
}
