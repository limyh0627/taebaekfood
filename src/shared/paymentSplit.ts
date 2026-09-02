/**
 * **받은 돈을 '갚은 몫'과 '초과분'으로 가른다.**
 *
 * 갚을 것보다 많이 받았으면 그 초과분은 채권 상계가 아니다.
 *   매출 초과 → 259 선수금 (미리 받은 돈, 부채)
 *   매입 초과 → 131 선급금 (미리 준 돈, 자산)
 * 전액을 108/251에 몰면 채권·채무가 음수로 밀린다 — "안 진 빚을 갚았다"가 되는 자리다.
 *
 * ---
 * **'갚을 것'을 셀 때 방금 끊은 전표를 빠뜨리면 안 된다.**
 *
 * 거래명세서를 끊으면서 같은 클릭으로 수금하면, 그 순간 거래처 잔액은 **그 전표를 모른다**
 * (화면 상태가 아직 안 돌았다). 그래서 받을 돈이 0으로 보이고 **전액이 초과수금**으로 갔다.
 * 피쉬메이저 632,000이 그렇게 259 선수금에 앉았다 — 같은 날 외상매출금 632,000과 함께.
 * 둘이 상계돼야 하는데 양쪽에 그대로 남았다.
 *
 * 그래서 '아직 잔액에 안 잡힌 전표'를 따로 받아 더한다.
 */
export interface PaymentSplit {
  /** 채권·채무를 턴 몫 (108 / 251) */
  settled: number;
  /** 넘게 받은 몫 (259 선수금 / 131 선급금) */
  over: number;
}

/**
 * @param total 받은(준) 금액
 * @param owed  그 거래처에 **지금 갚을 것이 얼마인가**.
 *              거래처 잔액 + 아직 잔액에 안 잡힌 전표. 음수면 0으로 본다.
 */
export function splitPayment(total: number, owed: number): PaymentSplit {
  const t = Math.round(Number(total) || 0);
  if (t <= 0) return { settled: 0, over: 0 };
  const cap = Math.max(0, Math.round(Number(owed) || 0));
  const settled = Math.min(t, cap);
  return { settled, over: t - settled };
}

/**
 * 지금 갚을 것 — **거래처 잔액에 아직 안 잡힌 전표를 더한다.**
 *
 * @param balance      거래처 잔액에서 본 받을 돈(매출) 또는 갚을 돈(매입)
 * @param pendingTotal 방금 끊어 아직 잔액에 안 들어간 전표들의 합
 */
export function owedNow(balance: number | undefined, pendingTotal = 0): number {
  return Math.max(0, Math.round(Number(balance) || 0)) + Math.max(0, Math.round(pendingTotal));
}
