import type { TimelineRow } from './timelineRows';
import { rowDate, rowKind, rowName } from './timelineRows';

/**
 * **전표 표의 머리를 눌러 세운다 — 여러 칸을 겹칠 수 있다.**
 *
 * 2026-09-15 사장님: "업체명이랑 이런거 눌러서 정렬 거는거 아직도 안되노",
 * 이어서 "얘도 무슨 정렬인지 보이고 초기화 버튼 있어야지 그리고 정렬 중복 가능하게 해".
 *
 * **겹친다** — 업체명으로 묶고 그 안에서 날짜 순, 같은 날이면 금액 큰 것부터처럼
 * 사람이 장부를 훑는 방식 그대로다. 누른 차례가 곧 우선순위라, 먼저 누른 것이 큰 묶음이 된다.
 *
 * 줄 갈래가 셋(전표·수금지불·자금)이라 칸마다 값을 꺼내는 길이 다르다. 그 길은
 * `timelineRows` 가 이미 알고 있으므로 여기서 다시 따지지 않는다.
 *
 * **제자리 정렬이다** — 걸어 둔 칸이 모두 같으면 원래 차례(오래된 것부터)가 남는다.
 */
export type TimelineSortColumn = 'date' | 'owner' | 'kind' | 'partner' | 'amount' | 'cumul' | 'settle' | 'evidence' | 'note';

export interface TimelineSort {
  column: TimelineSortColumn;
  dir: 'asc' | 'desc';
}

/** 금액 — 갈래마다 든 자리가 다르다. */
export const rowAmount = (row: TimelineRow): number =>
  row.kind === 'stmt' ? Number(row.data.totalAmount ?? 0) : Number(row.amount ?? 0);

/** 그 시점 거래처 잔액. 없는 줄(거래처 없는 자금 등)은 `undefined`. */
export const rowCumul = (row: TimelineRow): number | undefined => row.cumul;

/** 담당자 — 전표는 전표에, 자금·수금지불은 자금줄에 적힌다. */
export const rowOwner = (row: TimelineRow): string =>
  (row.kind === 'stmt' ? (row.data as { createdBy?: string }).createdBy
    : row.kind === 'pay' ? (row.entry as { createdBy?: string } | undefined)?.createdBy
    : (row.entry as { createdBy?: string }).createdBy) ?? '';

/** 비고 — 자금·수금지불에만 있다. */
export const rowMemo = (row: TimelineRow): string =>
  row.kind === 'cash' || row.kind === 'pay' ? (row.note ?? '') : '';

/** 빈 값을 맨 뒤로 보내는 표. 가나다 맨 앞에 몰리면 찾는 것이 저 아래로 밀린다. */
const 맨뒤 = '￿';

/**
 * **구분은 가나다가 아니라 정해진 차례다**(2026-09-15 사장님: "구분 정렬은 매출 매입 입금 출금
 * 순으로 바뀌게"). 가나다로 세우면 `매입 · 매출 · 입금 · 출금 · 대체` 가 되는데,
 * 장부를 읽는 차례는 **판 것 → 산 것 → 받은 돈 → 낸 돈** 이다.
 * 대체는 전표끼리 옮기는 것이라 매입 뒤(전표 묶음 끝)에 둔다.
 */
const 구분차례: Record<string, number> = { 매출: 1, 매입: 2, 대체: 3, 입금: 4, 출금: 5 };

/** 글자로 견줄 칸의 값. */
export function sortText(row: TimelineRow, column: TimelineSortColumn): string {
  switch (column) {
    case 'date': return rowDate(row).slice(0, 10);
    //  차례 숫자를 앞에 붙여 글자 비교로도 그 차례가 나오게 한다.
    case 'kind': { const k = rowKind(row); return `${구분차례[k] ?? 9}${k}`; }
    case 'partner': return rowName(row) || 맨뒤;
    case 'owner': return rowOwner(row) || 맨뒤;
    case 'note': return rowMemo(row).trim() || 맨뒤;
    //  '수금/지불'·'증빙'은 화면이 셈해 그리는 값이라 여기서 못 본다 — 부르는 쪽이 넘겨 준다.
    default: return '';
  }
}

