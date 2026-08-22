import { describe, it, expect } from 'vitest';
import type { AccountCode, AccountGroup } from './types';

/**
 * 성격 필터 — **줄의 계정으로 거르고, 계층은 두 단이다.**
 *
 *   대분류  매출 · 비용 · 자산·부채
 *   중분류  비용 아래 — 재료비 · 노무비 · 제조경비 · 판관비 · 영업외비용
 *
 * 갈래(매출·매입·대체·입금·출금)만으로는 "이번 달 나간 비용 전부"를 못 본다.
 * 대출상환은 출금전표인데 안에 이자비용이 있고, 급여 발생은 대체전표인데 인건비다.
 * 한 전표가 여러 성격을 품으므로 전표 머리가 아니라 줄을 봐야 한다.
 *
 * **계정 번호대로 가르면 안 된다** — 우리 장부는 800번대에 매출과 비용이 같이 있다.
 */
const CODES: AccountCode[] = [
  { id: '800', code: '800', name: '일반매출', type: '수익', groupId: 'ag-revenue' },
  { id: '818', code: '818', name: '감가상각비', type: '비용', groupId: 'ag-admin' },
  { id: '819', code: '819', name: '리스료', type: '비용', groupId: 'ag-admin' },
  { id: '515', code: '515', name: '급여', type: '비용', groupId: 'ag-labor' },
  { id: '951', code: '951', name: '이자비용', type: '비용', groupId: 'ag-other-expense' },
  { id: '254', code: '254', name: '예수금', type: '부채', groupId: 'ag-liability' },
  { id: '293', code: '293', name: '장기차입금', type: '부채', groupId: 'ag-liability' },
] as AccountCode[];
const GROUPS: AccountGroup[] = [
  { id: 'ag-revenue', name: '총매출', type: '수익', plLine: 'revenue' },
  { id: 'ag-admin', name: '판관비', type: '비용', plLine: 'sgna' },
  { id: 'ag-labor', name: '노무비', type: '비용', plLine: 'cogs' },
  { id: 'ag-other-expense', name: '영업외비용', type: '비용', plLine: 'other-expense' },
  { id: 'ag-liability', name: '부채', type: '부채' },
] as AccountGroup[];

// 화면과 같은 식 — 대분류는 **하나만** 돌려준다(계층이 섞이면 안 된다)
const groupOf = (code: string) => GROUPS.find(x => x.id === CODES.find(c => c.code === code)?.groupId);
const bucketOf = (code: string): string | null => {
  const g = groupOf(code);
  const t = CODES.find(c => c.code === code)?.type;
  if (g?.plLine === 'revenue' || (!g?.plLine && t === '수익')) return '매출';
  if (g?.plLine === 'cogs' || g?.plLine === 'sgna' || g?.plLine === 'other-expense'
      || (!g?.plLine && t === '비용')) return '비용';
  if (t === '자산' || t === '부채' || t === '자본') return '자산·부채';
  return null;
};
/** 전표 하나 — 줄 중 하나라도 걸리면 잡힌다 */
const hits = (codes: string[], bucket: string) => codes.some(c => bucketOf(c) === bucket);
const hitsGroup = (codes: string[], name: string) => codes.some(c => groupOf(c)?.name === name);

describe('계층이 안 섞인다', () => {
  /**
   * 전에는 매출·비용·인건비·자산부채를 한 줄에 나란히 뒀다. 잘못이었다 —
   * 인건비는 비용의 **하위**고, 자산·부채는 손익이 아니라 재무상태표다.
   * 나란히 두면 [비용]과 [인건비]가 배타적으로 보이는데 실제로는 포함 관계다.
   */
  it('대분류는 셋 — 매출·비용·자산·부채', () => {
    const all = ['800', '515', '951', '254', '293'].map(bucketOf);
    expect(new Set(all.filter(Boolean))).toEqual(new Set(['매출', '비용', '자산·부채']));
  });

  it('계정 하나는 대분류 하나에만 든다', () => {
    expect(bucketOf('515')).toBe('비용');      // 인건비이면서 비용이 아니라, 비용이다
    expect(bucketOf('254')).toBe('자산·부채');
  });

  it('인건비는 비용 아래 중분류(노무비 그룹)다', () => {
    expect(bucketOf('515')).toBe('비용');
    expect(groupOf('515')?.name).toBe('노무비');
    expect(hitsGroup(['515'], '노무비')).toBe(true);
    expect(hitsGroup(['951'], '노무비')).toBe(false);
  });
});

describe('번호대로 가르면 틀린다', () => {
  it('800번대에 매출과 비용이 같이 있다', () => {
    expect(bucketOf('800')).toBe('매출');
    expect(bucketOf('818')).toBe('비용');   // 같은 800번대인데 비용
    expect(bucketOf('819')).toBe('비용');
  });
});

describe('복합 전표도 안 빠진다', () => {
  const 대출상환 = ['293', '951'];         // 출금전표 · 차입금 + 이자비용
  const 급여발생 = ['515', '254', '263'];   // 대체전표 · 급여 + 예수금 + 미지급급여

  it('대출상환이 비용에 잡힌다 — 이자비용 줄 때문에', () => {
    expect(hits(대출상환, '비용')).toBe(true);
  });

  it('대출상환이 자산·부채에도 잡힌다 — 차입금 줄 때문에', () => {
    expect(hits(대출상환, '자산·부채')).toBe(true);
  });

  it('대출상환을 비용 › 영업외비용으로 좁히면 잡히고, 노무비로 좁히면 안 잡힌다', () => {
    expect(hitsGroup(대출상환, '영업외비용')).toBe(true);
    expect(hitsGroup(대출상환, '노무비')).toBe(false);
  });

  it('급여 발생이 비용 › 노무비에 잡힌다 — 대체전표인데도', () => {
    expect(hits(급여발생, '비용')).toBe(true);
    expect(hitsGroup(급여발생, '노무비')).toBe(true);
  });

  it('매출전표는 비용이 아니다', () => {
    expect(hits(['800'], '비용')).toBe(false);
    expect(hits(['800'], '매출')).toBe(true);
  });
});
