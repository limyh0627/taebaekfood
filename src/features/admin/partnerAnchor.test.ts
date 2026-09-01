import { describe, it, expect } from 'vitest';
import {
  buildPartnerAnchor, refreshPartner, anchorBefore, readFrom, balancesWithAnchor,
  openStatementIds, openingRemainders, allocationInputs, staleAnchors, anchorId, type AnchorInput,
} from './partnerAnchor';
import { allocatePartnerCash } from './cashLedger';
import type { JournalEntry, IssuedStatement, CashEntry } from '../../shared/types';

/** 매출 전표 — (차)108 / (대)800 */
const 매출je = (date: string, pid: string, amt: number, id = `s-${date}-${pid}`): JournalEntry => ({
  id, date, sourceType: '매출', createdAt: '',
  lines: [{ accountCode: '108', debit: amt, credit: 0, partnerId: pid }, { accountCode: '800', debit: 0, credit: amt }],
});
/** 수금 — (차)103 / (대)108 */
const 수금je = (date: string, pid: string, amt: number, id = `c-${date}-${pid}`): JournalEntry => ({
  id, date, sourceType: '자금', createdAt: '',
  lines: [{ accountCode: '103', debit: amt, credit: 0 }, { accountCode: '108', debit: 0, credit: amt, partnerId: pid }],
});
/** 매입 — (차)500 / (대)251 */
const 매입je = (date: string, pid: string, amt: number, id = `p-${date}-${pid}`): JournalEntry => ({
  id, date, sourceType: '매입', createdAt: '',
  lines: [{ accountCode: '500', debit: amt, credit: 0 }, { accountCode: '251', debit: 0, credit: amt, partnerId: pid }],
});
/** 미지급금(253)도 갚을 돈이다 */
const 세금je = (date: string, pid: string, amt: number): JournalEntry => ({
  id: `t-${date}-${pid}`, date, sourceType: '매입', createdAt: '',
  lines: [{ accountCode: '255', debit: amt, credit: 0 }, { accountCode: '253', debit: 0, credit: amt, partnerId: pid }],
});

/**
 * `items`를 꼭 채운다 — 비우면 `journalizeStatement`가 첫 줄에서 null을 내고
 * 채권 판정(`isReceivableStmt`)이 통째로 '채권 아님'이 된다. 실제 장부엔 계정 없는 전표가 없다.
 */
const 전표 = (id: string, date: string, pid: string, amt: number, type: '매출' | '매입' = '매출'): IssuedStatement =>
  ({ id, tradeDate: date, issuedAt: date, partnerId: pid, partnerName: pid, type, docNo: id,
     totalSupply: amt, totalTax: 0, totalAmount: amt,
     items: [{ name: '품목', spec: '', qty: 1, price: amt, supply: amt, tax: 0, total: amt,
               isTaxExempt: true, accountCode: type === '매입' ? '500' : '800' }] } as unknown as IssuedStatement);
const 자금 = (id: string, date: string, pid: string, amt: number, dir: '입금' | '출금' = '입금'): CashEntry =>
  ({ id, date, partnerId: pid, amount: amt, dir, accountCode: dir === '입금' ? '108' : '251' } as unknown as CashEntry);

const inp = (o: Partial<AnchorInput> & { journals: JournalEntry[] }): AnchorInput => o;

