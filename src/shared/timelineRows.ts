import type { IssuedStatement, CashEntry } from './types';
import { AR, AP } from './autoJournal';
import { issuedMs } from './voucherStamp';
import { matchesSearch } from './hangul';

/**
 * **전표 목록(발행내역)의 줄을 다루는 셈.**
 *
 * [TradeStatement.tsx](../../components/TradeStatement.tsx) 안에 있던 것을 떼어 왔다
 * (목록 화면 정리, 2026-09-05). 규칙이 미묘한데 화면에 붙어 있어 시험할 방법이 없었다 —
 * 특히 **계정은 전표 머리가 아니라 줄로 본다**는 것과, 소급 전표의 정렬.
 *
 * 부수효과 없음(입력 → 값).
 */

export type VoucherKind = '매출' | '매입' | '대체' | '입금' | '출금';

//  cumul 이 undefined = 잔액이라는 게 없는 줄(거래처가 안 붙은 전표). 화면은 —로 띄운다.
export type StmtRow = { kind: 'stmt'; data: IssuedStatement; cumul?: number; dateKey: string; ts: string };

export type PayRow = {
  kind: 'pay'; partnerId: string; partnerName: string; stmtType: '매출' | '매입';
  /** 상계 — 받을 것과 줄 것을 맞바꾼 것. 미수·미지급 양쪽에 한 줄씩 선다. */
  offset?: boolean;
  date: string; amount: number; method?: string; note?: string;
  paymentId: string; cumul: number; dateKey: string; ts: string; src: IssuedStatement;
  /** 이 수금·지불의 자금원장 원본 */
  entry?: CashEntry;
};

/** 자금 입출금 전표 — 전표에 상계되지 않은 순수 현금 이동(전기요금·급여·상환·기계구입 등) */
export type CashRow = {
  kind: 'cash'; entry: CashEntry; dir: '입금' | '출금'; amount: number;
  accountCode?: string; note?: string; partnerName?: string;
  /** 그 시점 이 거래처의 채권·채무 잔액. 거래처가 없거나 잔액 자취가 없으면 undefined */
  cumul?: number;
  date: string; ts: string; dateKey: string;
};

export type TimelineRow = StmtRow | PayRow | CashRow;

// ── 줄에서 값 꺼내기 ─────────────────────────────────────────────

export const rowDate = (row: TimelineRow): string =>
  row.kind === 'stmt' ? row.data.tradeDate : row.date;

export const rowName = (row: TimelineRow): string =>
  (row.kind === 'stmt' ? row.data.partnerName
    : row.kind === 'pay' ? row.partnerName
    : (row.partnerName ?? '')) || '';

export const rowDocNo = (row: TimelineRow): string => (row.kind === 'stmt' ? row.data.docNo : '') || '';

export const rowNote = (row: TimelineRow): string => (row.kind === 'cash' ? (row.note ?? '') : '');

export const rowId = (row: TimelineRow): string =>
  row.kind === 'stmt' ? row.data.id : row.kind === 'pay' ? row.paymentId : row.entry.id;

/**
 * 갈래(매출·매입·대체·입금·출금).
 *
 * **필터가 아니라 표시다.** 갈래로 거르면 복합 전표가 통째로 빠진다 — 대출상환은
 * 출금전표인데 안에 이자비용이 있고, 급여 발생은 대체전표인데 인건비다.
 * 무엇을 찾을 때 쓰는 건 성격(줄의 계정)이다.
 */
export function rowKind(row: TimelineRow): VoucherKind {
  if (row.kind === 'stmt') {
    return row.data.type === '매출' ? '매출' : row.data.type === '매입' ? '매입' : '대체';
  }
  if (row.kind === 'pay') return row.stmtType === '매출' ? '입금' : '출금';
  if (row.entry.dir === '대체') return '대체';
  return row.dir === '입금' ? '입금' : '출금';
}

