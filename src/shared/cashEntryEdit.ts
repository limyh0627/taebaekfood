import type { CashEntry } from './types';

/**
 * 자금 전표 수정 모달이 DB에 보낼 패치를 만든다.
 *
 * 모달이 `accountCode` 한 줄만 보내던 자리다. 쪼개진 전표(대출상환=원금+이자,
 * 급여=총액+원천공제)를 열었다 저장만 해도 **lines가 화면에서 사라졌고**, DB에는
 * 옛 줄이 그대로 남아 자금원장 금액(amount)과 분개(줄 합)가 따로 놀았다.
 * journalizeCashEntry는 lines를 먼저 보므로, 화면은 계정 하나인데 분개는 옛 줄로 섰다.
 *
 * 화면 조각이라 손이 안 닿던 판정을 여기로 꺼내 테스트로 못 박는다.
 */

/** 모달의 줄 입력 — 전부 문자열이다(빈 칸·부호·콤마가 들어온다) */
export interface CashEditLineDraft {
  accountCode: string;
  amount: string;
  note: string;
}

export interface CashEditForm {
  amount: string;
  date: string;
  dir: '입금' | '출금';
  accountCode: string;
  note: string;
}

/** 계정과 금액이 다 차야 줄로 친다 — 반쪽짜리 줄은 시산표를 조용히 망가뜨린다. */
export function cashEditSplit(lines: CashEditLineDraft[]): NonNullable<CashEntry['lines']> {
  return lines
    .map(l => ({
      accountCode: l.accountCode,
      amount: Number(String(l.amount).replace(/,/g, '')) || 0,
      note: l.note.trim() || undefined,
    }))
    .filter(l => l.accountCode && l.amount !== 0);
}

/**
 * 저장될 금액.
 *
 * 입금·출금은 **줄 합이 곧 금액**이다 — 따로 고치면 원장과 분개가 갈라진다.
 * 상계(대체)는 줄이 부호를 가져 합이 0이고(차 251 / 대 108) amount는 상계액이라 예외다.
 */
export function cashEditAmount(form: CashEditForm, lines: CashEditLineDraft[], isOffset: boolean): number {
  const split = cashEditSplit(lines);
  if (split.length && !isOffset) return split.reduce((a, l) => a + l.amount, 0);
  return parseFloat(form.amount) || 0;
}

export function buildCashEditPatch(
  entry: CashEntry,
  form: CashEditForm,
  lines: CashEditLineDraft[],
): Partial<CashEntry> {
  const isOffset = entry.dir === '대체';
  const split = cashEditSplit(lines);
  return {
    amount: cashEditAmount(form, lines, isOffset),
    date: form.date,
    // 상계(대체)는 방향을 고를 수 있는 게 아니다 — 모달이 '출금'으로 보여줄 뿐이라 그대로 둔다.
    //   예전엔 열었다 저장하면 대체가 출금으로 바뀌어, 오간 적 없는 통장 줄이 섰다.
    ...(isOffset ? {} : { dir: form.dir }),
    note: form.note.trim(),
    // 줄이 있으면 줄이 임자다 — accountCode는 안 쓴다(types.ts CashEntry 주석).
    // 줄을 다 지웠으면 lines를 빈 배열로 덮어 한 줄짜리로 되돌린다.
    ...(split.length
      ? { lines: split, accountCode: '' }
      : { lines: [], accountCode: form.accountCode }),
  };
}