describe('연말 앵커 만들기', () => {
  const journals = [
    매출je('2026-03-01', 'p1', 1_000_000),
    수금je('2026-04-01', 'p1', 400_000),
    매입je('2026-05-01', 'p2', 700_000),
  ];

  it('그날까지의 움직임을 더해 연말 잔액을 낸다', () => {
    const a = buildPartnerAnchor('taebaek', '2026', inp({ journals }));
    expect(a.id).toBe(anchorId('taebaek', '2026'));
    expect(a.asOf).toBe('2026-12-31');
    expect(a.rows.find(r => r.partnerId === 'p1')).toMatchObject({ receivable: 600_000, payable: 0 });
    expect(a.rows.find(r => r.partnerId === 'p2')).toMatchObject({ receivable: 0, payable: 700_000 });
  });

  it('asOf 뒤엣것이 섞여 들어와도 잘라 낸다 — 부르는 쪽 실수를 앵커가 떠안지 않는다', () => {
    const a = buildPartnerAnchor('taebaek', '2026', inp({
      journals: [...journals, 매출je('2027-01-05', 'p1', 999)],
      statements: [전표('st1', '2026-03-01', 'p1', 1_000_000), 전표('st9', '2027-01-05', 'p1', 999)],
    }));
    expect(a.rows.find(r => r.partnerId === 'p1')!.receivable).toBe(600_000);
    expect(openStatementIds(a)).not.toContain('st9');
  });

  it('아무것도 안 남은 거래처는 안 담는다 — 앵커가 해마다 커지기만 하면 뜻이 없다', () => {
    const a = buildPartnerAnchor('taebaek', '2026', inp({
      journals: [매출je('2026-03-01', 'p9', 500_000), 수금je('2026-06-01', 'p9', 500_000)],
      statements: [전표('st9', '2026-03-01', 'p9', 500_000)],
      cashEntries: [자금('c9', '2026-06-01', 'p9', 500_000)],
    }));
    expect(a.rows.find(r => r.partnerId === 'p9')).toBeUndefined();
  });

  it('251과 253을 한 덩어리로 본다 — 둘 다 그 거래처에 갚을 돈이다', () => {
    const a = buildPartnerAnchor('taebaek', '2026', inp({
      journals: [매입je('2026-03-01', 'p3', 100_000), 세금je('2026-04-01', 'p3', 30_000)],
    }));
    expect(a.rows.find(r => r.partnerId === 'p3')!.payable).toBe(130_000);
  });
});

describe('미결 전표를 같이 담는다 — 이게 없으면 앵커가 아니다', () => {
  //  1월 100만 · 6월 60만을 팔고 7월에 130만을 받았다 → 오래된 순으로 갚아 6월 것 30만이 남는다
  const statements = [전표('st1', '2026-01-10', 'p1', 1_000_000), 전표('st2', '2026-06-10', 'p1', 600_000)];
  const cashEntries = [자금('c1', '2026-07-01', 'p1', 1_300_000)];
  const a = buildPartnerAnchor('taebaek', '2026', inp({
    journals: [
      매출je('2026-01-10', 'p1', 1_000_000, 'j1'), 매출je('2026-06-10', 'p1', 600_000, 'j2'),
      수금je('2026-07-01', 'p1', 1_300_000),
    ],
    statements, cashEntries,
  }));

  it('안 끝난 전표만, 남은 금액과 함께 담는다', () => {
    expect(a.rows.find(r => r.partnerId === 'p1')!.openStmts)
      .toEqual([{ id: 'st2', date: '2026-06-10', type: '매출', remaining: 300_000 }]);
    expect(openStatementIds(a)).toEqual(['st2']);
    expect(openingRemainders(a).get('st2')).toBe(300_000);
  });

  it('미결 합이 그 거래처 잔액과 맞는다 — 앵커 안에서 두 값이 어긋나면 안 된다', () => {
    const row = a.rows.find(r => r.partnerId === 'p1')!;
    expect(row.openStmts.reduce((s, o) => s + o.remaining, 0)).toBe(row.receivable);
  });

  it('앵커에서 이어 배분하면 전부 읽은 것과 답이 같다 — 이게 앵커의 전부다', () => {
    const 이듬해전표 = 전표('st3', '2027-02-01', 'p1', 500_000);
    const 이듬해수금 = 자금('c2', '2027-03-01', 'p1', 400_000);

    //  ① 전부 읽고 배분
    const 전부 = allocatePartnerCash('p1', '매출', [...statements, 이듬해전표], [...cashEntries, 이듬해수금], []);
    //  ② 앵커 뒤만 읽고 배분 — 앵커가 짚어 준 미결 전표를 시작 잔액과 함께 얹는다
    const 앵커뒤 = allocatePartnerCash(
      'p1', '매출',
      [statements[1], 이듬해전표],
      [이듬해수금],
      [], openingRemainders(a),
    );
    expect(앵커뒤.get('st2')).toBe(전부.get('st2'));   // 300,000 − 400,000 → 0
    expect(앵커뒤.get('st3')).toBe(전부.get('st3'));   // 500,000 − 100,000 → 400,000
    expect(앵커뒤.get('st3')).toBe(400_000);
  });
});

/**
 * **앵커의 값어치는 이 한 가지로 정해진다 — 덜 읽고도 답이 같은가.**
 *
 * 화면이 하는 일을 그대로 두 번 한다. 한 번은 처음부터 전부 읽고,
 * 한 번은 앵커 뒤만 읽는다. 두 답이 다르면 앵커는 요약이 아니라 거짓말이다.
 */
