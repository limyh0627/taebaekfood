// 채권·채무·부가세·현금 계정코드 (setup-account-codes.mjs와 일치)
export const AR = '108';   // 외상매출금
export const AP = '251';   // 외상매입금
export const VAT_PAYABLE = '255';   // 부가세예수금
export const VAT_RECEIVABLE = '135'; // 부가세대급금
export const OTHER_PAYABLE = '253';  // 미지급금 — 상거래가 아닌 채무

/**
 * **251 외상매입금은 상거래 채무만 쓴다.**
 *
 * 물건·원재료를 외상으로 산 것만 외상매입금이다. 세금·경비·자산구입·카드값처럼
 * 상거래가 아닌 채무는 **253 미지급금**이 표준이다.
 * 안 가르면 재무상태표의 매입채무가 부풀고, 그 안에 세금 낼 돈까지 섞여 보인다.
 *
 * 한 전표에 상거래 계정이 하나라도 있으면 그 거래는 상거래다 — 참깨 매입에 딸린
 * 상차비·운임은 같은 거래의 부대비용이라 따로 253으로 가르지 않는다.
 */
export const TRADE_PURCHASE_CODES = new Set(['500', '501', '503', '505']);
export function payableCodeFor(itemCodes: (string | undefined)[]): string {
  const cs = itemCodes.map(c => String(c ?? ''));
  //  전표가 채무 계정을 **직접 적었으면** 그게 답이다 — 기초 이월 전표가 그 꼴이다
  //  (108/251을 줄에 박아 놓는다). 짐작으로 덮으면 갚은 계정이 진 계정과 어긋난다.
  if (cs.includes(AP)) return AP;
  if (cs.includes(OTHER_PAYABLE)) return OTHER_PAYABLE;
  //  채권 계정이 줄에 있으면 그 전표는 이미 상계 성격이다 — 예전대로 251로 턴다
  if (cs.includes(AR)) return AP;
  //  계정을 못 읽는 전표(빈 줄·자본만)는 예전대로 251 — 여기서 253으로 밀면
  //  옛 전표의 채무가 갑자기 다른 계정으로 옮겨 간다.
  if (!cs.some(c => c && (TRADE_PURCHASE_CODES.has(c) || NON_TRADE_HINT.test(c)))) return AP;
  return cs.some(c => TRADE_PURCHASE_CODES.has(c)) ? AP : OTHER_PAYABLE;
}
/** 253으로 보낼 만한 계정대 — 비용·세금·자산구입. 자본(3xx)·채권채무는 안 걸린다. */
export const NON_TRADE_HINT = /^(1[0-9]{2}|2[0-9]{2}|5[1-9][0-9]|6[0-9]{2}|8[0-9]{2}|9[0-9]{2})$/;
/** 갚을 돈 계정인가 — 거래처 잔액은 251·253을 **한 덩어리**로 본다(둘 다 그 거래처에 갚을 돈이다) */
export const isPayableCode = (code: string | undefined): boolean =>
  code === AP || code === OTHER_PAYABLE;
export const BANK = '103';  // 보통예금 (기본 현금계정)
export const INVENTORY = '146';   // 재고자산
export const PURCHASE = '500';    // 원료매입 — 실지재고조사법의 재고 대체 상대계정

export const r = (n: number) => Math.round((n ?? 0) * 100) / 100;
export const sum = (xs: number[]) => r(xs.reduce((a, b) => a + b, 0));
/** 파생 분개를 다시 계산해도 같은 시각이 나오게 원본 시각, 없으면 회계일 자정을 쓴다. */
export const sourceTimestamp = (date: string, timestamp?: string): string =>
  timestamp || `${date}T00:00:00.000Z`;

/**
 * 수금·지불 자금전표가 물릴 계정을 고른다.
 *
 * 원칙은 **채권·채무 상계**다(매출→108, 매입→251). 매출·매입은 전표를 끊을 때 이미 손익에
 * 잡혔으므로, 결제는 그 채권을 현금으로 턴 것뿐이다. 품목 계정을 그대로 물리면
 * (차)예금 (대)일반매출 로 분개돼 매출이 두 번 잡히고 외상매출금은 영영 안 줄어든다.
 *
 * 예외는 하나 — 기계 구입처럼 **비유동자산만** 달린 전표. 자금원장이 투자활동으로 끊어야 해서
 * 그 자산 계정을 그대로 물려준다(computeCashFlowMonth.isOperating과 같은 규칙).
 *
 * 기초전표는 상대변이 375 이월이익잉여금(자본)이라 이 예외에 걸리면 안 된다.
 * 걸리면 수금이 자본계정으로 잡혀 **미수가 그대로 남는다** — 2026-08-13 논두렁 건이 그랬다.
 *
 * @param stmtType   결제 대상 전표의 종류
 * @param itemCodes  그 전표들의 품목 계정코드
 * @param groupTypeOf 계정코드 → 그룹 5분류(자산·부채·자본·수익·비용)
 * @returns 자금전표에 박을 계정코드. undefined면 계정 미지정(영업)으로 둔다.
 */
export function settlementAccountCode(
  stmtType: '매출' | '매입' | string,
  itemCodes: string[],
  groupTypeOf: (code: string) => string | undefined,
): string | undefined {
  const codes = itemCodes.filter(Boolean);
  const types = codes.map(groupTypeOf).filter(Boolean) as string[];
  // 전 품목이 자산이고 채권·채무가 안 섞였을 때만 예외. 자본(375)·수익·비용은 여기서 걸러진다.
  const nonOperating = types.length > 0
    && types.length === codes.length
    && types.every(t => t === '자산')
    && !codes.some(c => c === AR || c === AP);
  if (!nonOperating) return stmtType === '매입' ? payableCodeFor(codes) : AR;
  const uniq = new Set(codes);
  return uniq.size === 1 ? [...uniq][0] : undefined;
}
