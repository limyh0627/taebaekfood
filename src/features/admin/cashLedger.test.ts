import { describe, it, expect } from 'vitest';
import {
  buildAccountLedger, totalCashOnHand, openBalance, unsettledStatements, unmatchedCash,
  buildPartnerLedger, partnerBalances,
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

  // 한 번의 이체로 밀린 전표 여러 건을 상계 — 지금 payments[] 구조로는 못 하던 것
  it('이체 1건이 전표 2건을 상계할 수 있다', () => {
    const sets = [settle('t1', 'e1', 's1', 5_000_000), settle('t2', 'e1', 's2', 1_000_000)];
    expect(openBalance(s1, sets)).toBe(0);
    expect(openBalance(s2, sets)).toBe(2_000_000);
    const open = unsettledStatements([s1, s2], sets, { type: '매입' });
    expect(open.map(o => o.stmt.id)).toEqual(['s2']);
  });

  it('구 payments[]도 상계로 인정한다(이관 전 병행)', () => {
    const legacy = { ...s1, payments: [{ id: 'p1', amount: 5_000_000, date: '2026-07-02' }] } as IssuedStatement;
    expect(openBalance(legacy, [])).toBe(0);
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

  it('구 payments[]와 자금원장 매칭을 한 타임라인으로 합친다', () => {
    const withPay = { ...s1, payments: [{ id: 'p1', amount: 3_000_000, date: '2026-06-30' }] } as IssuedStatement;
    const cash = [entry('c1', '2026-07-03', '출금', 2_000_000)];
    const sets = [settle('t1', 'c1', 's1', 2_000_000)];
    const l = buildPartnerLedger('p1', '매입', [withPay], cash, sets);
    expect(l.rows.map(r => r.source)).toEqual([undefined, 'payments', 'cash']);
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
