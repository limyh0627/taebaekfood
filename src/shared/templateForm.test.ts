import { describe, it, expect } from 'vitest';
import { templateAccrRows, templateJournalLines, splitModeOf, SPLIT_MODES, isCashDir, CashTemplate } from './cashTemplates';

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

describe('템플릿이 차·대를 들고 온다', () => {
  /**
   * 사용자가 줄마다 차변/대변을 고르게 하면 회계를 아는 사람만 쓸 수 있다.
   * 양식이 정해진 전표는 템플릿이 계정과 차·대를 다 알고, 사용자는 **금액만** 넣는다.
   */
  const 감가상각: CashTemplate = {
    id: 'fct-builtin-depreciation', label: '감가상각', dir: '대체', mode: '일반',
    accountCode: '818', amount: 1_000_000,
    transferLines: [
      { accountCode: '818', side: '차변' },
      { accountCode: '203', side: '대변' },
    ],
  };

  it('양식이 있으면 줄을 그대로 편다 — 계정도 차·대도 정해져 온다', () => {
    expect(templateAccrRows(감가상각)).toEqual([
      { name: '감가상각', accountCode: '818', price: '1000000', side: '차변' },
      { name: '감가상각', accountCode: '203', price: '1000000', side: '대변' },
    ]);
  });

  it('줄마다 이름을 따로 줄 수 있다', () => {
    const t = { ...감가상각, transferLines: [
      { accountCode: '818', side: '차변' as const, name: '감가상각비' },
      { accountCode: '203', side: '대변' as const, name: '누계액' },
    ] };
    expect(templateAccrRows(t).map(r => r.name)).toEqual(['감가상각비', '누계액']);
  });

  it('차·대가 맞는 양식이다 — 저장이 막히지 않는다', () => {
    const rows = templateAccrRows(감가상각);
    const 차 = rows.filter(r => r.side === '차변').reduce((a, r) => a + Number(r.price), 0);
    const 대 = rows.filter(r => r.side === '대변').reduce((a, r) => a + Number(r.price), 0);
    expect(차).toBe(대);
  });

  it('양식이 없으면 계정 한 줄 — 상대변은 사용자가 넣는다', () => {
    expect(templateAccrRows(lease)).toHaveLength(1);
    expect(templateAccrRows(lease)[0].side).toBe('차변');
  });
});

describe('템플릿이 만들 분개 모양', () => {
  /**
   * 사용자가 차·대를 고르지는 않지만 **무엇이 어디로 잡히는지는 볼 수 있어야** 한다.
   * 계정을 잘못 골라 두면 그 템플릿으로 끊는 전표가 죄다 어긋나는데,
   * 목록엔 계정 이름만 보여서 저장 전엔 알 수가 없었다.
   */
  const t = (o: Partial<CashTemplate>): CashTemplate =>
    ({ id: 'x', label: '테스트', dir: '출금', mode: '일반', amount: 100_000, ...o });
  const 차대 = (ls: ReturnType<typeof templateJournalLines>) => [
    ls.filter(l => l.side === '차변').reduce((a, l) => a + l.amount, 0),
    ls.filter(l => l.side === '대변').reduce((a, l) => a + l.amount, 0),
  ];

  it('출금은 (차) 계정 / (대) 통장', () => {
    const ls = templateJournalLines(t({ dir: '출금', accountCode: '520' }));
    expect(ls.map(l => [l.side, l.code])).toEqual([['차변', '520'], ['대변', '103']]);
    expect(차대(ls)).toEqual([100_000, 100_000]);
  });

  it('입금은 통장이 차변 — 방향이 뒤집힌다', () => {
    const ls = templateJournalLines(t({ dir: '입금', accountCode: '108' }));
    expect(ls.map(l => [l.side, l.code])).toEqual([['차변', '103'], ['대변', '108']]);
  });

  it('대체는 양식대로 — 감가상각', () => {
    const ls = templateJournalLines(t({ dir: '대체', transferLines: [
      { accountCode: '818', side: '차변' }, { accountCode: '203', side: '대변' },
    ] }));
    expect(ls.map(l => [l.side, l.code])).toEqual([['차변', '818'], ['대변', '203']]);
    expect(차대(ls)).toEqual([100_000, 100_000]);
  });

  it('양식 없는 대체는 차·대가 안 맞는다 — 상대변이 없다는 걸 화면이 알려야 한다', () => {
    const ls = templateJournalLines(t({ dir: '대체', accountCode: '819' }));
    const [d, c] = 차대(ls);
    expect(d).not.toBe(c);
  });

  it('급여는 (차) 총급여 / (대) 예수금 + 통장 실지급', () => {
    const ls = templateJournalLines(t({ mode: '급여', gross: 3_000_000, deduction: 300_000 }));
    expect(ls.map(l => [l.side, l.code, l.amount])).toEqual([
      ['차변', '515', 3_000_000], ['대변', '254', 300_000], ['대변', '103', 2_700_000],
    ]);
    expect(차대(ls)).toEqual([3_000_000, 3_000_000]);
  });

  it('4대보험은 차변이 둘 — 회사부담(비용) + 근로자부담(예수금)', () => {
    const ls = templateJournalLines(t({ mode: '보험', insCorp: 1_852_820, insEmp: 2_099_520 }));
    expect(ls.map(l => l.code)).toEqual(['530', '254', '103']);
    expect(차대(ls)).toEqual([3_952_340, 3_952_340]);
  });

  it('상환은 원금이 고른 차입금 계정으로 간다', () => {
    const ls = templateJournalLines(t({ mode: '상환', principal: 2_770_000, interest: 294_357, loanCode: '293' }));
    expect(ls.map(l => l.code)).toEqual(['293', '951', '103']);
    expect(차대(ls)).toEqual([3_064_357, 3_064_357]);
  });
});
