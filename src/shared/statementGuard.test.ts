import { describe, it, expect } from 'vitest';
import { statementBlockReason } from './statementGuard';
import type { IssuedStatement } from './types';

/**
 * 차·대를 못 채우는 전표는 **만들지 못하게** 막는다.
 * 계정이 없으면 journalizeStatement가 대변을 못 채워 분개를 통째로 안 만들고,
 * 그러면 그 전표는 시산표에서 사라지고 채권·채무 판정에도 안 잡힌다.
 */
const li = (o: Partial<IssuedStatement['items'][number]> = {}) => ({
  name: '참기름', spec: '', qty: 1, price: 1000, supply: 1000, tax: 0, total: 1000,
  isTaxExempt: true, accountCode: '800', ...o,
} as IssuedStatement['items'][number]);
const st = (items: IssuedStatement['items']) => ({ type: '매출', items } as Partial<IssuedStatement>);
/** 양변 전표(기초이월·감가상각) — 줄에 차·대를 직접 세운다. type은 '비용'이다. */
const two = (items: IssuedStatement['items']) => ({ type: '비용', items } as Partial<IssuedStatement>);

describe('전표 만들기 전 검사', () => {
  it('제대로 된 전표는 통과한다', () => {
    expect(statementBlockReason(st([li()]))).toBeNull();
  });

  it('품목이 없으면 막는다', () => {
    expect(statementBlockReason(st([]))).toContain('품목이 없습니다');
  });

  it('계정 없는 줄이 있으면 막고, 어느 줄인지 알려준다', () => {
    const r = statementBlockReason(st([li(), li({ name: '들기름', accountCode: undefined })]));
    expect(r).toContain('계정과목이 없는 줄이 1건');
    expect(r).toContain('들기름');
    expect(r).toContain('시산표에서 사라집니다');
  });

  it('양변 전표는 전 줄에 차변·대변이 있어야 한다 — 섞이면 막는다', () => {
    const r = statementBlockReason(two([li({ side: '차변' }), li()]));
    expect(r).toContain('섞여 있습니다');
  });

  it('양변 전표의 차·대가 안 맞으면 막는다', () => {
    const r = statementBlockReason(two([
      li({ accountCode: '108', side: '차변', total: 1_000_000 }),
      li({ accountCode: '375', side: '대변', total: 900_000 }),
    ]));
    expect(r).toContain('차변 1,000,000원과 대변 900,000원이 안 맞습니다');
  });

  it('차·대가 맞는 양변 전표(기초이월)는 통과한다', () => {
    expect(statementBlockReason(two([
      li({ accountCode: '108', side: '차변', total: 1_755_000 }),
      li({ accountCode: '375', side: '대변', total: 1_755_000 }),
    ]))).toBeNull();
  });

  /**
   * 매입전표는 줄에 **매입계정 한쪽만** 적는다 — 상대변 251은 journalizeStatement가 세운다.
   * 그걸 모르고 줄만 세면 "대변 0원"이라며 멀쩡한 전표를 막는다(전기세 1,233,780원이 그랬다).
   */
  it('매입전표는 한쪽 줄만 있어도 통과한다 — 상대변(251)은 분개가 세운다', () => {
    expect(statementBlockReason({ type: '매입', totalAmount: 1_233_780, totalTax: 0, items: [
      li({ name: '전기세', accountCode: '520', side: '차변', supply: 1_233_780, tax: 0, total: 1_233_780 }),
    ] } as Partial<IssuedStatement>)).toBeNull();
  });

  it('매출전표도 마찬가지다 — 상대변은 108이다', () => {
    expect(statementBlockReason({ type: '매출', totalAmount: 500_000, totalTax: 0, items: [
      li({ accountCode: '800', supply: 500_000, tax: 0, total: 500_000 }),
    ] } as Partial<IssuedStatement>)).toBeNull();
  });

  it('부가세가 붙어도 통과한다 — 차변 gross = 대변 공급가+세액', () => {
    expect(statementBlockReason({ type: '매출', totalAmount: 1_100_000, totalTax: 100_000, items: [
      li({ accountCode: '800', supply: 1_000_000, tax: 100_000, total: 1_100_000, isTaxExempt: false }),
    ] } as Partial<IssuedStatement>)).toBeNull();
  });

  it('품목 합계와 전표 합계가 다르면 막는다 — 시산표가 무너진다', () => {
    const r = statementBlockReason({ type: '매출', totalAmount: 900_000, totalTax: 0, items: [
      li({ accountCode: '800', supply: 500_000, tax: 0, total: 500_000 }),
    ] } as Partial<IssuedStatement>);
    expect(r).toContain('품목 합계 500,000원과 전표 합계 900,000원이 다릅니다');
  });
});
