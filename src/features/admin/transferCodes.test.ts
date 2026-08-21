import { describe, it, expect } from 'vitest';
import { filterCodesForContext, isCashAccountCode } from './financials';
import type { AccountCode, AccountGroup } from '../../shared/types';

/**
 * 대체전표 계정 목록 — **통장·현금만 뺀다.**
 *
 * 전에는 `noncash` 계정(감가상각·퇴직충당)만 남겨서 49개 중 4개만 떴다.
 * 그래서 거래처 없이 발생만 세우는 전표 — 급여·이자 — 를 아예 못 끊었다.
 * 정작 그 둘이 대체전표의 대표 용례인데.
 */
const c = (code: string, name: string, type: AccountCode['type'], noncash?: boolean): AccountCode =>
  ({ id: code, code, name, type, noncash } as AccountCode);

const CODES: AccountCode[] = [
  c('101', '현금', '자산'),
  c('103', '보통예금', '자산'),
  c('254', '예수금', '부채'),
  c('262', '미지급비용', '부채'),
  c('515', '급여', '비용'),
  c('818', '감가상각비', '비용', true),
  c('951', '이자비용', '비용'),
  c('800', '일반매출', '수익'),
];
const GROUPS: AccountGroup[] = [
  { id: 'ag-labor', name: '노무비', type: '비용', plLine: 'cogs' } as AccountGroup,
  { id: 'ag-other-expense', name: '영업외비용', type: '비용', plLine: 'other-expense' } as AccountGroup,
];
const 대체 = () => filterCodesForContext(CODES, GROUPS, '대체').map(x => x.code);

describe('대체전표에서 고를 수 있는 계정', () => {
  it('통장·현금은 안 뜬다 — 돈이 오갔으면 자금원장으로 가야 잔액이 맞는다', () => {
    expect(대체()).not.toContain('101');
    expect(대체()).not.toContain('103');
  });

  it('급여·이자가 뜬다 — 거래처 없이 발생만 세우는 대표 전표(고친 이유)', () => {
    expect(대체()).toContain('515');
    expect(대체()).toContain('951');
  });

  it('상대변 계정(부채)도 뜬다 — 차·대를 직접 세우는 전표라 한 변만으로는 못 끊는다', () => {
    expect(대체()).toContain('254');   // (차) 급여 / (대) 예수금
    expect(대체()).toContain('262');   // (차) 이자비용 / (대) 미지급비용
  });

  it('감가상각은 그대로 뜬다 — 좁히기 전에도 되던 것', () => {
    expect(대체()).toContain('818');
  });

  it('옛 규칙(noncash만)이었다면 급여·이자가 빠진다', () => {
    const 옛것 = CODES.filter(x => x.noncash === true || /감가상각|퇴직급여|충당금/.test(x.name)).map(x => x.code);
    expect(옛것).not.toContain('515');
    expect(옛것).not.toContain('951');
  });
});

describe('현금성 계정 판정', () => {
  it('코드로 안다', () => {
    expect(isCashAccountCode('101', CODES)).toBe(true);
    expect(isCashAccountCode('103', CODES)).toBe(true);
  });

  it('이름으로도 안다 — 통장을 계정으로 더 만들 수 있다', () => {
    const 농협 = [...CODES, c('104', '보통예금(농협)', '자산')];
    expect(isCashAccountCode('104', 농협)).toBe(true);
  });

  it('외상매출금은 현금이 아니다 — 자산이라고 다 현금은 아니다', () => {
    expect(isCashAccountCode('108', [...CODES, c('108', '외상매출금', '자산')])).toBe(false);
  });
});
