/**
 * 자동 분개 — 전표/자금기록을 복식부기 분개(JournalEntry)로 변환한다. 순수 함수, DB 안 건드림.
 *
 *   사용자는 거래처·품목·금액·계정만 입력하고, 여기서 상대 계정(채권·채무·부가세·현금)을 자동으로 채운다.
 *   상대 계정은 전표 종류 + 과세여부 + 결제방식으로 정해진다(추측 아님, 전표에 있는 정보).
 *   차/대 위치는 계정의 normalBalance가 정한다(journal.ts).
 *
 * 매핑 규칙(설계 docs/복식부기-설계.md §4):
 *   매출  (차) 외상매출금 [+현금]   (대) 매출계정들 + 부가세예수금
 *   매입  (차) 매입계정들 + 부가세대급금   (대) 외상매입금 [또는 현금]
 */
import type { IssuedStatement, JournalEntry, JournalLine, CashEntry, PaymentRecord } from './types';

// 채권·채무·부가세·현금 계정코드 (setup-account-codes.mjs와 일치)
export const AR = '108';   // 외상매출금
export const AP = '251';   // 외상매입금
export const VAT_PAYABLE = '255';   // 부가세예수금
export const VAT_RECEIVABLE = '135'; // 부가세대급금
export const BANK = '103';  // 보통예금 (기본 현금계정)

const r = (n: number) => Math.round((n ?? 0) * 100) / 100;
const sum = (xs: number[]) => r(xs.reduce((a, b) => a + b, 0));

export interface AutoJournalOptions {
  /** 즉시 현금거래면 채권/채무 대신 이 현금계정을 쓴다. 없으면 외상(AR/AP). */
  cashAccountCode?: string;
}

/**
 * 매출/매입 전표 → 분개. 계정 없는 라인이 있으면 null(분개 불가 — 계정부터 채워야).
 * '비용' 타입 전표(자금성 대체)는 여기서 다루지 않는다(자금원장 경로).
 */
