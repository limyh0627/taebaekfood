import type { Order, RawMaterialEntry } from './types';
import { itemSummary } from './itemSummary';

/**
 * **원장 한 줄이 "누가, 어디에" 인지 푸는 셈.**
 *
 * 2026-09-07 사장님: "누가했는지랑 어디 쓰였는지 하나도 안 나오내".
 * 세 가지가 겹쳐 있었다 —
 *
 *   ① **폰에서 칸이 눌려 안 보였다.** 이름·비고가 들어가는 '내역' 칸이 `flex-1` 이라
 *      숫자 칸(w-16 셋 + w-24)에 밀려 0px 이 됐다. 값은 있는데 화면에 자리가 없었다.
 *   ② **자동 줄에는 `addedBy` 를 아예 안 적었다.** 주문 생산처리로 빠지는 줄이 대부분인데
 *      거기 사람 이름이 없다. (원장 152건 중 자동이 절반 넘는다)
 *   ③ **어디 쓰였는지는 거래처까지만 있었다.** 비고가 `자동: 한중교역` 이라
 *      "무슨 품목 만드느라 썼나"는 어디에도 없다.
 *
 * ③을 여기서 푼다 — 자동 줄은 `orderId` 를 들고 있으니 그 주문에서 **거래처 · 품목**을 낸다.
 *
 * ---
 * **품목은 이 원료를 쓰는 줄만 고른다**(2026-09-10 사장님: "왜 볶음참깨 외 품목들이 보이냐").
 *
 * 예전엔 주문에 담긴 것을 통째로 적었다. 한 주문에 참기름과 들깨가루가 같이 있으면
 * **볶음참깨 줄에도 들깨가루가 떴다.** 숫자는 맞는데 이름이 엉뚱해 보인다.
 * 이제 `linesOf` 를 받으면 [rawUsers](./rawUsers.ts) 가 배합식으로 걸러 준 줄만 쓴다.
 * 안 넘기면 예전대로 전부 보여준다(배합식을 모르는 화면도 있다).
 *
 * 부수효과 없음(입력 → 값).
 */

/** `자동: 한중교역 ▸ 대성 15kg` 의 머리. 거래처는 `where` 로 따로 세우니 비고에선 뗀다. */
const AUTO_HEAD = /^자동:\s*/;

/** 로트 자취를 잇는 글자 — orderStockEngine 이 비고에 붙이는 구분자와 같아야 한다 */
const LOT_SEP = ' ▸ ';

export interface LedgerTrace {
  /** 누가 — 사람 이름. 빈 값이면 **모른다**(옛 기록이거나 안 적힌 경로). */
  who: string;
  /** 어디 쓰였나 — `한중교역 · 참기름/병 외 2개`. 주문이 없으면 빈 값. */
  where: string;
  /** 그 주문 카드번호(`ORD-260901-01`) — 찾아갈 때 쓴다 */
  cardNo?: string;
  /** 남은 비고 — 자동 줄이면 로트 자취(`대성 15kg + 한성 3kg`)만 남는다 */
  note: string;
}

/** 주문 목록 → id 로 찾는 표. 줄마다 훑으면 (줄 수 × 주문 수) 라 화면이 느려진다. */
export const orderIndex = (orders: readonly Order[] | undefined): Map<string, Order> =>
  new Map((orders ?? []).map(o => [o.id, o]));

export function ledgerTrace(
  e: Pick<RawMaterialEntry, 'note' | 'addedBy' | 'orderId'> & { material?: string },
  byId?: Map<string, Order>,
  /** 그 주문에서 **이 원료를 쓰는 줄만** 골라 주는 함수. 못 고르면 undefined 를 주면 된다. */
  linesOf?: (order: Order, material: string) => Order['items'] | undefined,
): LedgerTrace {
  const raw = String(e.note ?? '').trim();
  const order = e.orderId ? byId?.get(e.orderId) : undefined;

  const auto = AUTO_HEAD.test(raw);
  const 조각 = auto ? raw.replace(AUTO_HEAD, '').split(LOT_SEP) : [];
  //  주문을 찾았으면 거기 적힌 이름이 먼저다 — 비고는 찍힐 때 값이라 거래처명이 바뀌면 옛것이 남는다
  const 거래처 = order?.partnerName || (auto ? (조각[0] ?? '').trim() : '');
  //  이 원료를 쓰는 줄만 — 못 고르면(배합식 미등록 등) 예전대로 전부 보여준다.
  const 줄 = order && linesOf ? linesOf(order, String(e.material ?? '')) : undefined;
  const 품목 = itemSummary(줄 ?? order?.items, 1);

  return {
    who: String(e.addedBy ?? '').trim(),
    where: [거래처, 품목].filter(Boolean).join(' · '),
    ...(order?.cardNo ? { cardNo: order.cardNo } : {}),
    note: auto ? 조각.slice(1).join(LOT_SEP) : raw,
  };
}
