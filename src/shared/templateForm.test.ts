import { describe, it, expect } from 'vitest';
import { templateAccrRows, splitModeOf, SPLIT_MODES, isCashDir, CashTemplate } from './cashTemplates';

/**
 * 템플릿을 고르면 **양식 전체가 그 템플릿이 되어야 한다** — 계정·거래처·금액·두 줄 값까지.
 *
 * 실제로 걸렸던 것: 리스료는 dir이 '대체'라 금액칸이 아니라 '계정 · 금액' 줄을 쓰는 양식인데,
 * 템플릿의 금액을 금액칸에만 넣고 있었다. 금액 2,344,300과 계정 819를 들고 있는 템플릿을
 * 골라도 빈 줄이 떠서, 매번 계정과 금액을 다시 고르게 됐다(템플릿을 둔 뜻이 없어진다).
 */

const lease: CashTemplate = {
  id: 'fct-builtin-lease', label: '리스료', dir: '대체', mode: '일반',
  accountCode: '819', amount: 2344300, partnerId: 'c-1786085238664',
  partnerName: '차량 리스', itemName: '차량 리스',
};

describe('비현금 갈래 템플릿 → 계정·금액 줄', () => {
  it('대체 템플릿은 계정과 금액을 줄에 그대로 편다', () => {
    expect(templateAccrRows(lease)).toEqual([
      { name: '차량 리스', accountCode: '819', price: '2344300', side: '차변' },
    ]);
  });

  it('품목명이 없으면 비고, 그것도 없으면 템플릿 이름을 적요로 쓴다', () => {
    expect(templateAccrRows({ ...lease, itemName: undefined, note: '7월분' })[0].name).toBe('7월분');
    expect(templateAccrRows({ ...lease, itemName: undefined, note: undefined })[0].name).toBe('리스료');
  });

  it('금액이 없는 템플릿은 금액 칸을 비운다 — 0을 박아 두면 지우고 쓰게 된다', () => {
    expect(templateAccrRows({ ...lease, amount: undefined })[0].price).toBe('');
    expect(templateAccrRows({ ...lease, amount: 0 })[0].price).toBe('');
  });

  it('자금 갈래(출금·입금)는 금액칸을 쓰므로 줄을 비워 둔다', () => {
    expect(templateAccrRows({ ...lease, dir: '출금' })).toEqual([{ name: '', price: '', side: '차변' }]);
    expect(templateAccrRows({ ...lease, dir: '입금' })).toEqual([{ name: '', price: '', side: '차변' }]);
  });

  it('회사이체도 전용 입력이라 줄을 안 쓴다', () => {
    expect(templateAccrRows({ ...lease, dir: '회사이체' })).toEqual([{ name: '', price: '', side: '차변' }]);
  });

  it('줄돈·받을돈도 전표라 줄을 쓴다', () => {
    expect(templateAccrRows({ ...lease, dir: '줄돈' })[0].accountCode).toBe('819');
    expect(templateAccrRows({ ...lease, dir: '받을돈' })[0].accountCode).toBe('819');
  });
});

describe('두 줄로 갈리는 갈래는 모두 양식이 있어야 한다', () => {
  /**
   * 자금원장에 '세금' 양식이 없어서, 세금납부 템플릿을 고르면 상환(원금·이자) 칸이 떴다.
   * 고른 템플릿과 다른 양식이 뜨면 무슨 전표를 쓰는 중인지 알 수 없다.
   * 모드를 새로 만들 때 양식을 빠뜨리지 않도록 여기서 막는다.
   */
  const MODES: CashTemplate['mode'][] = ['일반', '상환', '급여', '보험', '세금'];

  it('일반을 뺀 모든 모드가 SPLIT_MODES에 양식을 갖고 있다', () => {
    for (const m of MODES) {
      if (m === '일반') { expect(splitModeOf(m)).toBeNull(); continue; }
      const sm = splitModeOf(m);
      expect(sm, `${m} 양식 없음`).not.toBeNull();
      const S = SPLIT_MODES[sm!];
      expect(S.a).toBeTruthy();
      expect(S.b).toBeTruthy();
      expect(S.labelA).toBeTruthy();
      expect(S.labelB).toBeTruthy();
    }
  });

  it('세금은 부가세 + 소득세 합계 — 급여처럼 빼면 안 된다', () => {
    expect(SPLIT_MODES.세금.total(1000, 300)).toBe(1300);
    expect(SPLIT_MODES.급여.total(1000, 300)).toBe(700);
  });
});

describe('자금원장이 받는 갈래', () => {
  it('돈이 오간 갈래만 자금전표다 — 대체는 전표 화면 몫', () => {
    expect(isCashDir('출금')).toBe(true);
    expect(isCashDir('입금')).toBe(true);
    expect(isCashDir('대체')).toBe(false);
    expect(isCashDir('줄돈')).toBe(false);
  });
});
