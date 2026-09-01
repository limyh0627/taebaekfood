import { describe, it, expect } from 'vitest';
import { journalizeCashEntry } from './autoJournal';
import type { CashEntry } from './types';

const entry = (over: Partial<CashEntry>): CashEntry => ({
  id: 'cash-1', date: '2026-08-05', cashAccountId: '', dir: '출금', amount: 0,
  createdAt: '2026-08-05T00:00:00.000Z', ...over,
} as CashEntry);

describe('journalizeCashEntry — 쪼갠 줄(대출상환)', () => {
  it('원금·이자를 각각 차변에 세우고 통장은 합계 한 줄', () => {
    const je = journalizeCashEntry(entry({
      amount: 1_965_899,
      lines: [
        { accountCode: '260', amount: 1_000_000, note: '원금' },
        { accountCode: '951', amount: 965_899, note: '이자' },
      ],
    }))!;
    //  줄 적요는 분개까지 따라온다 — 전표 양식의 '적요' 칸이 이걸 쓴다.
    //  차·대 판정에는 안 쓰이므로 금액은 그대로다.
    expect(je.lines).toEqual([
      { accountCode: '260', debit: 1_000_000, credit: 0, note: '원금' },
      { accountCode: '951', debit: 965_899, credit: 0, note: '이자' },
      { accountCode: '103', debit: 0, credit: 1_965_899 },
    ]);
    const d = je.lines.reduce((a, l) => a + l.debit, 0);
    const c = je.lines.reduce((a, l) => a + l.credit, 0);
    expect(d).toBe(c);
  });

  it('입금이면 방향이 뒤집힌다', () => {
    const je = journalizeCashEntry(entry({
      dir: '입금', amount: 3_000_000,
      lines: [{ accountCode: '260', amount: 3_000_000, note: '대출 실행' }],
    }))!;
    expect(je.lines[0]).toEqual({ accountCode: '103', debit: 3_000_000, credit: 0 });
    expect(je.lines[1]).toEqual({ accountCode: '260', debit: 0, credit: 3_000_000, note: '대출 실행' });
  });

  it('amount가 줄 합계와 어긋나도 분개는 줄 합계로 균형을 맞춘다', () => {
    const je = journalizeCashEntry(entry({
      amount: 999,   // 잘못 저장된 값
      lines: [{ accountCode: '951', amount: 500_000 }, { accountCode: '260', amount: 500_000 }],
    }))!;
    const d = je.lines.reduce((a, l) => a + l.debit, 0);
    const c = je.lines.reduce((a, l) => a + l.credit, 0);
    expect(d).toBe(c);
    expect(c).toBe(1_000_000);
  });

  it('줄이 없으면 기존 한 줄 방식 그대로', () => {
    const je = journalizeCashEntry(entry({ amount: 965_899, accountCode: '951' }))!;
    expect(je.lines).toEqual([
      { accountCode: '951', debit: 965_899, credit: 0 },
      { accountCode: '103', debit: 0, credit: 965_899 },
    ]);
  });

  it('거래처가 있으면 성격계정 줄에만 붙는다', () => {
    const je = journalizeCashEntry(entry({
      amount: 100, partnerId: 'C001',
      lines: [{ accountCode: '951', amount: 100 }],
    }))!;
    expect(je.lines[0]).toEqual({ accountCode: '951', partnerId: 'C001', debit: 100, credit: 0 });
    expect(je.lines[1].partnerId).toBeUndefined();
  });

  it('줄도 계정도 없으면 분개를 만들지 않는다', () => {
    expect(journalizeCashEntry(entry({ amount: 1000 }))).toBeNull();
  });
});

describe('journalizeCashEntry — 음수 줄(급여 원천공제)', () => {
  it('총급여는 차변, 원천공제는 대변, 통장은 실지급액', () => {
    const je = journalizeCashEntry(entry({
      amount: 2_700_000,                       // 통장에서 실제로 나간 돈
      lines: [
        { accountCode: '515', amount: 3_000_000, note: '총급여' },
        { accountCode: '254', amount: -300_000, note: '원천공제' },
      ],
    }))!;
    expect(je.lines).toEqual([
      { accountCode: '515', debit: 3_000_000, credit: 0, note: '총급여' },
      { accountCode: '254', debit: 0, credit: 300_000, note: '원천공제' },
      { accountCode: '103', debit: 0, credit: 2_700_000 },
    ]);
    const d = je.lines.reduce((a, l) => a + l.debit, 0);
    const c = je.lines.reduce((a, l) => a + l.credit, 0);
    expect(d).toBe(c);
    expect(d).toBe(3_000_000);
  });

  it('공제가 없으면 총급여 = 실지급액', () => {
    const je = journalizeCashEntry(entry({
      amount: 3_000_000,
      lines: [{ accountCode: '515', amount: 3_000_000, note: '총급여' }],
    }))!;
    expect(je.lines).toEqual([
      { accountCode: '515', debit: 3_000_000, credit: 0, note: '총급여' },
      { accountCode: '103', debit: 0, credit: 3_000_000 },
    ]);
  });

  it('입금에 음수 줄이면 그 줄만 차변으로 넘어간다', () => {
    const je = journalizeCashEntry(entry({
      dir: '입금', amount: 900_000,
      lines: [
        { accountCode: '800', amount: 1_000_000, note: '매출' },
        { accountCode: '831', amount: -100_000, note: '수수료 공제' },
      ],
    }))!;
    expect(je.lines).toEqual([
      { accountCode: '103', debit: 900_000, credit: 0 },
      { accountCode: '800', debit: 0, credit: 1_000_000, note: '매출' },
      { accountCode: '831', debit: 100_000, credit: 0, note: '수수료 공제' },
    ]);
    const d = je.lines.reduce((a, l) => a + l.debit, 0);
    const c = je.lines.reduce((a, l) => a + l.credit, 0);
    expect(d).toBe(c);
  });
});

