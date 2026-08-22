import { describe, it, expect } from 'vitest';
import { listVouchers, voucherOfStatement, voucherOfCashEntry, vouchersOfMonth } from './vouchers';
import type { CashEntry, IssuedStatement } from './types';

/**
 * 전표는 한 분류다 — 매출·매입·대체·입금·출금은 그 안의 갈래다.
 * 담기는 컬렉션이 둘로 갈려 있어서 화면마다 따로 모으다 한쪽을 빠뜨렸다.
 * 모으는 자리를 여기 하나로 두고, 그 약속을 못 박는다.
 */
const stmt = (o: Partial<IssuedStatement>): IssuedStatement => ({
  id: 'stmt-1787000000000', issuedAt: '2026-08-19T08:00:00.000Z', tradeDate: '2026-08-19',
  type: '매출', partnerId: 'p1', partnerName: '가득찬식품', orderId: '', docNo: '260819-01',
  totalSupply: 100, totalTax: 0, totalAmount: 100,
  items: [{ name: '참기름', spec: '', qty: 1, price: 100, supply: 100, tax: 0, total: 100, isTaxExempt: true, accountCode: '800' }],
  ...o,
} as IssuedStatement);
const cash = (o: Partial<CashEntry>): CashEntry => ({
  id: 'cash-1787000000001', date: '2026-08-19', cashAccountId: '', dir: '출금', amount: 50,
  accountCode: '951', note: '수협 (이자)', createdAt: '2026-08-19T09:00:00.000Z',
  ...o,
} as CashEntry);

describe('갈래', () => {
  it('거래명세서는 매출·매입 그대로', () => {
    expect(voucherOfStatement(stmt({})).kind).toBe('매출');
    expect(voucherOfStatement(stmt({ type: '매입' })).kind).toBe('매입');
  });

  it("옛 '비용' 전표는 대체다 — 현금도 상대도 없이 차·대를 세운 것", () => {
    expect(voucherOfStatement(stmt({ type: '비용' })).kind).toBe('대체');
  });

  it('자금기록은 입금·출금·대체 그대로', () => {
    expect(voucherOfCashEntry(cash({ dir: '입금' })).kind).toBe('입금');
    expect(voucherOfCashEntry(cash({ dir: '대체' })).kind).toBe('대체');
  });
});

describe('모으기', () => {
  const s = stmt({});
  const c = cash({});

  it('두 컬렉션이 한 목록으로 선다', () => {
    expect(listVouchers([s], [c]).map(v => v.kind)).toEqual(['매출', '출금']);
  });

  it('시각순 — 소급 전표는 그날 맨 뒤', () => {
    const 소급 = cash({ id: 'cash-1787999999999', createdAt: '2026-08-19T14:59:59.000Z', note: '소급' });
    const 낮 = cash({ id: 'cash-1787000000002', createdAt: '2026-08-19T02:00:00.000Z', note: '낮' });
    expect(listVouchers([], [소급, 낮]).map(v => v.memo)).toEqual(['낮', '소급']);
  });

  it('같은 시각이면 전표가 먼저 — 발생하고 나서 갚는다', () => {
    const 같은시각 = cash({ createdAt: '2026-08-19T08:00:00.000Z' });
    expect(listVouchers([s], [같은시각]).map(v => v.source)).toEqual(['statement', 'cash']);
  });

  it('회사로 가른다 — 두 사업자 장부가 섞이면 안 된다', () => {
    const 풍회 = stmt({ id: 'stmt-2', companyId: 'punghoe' });
    expect(listVouchers([s, 풍회], [], { companyId: 'taebaek' }).map(v => v.id)).toEqual([s.id]);
    expect(listVouchers([s, 풍회], [], { companyId: 'punghoe' }).map(v => v.id)).toEqual(['stmt-2']);
  });

  it('갈래로 거른다', () => {
    expect(listVouchers([s], [c], { kinds: ['출금'] }).map(v => v.kind)).toEqual(['출금']);
  });

  it('달로 거른다 — 자금전표도 같이 걸러진다(빠뜨리던 자리)', () => {
    const 지난달 = cash({ id: 'cash-1786000000000', date: '2026-07-19' });
    const got = vouchersOfMonth([s], [c, 지난달], '2026-08');
    expect(got.map(v => v.id)).toEqual([s.id, c.id]);
  });
});

