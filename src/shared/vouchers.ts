import type { CashEntry, CompanyId, IssuedStatement } from './types';
import { companyOf } from './types';
import { rowStamp, issuedMs } from './voucherStamp';

/**
 * 전표 — **매입·매출·대체·입금·출금은 갈래가 다를 뿐 다 같은 전표다.**
 *
 * 담기는 곳은 둘로 갈려 있다. 거래명세서는 `issuedStatements`, 자금은 `cashEntries`.
 * 그건 저장 사정이지 뜻이 아니다. 분개(buildJournals)는 이미 둘을 한 줄기로 합쳐
 * 손익·재무제표를 만든다 — **읽는 층에도 같은 줄기가 있어야 한다.**
 *
 * 없어서 생긴 일: 화면마다 두 컬렉션을 각자 다시 모았고, 그러다 한쪽을 빠뜨렸다.
 *   · 손익분석이 cashEntries를 아예 안 받아 급여·이자가 0으로 잡혔다
 *   · 월별 '전표 내역'에 자금전표가 안 떠서 합계와 내역이 안 맞았다
 *   · 매출원가를 전표만 보고 따로 세던 함수가 손익과 다른 값을 냈다
 * 하나씩 고치는 걸로는 안 끝난다. **모으는 자리를 하나로** 두면 빠뜨릴 자리가 없어진다.
 *
 * 여기서 합치는 건 **읽기**뿐이다. 쓰기(발행)는 갈래마다 화면이 다르고 검증도 다르다.
 * 저장까지 한 컬렉션으로 합치는 건 그 다음 단계다 — 이 모듈이 그때 바꿔 끼우는 자리가 된다.
 */

/** 전표 갈래 — 돈이 오갔나(입금·출금), 채권채무를 세웠나(매출·매입), 안 움직였나(대체) */
export type VoucherKind = '매출' | '매입' | '대체' | '입금' | '출금';

export interface VoucherLine {
  accountCode?: string;
  name: string;
  amount: number;
}

export interface Voucher {
  id: string;
  companyId: CompanyId;
  kind: VoucherKind;
  /** 전표일 — 거래가 일어난 날 */
  date: string;
  /** 하루 안의 자리 (전표일 + 로컬 시각). 소급은 23:59:59라 그날 맨 뒤에 선다. */
  ts: string;
  docNo?: string;
  partnerId?: string;
  partnerName?: string;
  memo?: string;
  amount: number;
  lines: VoucherLine[];
  /** 어느 컬렉션에서 왔나 — 고치러 갈 화면을 정하는 데만 쓴다 */
  source: 'statement' | 'cash';
}

/** 거래명세서 한 건 → 전표 */
export function voucherOfStatement(s: IssuedStatement): Voucher {
  return {
    id: s.id,
    companyId: companyOf(s),
    // 옛 '비용' 전표가 대체다(현금도 상대도 없이 차·대를 직접 세운 것)
    kind: s.type === '비용' ? '대체' : s.type,
    date: s.tradeDate,
    ts: rowStamp(s.tradeDate, s.issuedAt),
    docNo: s.docNo,
    partnerId: s.partnerId || undefined,
    partnerName: s.partnerName || undefined,
    memo: (s.items ?? []).map(i => i.name).filter(Boolean).slice(0, 2).join(', '),
    amount: s.totalAmount ?? 0,
    lines: (s.items ?? []).map(i => ({ accountCode: i.accountCode, name: i.name, amount: i.total ?? 0 })),
    source: 'statement',
  };
}

/** 자금기록 한 건 → 전표 */
export function voucherOfCashEntry(e: CashEntry): Voucher {
  // 줄이 여러 개면 그대로, 하나면 계정 한 줄로 편다 — 갈래와 상관없이 모양을 같게 둔다
  const lines: VoucherLine[] = e.lines?.length
    ? e.lines.map(l => ({ accountCode: l.accountCode, name: l.note ?? '', amount: l.amount }))
    : (e.accountCode ? [{ accountCode: e.accountCode, name: e.note ?? '', amount: e.amount }] : []);
  return {
    id: e.id,
    companyId: companyOf(e),
    kind: e.dir,
    date: e.date,
    ts: rowStamp(e.date, e.createdAt),
    // 자금전표엔 문서번호가 없다. 붙일 때까지 비워 둔다 — 없는 걸 지어내면 번호가 두 뜻이 된다.
    partnerId: e.partnerId || undefined,
    partnerName: e.partnerName || undefined,
    memo: e.note,
    amount: e.amount ?? 0,
    lines,
    source: 'cash',
  };
}

