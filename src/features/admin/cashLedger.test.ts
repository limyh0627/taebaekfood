import { describe, it, expect } from 'vitest';
import {
  buildAccountLedger, totalCashOnHand, openBalance, unsettledStatements, unmatchedCash, buildPartnerLedger, partnerBalances, partnerOpenBalance, allocatePartnerCash, partnerBalanceFromJournals, partnerCarryOver, allPartnerBalances, partnerCashParts,
} from './cashLedger';
import type { AccountCode, CashAccount, CashEntry, IssuedStatement, Settlement, JournalEntry } from '../../shared/types';
import { buildJournals } from '../../shared/buildJournals';

const acct = (over: Partial<CashAccount> = {}): CashAccount => ({
  id: 'a1', name: '기업은행', type: '통장',
  openingBalance: 1_000_000, openingDate: '2026-07-01',
  active: true, createdAt: '', ...over,
});

const entry = (id: string, date: string, dir: '입금' | '출금', amount: number, over: Partial<CashEntry> = {}): CashEntry => ({
  id, date, cashAccountId: 'a1', dir, amount, createdAt: `${date}T00:00:00`, ...over,
});

/**
 * 가짜 전표 — **품목에 계정을 채운다.**
 * 예전엔 `items: []`였는데, 그러면 journalizeStatement가 첫 줄에서 null을 낸다.
 * 채권·채무 판정을 분개로 옮기니 가짜 전표가 통째로 '채권 아님'이 되어 17건이 깨졌다.
 * 실제 장부엔 계정 없는 전표가 하나도 없다 — 픽스처만 실물과 달랐던 것이다.
 */
const stmt = (id: string, type: '매출' | '매입' | '비용', tradeDate: string, total: number): IssuedStatement =>
  ({ id, type, tradeDate, issuedAt: '', partnerId: 'p1', partnerName: '풍회유통', orderId: '', docNo: '',
     totalSupply: total, totalTax: 0, totalAmount: total,
     items: [{ name: '품목', spec: '', qty: 1, price: total, supply: total, tax: 0, total,
               isTaxExempt: true, accountCode: type === '매입' ? '500' : '800' }] } as IssuedStatement);

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

// 원장·잔액은 이제 **분개의 108·251**에서 나온다 — 갈래(type)가 아니다.
// 그래야 기초·상계처럼 매출·매입이 아닌 전표도 빠지지 않는다.
const ACCTS = [
  { id: '108', code: '108', name: '외상매출금', type: '자산', normalBalance: 'debit' },
  { id: '251', code: '251', name: '외상매입금', type: '부채', normalBalance: 'credit' },
  { id: '500', code: '500', name: '원료매입', type: '비용', normalBalance: 'debit' },
  { id: '800', code: '800', name: '일반매출', type: '수익', normalBalance: 'credit' },
  { id: '375', code: '375', name: '이월이익잉여금', type: '자본', normalBalance: 'credit' },
  { id: '103', code: '103', name: '보통예금', type: '자산', normalBalance: 'debit' },
] as unknown as AccountCode[];
const je = (st: IssuedStatement[], ce: CashEntry[]) =>
  buildJournals({ statements: st, cashEntries: ce, accounts: ACCTS }).entries;