describe('줄', () => {
  it('전표 품목이 그대로 줄이 된다', () => {
    expect(voucherOfStatement(stmt({})).lines).toEqual([{ accountCode: '800', name: '참기름', amount: 100 }]);
  });

  it('자금전표는 계정 한 줄로 편다 — 갈래가 달라도 모양은 같다', () => {
    expect(voucherOfCashEntry(cash({})).lines).toEqual([{ accountCode: '951', name: '수협 (이자)', amount: 50 }]);
  });

  it('여러 줄짜리 자금전표(대출상환)는 줄을 그대로 가져온다', () => {
    const 상환 = cash({ accountCode: undefined, amount: 300, lines: [
      { accountCode: '293', amount: 200, note: '원금' },
      { accountCode: '951', amount: 100, note: '이자' },
    ] });
    expect(voucherOfCashEntry(상환).lines).toEqual([
      { accountCode: '293', name: '원금', amount: 200 },
      { accountCode: '951', name: '이자', amount: 100 },
    ]);
  });

  it('자금전표엔 문서번호가 없다 — 지어내지 않는다', () => {
    expect(voucherOfCashEntry(cash({})).docNo).toBeUndefined();
  });
});

describe('갈래는 다섯뿐 — 줄이 여럿이어도 하나다', () => {
  /**
   * "여러 줄이면 대체전표"는 틀렸다. 3전표제에서 출금전표의 정의는 **대변이 현금 하나**다.
   *   대출상환  (차) 293 차입금 + 951 이자비용  /  (대) 통장
   * 차변이 둘이어도 통장에서 나갔으니 출금전표다. 대체는 **현금이 안 움직인** 거래다.
   *
   * 갈래를 늘리면(수금·지불·이체…) 한 전표가 여러 갈래에 걸쳐 어느 필터에도 안 잡힌다.
   */
  const 상환: CashEntry = {
    id: 'cash-loan', date: '2026-08-12', cashAccountId: '', dir: '출금', amount: 3_064_357,
    partnerId: 'p', partnerName: '중진공', note: '중진공 원리금 상환',
    lines: [
      { accountCode: '293', amount: 2_770_000, note: '원금' },
      { accountCode: '951', amount: 294_357, note: '이자' },
    ],
    createdAt: '2026-08-12T14:59:59.000Z',
  } as CashEntry;

  it('줄이 둘이어도 출금전표다 — 통장에서 나갔으니까', () => {
    expect(voucherOfCashEntry(상환).kind).toBe('출금');
  });

  it('줄은 그대로 실려 온다 — 원금·이자가 한 전표 안에서 갈린다', () => {
    expect(voucherOfCashEntry(상환).lines).toEqual([
      { accountCode: '293', name: '원금', amount: 2_770_000 },
      { accountCode: '951', name: '이자', amount: 294_357 },
    ]);
  });

  it('대체는 돈이 안 움직인 것 — 상계처럼', () => {
    const 상계 = { ...상환, dir: '대체', lines: [
      { accountCode: '251', amount: 100 }, { accountCode: '108', amount: -100 },
    ] } as CashEntry;
    expect(voucherOfCashEntry(상계).kind).toBe('대체');
  });

  it('갈래는 정확히 다섯 — 늘리면 한 전표가 여러 곳에 걸린다', () => {
    const kinds = ['매출', '매입', '대체', '입금', '출금'];
    expect(new Set(kinds).size).toBe(5);
    expect(kinds).not.toContain('수금');   // 입금 아래다
    expect(kinds).not.toContain('지불');   // 출금 아래다
  });
});