/**
 * 전표 전체를 한 줄기로 — **오래된 것부터.**
 *
 * 같은 시각이면 전표(채권·채무 발생)를 먼저, 자금을 뒤에 둔다. 발생하고 나서 갚는 순서라
 * 그래야 잔액이 순리대로 굴러간다. 그래도 같으면 끊은 순서(id에 박힌 ms)로 못 박는다 —
 * 소급 전표는 시각이 전부 23:59:59라 그게 유일한 근거다.
 */
export function listVouchers(
  statements: IssuedStatement[],
  cashEntries: CashEntry[],
  opts: { companyId?: CompanyId; from?: string; to?: string; kinds?: VoucherKind[] } = {},
): Voucher[] {
  const all = [...statements.map(voucherOfStatement), ...cashEntries.map(voucherOfCashEntry)];
  const kinds = opts.kinds ? new Set(opts.kinds) : null;
  return all
    .filter(v => !opts.companyId || v.companyId === opts.companyId)
    .filter(v => !opts.from || v.date >= opts.from)
    .filter(v => !opts.to || v.date <= opts.to)
    .filter(v => !kinds || kinds.has(v.kind))
    .sort((a, b) =>
      a.ts.localeCompare(b.ts)
      || (a.source === 'statement' ? 0 : 1) - (b.source === 'statement' ? 0 : 1)
      || issuedMs(a.id) - issuedMs(b.id)
      || String(a.id).localeCompare(String(b.id)));
}

/** 그 달 전표 — 월별 화면이 쓰는 지름길 */
export function vouchersOfMonth(
  statements: IssuedStatement[],
  cashEntries: CashEntry[],
  ym: string,
  companyId?: CompanyId,
): Voucher[] {
  return listVouchers(statements, cashEntries, { companyId })
    .filter(v => (v.date ?? '').startsWith(ym));
}

/**
 * **그 계정이 들어간 전표** — 손익 금액에서 근거로 내려가는 길.
 *
 * 손익분석은 계정별 금액만 보여줬다. "이 계정에 왜 이 금액이 나왔나"를 보려면
 * 전표 목록으로 가서 눈으로 찾아야 했고, 복합 전표(대출상환처럼 줄이 여럿인 것)는
 * 갈래 필터로는 아예 못 걸렀다.
 *
 * 갈래가 아니라 **줄의 계정**으로 거르므로, 한 전표에 그 계정이 하나라도 있으면 잡힌다.
 * `accountAmount`는 전표 총액이 아니라 **그 계정 몫**이다 — 합하면 손익 금액과 맞는다.
 *
 * ※ 매출전표의 부가세(255)는 줄에 없다(전표 머리의 totalTax). 손익 계정에는 해당 없다.
 */
export function vouchersWithAccount(
  statements: IssuedStatement[],
  cashEntries: CashEntry[],
  accountCode: string,
  opts: { companyId?: CompanyId; months?: string[] } = {},
): (Voucher & { accountAmount: number })[] {
  const months = opts.months?.length ? new Set(opts.months) : null;
  return listVouchers(statements, cashEntries, { companyId: opts.companyId })
    .filter(v => !months || months.has((v.date ?? '').slice(0, 7)))
    .map(v => ({
      ...v,
      accountAmount: v.lines
        .filter(l => String(l.accountCode) === String(accountCode))
        .reduce((a, l) => a + l.amount, 0),
    }))
    .filter(v => v.accountAmount !== 0);
}

/** 갈래 색 — 담긴 컬렉션이 아니라 **무슨 전표인가**로 가른다 */
export const VOUCHER_KIND_CHIP: Record<VoucherKind, string> = {
  '매출': 'bg-blue-100 text-blue-700',
  '매입': 'bg-amber-100 text-amber-700',
  '대체': 'bg-slate-200 text-slate-600',
  '입금': 'bg-emerald-100 text-emerald-700',
  '출금': 'bg-rose-100 text-rose-700',
};
