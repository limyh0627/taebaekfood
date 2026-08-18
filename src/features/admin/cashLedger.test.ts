import { describe, it, expect } from 'vitest';
import {
  buildAccountLedger, totalCashOnHand, openBalance, unsettledStatements, unmatchedCash,
  buildPartnerLedger, partnerBalances, partnerOpenBalance, allocatePartnerCash,
} from './cashLedger';
import type { CashAccount, CashEntry, IssuedStatement, Settlement } from '../../shared/types';

const acct = (over: Partial<CashAccount> = {}): CashAccount => ({
  id: 'a1', name: '기업은행', type: '통장',
  openingBalance: 1_000_000, openingDate: '2026-07-01',
  active: true, createdAt: '', ...over,
});

const entry = (id: string, date: string, dir: '입금' | '출금', amount: number, over: Partial<CashEntry> = {}): CashEntry => ({
  id, date, cashAccountId: 'a1', dir, amount, createdAt: `${date}T00:00:00`, ...over,
});

const stmt = (id: string, type: '매출' | '매입', tradeDate: string, total: number): IssuedStatement =>
  ({ id, type, tradeDate, issuedAt: '', partnerId: 'p1', partnerName: '풍회유통', orderId: '', docNo: '',
     totalSupply: total, totalTax: 0, totalAmount: total, items: [] } as IssuedStatement);

const settle = (id: string, cashEntryId: string, statementId: string, amount: number): Settlement =>
  ({ id, cashEntryId, statementId, amount, createdAt: '' });

describe('buildAccountLedger', () => {
  const entries = [
    entry('e1', '2026-07-03', '입금', 3_000_000),
    entry('e2', '2026-07-08', '출금', 900_000),
    entry('e3', '2026-07-10', '출금', 1_200_000),
  ];

  it('기초잔액에서 시작해 행마다 잔액을 굴린다', () => {
    const l = buildAccountLedger(acct(), entries, '2026-07-01', '2026-07-31');
    expect(l.opening).toBe(1_000_000);
    expect(l.rows.map(r => r.balance)).toEqual([4_000_000, 3_100_000, 1_900_000]);
    expect(l.totalIn).toBe(3_000_000);
    expect(l.totalOut).toBe(2_100_000);
    expect(l.closing).toBe(1_900_000);
  });

  // 거래처원장이 못 하던 것 — 기간을 좁혀도 이전 거래가 이월잔액으로 넘어와야 한다.
  it('기간을 좁혀도 이월잔액 덕에 잔액이 틀어지지 않는다', () => {
    const l = buildAccountLedger(acct(), entries, '2026-07-09', '2026-07-31');
    expect(l.opening).toBe(3_100_000);          // 7/3 입금 + 7/8 출금이 이월로
    expect(l.rows).toHaveLength(1);             // 7/10 한 건만
    expect(l.closing).toBe(1_900_000);          // 전체 기간과 같은 기말잔액
  });

  it('openingDate 이전 거래는 무시한다(기초잔액에 이미 포함)', () => {
    const withOld = [entry('old', '2026-06-20', '입금', 999_999), ...entries];
    const l = buildAccountLedger(acct(), withOld, '2026-07-01', '2026-07-31');
    expect(l.closing).toBe(1_900_000);
    expect(l.rows.find(r => r.entry.id === 'old')).toBeUndefined();
  });

  it('다른 계좌 거래는 섞이지 않는다', () => {
    const other = [...entries, entry('x', '2026-07-05', '입금', 500_000, { cashAccountId: 'a2' })];
    const l = buildAccountLedger(acct(), other, '2026-07-01', '2026-07-31');
    expect(l.closing).toBe(1_900_000);
  });
});