export interface SortOptions {
  /** 화면이 그린 글자를 그대로 쓰는 칸(수금/지불·증빙). */
  textOf?: (row: TimelineRow, column: TimelineSortColumn) => string | undefined;
  /**
   * **누적잔액을 한 축에 세우기 위한 방향** — 받을 돈은 `1`, 줄 돈은 `-1`.
   *
   * 2026-09-15 사장님: "거래처 누적잔액이 절대값으로 하면 되냐", 그리고 "B로 해".
   * 잔액은 거래처별·방향별로 따로 쌓여서 **매입도 양수로 남는다** — 그래서 그냥 세우면
   * 매출 미수 500만과 매입 미지급 500만이 같은 자리에 선다. 정반대 뜻인데 나란히 서는 것이다.
   *
   * **화면에 찍히는 숫자는 그대로 두고 세울 때만 뒤집는다** — 매입 줄을 음수로 보면
   * 한 번 내림차순으로 `받을 돈 많은 곳 → … → 줄 돈 많은 곳` 이 된다.
   * 방향 판정은 부르는 쪽이 한다(분개로 채권·채무를 가리는 `arapOf` 가 이미 있다).
   */
  signOf?: (row: TimelineRow) => 1 | -1;
}

const 숫자칸 = (column: TimelineSortColumn) => column === 'amount' || column === 'cumul';

export function sortByColumns(
  rows: readonly TimelineRow[],
  sorts: readonly TimelineSort[],
  options: SortOptions = {},
): TimelineRow[] {
  if (!sorts.length) return [...rows];
  return [...rows].sort((a, b) => {
    for (const { column, dir } of sorts) {
      const 뒤집기 = dir === 'desc' ? -1 : 1;
      let 차 = 0;
      if (숫자칸(column)) {
        const 값 = (row: TimelineRow) => {
          if (column === 'amount') return rowAmount(row);
          const c = rowCumul(row);
          //  **잔액만 방향을 입힌다** — 금액은 오간 돈의 크기라 방향이 없다.
          return c === undefined ? undefined : c * (options.signOf?.(row) ?? 1);
        };
        const x = 값(a); const y = 값(b);
        //  잔액이 없는 줄은 **늘 맨 뒤** — 방향을 뒤집어도 뒤다. 가운데 끼면 차례가 거짓말이 된다.
        if (x === undefined && y === undefined) 차 = 0;
        else if (x === undefined) return 1;
        else if (y === undefined) return -1;
        else 차 = (x - y) * 뒤집기;
      } else {
        const 글 = (row: TimelineRow) => options.textOf?.(row, column) ?? sortText(row, column);
        차 = 글(a).localeCompare(글(b), 'ko') * 뒤집기;
      }
      if (차 !== 0) return 차;
    }
    return 0;
  });
}

/**
 * 머리를 눌렀을 때 다음 상태.
 *
 * **처음 누르면 뒤에 붙고(겹치기), 이미 걸린 칸을 누르면 방향만 뒤집는다.**
 * 눌러서는 안 빠진다 — 푸는 것은 '정렬 해제' 하나다. 몇 번 눌렀는지 세고 있게 하면 안 된다.
 */
export function toggleSort(sorts: readonly TimelineSort[], column: TimelineSortColumn): TimelineSort[] {
  const 자리 = sorts.findIndex(s => s.column === column);
  if (자리 < 0) return [...sorts, { column, dir: 'asc' }];
  return sorts.map((s, i) => i === 자리 ? { ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' } : s);
}

/** 그 칸이 몇 번째로 걸렸나 — 1부터. 안 걸렸으면 0. */
export const sortRank = (sorts: readonly TimelineSort[], column: TimelineSortColumn): number =>
  sorts.findIndex(s => s.column === column) + 1;

export const COLUMN_LABEL: Record<TimelineSortColumn, string> = {
  date: '전표일자', owner: '담당자', kind: '구분', partner: '업체명',
  amount: '금액', cumul: '거래처 누적잔액', settle: '수금/지불', evidence: '증빙', note: '비고',
};

/** 걸린 정렬을 사람 말로 — `업체명 오름 · 전표일자 내림`. */
export const sortSummary = (sorts: readonly TimelineSort[]): string =>
  sorts.map(s => `${COLUMN_LABEL[s.column]} ${s.dir === 'asc' ? '오름' : '내림'}`).join(' · ');