/**
 * 그 전표가 건드리는 계정 전부 — 복합 전표라도 하나만 걸리면 잡힌다.
 *
 * 전표(거래명세서)는 품목 줄에 **손익 계정만** 있다. 상대변(외상매출금·외상매입금·부가세)은
 * 저장돼 있지 않고 분개할 때 생긴다. 그대로 두면 '재무'로 걸러도 매출·매입 전표가
 * 하나도 안 잡혀서, 재무 필터가 사실상 자금전표만 고르는 꼴이 된다(자금흐름과 똑같아진다).
 * 그래서 분개가 세우는 상대계정을 여기서 같이 넣는다 — journalizeStatement 와 같은 규칙.
 *
 * **부가세(255 예수금·135 대급금)는 일부러 뺀다** — 회계로는 매출전표가 부채를,
 * 매입전표가 자산을 건드리는 게 맞지만, 넣으면 과세 전표가 죄다 자산·부채에 걸려
 * 필터가 무용지물이 된다. 부가세는 부가세 화면에서 본다.
 */
export function rowCodes(row: TimelineRow): string[] {
  if (row.kind === 'stmt') {
    const items = (row.data.items ?? []).map(i => i.accountCode ?? '').filter(Boolean);
    if (row.data.type === '비용') return items;      // 대체전표는 차·대가 줄에 다 있다
    return [...items, row.data.type === '매출' ? AR : AP];
  }
  if (row.kind === 'pay') return [row.stmtType === '매출' ? AR : AP];
  const ls = (row.entry.lines ?? []).map(l => l.accountCode).filter(Boolean) as string[];
  return ls.length ? ls : (row.accountCode ? [row.accountCode] : []);
}

/**
 * 검색에 걸리는 글 — 거래처명·문서번호 말고 **계정과목과 품목까지** 본다.
 *
 * "이자"로 이번 달 이자비용만 뽑아보려면 이게 있어야 한다. 자금 행은 계정명이
 * 화면에만 있고 적요엔 없어서, 이게 없으면 계정 이름으로 못 찾는다.
 * @param codeName 계정코드 → 이름
 */
export function rowSearchText(row: TimelineRow, codeName: ReadonlyMap<string, string>): string {
  if (row.kind === 'cash') {
    const codes = ((row.entry.lines ?? []).filter(l => l.accountCode && l.amount !== 0).map(l => l.accountCode!)
      .concat(row.accountCode ? [row.accountCode] : []));
    return codes.map(c => `${c} ${codeName.get(c) ?? ''}`).join(' ')
      + ' ' + (row.entry.lines ?? []).map(l => l.note ?? '').join(' ');
  }
  if (row.kind === 'stmt') {
    return (row.data.items ?? [])
      .map(i => `${i.accountCode ?? ''} ${codeName.get(i.accountCode ?? '') ?? ''} ${i.name ?? ''}`)
      .join(' ');
  }
  return '';
}

// ── 거르기·줄 세우기 ─────────────────────────────────────────────

export interface TimelineFilter {
  /** 'YYYY-MM-DD' */
  from?: string;
  to?: string;
  /** '전체' 면 안 거른다 */
  kind?: '전체' | VoucherKind;
  /** 거래처 이름 (정확히 같은 것만) */
  partner?: string;
  search?: string;
}

export interface TimelineDeps {
  /** 계정 필터 — 줄의 계정 목록을 받아 걸리는지 답한다. 안 주면 안 거른다. */
  matchAccount?: (codes: string[]) => boolean;
  codeName: ReadonlyMap<string, string>;
}

export function filterTimeline(
  rows: readonly TimelineRow[], f: TimelineFilter, deps: TimelineDeps,
): TimelineRow[] {
  const q = (f.search ?? '').trim().toLowerCase();
  return rows.filter(row => {
    const d = rowDate(row);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    //  갈래는 이미 다섯으로 정해져 있다 — 여기서 또 옮기지 않는다.
    //  예전엔 수금→입금 매핑이 두 군데 있어 한쪽만 고치면 엉뚱한 탭이 걸렸다.
    if (f.kind && f.kind !== '전체' && rowKind(row) !== f.kind) return false;
    if (f.partner && rowName(row) !== f.partner) return false;
    // 계정은 **줄**로 본다 — 전표 머리로 보면 복합 전표가 통째로 빠진다
    if (deps.matchAccount && !deps.matchAccount(rowCodes(row))) return false;
    if (q) {
      const name = rowName(row);
      if (!matchesSearch(name, q)
        && !rowDocNo(row).includes(q)
        && !matchesSearch(rowNote(row), q)
        && !matchesSearch(rowSearchText(row, deps.codeName), q)) return false;
    }
    return true;
  });
}

/**
 * 오래된 → 최신.
 *
 * 같은 시각이면 **전표를 위로**(매출 가산 후 수금 차감 순). 그래도 같으면
 * **끊은 순서** — 소급 전표는 시각이 전부 23:59:59라 여기서만 갈린다.
 */
