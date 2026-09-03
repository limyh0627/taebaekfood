import type { IssuedStatement } from '../../shared/types';
import { isReceivableStmt } from './cashLedger';

/**
 * **전표 화면이 딛고 선 셈 셋** — `useVoucherLedger` 안에 갇혀 있던 것을 꺼냈다.
 *
 * 훅 안에 있어 테스트가 하나도 안 붙어 있었는데(2026-09-03 커버리지 0%),
 * 셋 다 **실제로 한 번씩 물린 자리**다. 훅은 이제 이걸 부르기만 한다.
 */

/**
 * 세 갈래로 떠온 전표를 하나로 — **나중에 넣은 것이 이긴다.**
 *
 *   앵커 미결  가장 옛것. 배분을 이어 가려고 id 로 집어 온 것
 *   조회분     기간을 넓혀 떠온 스냅샷
 *   구독분     최근 7일 실시간. **가장 최신이라 이게 이겨야 한다**
 *
 * 순서가 뒤집히면 방금 고친 전표가 옛 스냅샷으로 덮인다.
 * 지운 전표는 마지막에 뺀다 — 스냅샷은 삭제가 저절로 안 비쳐서 다시 떠오면 되살아난다.
 * 회사 거르기도 여기서 한다. 회사가 안 붙은 옛 전표는 태백 것으로 본다.
 */
export function mergeStatements(input: {
  anchor?: IssuedStatement[];
  extra?: IssuedStatement[];
  live?: IssuedStatement[];
  deletedIds?: Iterable<string>;
  companyId: string;
}): IssuedStatement[] {
  const { anchor = [], extra = [], live = [], deletedIds = [], companyId } = input;
  const map = new Map<string, IssuedStatement>();
  for (const s of anchor) map.set(s.id, s);
  for (const s of extra) map.set(s.id, s);
  for (const s of live) map.set(s.id, s);      //  구독분이 이긴다
  for (const id of deletedIds) map.delete(id);
  return [...map.values()].filter(s => (s.companyId ?? 'taebaek') === companyId);
}

/**
 * 전표가 걸린 주문 id — **`invoicePrinted` 플래그가 아니라 전표 실물이 근거다.**
 *
 * 플래그는 양쪽으로 다 거짓말한다. 전표를 지워도 true 로 남아 그 주문이 영영 숨고,
 * 전표를 손으로 이어 붙이면 false 라 전표가 있는데 미발행으로 뜬다.
 * 2026-08 에 실제로 3건이 숨어 있었다(일성상회 08-18 · 세화식품 08-13 · 글로벌유통 08-05).
 *
 * 한 전표가 여러 주문을 묶기도 해서 쉼표·공백으로 갈라 담는다.
 */
export function voucheredOrderIds(statements: Pick<IssuedStatement, 'orderId'>[]): Set<string> {
  const set = new Set<string>();
  for (const st of statements)
    for (const v of String(st.orderId ?? '').split(/[,\s]+/)) if (v) set.add(v);
  return set;
}

/**
 * **수금·지불 버튼을 달 전표인가** — 채권(108)·채무(251)를 세우는 것만.
 *
 * 예전엔 `남은금액 > 0` 하나로 봤는데, 남은금액은 배분에 없으면 총액으로 물러선다.
 * 그래서 감가상각·급여·선급금대체처럼 **갚을 상대가 없는 전표까지** 전액 미결제로 잡혀
 * 지불처리 버튼이 붙었다(그때 데이터로 비용 25건).
 *
 * 기초이월은 type 이 '비용'이지만 108·251 을 세우므로 여기 걸린다 — 실제로 갚아야 할 것이다.
 */
export function canSettleStatement(s: IssuedStatement, balance: number): boolean {
  return (isReceivableStmt(s, '매출') || isReceivableStmt(s, '매입')) && balance > 0;
}
