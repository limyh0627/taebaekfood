/**
 * 파생 분개 — 기존 데이터(전표·수금·자금·기초)에서 분개를 계산으로 뽑는다. **저장 안 함, 읽기 전용.**
 *
 *   Phase 2(병행)용. 전표 저장 경로를 안 건드리고, 재무제표 화면이 이 함수로 분개를 만들어
 *   시산표·손익·재무상태표를 그린다. 기존 손익표와 숫자를 대조하는 게 목적.
 */
import type { IssuedStatement, CashEntry, AccountCode, JournalEntry } from './types';
import { journalizeStatement, journalizePayment, journalizeCashEntry, journalizeTransfer, journalizeInventory, buildOpeningEntry, OpeningBalance, INVENTORY } from './autoJournal';

export interface BuildJournalsInput {
  statements: IssuedStatement[];
  cashEntries?: CashEntry[];
  accounts: AccountCode[];
  opening?: OpeningBalance | null;
  cashAccountMap?: Record<string, string>;   // cashAccountId → 계정코드
  /** 월말 재고 실사액 — 있으면 재고 조정 분개를 만든다(실지재고조사법). */
  inventorySnapshots?: { id?: string; yearMonth: string; value: number }[];
}

export interface BuildJournalsResult {
  entries: JournalEntry[];
  skipped: { sourceType: string; id: string; reason: string }[];   // 분개 못 만든 것(계정없음 등)
}

export function buildJournals(input: BuildJournalsInput): BuildJournalsResult {
  const { statements, cashEntries = [], accounts, opening, cashAccountMap = {}, inventorySnapshots = [] } = input;
  const normalOf = (code: string): 'debit' | 'credit' =>
    accounts.find(a => String(a.code) === String(code))?.normalBalance ?? 'debit';

  const entries: JournalEntry[] = [];
  const skipped: BuildJournalsResult['skipped'] = [];

  if (opening) entries.push(buildOpeningEntry(opening, normalOf));

  for (const s of statements) {
    const je = journalizeStatement(s);
    if (je) entries.push(je);
    else if (s.type === '매출' || s.type === '매입') skipped.push({ sourceType: s.type, id: s.id, reason: '계정 미지정 또는 빈 전표' });
    else if (s.type === '비용') {
      // 대체전표 — 감가상각·퇴직급여충당 등 현금 없는 내부 대체
      const tj = journalizeTransfer(s, normalOf);
      if (tj) entries.push(tj);
      else skipped.push({ sourceType: '대체', id: s.id, reason: '차·대 불일치 또는 계정 미지정 (상대계정 줄이 빠졌는지 확인)' });
    }
    // 수금/지불
    for (const p of s.payments ?? []) {
      const pj = journalizePayment(s, p);
      if (pj) entries.push(pj);
    }
  }

  for (const e of cashEntries) {
    const cj = journalizeCashEntry(e, cashAccountMap);
    if (cj) entries.push(cj);
    else skipped.push({ sourceType: '자금', id: e.id, reason: '계정 미지정' });
  }

  // 월말 재고 조정 — 매입을 비용으로 턴 것 중 안 팔리고 남은 만큼을 재고자산으로 되돌린다.
  if (inventorySnapshots.length) {
    const baseline = opening?.lines.find(l => l.accountCode === INVENTORY)?.amount ?? 0;
    entries.push(...journalizeInventory(inventorySnapshots, baseline, opening?.date?.slice(0, 7)));
  }

  return { entries, skipped };
}
