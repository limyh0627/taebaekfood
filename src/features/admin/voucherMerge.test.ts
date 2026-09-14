import { describe, it, expect } from 'vitest';
import { mergeStatements, voucheredOrderIds, canSettleStatement, settleStatus } from './voucherMerge';
import type { IssuedStatement } from '../../shared/types';

/**
 * 전표 화면이 딛고 선 셈 셋. `useVoucherLedger` 안에 갇혀 있어 여태 그물이 없었는데
 * (2026-09-03 커버리지 0%) 셋 다 **실제로 한 번씩 물린 자리**다.
 */
const 전표 = (over: Partial<IssuedStatement> = {}): IssuedStatement => ({
  id: 's1', issuedAt: '', tradeDate: '2026-08-10', type: '매출',
  partnerId: 'p1', partnerName: '가득찬식품', orderId: '', docNo: '260810-01',
  totalSupply: 1_000_000, totalTax: 0, totalAmount: 1_000_000,
  items: [{ name: '참기름', spec: '', qty: 1, price: 1_000_000, supply: 1_000_000, tax: 0, total: 1_000_000, isTaxExempt: true, accountCode: '800' }],
  ...over,
} as unknown as IssuedStatement);

describe('세 갈래로 떠온 전표를 합친다', () => {
  it('**구독분이 이긴다** — 순서가 뒤집히면 방금 고친 전표가 옛 스냅샷으로 덮인다', () => {
    const 옛것 = 전표({ id: 'a', totalAmount: 100 });
    const 조회 = 전표({ id: 'a', totalAmount: 200 });
    const 최신 = 전표({ id: 'a', totalAmount: 300 });
    const r = mergeStatements({ anchor: [옛것], extra: [조회], live: [최신], companyId: 'taebaek' });
    expect(r).toHaveLength(1);
    expect(r[0].totalAmount).toBe(300);
  });

  it('조회분이 앵커분을 이긴다 — 중간 순서도 지킨다', () => {
    const r = mergeStatements({
      anchor: [전표({ id: 'a', totalAmount: 100 })],
      extra: [전표({ id: 'a', totalAmount: 200 })],
      companyId: 'taebaek',
    });
    expect(r[0].totalAmount).toBe(200);
  });

  it('갈래가 달라도 한 줄씩 다 담긴다', () => {
    const r = mergeStatements({
      anchor: [전표({ id: 'a' })], extra: [전표({ id: 'b' })], live: [전표({ id: 'c' })],
      companyId: 'taebaek',
    });
    expect(r.map(s => s.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('**지운 전표는 다시 떠와도 안 되살아난다** — 스냅샷은 삭제가 저절로 안 비친다', () => {
    const r = mergeStatements({
      anchor: [전표({ id: 'a' })], extra: [전표({ id: 'a' })], live: [전표({ id: 'a' })],
      deletedIds: ['a'], companyId: 'taebaek',
    });
    expect(r).toHaveLength(0);
  });

  it('회사가 다르면 뺀다 — 태백 화면에 풍회 전표가 섞이면 잔액이 틀어진다', () => {
    const r = mergeStatements({
      live: [전표({ id: 'a', companyId: 'taebaek' } as never), 전표({ id: 'b', companyId: 'punghoe' } as never)],
      companyId: 'taebaek',
    });
    expect(r.map(s => s.id)).toEqual(['a']);
  });

  it('**회사가 안 붙은 옛 전표는 태백 것으로 본다** — 안 그러면 옛 전표가 통째로 사라진다', () => {
    const r = mergeStatements({ live: [전표({ id: 'a' })], companyId: 'taebaek' });
    expect(r).toHaveLength(1);
    expect(mergeStatements({ live: [전표({ id: 'a' })], companyId: 'punghoe' })).toHaveLength(0);
  });

  it('아무것도 없으면 빈 목록 — 터지지 않는다', () => {
    expect(mergeStatements({ companyId: 'taebaek' })).toEqual([]);
  });
});

describe('전표가 걸린 주문 id', () => {
  it('**한 전표가 여러 주문을 묶으면 갈라 담는다** — 쉼표로 이어 붙인다', () => {
    expect([...voucheredOrderIds([{ orderId: 'o1,o2,o3' }])].sort()).toEqual(['o1', 'o2', 'o3']);
  });
  it('공백으로 갈라도 읽는다', () => {
    expect([...voucheredOrderIds([{ orderId: 'o1 o2' }, { orderId: 'o3, o4' }])].sort()).toEqual(['o1', 'o2', 'o3', 'o4']);
  });
  it('빈 값은 안 담는다 — 빈 문자열이 들어가면 주문 없는 전표가 모든 주문을 가린다', () => {
    expect(voucheredOrderIds([{ orderId: '' }, { orderId: ',,' }, {} as never]).size).toBe(0);
  });
  it('같은 주문이 두 전표에 걸려도 한 번만', () => {
    expect(voucheredOrderIds([{ orderId: 'o1' }, { orderId: 'o1,o2' }]).size).toBe(2);
  });
});

describe('수금·지불 버튼을 달 전표인가', () => {
  /**
   * 예전엔 `남은금액 > 0` 하나로 봤다. 남은금액은 배분에 없으면 총액으로 물러서므로,
   * 갚을 상대가 없는 전표까지 전액 미결제로 잡혀 지불처리 버튼이 붙었다(비용 25건).
   */
  it('매출·매입은 남은 게 있으면 단다', () => {
    expect(canSettleStatement(전표({ type: '매출' }), 500)).toBe(true);
    expect(canSettleStatement(전표({ type: '매입' }), 500)).toBe(true);
  });

  it('다 갚았으면 안 단다', () => {
    expect(canSettleStatement(전표({ type: '매출' }), 0)).toBe(false);
    expect(canSettleStatement(전표({ type: '매출' }), -100)).toBe(false);
  });

  it('**갚을 상대가 없는 전표엔 안 단다** — 감가상각·급여는 낼 데가 없다', () => {
    const 감가상각 = 전표({ type: '비용', partnerId: '', partnerName: '감가상각',
      items: [{ name: '감가상각비', spec: '', qty: 1, price: 100, supply: 100, tax: 0, total: 100, isTaxExempt: true, accountCode: '818' }] } as never);
    expect(canSettleStatement(감가상각, 100)).toBe(false);
  });

  it('**기초이월은 type 이 비용이어도 단다** — 실제로 갚아야 할 것이다', () => {
    //  기초 전표는 차·대를 줄마다 `side` 로 박는다. 그게 없으면 채무로 안 잡힌다 —
    //  실제로 `cashLedger.test.ts:20` 에도 같은 함정이 적혀 있다.
    const 기초 = 전표({ id: 'open', type: '비용', docNo: '기초260731-01', partnerId: 'p1',
      items: [{ name: '기초 미지급', spec: '', qty: 1, price: 500, supply: 500, tax: 0, total: 500, isTaxExempt: true, accountCode: '251', side: '대변' }] } as never);
    expect(canSettleStatement(기초, 500)).toBe(true);
  });

  it('기초 전표라도 채권·채무 계정이 아니면 안 단다 — 이름이 아니라 계정이 근거다', () => {
    const 기초비용 = 전표({ id: 'open2', type: '비용', docNo: '기초260731-02', partnerId: 'p1',
      items: [{ name: '기초 소모품', spec: '', qty: 1, price: 500, supply: 500, tax: 0, total: 500, isTaxExempt: true, accountCode: '830', side: '차변' }] } as never);
    expect(canSettleStatement(기초비용, 500)).toBe(false);
  });
});

/**
 * 수금·지불이 어디까지 됐나(2026-09-15 사장님: "수금 상태 (미수 / 완료 / 부분수금)").
 * 전에는 `수금처리` 단추가 붙었는지로만 짐작해야 했다 — 단추가 없으면 다 낸 것인지
 * 애초에 받을 것이 없는 전표인지 가릴 수 없었다.
 */
describe('수금·지불 상태', () => {
  //  채권·채무 판정(`isReceivableStmt`)은 분개를 먼저 보고, 분개가 안 서면 줄의 `side` 로
  //  물러선다. 붙박이 값이 얇으면 분개가 안 서므로 **`side` 를 적어 그 길을 탄다.**
  const 매출 = (over: Record<string, unknown> = {}) =>
    ({ id: 's1', type: '매출', totalAmount: 100000, items: [{ accountCode: '108', side: '차변' }], ...over } as never);
  const 매입 = (over: Record<string, unknown> = {}) =>
    ({ id: 's2', type: '매입', totalAmount: 100000, items: [{ accountCode: '251', side: '대변' }], ...over } as never);

  it('남은 게 없으면 완료', () => {
    expect(settleStatus(매출(), 0)).toEqual({ state: 'done', label: '완료' });
    expect(settleStatus(매출(), -1)).toEqual({ state: 'done', label: '완료' });
  });

  it('손댄 적 없으면 미수 — 매입은 미지급이라 부른다', () => {
    expect(settleStatus(매출(), 100000)).toEqual({ state: 'open', label: '미수' });
    expect(settleStatus(매입(), 100000)).toEqual({ state: 'open', label: '미지급' });
  });

  it('일부만 받았으면 부분수금 — 매입은 부분지급', () => {
    expect(settleStatus(매출(), 40000)).toEqual({ state: 'partial', label: '부분수금' });
    expect(settleStatus(매입(), 40000)).toEqual({ state: 'partial', label: '부분지급' });
  });

  it('총액보다 많이 남으면 부분이라 하지 않는다 — 손댄 적 없는 것이다', () => {
    expect(settleStatus(매출(), 200000).state).toBe('open');
  });

  it('채권·채무를 안 세우는 전표는 해당없음 — 감가상각·급여처럼 갚을 상대가 없다', () => {
    const 비용 = { id: 's3', type: '비용', totalAmount: 50000, items: [{ accountCode: '818' }] } as never;
    expect(settleStatus(비용, 50000)).toEqual({ state: 'none', label: '—' });
  });
});