describe('totalCashOnHand', () => {
  it('여러 계좌 잔액을 합산한다', () => {
    const accounts = [acct(), acct({ id: 'a2', name: '법인카드', type: '카드', openingBalance: 0 })];
    const entries = [
      entry('e1', '2026-07-03', '입금', 3_000_000),
      entry('e2', '2026-07-05', '출금', 200_000, { cashAccountId: 'a2' }),
    ];
    expect(totalCashOnHand(accounts, entries, '2026-07-31')).toBe(3_800_000);
  });

  it('asOf 이후 거래는 세지 않는다', () => {
    const entries = [entry('e1', '2026-07-20', '입금', 3_000_000)];
    expect(totalCashOnHand([acct()], entries, '2026-07-10')).toBe(1_000_000);
  });
});

describe('openBalance / unsettledStatements', () => {
  const s1 = stmt('s1', '매입', '2026-07-01', 5_000_000);
  const s2 = stmt('s2', '매입', '2026-07-05', 3_000_000);

  it('매칭된 만큼 미결제 잔액이 줄어든다', () => {
    const sets = [settle('t1', 'e1', 's1', 2_000_000)];
    expect(openBalance(s1, sets)).toBe(3_000_000);
  });

  // 한 번의 이체로 밀린 전표 여러 건을 상계 — 전표에 결제를 매달던 옛 구조로는 못 하던 것
  it('이체 1건이 전표 2건을 상계할 수 있다', () => {
    const sets = [settle('t1', 'e1', 's1', 5_000_000), settle('t2', 'e1', 's2', 1_000_000)];
    expect(openBalance(s1, sets)).toBe(0);
    expect(openBalance(s2, sets)).toBe(2_000_000);
    const open = unsettledStatements([s1, s2], sets, { type: '매입' });
    expect(open.map(o => o.stmt.id)).toEqual(['s2']);
  });

  it('매칭이 없으면 전액이 미결제로 남는다 — 결제 근거는 자금원장뿐이다', () => {
    expect(openBalance(s1, [])).toBe(5_000_000);
  });
});

describe('unmatchedCash', () => {
  it('이체 금액 중 아직 전표에 안 붙은 잔액', () => {
    const e = entry('e1', '2026-07-09', '출금', 5_000_000);
    expect(unmatchedCash(e, [settle('t1', 'e1', 's1', 3_000_000)])).toBe(2_000_000);
  });
});

describe('buildPartnerLedger', () => {
  const s1 = { ...stmt('s1', '매입', '2026-06-26', 9_315_000), docNo: 'P-001' } as IssuedStatement;
  const s2 = { ...stmt('s2', '매입', '2026-07-07', 9_315_000), docNo: 'P-002' } as IssuedStatement;

  it('전표는 더하고 결제는 빼며 잔액을 굴린다', () => {
    const cash = [entry('c1', '2026-07-03', '출금', 5_000_000)];
    const sets = [settle('t1', 'c1', 's1', 5_000_000)];
    const l = buildPartnerLedger('p1', '매입', [s1, s2], cash, sets);
    expect(l.rows.map(r => r.balance)).toEqual([9_315_000, 4_315_000, 13_630_000]);
    expect(l.accrued).toBe(18_630_000);
    expect(l.paid).toBe(5_000_000);
    expect(l.balance).toBe(13_630_000);  // 아직 줄 돈
  });

  // 6월 전표를 안 빼먹어야 한다 — 옛 화면은 조회 기간 밖 전표를 못 봐서 잔액이 0부터 시작했다.
  it('과거 전표가 잔액에 그대로 반영된다', () => {
    const l = buildPartnerLedger('p1', '매입', [s1, s2], [], []);
    expect(l.balance).toBe(18_630_000);
  });

  it('결제 행은 전부 자금원장에서 온다 — 전표에 매다는 경로는 없앴다', () => {
    const cash = [entry('c1', '2026-07-03', '출금', 2_000_000), entry('c2', '2026-07-05', '출금', 3_000_000)];
    const sets = [settle('t1', 'c1', 's1', 2_000_000), settle('t2', 'c2', 's1', 3_000_000)];
    const l = buildPartnerLedger('p1', '매입', [s1], cash, sets);
    expect(l.rows.map(r => r.source)).toEqual([undefined, 'cash', 'cash']);
    expect(l.paid).toBe(5_000_000);
    expect(l.balance).toBe(4_315_000);   // 9,315,000 − 5,000,000
  });

  it('자금 기록이 지워진 매칭은 상계로 치지 않는다', () => {
    const sets = [settle('t1', 'ghost', 's1', 5_000_000)];
    const l = buildPartnerLedger('p1', '매입', [s1], [], sets);
    expect(l.balance).toBe(9_315_000);
  });

  it('다른 거래처·다른 타입은 섞이지 않는다', () => {
    const other = { ...stmt('s9', '매입', '2026-07-01', 1_000_000), partnerId: 'p2' } as IssuedStatement;
    const sale = stmt('s8', '매출', '2026-07-01', 500_000);
    const l = buildPartnerLedger('p1', '매입', [s1, other, sale], [], []);
    expect(l.rows).toHaveLength(1);
    expect(l.balance).toBe(9_315_000);
  });
});

