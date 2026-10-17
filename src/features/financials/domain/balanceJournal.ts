import type { JournalEntry, JournalLine } from '../../../shared/types';
import { r, sourceTimestamp, INVENTORY, PURCHASE } from './journalSupport';

/**
 * 월말 재고 조정 분개 — **실지재고조사법**. 매입은 일단 비용(500)으로 털고,
 * 월말 실사액과 직전 재고액의 차이만큼 재고자산(146)으로 되돌린다.
 *
 *   재고 증가: (차) 146 재고자산 / (대) 500 원료매입   ← 안 팔리고 남은 만큼 원가에서 뺀다
 *   재고 감소: (차) 500 원료매입 / (대) 146 재고자산
 *
 * 두 줄이 같은 금액이라 차·대는 구조적으로 항상 맞는다.
 * baseline은 기초분개의 재고자산 금액이고, 스냅샷을 오래된 순으로 이어 붙인다.
 * 기초 시점 이전 스냅샷은 이미 기초잔액에 녹아 있으므로 건너뛴다.
 */
export function journalizeInventory(
  snapshots: { id?: string; yearMonth: string; value: number }[],
  baseline: number,
  openingYm?: string,
): JournalEntry[] {
  const sorted = [...snapshots]
    .filter(s => /^\d{4}-\d{2}$/.test(s.yearMonth ?? ''))
    .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  const out: JournalEntry[] = [];
  let prev = r(baseline);
  for (const s of sorted) {
    if (openingYm && s.yearMonth <= openingYm) { prev = r(s.value ?? 0); continue; }
    const delta = r((s.value ?? 0) - prev);
    prev = r(s.value ?? 0);
    if (!delta) continue;
    const [y, m] = s.yearMonth.split('-').map(Number);
    const date = `${s.yearMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    const amt = Math.abs(delta);
    out.push({
      id: `je-inv-${s.yearMonth}`, date,
      lines: delta > 0
        ? [{ accountCode: INVENTORY, debit: amt, credit: 0 }, { accountCode: PURCHASE, debit: 0, credit: amt }]
        : [{ accountCode: PURCHASE, debit: amt, credit: 0 }, { accountCode: INVENTORY, debit: 0, credit: amt }],
      memo: `재고 조정 ${s.yearMonth} (실사 ${(s.value ?? 0).toLocaleString()}원)`,
      sourceType: '대체', sourceId: s.id ?? `inv-${s.yearMonth}`,
      createdAt: sourceTimestamp(date),
    });
  }
  return out;
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
  return { id: 'je-opening', date: ob.date, lines, memo: '기초잔액', sourceType: '수동', sourceId: 'opening', createdAt: sourceTimestamp(ob.date) };
}
