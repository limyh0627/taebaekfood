import type { IssuedStatement } from './types';

/**
 * **여러 전표의 품목을 한 장으로 합치는 셈** — 세금계산서가 쓴다.
 *
 * 한 달치 거래명세서 여러 장을 세금계산서 한 장으로 끊을 때, 같은 품목이 여러 전표에
 * 흩어져 있으면 한 줄로 모아야 한다.
 *
 * 같은 글자로 **세 곳에 적혀 있었다**(2026-09-05) — TaxStatement 에 둘,
 * TradeStatement 에 하나. 세금계산서 금액을 세는 자리라 한쪽만 고쳐지면 신고가 틀린다.
 *
 * 부수효과 없음(입력 → 값).
 */

export interface MergedItem {
  name: string; spec: string;
  qty: number; supply: number; tax: number; total: number;
  isTaxExempt: boolean;
}

/**
 * 합치는 열쇠는 **이름 + 규격 + 과세여부**다.
 *
 * 과세여부를 빼면 안 된다 — 세금계산서는 과세분과 면세분을 **따로 적어야** 하므로,
 * 같은 품목이라도 한쪽은 과세, 한쪽은 면세로 끊겼으면 합치면 안 된다.
 */
const 열쇠 = (i: { name: string; spec: string; isTaxExempt?: boolean }) =>
  `${i.name}||${i.spec}||${!!i.isTaxExempt}`;

/** 전표 여럿의 품목을 합친다. 순서는 처음 나온 차례대로. */
export function mergeStatementItems(stmts: readonly IssuedStatement[]): MergedItem[] {
  const map = new Map<string, MergedItem>();
  for (const stmt of stmts) {
    for (const item of (stmt.items ?? [])) {
      const k = 열쇠(item);
      const ex = map.get(k);
      if (ex) {
        ex.qty += item.qty; ex.supply += item.supply; ex.tax += item.tax; ex.total += item.total;
      } else {
        map.set(k, {
          name: item.name, spec: item.spec, qty: item.qty,
          supply: item.supply, tax: item.tax, total: item.total,
          isTaxExempt: !!item.isTaxExempt,
        });
      }
    }
  }
  return [...map.values()];
}

export interface SplitMerged {
  taxable: MergedItem[];
  exempt: MergedItem[];
}

/** 합친 뒤 과세·면세로 가른다 — 세금계산서는 둘을 따로 적는다. */
export function mergeAndSplit(stmts: readonly IssuedStatement[]): SplitMerged {
  const all = mergeStatementItems(stmts);
  return {
    taxable: all.filter(i => !i.isTaxExempt),
    exempt: all.filter(i => i.isTaxExempt),
  };
}