describe('partnerBalances', () => {
  it('거래처별 잔액을 큰 순으로 준다', () => {
    const a = { ...stmt('a1', '매입', '2026-07-01', 5_000_000), partnerId: 'pA', partnerName: '풍회유통' } as IssuedStatement;
    const b = { ...stmt('b1', '매입', '2026-07-02', 8_000_000), partnerId: 'pB', partnerName: '청정식품' } as IssuedStatement;
    const rows = partnerBalances('매입', [a, b], [], []);
    expect(rows.map(r => r.partnerName)).toEqual(['청정식품', '풍회유통']);
    expect(rows[0].balance).toBe(8_000_000);
  });

  // 실제 DB에 partnerName이 비어 있는 전표가 있다 — 여기서 터지면 안 된다.
  it('partnerName이 비어 있어도 죽지 않는다', () => {
    const nameless = { ...stmt('n1', '매입', '2026-07-01', 1_000), partnerId: 'pX', partnerName: null } as unknown as IssuedStatement;
    const rows = partnerBalances('매입', [nameless], [], []);
    expect(rows[0].partnerName).toBe('(이름없음)');
    expect(() => rows[0].partnerName.includes('x')).not.toThrow();
  });
});

/**
 * 거래처 잔액 — 화면 세 곳이 같은 값을 내야 한다.
 * 전표별 잔액을 더한 뒤 수금을 또 빼서 알이네식품 미수가 음수가 되고
 * 목록에서 사라진 적이 있다(2026-08-16).
 */
describe('partnerOpenBalance', () => {
  const sale = (id: string, total: number) => stmt(id, '매출', '2026-08-01', total);
  const cash = (id: string, amount: number, code: string, dir: '입금' | '출금' = '입금') =>
    entry(id, '2026-08-05', dir, amount, { partnerId: 'p1', accountCode: code });

  it('청구액 합계 − 수금. 수금을 두 번 빼면 안 된다', () => {
    // 알이네식품: 청구 10,321,000 / 수금 5,895,000 → 미수 4,426,000
    const st = [sale('s1', 5_895_000), sale('s2', 500_000), sale('s3', 3_926_000)];
    const ce = [cash('c1', 4_000_000, '108'), cash('c2', 1_895_000, '108')];
    expect(partnerOpenBalance('p1', '매출', st, ce)).toBe(4_426_000);
  });

  it('108/251이 아닌 자금은 잔액을 안 건드린다 — 계정이 틀리면 미수가 안 준다', () => {
    const st = [sale('s1', 1_000_000)];
    expect(partnerOpenBalance('p1', '매출', st, [cash('c1', 400_000, '375')])).toBe(1_000_000);
    expect(partnerOpenBalance('p1', '매출', st, [cash('c1', 400_000, '108')])).toBe(600_000);
  });

  it('반대 방향은 되돌림으로 친다(반품·환불)', () => {
    const st = [sale('s1', 1_000_000)];
    const ce = [cash('c1', 400_000, '108'), cash('c2', 100_000, '108', '출금')];
    expect(partnerOpenBalance('p1', '매출', st, ce)).toBe(700_000);
  });

  it('매입은 251·출금으로 본다', () => {
    const st = [stmt('b1', '매입', '2026-08-01', 3_000_000)];
    const ce = [cash('c1', 1_000_000, '251', '출금'), cash('c2', 500_000, '108')];
    expect(partnerOpenBalance('p1', '매입', st, ce)).toBe(2_000_000);
  });

  it('더 받았으면 음수 — 선수금', () => {
    expect(partnerOpenBalance('p1', '매출', [sale('s1', 100_000)], [cash('c1', 300_000, '108')])).toBe(-200_000);
  });

  it('여러 줄(lines) 자금도 해당 계정 줄만 본다', () => {
    const st = [sale('s1', 1_000_000)];
    const ce = [entry('c1', '2026-08-05', '입금', 500_000, {
      partnerId: 'p1',
      lines: [{ accountCode: '108', amount: 300_000 }, { accountCode: '259', amount: 200_000 }],
    })];
    expect(partnerOpenBalance('p1', '매출', st, ce)).toBe(700_000);
  });
});

