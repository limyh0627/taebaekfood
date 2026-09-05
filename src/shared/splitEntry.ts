import type { CashEntry } from './types';

/**
 * **한 번 나간 돈을 성격대로 줄로 가르는 자금전표.**
 *
 * 통장에서는 한 번 나가는데 안에 성격이 둘 이상 섞인 것들이 있다.
 * 합쳐서 한 계정으로 몰면 **손익이 틀린다** —
 *
 *   대출 상환   원금은 차입금(부채가 준다) · 이자만 비용
 *               → 몰면 원금까지 비용이 돼 이익이 그만큼 줄어 보인다
 *   4대보험     회사부담은 비용 · 근로자부담은 맡아둔 예수금을 터는 것
 *               → 몰면 비용이 부풀고 예수금이 영영 안 줄어든다
 *   세금        부가세는 손님한테 받아 맡아둔 부채 · 소득세는 사장님 개인 것(인출금)
 *               → **둘 다 비용이 아니다**
 *
 * 자금원장(CashLedger)과 일반전표(VoucherComposer) **두 화면이 이 셈을 따로 짜고
 * 있었다**(2026-09-05, 글자까지 같았다). 한쪽만 고쳐지면 같은 상환을 어느 화면에서
 * 끊었느냐에 따라 손익이 갈린다.
 *
 * 부수효과 없음(입력 → 값).
 */

/** 전표 한 줄 — 계정과 금액, 그리고 무엇인지 */
export interface SplitLine { accountCode: string; amount: number; note: string }

/** 화면이 채워 주는 공통 칸 (날짜·거래처·통장·회사 등) */
export type EntryBase = Partial<CashEntry>;

export interface SplitInput {
  /** 가를 줄들. 금액이 0 이하인 줄은 부르는 쪽에서 빼고 준다. */
  lines: SplitLine[];
  /** 적요. 비우면 기본말을 쓴다. */
  note?: string;
  /** 줄이 하나뿐일 때 붙일 기본말 */
  fallbackNote: string;
  base: EntryBase;
  /** id 를 만들 때 쓰는 시각 — 시험에서 고정하려고 받는다 */
  now?: number;
}

/**
 * 줄이 **둘 이상이면 `lines` 로**, **하나면 그 계정 하나로** 끊는다.
 *
 * 줄 하나짜리를 굳이 `lines` 로 두지 않는 이유 — 분개·원장이 `lines` 가 있으면
 * 복합 전표로 다루는데, 한 줄짜리는 그럴 게 없다. 적요도 `대출 상환 (이자)` 처럼
 * 무엇인지 붙여 줘야 목록에서 읽힌다.
 *
 * @returns 만들 전표. 가를 줄이 없으면 null.
 */
export function splitCashEntry(input: SplitInput): CashEntry | null {
  const lines = input.lines.filter(l => l.amount > 0);
  if (!lines.length) return null;

  const memo = (input.note ?? '').trim() || input.fallbackNote;
  const amount = lines.reduce((s, l) => s + l.amount, 0);
  const 여러줄 = lines.length > 1;

  return {
    id: `cash-${input.now ?? Date.now()}`,
    dir: '출금',
    amount,
    ...(여러줄 ? { lines } : { accountCode: lines[0].accountCode }),
    note: 여러줄 ? memo : `${memo} (${lines[0].note})`,
    ...input.base,
  } as CashEntry;
}

export interface PayrollInput {
  /** 총급여 — 비용으로 나간다 */
  gross: number;
  /** 원천공제 — 맡아둔 것이라 예수금으로 **들어온다** */
  deduction: number;
  salaryCode: string;
  withholdCode: string;
  note?: string;
  base: EntryBase;
  now?: number;
}

/**
 * 급여 — **두 건**으로 끊는다.
 *
 *   출금  총급여      (비용)
 *   입금  원천공제분  (예수금 — 나중에 세무서에 낼 때 턴다)
 *
 * 실지급액은 둘의 차다. 실지급액만 한 건으로 끊으면 **급여 비용이 그만큼 적게 잡히고**
 * 예수금이 서지 않아 나중에 낼 때 갈 곳이 없다.
 */
export function payrollEntries(input: PayrollInput): CashEntry[] {
  if (input.gross <= 0) return [];
  const memo = (input.note ?? '').trim() || '급여';
  const t = input.now ?? Date.now();
  return [
    { id: `cash-${t}-g`, dir: '출금', amount: input.gross,
      accountCode: input.salaryCode, note: `${memo} (총급여)`, ...input.base } as CashEntry,
    ...(input.deduction > 0
      ? [{ id: `cash-${t}-w`, dir: '입금', amount: input.deduction,
           accountCode: input.withholdCode, note: `${memo} (원천공제 예수)`, ...input.base } as CashEntry]
      : []),
  ];
}
