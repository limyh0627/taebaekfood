import { describe, it, expect } from 'vitest';
import type { Partner, PartnerType } from './types';

/**
 * 금융기관은 **사고파는 상대가 아니다.** 매입처로 두면 발주·입고·매입전표 거래처 목록에
 * 은행이 섞인다. 화면들이 쓰는 필터 식을 그대로 옮겨 두고, 새 갈래가 거기 안 걸리는지 본다.
 */
const p = (name: string, partnerType?: PartnerType): Partner =>
  ({ id: name, name, type: '일반', partnerType } as Partner);

// 화면에 흩어져 있는 필터와 **같은 식**
const 매입처 = (c: Partner) => c.partnerType === '매입처' || c.partnerType === '매출+매입처';
const 매출처 = (c: Partner) => !c.partnerType || c.partnerType === '매출처' || c.partnerType === '매출+매입처';

const 목록 = [
  p('가득찬식품', '매출처'),
  p('한국농수산물유통공사', '매입처'),
  p('풍회유통', '매출+매입처'),
  p('농협', '금융기관'),
  p('옛거래처'),                 // partnerType 없음 = 매출처(하위 호환)
];

describe('금융기관 갈래', () => {
  it('매입처 목록에 안 뜬다 — 발주·입고·매입전표', () => {
    expect(목록.filter(매입처).map(c => c.name)).toEqual(['한국농수산물유통공사', '풍회유통']);
  });

  it('매출처 목록에 안 뜬다 — 주문 생성·매출전표', () => {
    expect(목록.filter(매출처).map(c => c.name)).toEqual(['가득찬식품', '풍회유통', '옛거래처']);
  });

  it('갈래 없는 옛 거래처는 여전히 매출처로 본다 — 하위 호환', () => {
    expect(매출처(p('옛거래처'))).toBe(true);
    expect(매입처(p('옛거래처'))).toBe(false);
  });

  it('일반전표는 전체에서 고르므로 은행도 보인다 — 대출상환·이자', () => {
    expect(목록.some(c => c.name === '농협')).toBe(true);
  });

  /**
   * 거래처 관리에서 **만들 수는 있는데 고르거나 거를 수는 없으면** 갈래가 반쪽이다.
   * 실제로 추가 화면(AddPartnerModal)에만 금융기관이 있고 수정 폼·필터 탭엔 빠져 있었다 —
   * 잘못 넣은 은행을 고치려 해도 목록에 그 갈래가 없어 되돌릴 방법이 없었다.
   */
  it('거래처 구분은 네 갈래 전부 — 만들기·수정·거르기가 같은 목록을 쓴다', () => {
    const 갈래: PartnerType[] = ['매출처', '매입처', '매출+매입처', '금융기관'];
    expect(갈래).toContain('금융기관');
    expect(new Set(갈래).size).toBe(4);
  });

  it('금융기관은 채널(일반·택배·스마트스토어)을 안 쓴다 — 파는 상대가 아니다', () => {
    const 은행 = p('수협은행', '금융기관');
    expect(매출처(은행)).toBe(false);
    expect(매입처(은행)).toBe(false);
  });
});

describe('같은 계정을 쓰는 템플릿이 여럿일 때', () => {
  // 리스료가 둘(기본·안사장) 다 819를 쓴다. 계정만으로 되찾으면 먼저 오는 게 잡힌다.
  const list = [
    { id: 'fct-builtin-lease', label: '리스료', mode: '일반', accountCode: '819', amount: 2344300 },
    { id: 'fct-1787222602711', label: '리스료 (안사장)', mode: '일반', accountCode: '819', amount: 1268550 },
  ] as { id: string; label: string; mode: string; accountCode: string; amount: number }[];

  /** 옛 방식 — 계정으로 되찾는다 */
  const byCode = (accountCode: string) => list.find(t => t.accountCode === accountCode)?.id ?? null;
  /** 지금 방식 — 고른 id를 붙든다 */
  const byPicked = (pickedId: string | null, accountCode: string) =>
    (pickedId ? list.find(t => t.id === pickedId)?.id : undefined) ?? byCode(accountCode);

  it('계정으로 되찾으면 안사장을 골라도 기본이 잡힌다 — 고친 이유', () => {
    expect(byCode('819')).toBe('fct-builtin-lease');
  });

  it('고른 id를 붙들면 고른 그대로다', () => {
    expect(byPicked('fct-1787222602711', '819')).toBe('fct-1787222602711');
    expect(byPicked('fct-builtin-lease', '819')).toBe('fct-builtin-lease');
  });

  it('고른 게 없으면(전표 수정 등) 계정으로 짐작한다', () => {
    expect(byPicked(null, '819')).toBe('fct-builtin-lease');
  });
});