describe('buildPartnerLedger', () => {
  const s1 = { ...stmt('s1', '매입', '2026-06-26', 9_315_000), docNo: 'P-001',
    items: [{ name: '깨', spec: '', qty: 1, price: 9_315_000, supply: 9_315_000, tax: 0, total: 9_315_000, isTaxExempt: true, accountCode: '500' }] } as IssuedStatement;
  const s2 = { ...stmt('s2', '매입', '2026-07-07', 9_315_000), docNo: 'P-002',
    items: [{ name: '깨', spec: '', qty: 1, price: 9_315_000, supply: 9_315_000, tax: 0, total: 9_315_000, isTaxExempt: true, accountCode: '500' }] } as IssuedStatement;
  const 지불 = (id: string, date: string, amt: number) =>
    ({ ...entry(id, date, '출금', amt), accountCode: '251', partnerId: 'p1' }) as CashEntry;

  it('전표는 더하고 결제는 빼며 잔액을 굴린다', () => {
    const cash = [지불('c1', '2026-07-03', 5_000_000)];
    const l = buildPartnerLedger('p1', '매입', [s1, s2], cash, je([s1, s2], cash));
    expect(l.rows.map(r => r.balance)).toEqual([9_315_000, 4_315_000, 13_630_000]);
    expect(l.accrued).toBe(18_630_000);
    expect(l.paid).toBe(5_000_000);
    expect(l.balance).toBe(13_630_000);
  });

  // 6월 전표를 안 빼먹어야 한다 — 옛 화면은 조회 기간 밖 전표를 못 봐서 잔액이 0부터 시작했다.
  it('과거 전표가 잔액에 그대로 반영된다', () => {
    const l = buildPartnerLedger('p1', '매입', [s1, s2], [], je([s1, s2], []));
    expect(l.balance).toBe(18_630_000);
  });

  it('매칭(settlement)을 안 붙인 지불도 행으로 보인다 — 전에는 잔액만 줄고 안 보였다', () => {
    const cash = [지불('c1', '2026-07-03', 2_000_000)];
    const l = buildPartnerLedger('p1', '매입', [s1], cash, je([s1], cash));
    expect(l.rows.map(r => r.source)).toEqual([undefined, 'cash']);
    expect(l.balance).toBe(7_315_000);
  });

  it('갈래가 매출·매입이 아니어도 잡힌다 — 대체전표가 원장에 선다', () => {
    // (차) 108 외상매출금 / (대) 375 이월이익잉여금 — 개시잔액을 대체로 세운 모습
    const 기초 = { ...stmt('open', '비용', '2026-06-01', 1_000_000), docNo: '기초260601-01',
      items: [
        { name: '기초 미수금(이월)', spec: '', qty: 1, price: 1_000_000, supply: 1_000_000, tax: 0, total: 1_000_000, isTaxExempt: true, accountCode: '108', side: '차변' },
        { name: '기초 미수금(이월)', spec: '', qty: 1, price: 1_000_000, supply: 1_000_000, tax: 0, total: 1_000_000, isTaxExempt: true, accountCode: '375', side: '대변' },
      ] } as IssuedStatement;
    const l = buildPartnerLedger('p1', '매출', [기초], [], je([기초], []));
    expect(l.rows).toHaveLength(1);
    expect(l.balance).toBe(1_000_000);
  });

  it('다른 거래처·다른 타입은 섞이지 않는다', () => {
    const other = { ...s1, id: 's9', partnerId: 'p2' } as IssuedStatement;
    const sale = { ...stmt('s8', '매출', '2026-07-01', 500_000),
      items: [{ name: '기름', spec: '', qty: 1, price: 500_000, supply: 500_000, tax: 0, total: 500_000, isTaxExempt: true, accountCode: '800' }] } as IssuedStatement;
    const l = buildPartnerLedger('p1', '매입', [s1, other, sale], [], je([s1, other, sale], []));
    expect(l.rows).toHaveLength(1);
    expect(l.balance).toBe(9_315_000);
  });
});

