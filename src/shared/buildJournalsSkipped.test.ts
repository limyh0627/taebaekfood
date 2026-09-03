import { describe, it, expect } from 'vitest';
import { buildJournals } from './buildJournals';
import type { AccountCode, CashEntry, IssuedStatement } from './types';

/**
 * **분개가 안 된 원본은 반드시 `skipped` 에 적혀야 한다.**
 *
 * 손익·거래처잔액·현금흐름이 전부 이 함수 결과를 받아먹는다. 여기서 조용히 빠지면
 * 세 화면에서 한꺼번에 사라지는데, **어디에도 표시가 안 난다** — 합계가 그냥 작아질 뿐이다.
 * 유일한 신호가 재무제표 화면 위 "분개 못 만든 원본 N건" 한 줄이다.
 *
 * 그 절반이 여태 테스트 없이 있었다(2026-09-02 커버리지: 분기 51%·함수 57%).
 * 실제 데이터로 재 보니 338장 중 빠진 건 하나(일부러 만든 빈 전표)뿐이라 지금은 멀쩡한데,
 * **멀쩡하다는 걸 아무도 지켜 주고 있지 않았다.**
 */
const CODES: AccountCode[] = [
  { id: '800', code: '800', name: '일반매출', type: '수익', normalBalance: 'credit', groupId: 'g' },
  { id: '500', code: '500', name: '원재료비', type: '비용', normalBalance: 'debit', groupId: 'g' },
  { id: '103', code: '103', name: '보통예금', type: '자산', normalBalance: 'debit', groupId: 'g' },
  { id: '108', code: '108', name: '외상매출금', type: '자산', normalBalance: 'debit', groupId: 'g' },
  { id: '251', code: '251', name: '외상매입금', type: '부채', normalBalance: 'credit', groupId: 'g' },
  { id: '818', code: '818', name: '감가상각비', type: '비용', normalBalance: 'debit', groupId: 'g' },
  { id: '203', code: '203', name: '감가상각누계액', type: '자산', normalBalance: 'credit', groupId: 'g' },
] as AccountCode[];

const 매출 = (over: Partial<IssuedStatement> = {}): IssuedStatement => ({
  id: 's1', issuedAt: '2026-08-10T00:00:00.000Z', tradeDate: '2026-08-10', type: '매출',
  partnerId: 'p1', partnerName: '가득찬식품', orderId: '', docNo: '260810-01',
  totalSupply: 1_000_000, totalTax: 0, totalAmount: 1_000_000,
  items: [{ name: '참기름', spec: '', qty: 1, price: 1_000_000, supply: 1_000_000, tax: 0, total: 1_000_000, isTaxExempt: true, accountCode: '800' }],
  ...over,
} as unknown as IssuedStatement);

const 돈 = (over: Partial<CashEntry> = {}): CashEntry =>
  ({ id: 'c1', date: '2026-08-11', dir: '출금', amount: 100_000, accountCode: '500', cashAccountId: 'bank', ...over } as CashEntry);

type Input = Parameters<typeof buildJournals>[0];
/** 계정표는 늘 같으니 안 적어도 되게 — 테스트마다 되풀이하면 무엇이 다른지 안 보인다 */
const build = (i: Omit<Input, 'accounts'> & { accounts?: Input['accounts'] }) =>
  buildJournals({ accounts: CODES, ...i });

describe('멀쩡한 것은 그대로 분개된다 — 기준선', () => {
  it('매출 한 장 · 자금 한 줄 → 분개 둘, 빠진 것 없음', () => {
    const r = build({ statements: [매출()], cashEntries: [돈()], cashAccountMap: { bank: '103' } });
    expect(r.entries).toHaveLength(2);
    expect(r.skipped).toEqual([]);
  });
});

