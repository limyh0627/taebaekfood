import { describe, it, expect } from 'vitest';
import { createOemEngine, itemKg } from './oemEngine';
import type { Item, PurchaseOrder } from '../../shared/types';

const item = (over: Partial<Item>): Item =>
  ({ id: 'x', name: 'x', category: 'product', unit: '개', price: 0, stock: 0, minStock: 0, image: '', ...over });

// 참깨(raw 홀더) + 볶음참깨 완제품/벌크
const items: Item[] = [
  item({ id: 'raw-참깨', name: '참깨', category: 'raw', unit: 'kg', stock: 5000 }),
  item({ id: 'raw-볶음참깨', name: '볶음참깨', category: 'wip', unit: 'kg', stock: 0 }),
  item({ id: 'box10', name: '볶음참깨/10kg박스', spec: '10kg', procureType: '임가공', stock: 0 }),
  item({ id: 'box20', name: '볶음참깨/20kg박스', spec: '20kg', procureType: '임가공', stock: 0 }),
  item({ id: 'nakgae', name: '볶음참깨-낱개/1kg', spec: '1kg', procureType: '임가공', stock: 0 }),
];

/** mock deps — 쓰기 호출을 기록만 한다 */
function makeDeps() {
  const rawCalls: any[] = [];
  const updates: any[] = [];
  const adds: any[] = [];
  const deps = {
    items,
    adjustRawLots: async (o: any) => { rawCalls.push(o); },
    updateItem: async (c: string, id: string, d: any) => { updates.push({ c, id, d }); },
    addItem: async (c: string, d: any) => { adds.push({ c, d }); return d.id; },
  };
  return { deps, rawCalls, updates, adds };
}

describe('itemKg', () => {
  it('spec에서 kg 파싱', () => {
    expect(itemKg(item({ spec: '10kg' }))).toBe(10);
    expect(itemKg(item({ spec: '1kg' }))).toBe(1);
    expect(itemKg(item({ packageKg: 20, spec: '' }))).toBe(20);
    expect(itemKg(item({ spec: '' }))).toBe(0);
  });
});

describe('issueOemBatch (발주)', () => {
  it('본재고 FIFO 차감 + 열린 OEM 배치 생성', async () => {
    const { deps, rawCalls, adds } = makeDeps();
    const eng = createOemEngine(deps as any);
    const { poId } = await eng.issueOemBatch({
      oemPartnerId: 'oem1', partnerName: 'OO상회',
      sent: [{ material: '참깨', kg: 1000 }], date: '2026-07-17',
    });

    // 참깨 1000kg 차감
    expect(rawCalls).toHaveLength(1);
    expect(rawCalls[0]).toMatchObject({ material: '참깨', rawItemId: 'raw-참깨', deltaKg: -1000 });
    // OEM 배치 카드 (열림)
    const po = adds.find(a => a.c === 'purchaseOrders')!.d;
    expect(po).toMatchObject({ poType: 'oem', status: 'invoiced', oemPartnerId: 'oem1' });
    expect(po.oemSent).toEqual([{ material: '참깨', kg: 1000 }]);
    expect(poId).toBe(po.id);
  });

  it('원료 홀더가 없으면 던진다', async () => {
    const { deps } = makeDeps();
    const eng = createOemEngine(deps as any);
    await expect(eng.issueOemBatch({
      oemPartnerId: 'oem1', partnerName: 'OO', sent: [{ material: '없는원료', kg: 100 }], date: '2026-07-17',
    })).rejects.toThrow('원료 홀더');
  });
});

describe('receiveOemBatch (가공입고)', () => {
  const openPo: PurchaseOrder = {
    id: 'oem-1', poType: 'oem', partnerName: 'OO상회', oemPartnerId: 'oem1',
    oemSent: [{ material: '참깨', kg: 1000 }], status: 'invoiced',
    itemId: '', itemName: '', quantity: 0, createdAt: '',
  };

  it('완제품 박스/낱개 재고 +N, 가공비 전표(과세), 로스 자동', async () => {
    const { deps, updates, adds } = makeDeps();
    const eng = createOemEngine(deps as any);
    // 10kg박스 20 + 20kg박스 10 + 낱개 5 = 200+200+5 = 405kg 받음 (참깨 1000 보냈으니 로스 595? — 예시값)
    const res = await eng.receiveOemBatch({
      po: openPo,
      returns: [{ itemId: 'box10', qty: 20 }, { itemId: 'box20', qty: 10 }, { itemId: 'nakgae', qty: 5 }],
      unitPricePerKg: 2000, date: '2026-07-17',
    });

    expect(res.receivedKg).toBe(405);
    expect(res.loss).toBe(595);            // 1000 − 405

    // 완제품 3종 재고 가산
    expect(updates.filter(u => u.c === 'items').map(u => [u.id, u.d.stock])).toEqual([
      ['box10', 20], ['box20', 10], ['nakgae', 5],
    ]);
    // 가공비 전표: 405 × 2000 = 810,000 + 세액 81,000
    const stmt = adds.find(a => a.c === 'issuedStatements')!.d;
    expect(stmt).toMatchObject({ type: '매입', totalSupply: 810_000, totalTax: 81_000, totalAmount: 891_000 });
    expect(stmt.items[0].accountCode).toBe('540');
    // 배치 닫힘 + 전표 연결
    const poUpd = updates.find(u => u.c === 'purchaseOrders')!;
    expect(poUpd.d).toMatchObject({ status: 'received', oemReceivedKg: 405, linkedStatementId: stmt.id });
  });

  it('면세면 세액 0', async () => {
    const { deps, adds } = makeDeps();
    const eng = createOemEngine(deps as any);
    await eng.receiveOemBatch({
      po: openPo, returns: [{ itemId: 'nakgae', qty: 100 }], unitPricePerKg: 2000, date: '2026-07-17', taxable: false,
    });
    const stmt = adds.find(a => a.c === 'issuedStatements')!.d;
    expect(stmt.totalTax).toBe(0);
  });

  it('이미 받은 배치는 던진다', async () => {
    const { deps } = makeDeps();
    const eng = createOemEngine(deps as any);
    await expect(eng.receiveOemBatch({
      po: { ...openPo, status: 'received' }, returns: [{ itemId: 'nakgae', qty: 1 }], unitPricePerKg: 2000, date: '2026-07-17',
    })).rejects.toThrow('이미 가공입고');
  });
});