export function journalizeStatement(s: IssuedStatement, opts: AutoJournalOptions = {}): JournalEntry | null {
  if (s.type !== '매출' && s.type !== '매입') return null;
  const items = s.items ?? [];
  if (items.length === 0) return null;
  if (items.some(it => !it.accountCode)) return null;   // 계정 미지정 — 분개 못 만듦

  // 계정별 공급가 합산(같은 계정 여러 줄이면 묶음)
  const bySupply = new Map<string, number>();
  for (const it of items) {
    const code = it.accountCode!;
    bySupply.set(code, r((bySupply.get(code) ?? 0) + (it.supply ?? 0)));
  }
  const tax = r(s.totalTax ?? sum(items.map(it => it.tax ?? 0)));
  const gross = r(s.totalAmount ?? sum(items.map(it => it.total ?? 0)));
  const counter = opts.cashAccountCode;   // 현금거래면 통장, 아니면 채권/채무
  const lines: JournalLine[] = [];

  if (s.type === '매출') {
    // (차) 채권/현금 gross   (대) 매출계정들 supply + 부가세예수금 tax
    lines.push({ accountCode: counter ?? AR, debit: gross, credit: 0, ...(counter ? {} : { partnerId: s.partnerId }) });
    for (const [code, supply] of bySupply) if (supply) lines.push({ accountCode: code, debit: 0, credit: supply });
    if (tax) lines.push({ accountCode: VAT_PAYABLE, debit: 0, credit: tax });
  } else {
    // 매입: (차) 매입계정들 supply + 부가세대급금 tax   (대) 채무/현금 gross
    for (const [code, supply] of bySupply) if (supply) lines.push({ accountCode: code, debit: supply, credit: 0 });
    if (tax) lines.push({ accountCode: VAT_RECEIVABLE, debit: tax, credit: 0 });
    lines.push({ accountCode: counter ?? AP, debit: 0, credit: gross, ...(counter ? {} : { partnerId: s.partnerId }) });
  }

  return {
    id: `je-${s.id}`,
    date: s.tradeDate,
    lines,
    memo: `${s.type} ${s.partnerName} ${s.docNo ?? ''}`.trim(),
    sourceType: s.type,
    sourceId: s.id,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 수금/지불(전표의 payment) → 분개. 채권/채무를 현금으로 상계(손익 재인식 아님).
 *   매출전표 수금: (차) 보통예금  (대) 외상매출금 [거래처]
 *   매입전표 지불: (차) 외상매입금 [거래처]  (대) 보통예금
 */
export function journalizePayment(s: IssuedStatement, p: PaymentRecord, cashAccountCode = BANK): JournalEntry | null {
  const amt = r(p.amount ?? 0);
  if (!amt) return null;
  const lines: JournalLine[] = s.type === '매출'
    ? [{ accountCode: cashAccountCode, debit: amt, credit: 0 }, { accountCode: AR, debit: 0, credit: amt, partnerId: s.partnerId }]
    : [{ accountCode: AP, debit: amt, credit: 0, partnerId: s.partnerId }, { accountCode: cashAccountCode, debit: 0, credit: amt }];
  return {
    id: `je-pay-${p.id}`, date: p.date ?? s.tradeDate, lines,
    memo: `${s.type === '매출' ? '수금' : '지불'} ${s.partnerName}`, sourceType: '자금', sourceId: p.id,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 자금원장 CashEntry → 분개. 현금계정 ↔ 성격계정(accountCode).
 *   입금: (차) 보통예금  (대) accountCode [거래처]
 *   출금: (차) accountCode [거래처]  (대) 보통예금
 * cashAccountMap: cashAccountId → 계정코드(통장별). 없으면 BANK.
 * accountCode 미지정이면 분개 못 만듦(null).
 */
export function journalizeCashEntry(e: CashEntry, cashAccountMap: Record<string, string> = {}): JournalEntry | null {
  const amt = r(e.amount ?? 0);
  if (!amt || !e.accountCode) return null;
  const cash = cashAccountMap[e.cashAccountId] ?? BANK;
  const other = { accountCode: e.accountCode, ...(e.partnerId ? { partnerId: e.partnerId } : {}) };
  const lines: JournalLine[] = e.dir === '입금'
    ? [{ accountCode: cash, debit: amt, credit: 0 }, { ...other, debit: 0, credit: amt }]
    : [{ ...other, debit: amt, credit: 0 }, { accountCode: cash, debit: 0, credit: amt }];
  return {
    id: `je-cash-${e.id}`, date: e.date, lines,
    memo: `${e.dir} ${e.partnerName ?? ''} ${e.note ?? ''}`.trim(), sourceType: '자금', sourceId: e.id,
    createdAt: new Date().toISOString(),
  };
}

/** 기초분개 입력 — 계정별 잔액. 자본은 plug(자산−부채)로 자동 채운다. */
export interface OpeningBalance {
  date: string;                                  // 컷오프 (이 날짜의 기초)
  lines: { accountCode: string; amount: number; partnerId?: string }[]; // 각 계정의 정상방향 잔액
  capitalAccount?: string;                        // 차액을 담을 자본계정 (기본 331 자본금)
}

/**
 * 기초분개 생성 — 각 계정을 normalBalance 방향으로 세우고, 차대 차액을 자본계정에 넣어 균형.
 * normalOf: 계정코드 → 'debit'|'credit' (계정과목에서). 모르면 debit 취급.
 */
export function buildOpeningEntry(ob: OpeningBalance, normalOf: (code: string) => 'debit' | 'credit'): JournalEntry {
  const lines: JournalLine[] = [];
  let d = 0, c = 0;
  for (const l of ob.lines) {
    const amt = r(l.amount ?? 0);
    if (!amt) continue;
    if (normalOf(l.accountCode) === 'debit') { lines.push({ accountCode: l.accountCode, debit: amt, credit: 0, ...(l.partnerId ? { partnerId: l.partnerId } : {}) }); d += amt; }
    else { lines.push({ accountCode: l.accountCode, debit: 0, credit: amt, ...(l.partnerId ? { partnerId: l.partnerId } : {}) }); c += amt; }
  }
  const diff = r(d - c);   // 차변이 크면 자본(대변)으로 메움
  const cap = ob.capitalAccount ?? '331';
  if (diff > 0) lines.push({ accountCode: cap, debit: 0, credit: diff });
  else if (diff < 0) lines.push({ accountCode: cap, debit: -diff, credit: 0 });
  return { id: 'je-opening', date: ob.date, lines, memo: '기초잔액', sourceType: '수동', sourceId: 'opening', createdAt: new Date().toISOString() };
}
