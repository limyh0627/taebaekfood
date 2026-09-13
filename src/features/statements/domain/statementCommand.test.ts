import { describe, it, expect } from 'vitest';
import { buildStatementCommand, checkStatementCommand } from './statementCommand';
import type { LineItem } from '../../../shared/statementLines';

/**
 * 전표 명령 — **막는 규칙은 지금 화면이 막는 것 그대로**여야 한다.
 * 검사를 한곳으로 모으는 게 목적이라, 새로 조이면 오늘 되던 발행이 내일 안 된다.
 */

const 줄 = (부분: Partial<LineItem>): LineItem => ({
  key: 'k', no: 1, name: '참기름', spec: '350ml',
  qty: 1, price: 1000, supply: 909, tax: 91, total: 1000,
  isTaxExempt: false, accountCode: '800',
  ...부분,
});

const 명령 = (부분: Partial<Parameters<typeof buildStatementCommand>[0]> = {}) =>
  buildStatementCommand({
    statementId: 'stmt-1', partnerId: 'C001', partnerName: '일성상회',
    tradeDate: '2026-09-13', type: '매출', docNo: '260913-01',
    lines: [줄({})], ...부분,
  });

describe('buildStatementCommand — 흩어진 값을 한 덩이로', () => {
  it('같은 전표를 다시 눌러도 operationId 가 같다 — 두 번째를 거를 수 있어야 한다', () => {
    expect(명령().operationId).toBe(명령().operationId);
    expect(명령().operationId).toBe('stmt-1:ISSUE');
  });

  it('합계를 화면에서 받아 적지 않고 줄에서 셈한다', () => {
    const c = 명령({ lines: [줄({ supply: 909, tax: 91 }), 줄({ supply: 1818, tax: 182 })] });
    expect(c.totals).toEqual({ supply: 2727, tax: 273, amount: 3000 });
  });

  it('양변 전표는 차변만 센다 — 셈이 lineTotals 한 곳에 있으므로 여기서도 같다', () => {
    const c = 명령({
      lines: [
        줄({ side: '차변', supply: 1000, tax: 0, total: 1000 }),
        줄({ side: '대변', supply: 1000, tax: 0, total: 1000 }),
      ],
    });
    expect(c.totals.supply).toBe(1000);
  });

  it('빈 주문 id 는 버리고, 메모는 앞뒤 공백을 턴다', () => {
    const c = 명령({ orderIds: ['ORD-1', '', 'ORD-2'], memo: '  급한 건  ' });
    expect(c.orderIds).toEqual(['ORD-1', 'ORD-2']);
    expect(c.memo).toBe('급한 건');
  });

  it('빈 메모는 칸 자체를 안 만든다 — 빈 글자를 저장해 두면 나중에 둘을 다 따져야 한다', () => {
    expect('memo' in 명령({ memo: '   ' })).toBe(false);
  });
});

describe('checkStatementCommand — 막는 것', () => {
  it('성한 명령은 통과한다', () => {
    const r = checkStatementCommand(명령());
    expect(r.ok).toBe(true);
    expect(r.rejections).toEqual([]);
  });

  it('계정과목이 없는 줄을 집어낸다 — 몇 번째 줄인지까지', () => {
    const r = checkStatementCommand(명령({
      lines: [줄({}), 줄({ name: '들기름', accountCode: undefined })],
    }));
    expect(r.ok).toBe(false);
    const 걸림 = r.rejections.find(x => x.code === 'NO_ACCOUNT_CODE')!;
    expect(걸림.lineIndexes).toEqual([1]);
    expect(걸림.lineNames).toEqual(['들기름']);
  });

  it('단가 0 은 막고 **음수는 통과**시킨다 — 할인·반품 줄이 단독으로 설 수 있어야 한다', () => {
    const 영 = checkStatementCommand(명령({ lines: [줄({ price: 0 })] }));
    expect(영.rejections.map(x => x.code)).toContain('ZERO_PRICE');

    const 음수 = checkStatementCommand(명령({ lines: [줄({ price: -5000, supply: -4545, tax: -455 })] }));
    expect(음수.ok).toBe(true);
  });

  it('거래처·거래일·줄이 없으면 막는다', () => {
    const r = checkStatementCommand(명령({ partnerId: '', tradeDate: '', lines: [] }));
    expect(r.rejections.map(x => x.code).sort())
      .toEqual(['NO_LINES', 'NO_PARTNER', 'NO_TRADE_DATE']);
  });
});

describe('checkStatementCommand — 알리기만 하는 것', () => {
  it('품목 줄인데 id 가 없으면 **막지 않고 알린다** — 지금도 발행은 된다', () => {
    const r = checkStatementCommand(명령({
      lines: [줄({ lineKind: 'item', itemId: undefined, unknownItem: true })],
    }));
    expect(r.ok).toBe(true);
    expect(r.warnings.map(w => w.code)).toContain('ITEM_LINE_WITHOUT_ID');
  });

  it('계정 줄은 id 가 없어도 아무 말 안 한다 — 택배비에 품목이 없는 건 정상이다', () => {
    const r = checkStatementCommand(명령({
      lines: [줄({ name: '택배비', lineKind: 'account', itemId: undefined, accountCode: '800' })],
    }));
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('과세·면세를 아무도 안 정한 줄을 알린다', () => {
    const r = checkStatementCommand(명령({ lines: [줄({ taxUnknown: true })] }));
    expect(r.warnings.map(w => w.code)).toContain('TAX_UNDECIDED');
  });
});
