import type { AccountCode, AccountGroup, JournalEntry } from '../../../shared/types';



export interface MonthPL {
  sales: number; cogs: number; sgna: number;
  grossProfit: number; operatingProfit: number;
  otherIncome: number; otherExpense: number; netIncome: number;
}


/**
 * 손익은 **전표(분개)와 그 계정과목으로만** 집계한다.
 *
 * 예전엔 computeMonthPL이 따로 있어서 두 가지 다른 길로 숫자를 만들었다:
 *   · 계정과목이 없으면 전표 유형(매출/매입/비용)으로 때려맞췄다
 *   · fixedCosts(정기비용) 컬렉션을 판관비에 그냥 더했다 — 전표가 아닌데 손익에 잡혔다
 * 둘 다 지웠다. 집계 근거가 둘이면 어느 쪽이 맞는지 알 수 없고, 계정과목을 안 거친
 * 금액은 계정별로 쪼개 볼 수도, 분개와 대조할 수도 없다.
 *
 * 계정에 그룹(plLine)이나 5분류(type)가 없으면 손익에서 조용히 빠진다 —
 * 계정과목을 만들 때 반드시 채울 것.
 */

/**
 * 분개 기반 월별 손익 — 전표·자금원장이 모두 분개를 거쳐 들어오므로 원천이 어디든 한 번만 잡힌다.
 *
 * `computeMonthPL`(전표 직접 집계)과 두 가지가 다르다:
 *  - **부가세가 손익에서 빠진다.** 분개는 공급가만 수익·비용으로 세우고 부가세는
 *    예수금(부채)·대급금(자산)으로 보낸다. 전표 집계는 부가세 포함 `item.total`을 더했다.
 *  - **자금원장에만 있는 손익도 잡힌다.** 이자비용처럼 전표 없이 자금으로만 나간 것.
 *
 * 계정에 `type`이 없으면 손익에서 조용히 빠진다 — 계정과목 등록 시 5분류를 반드시 채울 것.
 */
/**
 * **분개 한 줄이 손익을 얼마나 움직였나** — 손익을 세는 자리는 전부 이걸 쓴다.
 *
 * 규칙은 둘뿐이다.
 *   ① 수익·비용 계정만 본다(자산·부채·자본은 손익이 아니다)
 *   ② 그 계정의 정상 방향(normalBalance)으로 부호를 잡는다 — 비용은 차변, 수익은 대변
 *
 * **전표 갈래(type)로 세면 안 된다.** 급여 발생·감가상각·퇴직급여충당은 갈래가 '비용'
 * (대체전표)이라 `type === '매입'` 으로 세면 통째로 빠진다 —
 * 실제로 2026-08 급여 19,314,620원이 전표 화면 하단 합계에서 사라져 있었다(2026-09-03 사장님 발견).
 * **전표 총액으로 세도 안 된다.** 부가세가 섞인다(1,070,000 매출의 손익은 1,000,000이다).
 */
export function plMovement(acc: AccountCode | undefined, debit: number, credit: number): number {
  if (acc?.type !== '수익' && acc?.type !== '비용') return 0;
  const normal = acc.normalBalance ?? (acc.type === '수익' ? 'credit' : 'debit');
  return normal === 'debit' ? debit - credit : credit - debit;
}


/**
 * 분개 뭉치의 수익·비용 합 — 기간이든 필터든 **부르는 쪽이 이미 고른 것**만 넘긴다.
 * 월별 손익표(`computeMonthPLFromJournals`)와 같은 규칙(`plMovement`)이라 안 갈린다.
 */
export function plOfJournals(
  entries: JournalEntry[],
  accountCodes: AccountCode[],
): { income: number; cost: number } {
  const byCode = new Map(accountCodes.map(a => [String(a.code), a]));
  let income = 0, cost = 0;
  for (const e of entries) {
    for (const l of e.lines ?? []) {
      const acc = byCode.get(String(l.accountCode));
      const moved = plMovement(acc, l.debit ?? 0, l.credit ?? 0);
      if (!moved) continue;
      if (acc!.type === '수익') income += moved; else cost += moved;
    }
  }
  return { income, cost };
}


export function computeMonthPLFromJournals(
  ym: string,
  entries: JournalEntry[],
  accountCodes: AccountCode[],
  codeToGroup: (code: string | undefined) => AccountGroup | undefined,
): MonthPL {
  const byCode = new Map(accountCodes.map(a => [String(a.code), a]));
  const tally = new Map<string, { debit: number; credit: number }>();
  for (const e of entries) {
    if (!(e.date ?? '').startsWith(ym)) continue;
    for (const l of e.lines ?? []) {
      const cur = tally.get(l.accountCode) ?? { debit: 0, credit: 0 };
      cur.debit += l.debit ?? 0;
      cur.credit += l.credit ?? 0;
      tally.set(l.accountCode, cur);
    }
  }
  let sales = 0, cogs = 0, sgna = 0, otherIncome = 0, otherExpense = 0;
  for (const [code, t] of tally) {
    const acc = byCode.get(code);
    //  손익 판정은 plMovement 하나다 — 두 벌로 두면 언젠가 갈린다
    const bal = plMovement(acc, t.debit, t.credit);
    if (!bal) continue;
    if (!bal) continue;
    switch (codeToGroup(code)?.plLine) {
      case 'revenue':       sales += bal; break;
      case 'cogs':          cogs += bal; break;
      case 'sgna':          sgna += bal; break;
      case 'other-income':  otherIncome += bal; break;
      case 'other-expense': otherExpense += bal; break;
      default:              if (acc?.type === '수익') sales += bal; else cogs += bal;
    }
  }
  const grossProfit = sales - cogs;
  const operatingProfit = grossProfit - sgna;
  const netIncome = operatingProfit + otherIncome - otherExpense;
  return { sales, cogs, sgna, grossProfit, operatingProfit, otherIncome, otherExpense, netIncome };
}
