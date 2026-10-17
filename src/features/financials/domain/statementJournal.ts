import type {IssuedStatement,JournalEntry,JournalLine} from '../../../shared/types';
import {AR,VAT_PAYABLE,VAT_RECEIVABLE,payableCodeFor,r,sum,sourceTimestamp} from './journalSupport';

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
  //  품목명을 계정별로 모아 둔다 — 전표 양식의 '적요' 칸이 이걸 쓴다.
  //  차·대에는 안 쓰이므로 금액은 그대로다. 계정 이름만 보면 무슨 돈인지 안 읽힌다
  //  ('520 전기세'는 알겠지만 '500 원료매입'만으론 참깨인지 들깨인지 모른다).
  const byName = new Map<string, string[]>();
  for (const it of items) {
    const code = it.accountCode!;
    bySupply.set(code, r((bySupply.get(code) ?? 0) + (it.supply ?? 0)));
    const nm = String(it.name ?? '').trim();
    if (nm) { const arr = byName.get(code) ?? []; if (!arr.includes(nm)) arr.push(nm); byName.set(code, arr); }
  }
  /** 그 계정에 붙은 품목명 — 셋을 넘으면 '외 N건'으로 줄인다 */
  const noteOf = (code: string) => {
    const arr = byName.get(code) ?? [];
    if (!arr.length) return undefined;
    return arr.length <= 3 ? arr.join(', ') : `${arr.slice(0, 3).join(', ')} 외 ${arr.length - 3}건`;
  };
  const tax = r(s.totalTax ?? sum(items.map(it => it.tax ?? 0)));
  const gross = r(s.totalAmount ?? sum(items.map(it => it.total ?? 0)));
  const counter = opts.cashAccountCode;   // 현금거래면 통장, 아니면 채권/채무
  const lines: JournalLine[] = [];

  if (s.type === '매출') {
    // (차) 채권/현금 gross   (대) 매출계정들 supply + 부가세예수금 tax
    lines.push({ accountCode: counter ?? AR, debit: gross, credit: 0, ...(counter ? {} : { partnerId: s.partnerId }) });
    for (const [code, supply] of bySupply) if (supply) lines.push({ accountCode: code, debit: 0, credit: supply, ...(noteOf(code) ? { note: noteOf(code)! } : {}) });
    if (tax) lines.push({ accountCode: VAT_PAYABLE, debit: 0, credit: tax, note: '매출세액' });
  } else {
    // 매입: (차) 매입계정들 supply + 부가세대급금 tax   (대) 채무/현금 gross
    for (const [code, supply] of bySupply) if (supply) lines.push({ accountCode: code, debit: supply, credit: 0, ...(noteOf(code) ? { note: noteOf(code)! } : {}) });
    if (tax) lines.push({ accountCode: VAT_RECEIVABLE, debit: tax, credit: 0, note: '매입세액' });
    //  상거래면 251, 아니면 253 — 재무상태표에서 매입채무와 미지급금이 갈려야 한다
    lines.push({ accountCode: counter ?? payableCodeFor([...bySupply.keys()]), debit: 0, credit: gross, ...(counter ? {} : { partnerId: s.partnerId }) });
  }

  /*
   * **차·대가 안 맞으면 안 내보낸다.**
   *
   * 채권/채무 줄은 전표 머리(totalAmount)에서, 손익 줄은 품목(supply)에서 가져온다.
   * 둘이 어긋난 전표가 실제로 있었다(기초 전표 17건의 totalSupply가 0이었다).
   * 그대로 내보내면 시산표가 조용히 틀어져 어디서 샜는지 못 찾는다.
   * 여기서 막으면 buildJournals가 skipped로 잡아 재무제표 화면에 띄운다.
   */
  const debit = r(sum(lines.map(l => l.debit ?? 0)));
  const credit = r(sum(lines.map(l => l.credit ?? 0)));
  if (debit !== credit) return null;

  return {
    id: `je-${s.id}`,
    date: s.tradeDate,
    lines,
    memo: `${s.type} ${s.partnerName} ${s.docNo ?? ''}`.trim(),
    sourceType: s.type,
    sourceId: s.id,
    createdAt: sourceTimestamp(s.tradeDate, s.issuedAt),
  };
}
