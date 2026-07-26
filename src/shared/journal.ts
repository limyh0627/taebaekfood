/**
 * 복식부기 코어 — 순수 도메인 모듈. 부수효과 없음.
 *
 *   분개(JournalEntry) 하나가 회계의 유일한 진실이고, 모든 보고서(시산표·손익·재무상태·현금흐름)가
 *   여기서 나온다. 이 모듈은 "분개가 맞는가"와 "분개들을 어떻게 집계하는가"만 안다.
 *   전표→분개로 바꾸는 규칙(자동 분개)은 autoJournal.ts, DB 읽기/쓰기는 호출부가 담당한다.
 *
 * 불변식: 모든 분개는 sum(debit) === sum(credit). validateEntry로 강제한다.
 */
import type { JournalEntry, JournalLine, AccountCode, AccountType } from './types';

const round = (n: number) => Math.round(n * 100) / 100;   // 원 단위 반올림(부동소수 방어)

/** 분개 검증 — 차대 일치 + 각 줄이 차변XOR대변. 문제 메시지 배열(빈 배열=정상). */
export function validateEntry(e: Pick<JournalEntry, 'lines'>): string[] {
  const errs: string[] = [];
  const lines = e.lines ?? [];
  if (lines.length < 2) errs.push('분개는 최소 2줄(차변·대변)이어야 합니다.');
  let d = 0, c = 0;
  for (const l of lines) {
    const dr = l.debit ?? 0, cr = l.credit ?? 0;
    if (dr < 0 || cr < 0) errs.push(`${l.accountCode}: 음수 금액 불가`);
    if (dr > 0 && cr > 0) errs.push(`${l.accountCode}: 한 줄에 차변·대변 동시 불가`);
    if (dr === 0 && cr === 0) errs.push(`${l.accountCode}: 금액 0 줄`);
    if (!l.accountCode) errs.push('계정과목 없는 줄');
    d += dr; c += cr;
  }
  if (round(d) !== round(c)) errs.push(`차대 불일치: 차변 ${round(d)} ≠ 대변 ${round(c)}`);
  return errs;
}

export const isBalanced = (e: Pick<JournalEntry, 'lines'>): boolean => validateEntry(e).length === 0;

/** 계정별 차변합·대변합 집계 */
export interface AccountTally { accountCode: string; debit: number; credit: number; }

export function tallyByAccount(entries: JournalEntry[]): Map<string, AccountTally> {
  const m = new Map<string, AccountTally>();
  for (const e of entries) {
    for (const l of e.lines ?? []) {
      const t = m.get(l.accountCode) ?? { accountCode: l.accountCode, debit: 0, credit: 0 };
      t.debit = round(t.debit + (l.debit ?? 0));
      t.credit = round(t.credit + (l.credit ?? 0));
      m.set(l.accountCode, t);
    }
  }
  return m;
}

/**
 * 계정 잔액 — normalBalance 방향의 순액.
 *   자산·비용(debit): 차변−대변 / 부채·자본·수익(credit): 대변−차변.
 * 부호가 +면 정상방향으로 남아있는 것.
 */
export function accountBalance(t: AccountTally, normalBalance: 'debit' | 'credit'): number {
  return normalBalance === 'debit' ? round(t.debit - t.credit) : round(t.credit - t.debit);
}

/** 합계잔액시산표 한 줄 */
export interface TrialBalanceRow {
  accountCode: string; name: string; type?: AccountType;
  debit: number; credit: number; balance: number;   // balance = normalBalance 방향 순액
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;   // 차변총계 === 대변총계
}

export function trialBalance(entries: JournalEntry[], accounts: AccountCode[]): TrialBalance {
  const byCode = new Map(accounts.map(a => [String(a.code), a]));
  const tally = tallyByAccount(entries);
  const rows: TrialBalanceRow[] = [];
  let totalDebit = 0, totalCredit = 0;
  for (const t of tally.values()) {
    const acc = byCode.get(String(t.accountCode));
    const nb = acc?.normalBalance ?? 'debit';
    rows.push({
      accountCode: t.accountCode, name: acc?.name ?? t.accountCode, type: acc?.type,
      debit: t.debit, credit: t.credit, balance: accountBalance(t, nb),
    });
    totalDebit = round(totalDebit + t.debit);
    totalCredit = round(totalCredit + t.credit);
  }
  rows.sort((a, b) => String(a.accountCode).localeCompare(String(b.accountCode)));
  return { rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

/** type별 잔액 합계 — 손익·재무상태표 재료 */
export function balancesByType(entries: JournalEntry[], accounts: AccountCode[]): Record<AccountType, number> {
  const byCode = new Map(accounts.map(a => [String(a.code), a]));
  const tally = tallyByAccount(entries);
  const out: Record<AccountType, number> = { 자산: 0, 부채: 0, 자본: 0, 수익: 0, 비용: 0 };
  for (const t of tally.values()) {
    const acc = byCode.get(String(t.accountCode));
    if (!acc?.type) continue;
    out[acc.type] = round(out[acc.type] + accountBalance(t, acc.normalBalance ?? 'debit'));
  }
  return out;
}

/** 손익계산서 요약 — 수익 − 비용 */
export interface IncomeStatement { revenue: number; expense: number; netIncome: number; }
export function incomeStatement(entries: JournalEntry[], accounts: AccountCode[]): IncomeStatement {
  const b = balancesByType(entries, accounts);
  return { revenue: b.수익, expense: b.비용, netIncome: round(b.수익 - b.비용) };
}

/**
 * 재무상태표 요약 — 자산 = 부채 + 자본 + 당기순이익.
 * (기중 순이익은 자본에 미마감 상태라 자본에 더해 균형을 맞춘다.)
 */
export interface BalanceSheet {
  asset: number; liability: number; equity: number; netIncome: number;
  balanced: boolean;   // 자산 === 부채 + 자본 + 순이익
}
export function balanceSheet(entries: JournalEntry[], accounts: AccountCode[]): BalanceSheet {
  const b = balancesByType(entries, accounts);
  const netIncome = round(b.수익 - b.비용);
  const rhs = round(b.부채 + b.자본 + netIncome);
  return { asset: b.자산, liability: b.부채, equity: b.자본, netIncome, balanced: b.자산 === rhs };
}

/** 거래처별 계정 잔액 (외상매출금·외상매입금 원장) */
export function partnerBalance(entries: JournalEntry[], accountCode: string, partnerId: string, normalBalance: 'debit' | 'credit'): number {
  let d = 0, c = 0;
  for (const e of entries) for (const l of e.lines ?? []) {
    if (l.accountCode !== accountCode || l.partnerId !== partnerId) continue;
    d += l.debit ?? 0; c += l.credit ?? 0;
  }
  return normalBalance === 'debit' ? round(d - c) : round(c - d);
}

/** 기간 필터 — [from, to] 포함 (YYYY-MM-DD 문자열 비교) */
export function inRange(entries: JournalEntry[], from: string, to: string): JournalEntry[] {
  return entries.filter(e => e.date >= from && e.date <= to);
}