export function sortTimeline(rows: readonly TimelineRow[]): TimelineRow[] {
  return [...rows].sort((a, b) => {
    const d = a.ts.localeCompare(b.ts);
    if (d !== 0) return d;
    if (a.kind === 'stmt' && b.kind === 'pay') return -1;
    if (a.kind === 'pay' && b.kind === 'stmt') return 1;
    const ida = rowId(a), idb = rowId(b);
    return issuedMs(ida) - issuedMs(idb)
      || String(ida).localeCompare(String(idb), undefined, { numeric: true });
  });
}

/** 목록에 실제로 있는 거래처 이름 — 없는 이름을 고르게 하면 빈 목록만 본다. */
export function partnerNamesOf(rows: readonly TimelineRow[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    const n = rowName(row);
    if (n) set.add(n);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
}

// ── 줄의 성격 · 합계 ─────────────────────────────────────────────

/** 계정코드 → 성격('수익'·'비용'·그 밖). 부르는 쪽이 계정표에서 만들어 준다. */
export type CodeType = ReadonlyMap<string, string | undefined>;

export interface RowClass {
  pl?: '수익' | '비용';
  /** 손익에 잡히는 금액 — 자금전표는 줄 중 손익 계정만 센다 */
  plAmount: number;
  cash?: '입금' | '출금';
  /** 대체전표 — 현금이 안 움직인다 */
  transfer?: boolean;
}

/**
 * 이 줄이 수익인가 비용인가, 돈이 들어왔나 나갔나.
 *
 * **자금전표는 줄로 본다.** 대출상환 출금전표는 안에 차입금(부채)과 이자(비용)가
 * 같이 있어서, 전표 금액을 통째로 비용으로 세면 원금까지 비용이 된다.
 */
export function classifyRow(row: TimelineRow, codeType: CodeType): RowClass {
  if (row.kind === 'stmt') {
    if (row.data.type === '매출') return { pl: '수익', plAmount: row.data.totalAmount };
    if (row.data.type === '매입') return { pl: '비용', plAmount: row.data.totalAmount };
    return { transfer: true, plAmount: 0 };                       // 대체전표
  }
  if (row.kind === 'pay') {
    return { cash: row.stmtType === '매출' ? '입금' : '출금', plAmount: 0 };
  }
  const want = row.dir === '입금' ? '수익' : '비용';
  const parts = (row.entry.lines ?? []).filter(l => l.accountCode && l.amount > 0);
  const plAmount = parts.length
    ? parts.reduce((a, l) => a + (codeType.get(l.accountCode!) === want ? l.amount : 0), 0)
    : (row.accountCode && codeType.get(row.accountCode) === want ? row.amount : 0);
  return { cash: row.dir, plAmount, ...(plAmount > 0 ? { pl: want } : {}) };
}

export interface TimelineTotals {
  stmtSum: number; stmtCnt: number;
  receiveSum: number; receiveCnt: number;
  paySum: number; payCnt: number;
}

/**
 * 목록 하단 합계 — 지금 걸린 줄의 전표·수금·지불 총액.
 *
 * 손익(발생 수익·비용)은 여기서 안 센다. **그건 분개에서 센다** —
 * 갈래로 세면 대체전표가 통째로 빠진다(급여 발생·감가상각은 갈래가 '비용'이다).
 * 부르는 쪽이 `financials.plOfJournals` 로 따로 구해 붙인다.
 */
export function timelineTotals(rows: readonly TimelineRow[], codeType: CodeType): TimelineTotals {
  const t: TimelineTotals = { stmtSum: 0, stmtCnt: 0, receiveSum: 0, receiveCnt: 0, paySum: 0, payCnt: 0 };
  for (const r of rows) {
    const c = classifyRow(r, codeType);      // 구분 판정은 한 곳에서만 — 필터와 같은 규칙
    if (r.kind === 'stmt') { t.stmtSum += r.data.totalAmount; t.stmtCnt++; }
    if (r.kind === 'stmt') continue;         // 전표는 수금·지불이 아니다
    const amount = r.amount;
    if (c.cash === '입금') { t.receiveSum += amount; t.receiveCnt++; }
    else if (c.cash === '출금') { t.paySum += amount; t.payCnt++; }
  }
  return t;
}
