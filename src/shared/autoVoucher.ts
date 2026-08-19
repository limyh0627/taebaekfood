import type { FixedCostTemplate, CashEntry, IssuedStatement, IssuedStatementItem } from './types';

/**
 * 정기 전표 발행 — 템플릿 하나로 무엇을 만들지 정한다. 순수 함수, DB 안 건드림.
 *
 * 앱(버튼)과 스케줄러(Cloud Function)가 **같은 함수**를 써야 한다.
 * 규칙이 두 벌이면 손으로 낸 것과 자동으로 난 것이 달라지고, 그건 눈으로 못 잡는다.
 *
 *   출금·입금   자금전표 하나        (차) 비용 / (대) 통장
 *   줄돈        매입전표로 채무만     (차) 비용 / (대) 251 → 지불은 따로
 *   받을돈      매출전표로 채권만     (차) 108 / (대) 수익 → 수금은 따로
 *   대체        돈이 영영 안 움직임   (차) 감가상각비 / (대) 감가상각누계액
 *
 * 중복 발행은 id로 막는다(`AUTO-{템플릿}-{YYYY-MM}`). 같은 달에 두 번 돌아도 한 건이다.
 */

/** 그 달에 이 템플릿이 나가는 날. issueDay 31은 말일로 친다. */
export function issueDateOf(ym: string, issueDay?: number): string {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();          // 그 달 마지막 날
  const day = Math.min(Math.max(issueDay ?? 1, 1), last);
  return `${ym}-${String(day).padStart(2, '0')}`;
}

/** 오늘(YYYY-MM-DD)이 이 템플릿의 발행일인가 */
export function isIssueDay(today: string, t: FixedCostTemplate): boolean {
  return issueDateOf(today.slice(0, 7), t.issueDay) === today;
}

/** 그 달 발행분의 고유 id — 중복 발행 방지 */
export function autoVoucherId(t: FixedCostTemplate, ym: string): string {
  return `AUTO-${t.id}-${ym}`;
}

/** 옛 postMode를 새 dir로 읽는다 — '분리'는 채무를 세우는 것이니 '줄돈'이다. */
export function dirOf(t: FixedCostTemplate): NonNullable<FixedCostTemplate['dir']> {
  if (t.dir) return t.dir;
  return t.postMode === '분리' ? '줄돈' : '출금';
}
/** 돈이 지금 움직이는 갈래인가 — 아니면 전표(매입·매출·대체)로 끊는다 */
export const isCashDir = (d: string) => d === '입금' || d === '출금';

/**
 * 자동 발행 대상인가 — 켜져 있고, 금액이 있고, 기간 안이어야 한다.
 * 금액이 0이면 못 켠다: 매달 다른 금액(전기세)을 자동으로 만들면 틀린 숫자가 장부에 남는다.
 */
export function canAutoIssue(t: FixedCostTemplate, ym: string): boolean {
  if (!t.autoIssue || !t.accountCode) return false;
  // 회사 간 이체는 두 장부에 동시에 서야 해서 자동 발행 대상이 아니다(손으로 끊는다)
  if (dirOf(t) === '회사이체') return false;
  if (!(t.amount > 0)) return false;
  if (t.startYm && ym < t.startYm) return false;
  if (t.endYm && ym > t.endYm) return false;
  const d = dirOf(t);
  // 비현금 갈래는 **거래처가 있어야 자동으로 낼 수 있다.**
  //   거래처 있음 → 매입전표. 상대변이 251 외상매입금으로 자동이라 한 줄이면 된다.
  //   거래처 없음 → 순수 대체. 차·대를 직접 세워야 하는데 템플릿엔 계정이 하나뿐이라
  //                 반쪽 전표가 된다 — 그건 손으로 끊는다.
  if (!isCashDir(d) && !t.partnerId) return false;
  return true;
}

/** 출금·입금 — 자금전표 한 건 */
export function buildCashVoucher(
  t: FixedCostTemplate,
  ym: string,
  opts: { cashAccountId?: string; accountName?: string } = {},
): CashEntry {
  return {
    id: autoVoucherId(t, ym),
    date: issueDateOf(ym, t.issueDay),
    cashAccountId: opts.cashAccountId ?? '',
    dir: (dirOf(t) === '입금' ? '입금' : '출금') as '입금' | '출금',
    amount: t.amount,
    accountCode: t.accountCode,
    ...(t.partnerId ? { partnerId: t.partnerId, partnerName: t.partnerName ?? '' } : {}),
    note: `정기 · ${t.name}${t.partnerName ? ` · ${t.partnerName}` : ''}`,
    createdAt: new Date().toISOString(),
  } as CashEntry;
}

/**
 * 줄돈·받을돈·대체 — 전표 한 건. 결제는 안 만든다(채권·채무만 세운다).
 * 금액은 **부가세 포함 총액**으로 본다. 과세면 1.1로 나눠 공급가·세액을 가른다.
 */
export function buildStatementVoucher(
  t: FixedCostTemplate,
  ym: string,
  opts: { docNo: string; accountName?: string } = { docNo: '' },
): IssuedStatement {
  const total = t.amount;
  const exempt = !!t.taxExempt;
  const supply = exempt ? total : Math.round(total / 1.1);
  const tax = exempt ? 0 : total - supply;
  const item: IssuedStatementItem = {
    // 품목명 → 계정과목 이름 → 템플릿 이름 순. 비워 두면 계정 이름이 그대로 들어간다.
    name: t.itemName?.trim() || opts.accountName || t.name,
    spec: '', qty: 1, price: total,
    supply, tax, total,
    isTaxExempt: exempt,
    accountCode: t.accountCode,
  };
  const date = issueDateOf(ym, t.issueDay);
  const d = dirOf(t);
  return {
    id: autoVoucherId(t, ym),
    issuedAt: new Date(`${date}T09:00:00+09:00`).toISOString(),
    tradeDate: date,
    // 거래처가 있으면 매입전표(미지급금이 선다), 없으면 순수 대체(차·대 직접).
    // 받을돈은 매출전표 — 지금 화면에선 안 쓰지만 규칙은 남겨 둔다.
    type: d === '받을돈' ? '매출' : (t.partnerId ? '매입' : '비용'),
    partnerId: t.partnerId ?? '',
    partnerName: t.partnerName ?? '',
    orderId: autoVoucherId(t, ym),      // 중복 체크에 쓰던 키 — 기존 정기비용과 같은 자리
    docNo: opts.docNo,
    totalSupply: supply,
    totalTax: tax,
    totalAmount: total,
    items: [item],
  } as IssuedStatement;
}