describe('앵커로 읽은 답 = 전부 읽은 답', () => {
  //  2026년: 세 장 팔고 두 번 받았다. 2027년: 한 장 더 팔고 한 번 더 받았다.
  const s2026 = [
    전표('a1', '2026-02-01', 'p1', 1_000_000),
    전표('a2', '2026-05-01', 'p1', 800_000),
    전표('a3', '2026-11-01', 'p1', 600_000),
    전표('b1', '2026-03-01', 'p2', 400_000, '매입'),
  ];
  const c2026 = [자금('c1', '2026-06-01', 'p1', 1_500_000), 자금('c2', '2026-12-01', 'p1', 500_000)];
  const s2027 = [전표('a4', '2027-03-01', 'p1', 900_000)];
  const c2027 = [자금('c3', '2027-04-01', 'p1', 700_000)];

  const 전체전표 = [...s2026, ...s2027];
  const 전체자금 = [...c2026, ...c2027];
  const 전체분개 = [
    매출je('2026-02-01', 'p1', 1_000_000, 'j1'), 매출je('2026-05-01', 'p1', 800_000, 'j2'),
    매출je('2026-11-01', 'p1', 600_000, 'j3'), 매입je('2026-03-01', 'p2', 400_000, 'j4'),
    수금je('2026-06-01', 'p1', 1_500_000, 'j5'), 수금je('2026-12-01', 'p1', 500_000, 'j6'),
    매출je('2027-03-01', 'p1', 900_000, 'j7'), 수금je('2027-04-01', 'p1', 700_000, 'j8'),
  ];

  const anchor = buildPartnerAnchor('taebaek', '2026', inp({
    journals: 전체분개, statements: 전체전표, cashEntries: 전체자금,
  }));

  it('거래처 잔액이 같다', () => {
    const 전부 = balancesWithAnchor(undefined, 전체분개);
    const 앵커로 = balancesWithAnchor(anchor, 전체분개);
    expect(앵커로.get('p1')).toEqual(전부.get('p1'));
    expect(앵커로.get('p2')).toEqual(전부.get('p2'));
    expect(앵커로.get('p1')!.receivable).toBe(600_000);   // 2,400,000 + 900,000 − 2,700,000
  });

  it('전표 한 장씩 남은 금액이 같다', () => {
    const 배분 = (stmts: typeof 전체전표, cash: typeof 전체자금, opening?: Map<string, number>) =>
      allocatePartnerCash('p1', '매출', stmts, cash, [], opening);

    const 전부 = 배분(전체전표, 전체자금);
    const alloc = allocationInputs(anchor, 전체전표, 전체자금);
    const 앵커로 = 배분(alloc.statements, alloc.cashEntries, alloc.opening);

    //  a1·a2는 연말에 이미 다 갚혀 앵커에 안 담긴다 — **안 읽는 게 목적**이라 결과에도 안 나온다.
    //  안 나온 건 0이라는 뜻이고, 전부 읽었을 때도 0이어야 앵커가 아무것도 안 숨긴 것이다.
    for (const id of ['a1', 'a2', 'a3', 'a4']) expect([id, 앵커로.get(id) ?? 0]).toEqual([id, 전부.get(id)]);
    //  2,400,000 중 2,000,000을 받았으니 a3에 400,000이 남고, 2027년 90만 팔고 70만 받아 a4가 600,000
    expect(전부.get('a3')).toBe(0);
    expect(전부.get('a4')).toBe(600_000);
  });

  it('앵커 뒤만 읽어도 같다 — 앞엣것을 아예 안 넘겨도', () => {
    const 앞엣것없이 = allocationInputs(anchor, [...anchorOpenOf(anchor, 전체전표), ...s2027], c2027);
    const 앵커로 = allocatePartnerCash('p1', '매출', 앞엣것없이.statements, 앞엣것없이.cashEntries, [], 앞엣것없이.opening);
    const 전부 = allocatePartnerCash('p1', '매출', 전체전표, 전체자금, []);
    expect(앵커로.get('a4')).toBe(전부.get('a4'));
    //  앵커가 짚어 준 전표만 들고 오면 되고, 다 갚은 a1·a2는 아예 안 읽는다
    expect(openStatementIds(anchor).sort()).toEqual(['a3', 'b1']);
  });
});