/**
 * 전표별 배분 — 지정 매칭이 먼저, 나머지는 오래된 순.
 * 어느 청구서를 갚았는지가 틀려도 **거래처 잔액은 안 흔들려야 한다**(그게 payments[]의 교훈).
 */
describe('allocatePartnerCash', () => {
  const s1 = stmt('s1', '매출', '2026-07-01', 1_000_000);
  const s2 = stmt('s2', '매출', '2026-08-01', 2_000_000);
  const cash = (id: string, amount: number, over = {}) =>
    entry(id, '2026-08-05', '입금', amount, { partnerId: 'p1', accountCode: '108', ...over });

  it('지정이 없으면 오래된 전표부터 채운다', () => {
    const m = allocatePartnerCash('p1', '매출', [s1, s2], [cash('c1', 1_500_000)], []);
    expect(m.get('s1')).toBe(0);
    expect(m.get('s2')).toBe(1_500_000);
  });

  it('지정한 전표를 먼저 채우고 남는 돈만 오래된 순으로 간다', () => {
    const m = allocatePartnerCash('p1', '매출', [s1, s2], [cash('c1', 1_500_000)],
      [settle('t1', 'c1', 's2', 1_200_000)]);
    expect(m.get('s2')).toBe(800_000);    // 지정 1,200,000
    expect(m.get('s1')).toBe(700_000);    // 남은 300,000이 오래된 것으로
  });

  it('배분 합계는 늘 거래처 잔액과 같다 — 지정을 해도 총액은 안 변한다', () => {
    const ce = [cash('c1', 1_500_000)];
    const sum = (sets: ReturnType<typeof settle>[]) =>
      [...allocatePartnerCash('p1', '매출', [s1, s2], ce, sets).values()].reduce((a, b) => a + b, 0);
    const bal = partnerOpenBalance('p1', '매출', [s1, s2], ce);
    expect(sum([])).toBe(bal);
    expect(sum([settle('t1', 'c1', 's2', 1_200_000)])).toBe(bal);
  });

  it('근거(자금기록)가 사라진 매칭은 안 친다 — 안 받은 돈이 사라지면 안 된다', () => {
    const m = allocatePartnerCash('p1', '매출', [s1, s2], [], [settle('t1', 'ghost', 's1', 1_000_000)]);
    expect(m.get('s1')).toBe(1_000_000);
  });

  it('지정이 전표 금액을 넘어도 전표 잔액이 음수가 되지 않는다', () => {
    const m = allocatePartnerCash('p1', '매출', [s1], [cash('c1', 1_000_000)],
      [settle('t1', 'c1', 's1', 9_999_999)]);
    expect(m.get('s1')).toBe(0);
  });

  it('수금이 없으면 전부 청구액 그대로', () => {
    const m = allocatePartnerCash('p1', '매출', [s1, s2], [], []);
    expect(m.get('s1')).toBe(1_000_000);
    expect(m.get('s2')).toBe(2_000_000);
  });
});
