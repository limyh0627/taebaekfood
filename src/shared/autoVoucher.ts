import type { FixedCostTemplate, CashEntry, IssuedStatement, IssuedStatementItem } from './types';

/**
 * 정기 전표 발행 — 템플릿 하나로 무엇을 만들지 정한다. 순수 함수, DB 안 건드림.
 *
 * 앱(버튼)과 스케줄러(Cloud Function)가 **같은 함수**를 써야 한다.
 * 규칙이 두 벌이면 손으로 낸 것과 자동으로 난 것이 달라지고, 그건 눈으로 못 잡는다.
 *
 *   합침  나가는 날 출금전표 하나            (차) 비용 / (대) 보통예금
 *   분리  발생일에 매입전표로 채무를 세운다   (차) 비용 / (대) 외상매입금
 *         지불은 따로 — 거래처 미지급금이 늘어나므로 기존 [지불] 흐름을 그대로 탄다
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

/**
 * 자동 발행 대상인가 — 켜져 있고, 금액이 있고, 기간 안이고, 분리면 거래처가 있어야 한다.
 * 금액이 0이면 못 켠다: 매달 다른 금액(전기세)을 자동으로 만들면 틀린 숫자가 장부에 남는다.
 */
export function canAutoIssue(t: FixedCostTemplate, ym: string): boolean {
  if (!t.autoIssue || !t.accountCode) return false;
  if (!(t.amount > 0)) return false;
  if (t.startYm && ym < t.startYm) return false;
  if (t.endYm && ym > t.endYm) return false;
  if ((t.postMode ?? '합침') === '분리' && !t.partnerId) return false;
  return true;
}

/** 합침 — 출금 자금전표 한 건 */
export function buildCashVoucher(
  t: FixedCostTemplate,
  ym: string,
  opts: { cashAccountId?: string; accountName?: string } = {},
): CashEntry {
  return {
    id: autoVoucherId(t, ym),
    date: issueDateOf(ym, t.issueDay),
    cashAccountId: opts.cashAccountId ?? '',
    dir: (t.dir ?? '출금') as '입금' | '출금',
    amount: t.amount,
    accountCode: t.accountCode,
    ...(t.partnerId ? { partnerId: t.partnerId, partnerName: t.partnerName ?? '' } : {}),
    note: `정기 · ${t.name}${t.partnerName ? ` · ${t.partnerName}` : ''}`,
    createdAt: new Date().toISOString(),
  } as CashEntry;
}

/**
 * 분리 — 매입전표 한 건. 지불은 안 만든다(채무만 세운다).
 * 금액은 **부가세 포함 총액**으로 본다. 과세면 1.1로 나눠 공급가·세액을 가른다.
 */
export function buildPurchaseVoucher(
  t: FixedCostTemplate,
  ym: string,
  opts: { docNo: string; accountName?: string } = { docNo: '' },
): IssuedStatement {
  const total = t.amount;
  const exempt = !!t.taxExempt;
  const supply = exempt ? total : Math.round(total / 1.1);
  const tax = exempt ? 0 : total - supply;
  const item: IssuedStatementItem = {
    name: opts.accountName || t.name,
    spec: '', qty: 1, price: total,
    supply, tax, total,
    isTaxExempt: exempt,
    accountCode: t.accountCode,
  };
  const date = issueDateOf(ym, t.issueDay);
  return {
    id: autoVoucherId(t, ym),
    issuedAt: new Date(`${date}T09:00:00+09:00`).toISOString(),
    tradeDate: date,
    type: '매입',
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
