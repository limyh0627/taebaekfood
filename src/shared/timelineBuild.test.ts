import { describe, it, expect } from 'vitest';
import { buildTimeline, type ArApSide } from './timelineBuild';

const 전표 = (o: any) => ({
  partnerId: 'A', partnerName: '희성실업', type: '매출',
  tradeDate: '2026-09-01', issuedAt: '2026-09-01T10:00:00+09:00',
  totalAmount: 0, items: [], ...o,
} as any);

const 자금 = (o: any) => ({
  dir: '입금', amount: 0, date: '2026-09-02', createdAt: '2026-09-02T10:00:00+09:00',
  lines: [], ...o,
} as any);

/** 매출전표는 채권 +총액, 매입전표는 채무 +총액, 그 밖은 거래처 빚 없음 */
const 보통분개 = (s: any): ArApSide =>
  s.type === '매출' ? { side: '채권', delta: s.totalAmount }
  : s.type === '매입' ? { side: '채무', delta: s.totalAmount }
  : { side: null, delta: 0 };

const 줄찾기 = (rows: any[], kind: string) => rows.filter(r => r.kind === kind);

describe('buildTimeline — 누적잔액', () => {
  it('매출전표가 서면 잔액이 는다', () => {
    const rows = buildTimeline({
      statements: [전표({ id: 's1', totalAmount: 1_000_000 })],
      cashEntries: [], arapOf: 보통분개,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].cumul).toBe(1_000_000);
  });

  it('수금이 들어오면 잔액이 준다', () => {
    const rows = buildTimeline({
      statements: [전표({ id: 's1', totalAmount: 1_000_000 })],
      cashEntries: [자금({ id: 'c1', partnerId: 'A', dir: '입금', amount: 400_000, accountCode: '108' })],
      arapOf: 보통분개,
    });
    const pay = 줄찾기(rows, 'pay');
    expect(pay).toHaveLength(1);
    expect(pay[0].cumul).toBe(600_000);
  });

  it('같은 날이면 전표가 먼저 — 매출 가산 후 수금 차감이다', () => {
    const rows = buildTimeline({
      statements: [전표({ id: 's1', totalAmount: 1_000_000, tradeDate: '2026-09-01' })],
      cashEntries: [자금({ id: 'c1', partnerId: 'A', dir: '입금', amount: 300_000,
                          accountCode: '108', date: '2026-09-01', createdAt: '2026-09-01T10:00:00+09:00' })],
      arapOf: 보통분개,
    });
    expect(rows.map(r => r.kind)).toEqual(['stmt', 'pay']);
    expect(rows[1].cumul).toBe(700_000);
  });

  it('**채권과 채무는 따로 굴린다** — 한 거래처에 받을 것과 줄 것이 같이 있어도', () => {
    const rows = buildTimeline({
      statements: [
        전표({ id: '매출', type: '매출', totalAmount: 1_000_000 }),
        전표({ id: '매입', type: '매입', totalAmount: 300_000 }),
      ],
      cashEntries: [], arapOf: 보통분개,
    });
    const byId = new Map(줄찾기(rows, 'stmt').map((r: any) => [r.data.id, r.cumul]));
    expect(byId.get('매출')).toBe(1_000_000);
    expect(byId.get('매입')).toBe(300_000);   // 1,000,000 에 얹히지 않는다
  });

  it('잔액에 얹는 건 **분개가 센 값**이지 전표 총액이 아니다', () => {
    //  기초이월 전표 — 갈래는 '비용'(대체)인데 분개로는 채권 500,000
    const rows = buildTimeline({
      statements: [전표({ id: '기초', type: '비용', totalAmount: 999_999 })],
      cashEntries: [],
      arapOf: () => ({ side: '채권', delta: 500_000 }),
    });
    expect(rows[0].cumul).toBe(500_000);
  });
});

