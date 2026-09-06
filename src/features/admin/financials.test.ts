import { describe, it, expect } from 'vitest';
import { makeCodeToGroup, addMonthStr, filterCodesForContext, plMovement, plOfJournals } from './financials';
import type { IssuedStatement, AccountCode, AccountGroup, FixedCostEntry, CashEntry } from '../../shared/types';

describe('filterCodesForContext', () => {
  const gs: AccountGroup[] = [
    { id: 'ag-revenue', name: '총매출', type: '수익' } as AccountGroup,
    { id: 'ag-cogs', name: '총매출원가', type: '비용' } as AccountGroup,
    { id: 'ag-asset', name: '자산', type: '자산' } as AccountGroup,
    { id: 'ag-liability', name: '부채', type: '부채' } as AccountGroup,
  ];
  const cs: AccountCode[] = [
    { id: '800', code: '800', name: '일반매출', groupId: 'ag-revenue' },
    { id: '520', code: '520', name: '전기세', groupId: 'ag-cogs' },
    { id: '206', code: '206', name: '기계장치', groupId: 'ag-asset' },
    { id: '260', code: '260', name: '단기차입금', groupId: 'ag-liability' },
    { id: '605', code: '605', name: '운임' },                       // 그룹 미지정
  ];
  // 반환 순서는 계정번호 오름차순 — 전표 발행 드롭다운에서 번호대로 보여야 찾기 쉽다.
  const names = (ctx: '매출' | '매입' | '자금') => filterCodesForContext(cs, gs, ctx).map(c => c.code);

  it('매출전표에는 수익 계정만 (단기차입금·기계장치 안 뜸)', () => {
    expect(names('매출')).toEqual(['605', '800']);
  });
  // 기계·차량 취득은 손익이 아니라 투자다 — 자금원장에서 끊는다.
  // 손익에 닿는 건 그 자산의 감가상각뿐이라, 매입전표에 자산 계정이 뜨면 안 된다.
  it('매입전표에는 비용 계정만 (기계장치·단기차입금 안 뜸)', () => {
    expect(names('매입')).toEqual(['520', '605']);
  });
  it('자금 전표는 전부 — 돈이 나가는 이유는 뭐든 될 수 있다', () => {
    expect(names('자금')).toEqual(['206', '260', '520', '605', '800']);
  });
  it('그룹 미지정 계정은 감추지 않는다 (기존 전표를 고칠 수 있어야 한다)', () => {
    expect(names('매출')).toContain('605');
    expect(names('매입')).toContain('605');
  });

  /*
   * 대체전표는 **돈이 안 움직이는** 분개다. 막아야 할 건 그것 하나 —
   * 현금이 오간 것을 대체로 적으면 통장 잔액과 어긋난다.
   *
   * 전에는 `noncash` 계정(감가상각·퇴직충당)만 남겼는데, 그건 '현금이 안 나간다'가 아니라
   * '영영 현금이 안 나간다'는 뜻이라 너무 좁았다. 실제 계정 49개 중 4개만 떠서
   * **급여도 이자도 못 골랐다** — 거래처 없이 발생만 세우는 대표 전표가 그 둘인데.
   */
  it('대체전표에서 통장·현금만 빠진다', () => {
    const withCash: AccountCode[] = [
      ...cs,
      { id: '818', code: '818', name: '감가상각비', groupId: 'ag-cogs', noncash: true },
      { id: '103', code: '103', name: '보통예금', groupId: 'ag-asset' },
      { id: '101', code: '101', name: '현금', groupId: 'ag-asset' },
    ];
    const out = filterCodesForContext(withCash, gs, '대체').map(c => c.code);
    expect(out).not.toContain('103');
    expect(out).not.toContain('101');
    expect(out).toContain('818');   // 감가상각 — 좁히기 전에도 되던 것
    expect(out).toContain('520');   // 전기세 발생 — 아직 안 낸 것을 세운다
    expect(out).toContain('260');   // 상대변(부채) — 차·대를 직접 세우려면 있어야 한다
  });
});

const groups: AccountGroup[] = [
  { id: 'g-rev', name: '총매출', type: '수익', plLine: 'revenue' } as AccountGroup,
];
const codes: AccountCode[] = [
  { id: 'ac-400', code: '400', name: '제품매출', groupId: 'g-rev' } as AccountCode,
];
const stmt = (type: '매출' | '매입' | '비용', tradeDate: string, total: number, accountCode?: string): IssuedStatement =>
  ({ id: `${type}-${tradeDate}-${total}`, type, tradeDate, issuedAt: '', partnerId: '', partnerName: '', orderId: '', docNo: '', totalSupply: total, totalTax: 0, totalAmount: total, items: [{ name: 'x', spec: '', qty: 1, price: total, supply: total, tax: 0, total, isTaxExempt: true, accountCode }] } as IssuedStatement);

describe('addMonthStr', () => {
  it('월 가감(연도 넘김 포함)', () => {
    expect(addMonthStr('2026-07', -1)).toBe('2026-06');
    expect(addMonthStr('2026-01', -1)).toBe('2025-12');
    expect(addMonthStr('2026-12', 1)).toBe('2027-01');
  });
});

