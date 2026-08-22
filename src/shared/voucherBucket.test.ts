import { describe, it, expect } from 'vitest';
import type { AccountCode, AccountGroup } from './types';

/**
 * 성격 대분류 필터 — **줄의 계정으로 거른다.**
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

// 화면과 같은 식
const bucketOf = (code: string): string[] => {
  const g = GROUPS.find(x => x.id === CODES.find(c => c.code === code)?.groupId);
  const t = CODES.find(c => c.code === code)?.type;
  const out: string[] = [];
  if (g?.plLine === 'revenue' || (!g?.plLine && t === '수익')) out.push('매출');
  if (g?.plLine === 'cogs' || g?.plLine === 'sgna' || g?.plLine === 'other-expense'
      || (!g?.plLine && t === '비용')) out.push('비용');
  if (g?.name === '노무비' || code === '254' || code === '263') out.push('인건비');
  if (t === '자산' || t === '부채' || t === '자본') out.push('자산·부채');
  return out;
};
/** 전표 하나 — 줄 중 하나라도 걸리면 잡힌다 */
const hits = (codes: string[], bucket: string) => codes.some(c => bucketOf(c).includes(bucket));

describe('번호대로 가르면 틀린다', () => {
  it('800번대에 매출과 비용이 같이 있다', () => {
    expect(bucketOf('800')).toContain('매출');
    expect(bucketOf('818')).toContain('비용');   // 같은 800번대인데 비용
    expect(bucketOf('819')).toContain('비용');
    expect(bucketOf('818')).not.toContain('매출');
  });
});

describe('복합 전표도 안 빠진다', () => {
  const 대출상환 = ['293', '951'];      // 출금전표 · 차입금 + 이자비용
  const 급여발생 = ['515', '254', '263'];  // 대체전표 · 급여 + 예수금 + 미지급급여

  it('대출상환이 비용에 잡힌다 — 이자비용 줄 때문에', () => {
    expect(hits(대출상환, '비용')).toBe(true);
  });

  it('대출상환이 자산·부채에도 잡힌다 — 차입금 줄 때문에', () => {
    expect(hits(대출상환, '자산·부채')).toBe(true);
  });

  it('급여 발생이 인건비에 잡힌다 — 대체전표인데도', () => {
    expect(hits(급여발생, '인건비')).toBe(true);
  });

  it('대출상환은 인건비가 아니다', () => {
    expect(hits(대출상환, '인건비')).toBe(false);
  });

  it('매출전표는 비용이 아니다', () => {
    expect(hits(['800'], '비용')).toBe(false);
    expect(hits(['800'], '매출')).toBe(true);
  });
});

describe('겹치는 건 겹치는 대로', () => {
  it('급여는 비용이면서 인건비다 — 필터는 렌즈지 칸막이가 아니다', () => {
    expect(bucketOf('515')).toEqual(expect.arrayContaining(['비용', '인건비']));
  });
});