describe('buildTimeline — 자금 행', () => {
  it('거래처 채권으로 다 나간 자금은 자금 행으로 또 뜨지 않는다', () => {
    const rows = buildTimeline({
      statements: [전표({ id: 's1', totalAmount: 1_000_000 })],
      cashEntries: [자금({ id: 'c1', partnerId: 'A', dir: '입금', amount: 400_000, accountCode: '108' })],
      arapOf: 보통분개,
    });
    expect(줄찾기(rows, 'cash')).toHaveLength(0);
    expect(줄찾기(rows, 'pay')).toHaveLength(1);
  });

  it('거래처와 무관한 지출은 자금 행으로 뜬다 — 전기요금 같은 것', () => {
    const rows = buildTimeline({
      statements: [],
      cashEntries: [자금({ id: 'c1', dir: '출금', amount: 88_000, accountCode: '815' })],
      arapOf: 보통분개,
    });
    expect(줄찾기(rows, 'cash')).toHaveLength(1);
    expect(줄찾기(rows, 'cash')[0].amount).toBe(88_000);
  });

  it('반만 채권이면 나머지만 자금 행으로 뜬다', () => {
    const rows = buildTimeline({
      statements: [전표({ id: 's1', totalAmount: 1_000_000 })],
      cashEntries: [자금({
        id: 'c1', partnerId: 'A', dir: '출금', amount: 500_000,
        lines: [{ accountCode: '108', amount: 300_000 }, { accountCode: '931', amount: 200_000 }],
      })],
      arapOf: 보통분개,
    });
    const cash = 줄찾기(rows, 'cash');
    expect(cash).toHaveLength(1);
    expect(cash[0].amount).toBe(200_000);   // 채권분 300,000 은 수금 행으로 갔다
  });

  it('자금 행에도 그 거래처의 그 시점 잔액이 달린다', () => {
    const rows = buildTimeline({
      statements: [전표({ id: 's1', totalAmount: 1_000_000, tradeDate: '2026-09-01' })],
      cashEntries: [자금({ id: 'c1', partnerId: 'A', dir: '출금', amount: 50_000,
                          accountCode: '931', date: '2026-09-03' })],
      arapOf: 보통분개,
    });
    expect(줄찾기(rows, 'cash')[0].cumul).toBe(1_000_000);
  });

  it('거래처가 없으면 잔액 칸이 빈다 — 화면은 —로 띄운다', () => {
    const rows = buildTimeline({
      statements: [], cashEntries: [자금({ id: 'c1', dir: '출금', amount: 1000, accountCode: '815' })],
      arapOf: 보통분개,
    });
    expect(줄찾기(rows, 'cash')[0].cumul).toBeUndefined();
  });
});

describe('buildTimeline — 채권·채무를 안 세우는 전표', () => {
  it('잔액을 안 흔들고, 그 거래처의 그 시점 잔액을 적는다', () => {
    const rows = buildTimeline({
      statements: [
        전표({ id: '매출', type: '매출', totalAmount: 1_000_000, tradeDate: '2026-09-01' }),
        전표({ id: '감가', type: '비용', totalAmount: 700_000, tradeDate: '2026-09-03' }),
      ],
      cashEntries: [],
      arapOf: (s: any) => (s.id === '매출' ? { side: '채권', delta: 1_000_000 } : { side: null, delta: 0 }),
    });
    const 감가 = 줄찾기(rows, 'stmt').find((r: any) => r.data.id === '감가');
    expect(감가.cumul).toBe(1_000_000);   // 700,000 이 얹히지 않는다
  });

  it('**그런 전표는 잔액 자취에 안 쌓인다** — 쌓으면 그 거래처 잔액이 통째로 흐려진다', () => {
    const rows = buildTimeline({
      statements: [
        전표({ id: '감가', type: '비용', totalAmount: 700_000, tradeDate: '2026-09-01' }),
        전표({ id: '매출', type: '매출', totalAmount: 1_000_000, tradeDate: '2026-09-03' }),
      ],
      cashEntries: [],
      arapOf: (s: any) => (s.id === '매출' ? { side: '채권', delta: 1_000_000 } : { side: null, delta: 0 }),
    });
    const 매출 = 줄찾기(rows, 'stmt').find((r: any) => r.data.id === '매출');
    expect(매출.cumul).toBe(1_000_000);
  });
});

describe('buildTimeline — 소급 전표 순서', () => {
  it('시각이 같으면 끊은 순서로 못 박는다 — 새로고침마다 달라지면 안 된다', () => {
    const 늦게끊음 = 전표({ id: 'stmt-1786000000002', totalAmount: 200, issuedAt: '2026-09-01T23:59:59+09:00' });
    const 먼저끊음 = 전표({ id: 'stmt-1786000000001', totalAmount: 100, issuedAt: '2026-09-01T23:59:59+09:00' });
    const a = buildTimeline({ statements: [늦게끊음, 먼저끊음], cashEntries: [], arapOf: 보통분개 });
    const b = buildTimeline({ statements: [먼저끊음, 늦게끊음], cashEntries: [], arapOf: 보통분개 });
    expect(a.map((r: any) => r.data.id)).toEqual(b.map((r: any) => r.data.id));
    expect((a[0] as any).data.id).toBe('stmt-1786000000001');
  });
});
