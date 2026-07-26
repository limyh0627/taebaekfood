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
import type { IssuedStatement, JournalEntry, JournalLine } from './types';

// 채권·채무·부가세 계정코드 (setup-account-codes.mjs와 일치)
export const AR = '108';   // 외상매출금
export const AP = '251';   // 외상매입금
export const VAT_PAYABLE = '255';   // 부가세예수금
export const VAT_RECEIVABLE = '135'; // 부가세대급금

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
