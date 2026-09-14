import { describe, it, expect } from 'vitest';
import { planStatementWrites } from './statementWrites';
import { buildStatementCommand } from './statementCommand';
import type { LineItem } from '../../../shared/statementLines';
import type { IssuedStatement } from '../../../shared/types';

const 줄 = (부분: Partial<LineItem> = {}): LineItem => ({
  key: 'k', no: 1, name: '참기름', spec: '350ml', qty: 1, price: 1000,
  supply: 909, tax: 91, total: 1000, isTaxExempt: false, accountCode: '800', ...부분,
});

const 명령 = (부분 = {}) => buildStatementCommand({
  statementId: 'stmt-1', partnerId: 'C001', partnerName: '일성상회',
  tradeDate: '2026-09-13', type: '매출', docNo: '260913-01',
  lines: [줄()], orderIds: ['ORD-1', 'ORD-2'], ...부분,
});

const 전표 = (부분: Partial<IssuedStatement> = {}): IssuedStatement => ({
  id: 'stmt-1', issuedAt: '2026-09-13T09:00:00+09:00', tradeDate: '2026-09-13',
  type: '매출', partnerId: 'C001', partnerName: '일성상회', orderId: 'ORD-1,ORD-2',
  docNo: '260913-01', totalSupply: 909, totalTax: 91, totalAmount: 1000,
  items: [{ name: '참기름', spec: '350ml', qty: 1, price: 1000, supply: 909, tax: 91, total: 1000, isTaxExempt: false }],
  ...부분,
} as IssuedStatement);

const 계획 = (부분 = {}) => planStatementWrites({ command: 명령(), statement: 전표(), ...부분 });
const 찾기 = (writes: ReturnType<typeof 계획>['writes'], collection: string) =>
  writes.filter(w => w.collection === collection);

describe('planStatementWrites — 전표 한 장이 만드는 쓰기', () => {
  it('전표 본문에 명령 도장을 같이 박는다 — 두 번째 클릭을 거를 열쇠다', () => {
    const [본문] = 찾기(계획().writes, 'issuedStatements');
    expect(본문.id).toBe('stmt-1');
    expect(본문.data.operationId).toBe('stmt-1:ISSUE');
    expect(본문.merge).toBe(false);
  });

  it('본문에 id 칸을 또 넣지 않는다 — 문서 이름이 곧 id 다', () => {
    const [본문] = 찾기(계획().writes, 'issuedStatements');
    expect('id' in 본문.data).toBe(false);
  });

  it('당사자 스냅샷은 명령의 값을 전표 본문에 함께 저장한다', () => {
    const partySnapshot = {
      supplier: { name: '태백식품', bizNo: '1', ceo: '임', addr: '음성', bizType: '제조', bizItem: '식품', tel: '1', fax: '' },
      buyer: { name: '일성상회', bizNo: '2', ceo: '김', addr: '서울', bizType: '', bizItem: '', tel: '2', fax: '' },
    };
    const command = 명령({ partySnapshot });
    const [본문] = 찾기(planStatementWrites({ command, statement: 전표() }).writes, 'issuedStatements');
    expect(본문.data.partySnapshot).toEqual(partySnapshot);
  });

  it('묶인 주문마다 발행표시를 찍는다 — 이게 빠지면 그 주문이 다시 떠서 두 번 발행된다', () => {
    const 주문 = 찾기(계획().writes, 'orders');
    expect(주문.map(w => w.id)).toEqual(['ORD-1', 'ORD-2']);
    expect(주문.every(w => w.data.invoicePrinted === true && w.merge)).toBe(true);
  });

  it('거래처 단가는 **여기 없다** — 박스→낱개 자동 등록 규칙이 붙어 있어 커밋 뒤로 민다', () => {
    expect(찾기(계획().writes, 'partner_item')).toEqual([]);
  });

  it('품목 원가는 쓰기에 넣고, **되말기는 커밋 뒤로** 미룬다', () => {
    const p = 계획({ costUpdates: [{ itemId: 'p-1', price: 800 }] });
    expect(찾기(p.writes, 'items')).toEqual([{ collection: 'items', id: 'p-1', data: { cost: 800 }, merge: true }]);
    expect(p.afterCommit).toEqual([{ kind: 'RECOMPUTE_COSTS', itemIds: ['p-1'] }]);
  });

  it('품목 원가가 바뀌면 근거 전표·줄과 변경 전후 금액을 같은 쓰기에 남긴다', () => {
    const p = 계획({
      costUpdates: [{ itemId: 'p-1', price: 800, beforeCost: 700, sourceLineIndex: 2 }],
      recordedAt: '2026-09-14T10:00:00Z', actorId: 'staff-1',
    });
    expect(찾기(p.writes, 'itemCostHistory')).toEqual([{
      collection: 'itemCostHistory', id: 'stmt-1_p-1_2', merge: false,
      data: {
        itemId: 'p-1', beforeCost: 700, afterCost: 800,
        effectiveAt: '2026-09-13', recordedAt: '2026-09-14T10:00:00Z', actorId: 'staff-1',
        sourceStatementId: 'stmt-1', sourceLineIndex: 2,
      },
    }]);
  });

  it('원가가 그대로면 변경 이력을 만들지 않는다', () => {
    const p = 계획({ costUpdates: [{ itemId: 'p-1', price: 800, beforeCost: 800 }] });
    expect(찾기(p.writes, 'itemCostHistory')).toEqual([]);
  });

  it('원가가 안 바뀌면 뒤로 미룰 일도 없다', () => {
    expect(계획().afterCommit).toEqual([]);
  });

  it('발주카드는 잇는 것과 새로 세우는 것을 가른다', () => {
    const p = 계획({
      poLinks: [{ poId: 'po-1', data: { linkedStatementId: 'stmt-1' } }],
      newPo: { id: 'po-new', data: { partnerId: 'C001' } },
    });
    const po = 찾기(p.writes, 'purchaseOrders');
    expect(po.map(w => [w.id, w.merge])).toEqual([['po-1', true], ['po-new', false]]);
  });

  it('주문이 없는 손입력 전표는 주문 쓰기가 없다', () => {
    expect(찾기(planStatementWrites({ command: 명령({ orderIds: [] }), statement: 전표() }).writes, 'orders')).toEqual([]);
  });
});