describe('partnerBalances', () => {
  const buy = (id: string, pid: string, name: string, amt: number) =>
    ({ ...stmt(id, '매입', '2026-07-01', amt), partnerId: pid, partnerName: name,
       items: [{ name: '깨', spec: '', qty: 1, price: amt, supply: amt, tax: 0, total: amt, isTaxExempt: true, accountCode: '500' }] }) as IssuedStatement;

  it('거래처별 잔액을 큰 순으로 준다', () => {
    const a = buy('a1', 'pA', '풍회유통', 5_000_000);
    const b = buy('b1', 'pB', '청정식품', 8_000_000);
    const rows = partnerBalances('매입', [a, b], [], je([a, b], []));
    expect(rows.map(r => r.partnerName)).toEqual(['청정식품', '풍회유통']);
    expect(rows[0].balance).toBe(8_000_000);
  });

  // 실제 DB에 partnerName이 비어 있는 전표가 있다 — 여기서 터지면 안 된다.
  it('partnerName이 비어 있어도 죽지 않는다', () => {
    const nameless = { ...buy('n1', 'pX', '', 1_000), partnerName: null } as unknown as IssuedStatement;
    const rows = partnerBalances('매입', [nameless], [], je([nameless], []));
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

  /**
   * 기초이월 전표는 차·대를 직접 세운 일반전표라 `type`이 '비용'이다(매출·매입·비용 셋뿐이라서).
   * 그걸 후보에서 빼면 **그 기초를 갚은 수금이 새 전표를 갉아먹는다.**
   * 유통가교가 그랬다 — 기초 1,755,000을 수금했는데 08-25·08-28 전표가 다 갚아진 걸로 잡혀
   * 수금처리 버튼이 사라졌다(실제 미수 620,000).
   */
  const 기초 = (id: string, total: number): IssuedStatement =>
    ({ ...stmt(id, '비용', '2026-07-31', total),
       items: [{ name: '기초 미수금(이월)', spec: '', qty: 1, price: total, supply: total, tax: 0, total,
                 isTaxExempt: true, accountCode: '108', side: '차변' }] } as IssuedStatement);

  it('기초이월 전표(type=비용)도 채권 전표로 본다 — 그 수금이 새 전표를 먹지 않는다', () => {
    const open = 기초('open1', 1_755_000);
    const s3 = stmt('s3', '매출', '2026-08-25', 120_000);
    const s4 = stmt('s4', '매출', '2026-08-28', 500_000);
    const m = allocatePartnerCash('p1', '매출', [open, s3, s4], [cash('c1', 1_755_000)],
      [settle('t1', 'c1', 'open1', 1_755_000)]);
    expect(m.get('open1')).toBe(0);        // 기초는 다 갚았고
    expect(m.get('s3')).toBe(120_000);     // 새 전표는 그대로 남는다
    expect(m.get('s4')).toBe(500_000);
  });

  it('지정이 없어도 기초 전표가 오래된 순 맨 앞이라 먼저 채워진다', () => {
    const open = 기초('open1', 1_755_000);
    const s3 = stmt('s3', '매출', '2026-08-25', 120_000);
    const m = allocatePartnerCash('p1', '매출', [open, s3], [cash('c1', 1_755_000)], []);
    expect(m.get('open1')).toBe(0);
    expect(m.get('s3')).toBe(120_000);
  });

  it('매입 기초는 251 대변으로 알아본다', () => {
    const openAp = { ...stmt('openAp', '비용', '2026-07-31', 900_000),
      items: [{ name: '기초 미지급금(이월)', spec: '', qty: 1, price: 900_000, supply: 900_000, tax: 0,
                total: 900_000, isTaxExempt: true, accountCode: '251', side: '대변' }] } as IssuedStatement;
    const b1 = stmt('b1', '매입', '2026-08-10', 300_000);
    const m = allocatePartnerCash('p1', '매입', [openAp, b1],
      [entry('c9', '2026-08-12', '출금', 900_000, { partnerId: 'p1', accountCode: '251' })], []);
    expect(m.get('openAp')).toBe(0);
    expect(m.get('b1')).toBe(300_000);
  });

  /**
   * **누른 전표에 붙여야 남은 금액이 남는다.**
   * 안 붙이면 그 돈이 오래된 전표부터 채워져, 500,000짜리에 100,000만 넣었는데
   * 엉뚱한 옛 전표가 완납으로 잡히고 그쪽 수금 버튼이 사라졌다.
   */
  it('새 전표에 일부만 넣으면 그 전표에 그만큼만 붙고 나머지가 남는다', () => {
    const m = allocatePartnerCash('p1', '매출', [s1, s2], [cash('c1', 500_000)],
      [settle('t1', 'c1', 's2', 500_000)]);
    expect(m.get('s2')).toBe(1_500_000);   // 2,000,000 − 500,000 → 버튼이 남는다
    expect(m.get('s1')).toBe(1_000_000);   // 옛 전표는 안 건드린다
  });

  it('안 붙이면 옛 전표가 대신 채워진다 — 고치기 전 모습', () => {
    const m = allocatePartnerCash('p1', '매출', [s1, s2], [cash('c1', 500_000)], []);
    expect(m.get('s1')).toBe(500_000);     // 오래된 쪽이 먼저 채워진다
    expect(m.get('s2')).toBe(2_000_000);
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

describe('거래처 잔액은 계정으로 센다', () => {
  /**
   * 전에는 전표 머리의 type('매출'/'매입')으로 셌다. 숫자는 같았지만 갈래를 바꾸면 무너진다:
   * 기초 전표를 대체로 옮기는 순간 type 필터에서 빠져 미수가 통째로 사라졌을 것이다.
   * 잔액은 **계정이 정한다.** 갈래는 어떻게 끊었는지일 뿐이다.
   */
  const je = (lines: { accountCode: string; partnerId?: string; debit?: number; credit?: number }[]) =>
    ({ id: 'je', date: '2026-08-01', lines: lines.map(l => ({ debit: 0, credit: 0, ...l })),
       memo: '', sourceType: '매출' as const, sourceId: 's', createdAt: '' });

  it('매출은 108 차변, 수금은 108 대변', () => {
    const entries = [
      je([{ accountCode: '108', partnerId: 'p1', debit: 1000 }, { accountCode: '800', credit: 1000 }]),
      je([{ accountCode: '103', debit: 400 }, { accountCode: '108', partnerId: 'p1', credit: 400 }]),
    ];
    expect(partnerBalanceFromJournals('p1', '매출', entries)).toBe(600);
  });

  it('매입은 251 대변, 지불은 251 차변', () => {
    const entries = [
      je([{ accountCode: '500', debit: 700 }, { accountCode: '251', partnerId: 'p1', credit: 700 }]),
      je([{ accountCode: '251', partnerId: 'p1', debit: 200 }, { accountCode: '103', credit: 200 }]),
    ];
    expect(partnerBalanceFromJournals('p1', '매입', entries)).toBe(500);
  });

  it('거래처가 다르면 안 센다', () => {
    const entries = [je([{ accountCode: '108', partnerId: 'p2', debit: 1000 }])];
    expect(partnerBalanceFromJournals('p1', '매출', entries)).toBe(0);
  });

  it('거래처가 안 붙은 줄은 안 센다 — 통장·비용 줄이 섞이면 안 된다', () => {
    const entries = [je([{ accountCode: '108', debit: 1000 }])];
    expect(partnerBalanceFromJournals('p1', '매출', entries)).toBe(0);
  });

  it('갈래가 무엇이든 계정만 본다 — 대체전표(상계)도 잡힌다', () => {
    const 상계 = { ...je([{ accountCode: '251', partnerId: 'p1', debit: 300 },
                         { accountCode: '108', partnerId: 'p1', credit: 300 }]), sourceType: '대체' as const };
    expect(partnerBalanceFromJournals('p1', '매출', [상계])).toBe(-300);   // 미수가 줄었다
    expect(partnerBalanceFromJournals('p1', '매입', [상계])).toBe(-300);   // 미지급도 줄었다
  });
});

describe('partnerCarryOver — 기초 전표는 기간 안에 있어도 이월이다', () => {
  /**
   * 2026-07-31 기초로 장부를 열고 연 2026을 보는 상황.
   * 이월 조건(`날짜 < 2026-01-01`)에 걸리는 분개가 없어서 이월이 0이 됐는데,
   * 기초 전표는 기간 발생에서도 빼고 있었다 → 개시잔액이 통째로 사라졌다.
   */
  const je = (id: string, date: string, debit: number, sourceId: string): JournalEntry =>
    ({ id, date, sourceId, lines: [{ accountCode: '108', partnerId: 'p1', debit, credit: 0 }] } as unknown as JournalEntry);

  const 기초 = je('j0', '2026-07-31', 21_782_710, 'stmt-기초');
  const 매출 = je('j1', '2026-08-05', 1_000_000, 'stmt-1');
  const opening = new Set(['stmt-기초']);

  it('기초 전표를 이월에 넣는다 — 안 넣으면 0이 된다', () => {
    const entries = [기초, 매출];
    expect(partnerCarryOver('p1', '매출', entries, '2026-01-01', opening)).toBe(21_782_710);
    // 기초를 안 알려주면 예전처럼 사라진다(이 값이 버그였다)
    expect(partnerCarryOver('p1', '매출', entries, '2026-01-01', new Set())).toBe(0);
  });

  it('이월 + 기간발생 = 전기간 잔액 (목록과 상세가 맞는다)', () => {
    const entries = [기초, 매출];
    const carry = partnerCarryOver('p1', '매출', entries, '2026-01-01', opening);
    const inPeriod = 1_000_000;                                    // 기초 뺀 그 해 발생
    expect(carry + inPeriod).toBe(partnerBalanceFromJournals('p1', '매출', entries));
  });

  it('기간 시작 전 분개는 그대로 이월', () => {
    const entries = [je('j2', '2025-12-31', 500_000, 'stmt-old'), 매출];
    expect(partnerCarryOver('p1', '매출', entries, '2026-01-01', new Set())).toBe(500_000);
  });

  it('월 단위도 같다 — 8월을 보면 7/31 기초가 이월', () => {
    const entries = [기초, 매출];
    expect(partnerCarryOver('p1', '매출', entries, '2026-08-01', opening)).toBe(21_782_710);
  });
});

/**
 * 전 거래처 잔액 — **분개에 나오는 거래처를 하나도 빠뜨리면 안 된다.**
 * 예전엔 부르는 쪽이 '전표에 등장한 거래처' 목록을 만들어 넘겼는데, 전표 조회창이 좁으면
 * 그 창에 안 걸린 거래처가 통째로 빠져 일반전표 발행에서 잔액이 0으로 떴다.
 */
describe('allPartnerBalances', () => {
  const je2 = (date: string, lines: { accountCode: string; debit?: number; credit?: number; partnerId?: string }[]) =>
    ({ id: date, date, sourceId: date, lines } as never);

  it('거래처마다 부르는 것과 같은 값을 낸다', () => {
    const entries = [
      je2('2026-07-31', [{ accountCode: '108', debit: 1_755_000, partnerId: 'p1' }, { accountCode: '375', credit: 1_755_000 }]),
      je2('2026-08-12', [{ accountCode: '103', debit: 1_755_000 }, { accountCode: '108', credit: 1_755_000, partnerId: 'p1' }]),
      je2('2026-08-25', [{ accountCode: '108', debit: 120_000, partnerId: 'p1' }, { accountCode: '800', credit: 120_000 }]),
      je2('2026-08-10', [{ accountCode: '146', debit: 900_000 }, { accountCode: '251', credit: 900_000, partnerId: 'p2' }]),
    ];
    const all = allPartnerBalances(entries);
    expect(all.get('p1')!.receivable).toBe(partnerBalanceFromJournals('p1', '매출', entries));
    expect(all.get('p1')!.receivable).toBe(120_000);
    expect(all.get('p2')!.payable).toBe(900_000);
  });

  it('전표가 한 장도 없어도 자금만으로 잔액이 잡히면 담는다', () => {
    //  수금만 있고 전표가 조회창 밖이면 예전 방식은 이 거래처를 통째로 빠뜨렸다
    const entries = [je2('2026-08-12', [{ accountCode: '103', debit: 500_000 }, { accountCode: '108', credit: 500_000, partnerId: 'p9' }])];
    expect(allPartnerBalances(entries).get('p9')!.receivable).toBe(-500_000);
  });
});

/**
 * 상계(대체)는 **미수와 미지급을 같이 줄인다** — 108 한 줄, 251 한 줄.
 *
 * 전표 화면 타임라인은 거래처를 채권 묶음·채무 묶음으로 갈라 굴리므로, 이런 자금전표
 * 하나가 수금·지불 행 **두 줄**로 나온다. 두 줄의 paymentId가 같아서 화면 열쇠(key)를
 * 자금전표 id만으로 잡으면 겹친다 — 겹친 열쇠는 React가 지운 줄을 못 지워, 걸러낸
 * 뒤에도 남아 있는 행이 된다(가득찬식품 2026-08-31 24,604,700).
 * 그래서 열쇠에 방향(stmtType)을 붙인다. 이 테스트는 "두 줄이 나온다"는 근거를 잡아 둔다.
 */
describe('상계 자금전표', () => {
  it('108·251 두 계정을 모두 양수로 줄인다 — 그래서 타임라인 행이 두 줄', () => {
    const offset = entry('cash-offset', '2026-08-31', '입금', 24_604_700, {
      dir: '대체' as CashEntry['dir'],
      partnerId: 'p1',
      lines: [
        { accountCode: '251', amount: 24_604_700, note: '미지급 상계' },
        { accountCode: '108', amount: -24_604_700, note: '미수 상계' },
      ],
    } as Partial<CashEntry>);

    const parts = partnerCashParts(offset);
    const ar = parts.filter(x => x.code === '108').reduce((a, x) => a + x.reduce, 0);
    const ap = parts.filter(x => x.code === '251').reduce((a, x) => a + x.reduce, 0);

    expect(ar).toBe(24_604_700);   // 미수가 준다
    expect(ap).toBe(24_604_700);   // 미지급도 준다
  });
});
