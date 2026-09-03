import { describe, it, expect } from 'vitest';
import { statementEditPatch, cashEditPatch, docNoDateMismatch } from './statementEdit';
import { timeOfLocal } from './voucherStamp';
import type { IssuedStatement } from './types';

/**
 * **날짜를 옮기면 시각 도장도 따라가야 한다.**
 *
 * 끊을 때는 제대로 찍는데(`stampFor`) 고칠 때는 거래일만 쓰고 `issuedAt` 을 그대로 뒀다.
 * 실측(2026-09-03) — 규칙이 붙은 8/21 뒤에도 전표 14건·자금 12건이 어긋나 있었다.
 *
 *   260827-12  거래일 8/28 인데 issuedAt 은 8/27 23:59:59
 *   260826-03  거래일 8/25 인데 issuedAt 은 8/26 16:15 (만든 시각 그대로)
 */
const 오늘 = new Date('2026-08-28T10:00:00+09:00');
const 현재 = (d: string) => ({ tradeDate: d } as IssuedStatement);
const 시각 = (p: Partial<IssuedStatement>) => timeOfLocal(p.issuedAt);

describe('거래일이 바뀌면 도장을 다시 찍는다', () => {
  it('**지난 날짜로 옮기면 그날 맨 뒤** — 나중에 알게 된 것이니 뒤에 붙는다', () => {
    const p = statementEditPatch({ tradeDate: '2026-08-25' }, 현재('2026-08-28'), 오늘);
    expect(시각(p)).toBe('23:59:59');
    expect(p.issuedAt!.slice(0, 10) <= '2026-08-25').toBe(true);
  });

  it('**앞선 날짜로 옮기면 그날 맨 앞** — 그날이 오면 처음부터 서 있어야 한다', () => {
    const p = statementEditPatch({ tradeDate: '2026-08-31' }, 현재('2026-08-28'), 오늘);
    expect(시각(p)).toBe('00:00:00');
  });

  it('오늘로 옮기면 지금 시각', () => {
    const p = statementEditPatch({ tradeDate: '2026-08-28' }, 현재('2026-08-25'), 오늘);
    expect(시각(p)).toBe('10:00:00');
  });

  it('**날짜가 그대로면 도장을 안 건드린다** — 금액만 고쳤는데 순서가 바뀌면 안 된다', () => {
    const p = statementEditPatch({ tradeDate: '2026-08-28', totalAmount: 500 }, 현재('2026-08-28'), 오늘);
    expect(p.issuedAt).toBeUndefined();
    expect(p.totalAmount).toBe(500);
  });

  it('거래일을 아예 안 고치면 그대로 지나간다', () => {
    const p = statementEditPatch({ totalAmount: 500 }, 현재('2026-08-28'), 오늘);
    expect(p).toEqual({ totalAmount: 500 });
  });

  it('날짜 모양이 아니면 손대지 않는다 — 지어내지 않는다', () => {
    expect(statementEditPatch({ tradeDate: '' }, 현재('2026-08-28'), 오늘).issuedAt).toBeUndefined();
    expect(statementEditPatch({ tradeDate: '8월 28일' } as never, 현재('2026-08-28'), 오늘).issuedAt).toBeUndefined();
  });

  it('원본을 못 찾아도 날짜가 있으면 찍는다 — 안 찍는 것보다 낫다', () => {
    expect(시각(statementEditPatch({ tradeDate: '2026-08-25' }, undefined, 오늘))).toBe('23:59:59');
  });

  it('**전표번호는 안 건드린다** — 인쇄해서 건넨 종이에 박혀 있을 수 있다', () => {
    const p = statementEditPatch({ tradeDate: '2026-08-25' }, 현재('2026-08-28'), 오늘);
    expect('docNo' in p).toBe(false);
  });
});

describe('번호에 박힌 날짜가 거래일과 다른 것을 짚어 낸다', () => {
  it('고친 뒤 번호가 안 따라간 전표', () => {
    expect(docNoDateMismatch({ docNo: '260827-12', tradeDate: '2026-08-28' } as never)).toBe(true);
  });
  it('맞는 것은 안 짚는다', () => {
    expect(docNoDateMismatch({ docNo: '260828-02', tradeDate: '2026-08-28' } as never)).toBe(false);
  });
  it('접두어가 붙어도 본다 — 반품·가공·급여', () => {
    expect(docNoDateMismatch({ docNo: '가공260828-01', tradeDate: '2026-08-27' } as never)).toBe(true);
    expect(docNoDateMismatch({ docNo: '반품260828-01', tradeDate: '2026-08-28' } as never)).toBe(false);
  });
  it('**모양이 아예 다른 옛 번호는 안 짚는다** — 그건 다른 이야기다', () => {
    expect(docNoDateMismatch({ docNo: '2026-08-0216', tradeDate: '2026-08-21' } as never)).toBe(false);
    expect(docNoDateMismatch({ docNo: '', tradeDate: '2026-08-21' } as never)).toBe(false);
  });
});

describe('자금원장도 같은 규칙', () => {
  const 현금 = (d: string) => ({ date: d } as never);
  it('지난 날짜로 옮기면 23:59:59', () => {
    const p = cashEditPatch({ date: '2026-08-25' }, 현금('2026-08-28'), 오늘);
    expect(timeOfLocal(p.createdAt)).toBe('23:59:59');
  });
  it('앞선 날짜로 옮기면 00:00:00', () => {
    expect(timeOfLocal(cashEditPatch({ date: '2026-08-31' }, 현금('2026-08-28'), 오늘).createdAt)).toBe('00:00:00');
  });
  it('날짜가 그대로면 안 건드린다 — 금액만 고쳤는데 순서가 바뀌면 안 된다', () => {
    const p = cashEditPatch({ date: '2026-08-28', amount: 500 } as never, 현금('2026-08-28'), 오늘);
    expect(p.createdAt).toBeUndefined();
  });
});