/**
 * **차·대는 `side`가 말한다 — 금액은 언제나 양수다.**
 *
 * 예전엔 부호가 차·대였다. 그런데 그 뜻이 `dir`에 매달려 있어서, 같은 +3,000,000이
 * 출금이면 차변 입금이면 대변이었다. `dir`을 바꾸면 모든 줄이 조용히 뒤집힌다.
 * 그래서 `side`로 옮겼고, 옛 줄(side 없음)은 예전 규칙으로 계속 읽는다.
 *
 * 아래는 **두 모양이 같은 분개를 낸다**는 걸 잠가 둔다 — 옛 데이터를 안 건드리고
 * 옮길 수 있는 근거다.
 */
describe('차·대는 side 로 적는다 (옛 부호 줄과 같은 분개)', () => {
  const 급여옛 = entry({
    amount: 2_700_000,
    lines: [
      { accountCode: '515', amount: 3_000_000, note: '총급여' },
      { accountCode: '254', amount: -300_000, note: '원천공제' },
    ],
  });
  const 급여새 = entry({
    amount: 2_700_000,
    lines: [
      { accountCode: '515', amount: 3_000_000, side: '차변', note: '총급여' },
      { accountCode: '254', amount: 300_000, side: '대변', note: '원천공제' },
    ],
  });

  it('출금 — 옛 부호 줄과 새 side 줄이 같은 분개를 낸다', () => {
    expect(journalizeCashEntry(급여새)!.lines).toEqual(journalizeCashEntry(급여옛)!.lines);
  });

  it('출금에서 side 를 안 적으면 통장 반대편(차변)이 기본이다', () => {
    const je = journalizeCashEntry(entry({
      amount: 500_000,
      lines: [{ accountCode: '520', amount: 500_000, side: '차변' }],
    }))!;
    expect(je.lines[0]).toMatchObject({ accountCode: '520', debit: 500_000 });
    expect(je.lines[1]).toMatchObject({ accountCode: '103', credit: 500_000 });
  });

  /** 같은 side 라도 dir 이 뒤집히면 차·대가 뒤집혀야 한다 — 부호 시절엔 이게 안 됐다 */
  it('입금이면 같은 side 가 반대편에 선다', () => {
    const 입금 = journalizeCashEntry(entry({
      dir: '입금', amount: 500_000,
      lines: [{ accountCode: '930', amount: 500_000, side: '대변' }],
    }))!;
    expect(입금.lines.find(l => l.accountCode === '930')).toMatchObject({ credit: 500_000, debit: 0 });
    expect(입금.lines.find(l => l.accountCode === '103')).toMatchObject({ debit: 500_000, credit: 0 });
  });

  it('대체도 side 로 읽는다 — 상계는 251 차변 / 108 대변', () => {
    const je = journalizeCashEntry(entry({
      dir: '대체' as CashEntry['dir'], amount: 9_370_000, partnerId: 'p1',
      lines: [
        { accountCode: '251', amount: 9_370_000, side: '차변', note: '미지급 상계' },
        { accountCode: '108', amount: 9_370_000, side: '대변', note: '미수 상계' },
      ],
    } as Partial<CashEntry>))!;
    expect(je.lines.find(l => l.accountCode === '251')).toMatchObject({ debit: 9_370_000 });
    expect(je.lines.find(l => l.accountCode === '108')).toMatchObject({ credit: 9_370_000 });
  });

  it('금액을 음수로 적어도 side 가 있으면 side 가 이긴다 — 실수해도 안 뒤집힌다', () => {
    const je = journalizeCashEntry(entry({
      amount: 300_000,
      lines: [{ accountCode: '254', amount: -300_000, side: '차변' }],
    }))!;
    expect(je.lines[0]).toMatchObject({ accountCode: '254', debit: 300_000, credit: 0 });
  });
});