describe('makeCodeToGroup', () => {
  const c2g = makeCodeToGroup(codes, groups, groups);
  it('코드→그룹, 없으면 undefined', () => {
    expect(c2g('400')?.plLine).toBe('revenue');
    expect(c2g(undefined)).toBeUndefined();
    expect(c2g('999')).toBeUndefined();
  });
});

describe('집계는 계정과목으로만 — 전표 유형 폴백을 없앴다', () => {
  const c2g = makeCodeToGroup(codes, groups, groups);

  it('계정에 붙은 그룹을 있는 그대로 돌려준다 — id를 갈아끼우지 않는다', () => {
    // 예전엔 표시용으로 판관비 id를 'ag-sgna'로 바꿔 내보냈는데, 설정 화면이 그 id를
    // 그대로 저장하면서 없는 그룹을 가리키는 계정이 생겼다(운임·카드대금이 손익에서 빠졌다).
    for (const ac of codes) {
      const g = c2g(ac.code);
      if (!g) continue;
      expect(groups.some(x => x.id === g.id)).toBe(true);   // 실제로 있는 그룹이어야 한다
    }
  });

  it('계정과목이 없으면 그룹도 없다 — 전표 유형으로 때려맞추지 않는다', () => {
    expect(c2g(undefined)).toBeUndefined();
    expect(c2g('없는코드')).toBeUndefined();
  });
});


/**
 * **손익은 분개에서 센다 — 전표 갈래로 세면 안 된다.** (2026-09-03 사장님 발견)
 *
 * 전표 화면 하단 합계가 `type === '매입'` 인 것만 더하고 있었다. 그래서 **대체전표가
 * 통째로 빠졌다** — 급여 발생·감가상각·퇴직급여충당은 갈래가 '비용'이다.
 * 2026-08 급여 19,314,620원이 그렇게 사라져 있었다.
 */
describe('plMovement · plOfJournals — 손익 판정은 한 곳', () => {
  const 계정: AccountCode[] = [
    { id: '515', code: '515', name: '급여', type: '비용', normalBalance: 'debit' },
    { id: '800', code: '800', name: '일반매출', type: '수익', normalBalance: 'credit' },
    { id: '254', code: '254', name: '예수금', type: '부채', normalBalance: 'credit' },
    { id: '263', code: '263', name: '미지급급여', type: '부채', normalBalance: 'credit' },
    { id: '255', code: '255', name: '부가세예수금', type: '부채', normalBalance: 'credit' },
    { id: '108', code: '108', name: '외상매출금', type: '자산', normalBalance: 'debit' },
  ] as AccountCode[];
  const je = (lines: { accountCode: string; debit?: number; credit?: number }[]) =>
    ([{ id: 'j', date: '2026-08-31', lines }] as never);

  it('**대체전표의 비용도 잡힌다** — 갈래가 비용이라 예전엔 통째로 빠졌다', () => {
    //  급여260831-01 실물: 차변 515 급여 / 대변 254 예수금 + 263 미지급급여
    const r = plOfJournals(je([
      { accountCode: '515', debit: 19_314_620, credit: 0 },
      { accountCode: '254', debit: 0, credit: 1_608_610 },
      { accountCode: '263', debit: 0, credit: 17_706_010 },
    ]), 계정);
    expect(r.cost).toBe(19_314_620);
    expect(r.income).toBe(0);
  });

  it('**부가세는 손익이 아니다** — 전표 총액으로 세면 섞인다', () => {
    //  1,070,000 매출전표의 손익은 1,000,000 이다
    const r = plOfJournals(je([
      { accountCode: '108', debit: 1_070_000, credit: 0 },
      { accountCode: '800', debit: 0, credit: 1_000_000 },
      { accountCode: '255', debit: 0, credit: 70_000 },
    ]), 계정);
    expect(r.income).toBe(1_000_000);
  });

  it('되돌린 줄은 깎는다 — 반품이 매출을 부풀리면 안 된다', () => {
    expect(plOfJournals(je([{ accountCode: '800', debit: 300_000, credit: 0 }]), 계정).income).toBe(-300_000);
  });

  it('자산·부채만 움직인 분개는 손익이 0 — 수금은 이익이 아니다', () => {
    const r = plOfJournals(je([
      { accountCode: '108', debit: 0, credit: 500_000 },
      { accountCode: '263', debit: 500_000, credit: 0 },
    ]), 계정);
    expect(r).toEqual({ income: 0, cost: 0 });
  });

  it('모르는 계정은 안 센다 — 지어내지 않는다', () => {
    expect(plOfJournals(je([{ accountCode: '999', debit: 1_000 }]), 계정)).toEqual({ income: 0, cost: 0 });
  });

  it('plMovement 은 정상 방향으로 부호를 잡는다', () => {
    expect(plMovement(계정[0], 100, 0)).toBe(100);    // 비용 차변 = +
    expect(plMovement(계정[1], 0, 100)).toBe(100);    // 수익 대변 = +
    expect(plMovement(계정[2], 0, 100)).toBe(0);      // 부채는 손익이 아니다
    expect(plMovement(undefined, 100, 0)).toBe(0);
  });
});
