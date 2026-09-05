import type { Partner } from './types';

/**
 * **거래처가 파는 상대인가 사는 상대인가.**
 *
 * 이 판정이 열 곳에 손으로 적혀 있었다(2026-09-05).
 * 갈래가 넷이라(`매출처`·`매입처`·`매출+매입처`·`금융기관`) 조건을 매번 두 개씩 쓰게 되고,
 * 그러다 **받침을 빼먹으면 거래처가 목록에서 통째로 사라진다.**
 *
 * ---
 * **갈래가 안 적힌 옛 거래처는 매출처로 본다.**
 *
 * 처음엔 파는 상대만 있었고 갈래 칸이 나중에 생겼다. 그래서 안 적힌 것은 매출처다 —
 * 매입 쪽에는 그 받침이 **없다**(안 적힌 것을 매입처로 치면 엉뚱한 데서 사 온 게 된다).
 * 이 비대칭이 규칙이라 여기 한 곳에 적어 둔다.
 */
type RoleLike = Pick<Partner, 'partnerType'>;

/** 이 거래처에 파는가 — **갈래가 안 적혀 있으면 그렇다** */
export const sellsTo = (c: RoleLike | undefined): boolean =>
  !c?.partnerType || c.partnerType === '매출처' || c.partnerType === '매출+매입처';

/** 이 거래처에서 사 오는가 — 안 적힌 것은 **아니다** */
export const buysFrom = (c: RoleLike | undefined): boolean =>
  c?.partnerType === '매입처' || c?.partnerType === '매출+매입처';

/** 은행·카드 같은 곳 — 물건을 주고받지 않는다 */
export const isFinancial = (c: RoleLike | undefined): boolean =>
  c?.partnerType === '금융기관';