describe('**분개가 안 되면 적어 둔다**', () => {
  it('빈 매출 전표 — 실제로 하나 있다(미발행 정리용, 총액 0·품목 0줄)', () => {
    const r = build({ statements: [매출({ items: [], totalAmount: 0, totalSupply: 0 } as never)] });
    expect(r.entries).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].sourceType).toBe('매출');
    expect(r.skipped[0].id).toBe('s1');
    //  이유가 적혀 있어야 사람이 찾아간다
    expect(r.skipped[0].reason).toMatch(/계정|빈 전표|차대/);
  });

  it('계정이 안 붙은 매입도 적힌다', () => {
    const 매입 = 매출({ id: 's2', type: '매입', items: [{ name: '참깨', qty: 1, price: 500_000, supply: 500_000, tax: 0, total: 500_000, isTaxExempt: true }] } as never);
    const r = build({ statements: [매입] });
    expect(r.entries).toHaveLength(0);
    expect(r.skipped.map(s => s.id)).toEqual(['s2']);
    expect(r.skipped[0].sourceType).toBe('매입');
  });

  it('대체전표(비용)가 안 서면 **`대체` 로 적힌다** — 갈래를 알아야 어디를 볼지 안다', () => {
    //  상대계정 줄이 빠져 차·대가 안 맞는 대체전표
    const 대체 = 매출({ id: 's3', type: '비용', items: [{ name: '감가상각', qty: 1, price: 0, supply: 0, tax: 0, total: 0, accountCode: '818' }] } as never);
    const r = build({ statements: [대체] });
    expect(r.entries).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].sourceType).toBe('대체');
    expect(r.skipped[0].reason).toContain('상대계정');
  });

  it('계정 없는 자금 줄은 **`자금` 으로 적힌다**', () => {
    const r = build({ statements: [], cashEntries: [돈({ accountCode: '' } as never)] });
    expect(r.entries).toHaveLength(0);
    expect(r.skipped).toEqual([{ sourceType: '자금', id: 'c1', reason: '계정 미지정' }]);
  });

  it('여러 건이 빠지면 전부 적힌다 — 하나만 적고 말면 나머지를 못 찾는다', () => {
    const r = build({
      statements: [매출({ id: 'a', items: [] } as never), 매출({ id: 'b', items: [] } as never)],
      cashEntries: [돈({ id: 'c', accountCode: '' } as never)],
    });
    expect(r.skipped.map(s => s.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('기초잔액은 자본금으로 균형을 맞춘다', () => {
  /**
   * 한쪽만 넣어도 차액을 자본(331)으로 메워 균형 잡힌 분개가 나온다(`buildOpeningEntry`).
   * **그래서 buildJournals 맨 아래 차·대 검사 둘은 오늘의 어떤 경로로도 안 걸린다** —
   * journalize* 넷이 전부 균형 잡힌 것만 내놓거나 null 을 내놓기 때문이다.
   * 걷어내지는 않는다. 새 분개 경로를 붙일 때 그물이 되어 준다.
   */
  it('차변만 넣으면 대변에 자본금이 선다', () => {
    const r = build({
      statements: [],
      opening: { date: '2026-07-01', lines: [{ accountCode: '103', amount: 1_000_000 }] } as never,
    });
    expect(r.entries).toHaveLength(1);
    expect(r.skipped).toEqual([]);
    const lines = r.entries[0].lines;
    expect(lines.find(l => l.accountCode === '103')?.debit).toBe(1_000_000);
    expect(lines.find(l => l.accountCode === '331')?.credit).toBe(1_000_000);
  });

  it('대변만 넣으면 차변에 자본금이 선다 — 반대쪽도 같다', () => {
    const r = build({
      statements: [],
      opening: { date: '2026-07-01', lines: [{ accountCode: '251', amount: 700_000 }] } as never,
    });
    const lines = r.entries[0].lines;
    expect(lines.find(l => l.accountCode === '251')?.credit).toBe(700_000);
    expect(lines.find(l => l.accountCode === '331')?.debit).toBe(700_000);
    expect(r.skipped).toEqual([]);
  });

  it('**양쪽이 이미 맞으면 자본금 줄을 안 만든다** — 없는 자본을 지어내면 안 된다', () => {
    const r = build({
      statements: [],
      opening: { date: '2026-07-01', lines: [
        { accountCode: '103', amount: 1_000_000 },
        { accountCode: '251', amount: 1_000_000 },
      ] } as never,
    });
    expect(r.entries[0].lines.some(l => l.accountCode === '331')).toBe(false);
    expect(r.skipped).toEqual([]);
  });

  it('모든 분개는 차·대가 맞는다 — 하나라도 어긋나면 세 화면이 같이 틀어진다', () => {
    const r = build({
      statements: [매출()],
      cashEntries: [돈()],
      cashAccountMap: { bank: '103' },
      opening: { date: '2026-07-01', lines: [{ accountCode: '103', amount: 1_000_000 }] } as never,
    });
    expect(r.skipped).toEqual([]);
    for (const je of r.entries) {
      const dr = je.lines.reduce((a, l) => a + (l.debit ?? 0), 0);
      const cr = je.lines.reduce((a, l) => a + (l.credit ?? 0), 0);
      expect(Math.round(dr - cr)).toBe(0);
      //  한 줄에 차·대가 둘 다 서면 합계는 맞아 보이면서 그 줄만 뜻이 없어진다
      expect(je.lines.every(l => !((l.debit ?? 0) > 0 && (l.credit ?? 0) > 0))).toBe(true);
    }
  });
});

describe('아무것도 없을 때', () => {
  it('빈 입력이면 빈 결과 — 터지지 않는다', () => {
    const r = build({ statements: [] });
    expect(r.entries).toEqual([]);
    expect(r.skipped).toEqual([]);
  });
});

/**
 * **월말 재고 조정** — 매입을 통째로 비용으로 턴 것 중 안 팔리고 남은 만큼을
 * 재고자산(146)으로 되돌린다. 실지재고조사법.
 *
 * 이 자리도 여태 테스트가 없었다. 여기가 틀리면 매출원가가 통째로 밀린다 —
 * 재고가 늘었는데 안 되돌리면 그 달 이익이 그만큼 작아 보인다.
 */
describe('월말 재고 조정 분개', () => {
  const 기초 = { date: '2026-06-30', lines: [{ accountCode: '146', amount: 100_000_000 }] } as never;

  it('재고가 늘면 재고자산 차변 · 매입 대변 — 안 팔린 만큼 비용에서 뺀다', () => {
    const r = build({
      statements: [], opening: 기초,
      inventorySnapshots: [{ yearMonth: '2026-07', value: 120_000_000 }],
    });
    const inv = r.entries.find(e => e.id === 'je-inv-2026-07')!;
    expect(inv).toBeTruthy();
    expect(inv.lines.find(l => l.accountCode === '146')?.debit).toBe(20_000_000);
    expect(inv.lines.find(l => l.debit === 0)?.credit).toBe(20_000_000);
  });

  it('재고가 줄면 반대 — 판 만큼 비용으로 넘긴다', () => {
    const r = build({
      statements: [], opening: 기초,
      inventorySnapshots: [{ yearMonth: '2026-07', value: 85_000_000 }],
    });
    const inv = r.entries.find(e => e.id === 'je-inv-2026-07')!;
    expect(inv.lines.find(l => l.accountCode === '146')?.credit).toBe(15_000_000);
  });

  it('**안 바뀌면 분개를 안 만든다** — 0원짜리 줄이 장부에 쌓이면 읽기만 어려워진다', () => {
    const r = build({
      statements: [], opening: 기초,
      inventorySnapshots: [{ yearMonth: '2026-07', value: 100_000_000 }],
    });
    expect(r.entries.some(e => String(e.id).startsWith('je-inv'))).toBe(false);
  });

  it('**기초 달 이전 실사는 안 센다** — 기초잔액이 이미 그 값을 담고 있다', () => {
    const r = build({
      statements: [], opening: 기초,
      inventorySnapshots: [
        { yearMonth: '2026-06', value: 90_000_000 },   // 기초(6월) — 건너뛴다
        { yearMonth: '2026-07', value: 95_000_000 },
      ],
    });
    expect(r.entries.some(e => e.id === 'je-inv-2026-06')).toBe(false);
    //  7월은 6월 실사값(90M)에서 이어 센다 — 기초 100M 이 아니다
    const inv = r.entries.find(e => e.id === 'je-inv-2026-07')!;
    expect(inv.lines.find(l => l.accountCode === '146')?.debit).toBe(5_000_000);
  });

  it('달이 이어지면 앞 달 실사에서 이어 센다 — 매번 기초에서 세면 이중이 된다', () => {
    const r = build({
      statements: [], opening: 기초,
      inventorySnapshots: [
        { yearMonth: '2026-08', value: 130_000_000 },
        { yearMonth: '2026-07', value: 120_000_000 },   // 순서가 뒤섞여 들어와도
      ],
    });
    expect(r.entries.find(e => e.id === 'je-inv-2026-07')!.lines.find(l => l.accountCode === '146')?.debit).toBe(20_000_000);
    expect(r.entries.find(e => e.id === 'je-inv-2026-08')!.lines.find(l => l.accountCode === '146')?.debit).toBe(10_000_000);
  });

  it('실사가 없으면 조정도 없다', () => {
    const r = build({ statements: [], opening: 기초, inventorySnapshots: [] });
    expect(r.entries.some(e => String(e.id).startsWith('je-inv'))).toBe(false);
  });

  it('재고 조정도 차·대가 맞는다', () => {
    const r = build({
      statements: [], opening: 기초,
      inventorySnapshots: [{ yearMonth: '2026-07', value: 120_000_000 }, { yearMonth: '2026-08', value: 90_000_000 }],
    });
    expect(r.skipped).toEqual([]);
    for (const je of r.entries.filter(e => String(e.id).startsWith('je-inv'))) {
      const dr = je.lines.reduce((a, l) => a + (l.debit ?? 0), 0);
      const cr = je.lines.reduce((a, l) => a + (l.credit ?? 0), 0);
      expect(dr).toBe(cr);
    }
  });
});