/** 앵커가 짚어 준 전표만 골라 온다 — 화면이 fetchByIds로 하는 일 */
const anchorOpenOf = (a: ReturnType<typeof buildPartnerAnchor>, all: IssuedStatement[]) => {
  const ids = new Set(openStatementIds(a));
  return all.filter(s => ids.has(s.id));
};

describe('앵커로 읽기', () => {
  const a26 = buildPartnerAnchor('taebaek', '2026', inp({ journals: [매출je('2026-03-01', 'p1', 1_000_000)] }));

  it('기준일보다 앞선 앵커 중 마지막을 고른다', () => {
    const a25 = buildPartnerAnchor('taebaek', '2025', inp({ journals: [] }));
    expect(anchorBefore([a25, a26], '2027-05-01')?.year).toBe('2026');
    expect(anchorBefore([a25, a26], '2026-05-01')?.year).toBe('2025');
    expect(anchorBefore([a25, a26], '2025-05-01')).toBeUndefined();
  });

  it('앵커 다음 날부터 읽는다 — 앵커 날짜를 또 읽으면 두 번 센다', () => {
    expect(readFrom(a26, '2020-01-01')).toBe('2027-01-01');
    expect(readFrom(undefined, '2020-01-01')).toBe('2020-01-01');
  });

  it('앵커 + 그 이후 = 지금 잔액', () => {
    const bal = balancesWithAnchor(a26, [수금je('2027-02-01', 'p1', 300_000), 매입je('2027-03-01', 'p2', 50_000)]);
    expect(bal.get('p1')).toEqual({ receivable: 700_000, payable: 0 });
    expect(bal.get('p2')).toEqual({ receivable: 0, payable: 50_000 });
  });

  it('앵커가 없으면 넘어온 분개가 전부다 — 지금 데이터가 이 길이다', () => {
    expect(balancesWithAnchor(undefined, [매출je('2026-03-01', 'p1', 1_000_000)]).get('p1')!.receivable).toBe(1_000_000);
  });
});

describe('소급 전표 — 그 거래처만 다시 박는다', () => {
  const journals = [매출je('2026-03-01', 'p1', 1_000_000), 매입je('2026-05-01', 'p2', 700_000)];
  const a26 = buildPartnerAnchor('taebaek', '2026', inp({ journals }));

  it('낡는 앵커를 앞선 해부터 짚어 준다', () => {
    const a27 = buildPartnerAnchor('taebaek', '2027', inp({ journals }));
    expect(staleAnchors([a26, a27], '2026-08-01').map(a => a.year)).toEqual(['2026', '2027']);
    expect(staleAnchors([a26, a27], '2027-08-01').map(a => a.year)).toEqual(['2027']);
    expect(staleAnchors([a26, a27], '2028-01-01')).toEqual([]);   // 앵커보다 뒤면 다시 박을 게 없다
  });

  it('그 거래처 줄만 다시 세고 나머지는 안 건드린다', () => {
    const next = refreshPartner(a26, 'p1', inp({
      journals: [매출je('2026-03-01', 'p1', 1_000_000), 매출je('2026-08-01', 'p1', 250_000)],
    }));
    expect(next.rows.find(r => r.partnerId === 'p1')!.receivable).toBe(1_250_000);
    expect(next.rows.find(r => r.partnerId === 'p2')).toEqual(a26.rows.find(r => r.partnerId === 'p2'));
  });

  it('다시 세서 아무것도 안 남으면 줄을 뺀다', () => {
    const next = refreshPartner(a26, 'p1', inp({
      journals: [매출je('2026-03-01', 'p1', 1_000_000), 수금je('2026-09-01', 'p1', 1_000_000)],
    }));
    expect(next.rows.find(r => r.partnerId === 'p1')).toBeUndefined();
  });

  it('미결 전표도 같이 다시 박힌다', () => {
    const next = refreshPartner(a26, 'p1', inp({
      journals: [매출je('2026-03-01', 'p1', 1_000_000), 수금je('2026-09-01', 'p1', 600_000)],
      statements: [전표('st1', '2026-03-01', 'p1', 1_000_000)],
      cashEntries: [자금('c1', '2026-09-01', 'p1', 600_000)],
    }));
    expect(next.rows.find(r => r.partnerId === 'p1')!.openStmts)
      .toEqual([{ id: 'st1', date: '2026-03-01', type: '매출', remaining: 400_000 }]);
  });
});
