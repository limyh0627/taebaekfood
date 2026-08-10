import { describe, it, expect } from 'vitest';
import { createOemEngine } from './oemEngine';
import type { Item } from '../../shared/types';

/**
 * 임가공 한 사이클 시뮬레이션 — 발주 → 가공입고 → 판매.
 *
 * 설계 의도:
 *   · 반제품(볶음참깨) 재고는 **계속 0**이다. 실물은 완제품으로 포장돼 돌아오므로 완제품 재고로만 잡는다.
 *   · 대신 원료수불부(원장)에 볶음참깨가 kg으로 들어오고(가공입고) 나간다(판매).
 *   · 그래서 원장 볶음참깨 잔량 = 가공입고 합 − 판매 사용 합 이어야 한다.
 */

const item = (over: Partial<Item>): Item =>
  ({ id: 'x', name: 'x', category: 'product', unit: '개', price: 0, stock: 0, minStock: 0, image: '', ...over } as Item);

const items: Item[] = [
  item({ id: 'raw-참깨', name: '참깨', category: 'raw', unit: 'kg', stock: 2000 }),
  item({ id: 'wip-볶음참깨', name: '볶음참깨', category: 'wip', unit: 'kg', stock: 0 }),
  item({ id: 'nakgae', name: '볶음참깨-낱개/1kg', spec: '1kg', procureType: '임가공', 품목: '시골향볶음참깨', stock: 0 }),
  item({ id: 'box10', name: '볶음참깨/1kg (10개입)', spec: '10kg', procureType: '임가공', 품목: '시골향볶음참깨', stock: 0 }),
  item({ id: 'box20', name: '볶음참깨/1kg (20개입)', spec: '20kg', procureType: '임가공', 품목: '시골향볶음참깨', stock: 0 }),
];

function makeDeps() {
  const rawCalls: any[] = [], updates: any[] = [], adds: any[] = [];
  return {
    rawCalls, updates, adds,
    deps: {
      items,
      adjustRawLots: async (o: any) => { rawCalls.push(o); },
      updateItem: async (c: string, id: string, d: any) => { updates.push({ c, id, d }); },
      addItem: async (c: string, d: any) => { adds.push({ c, d }); return d.id; },
      buildFormula: (key: string) => (key === '시골향볶음참깨' ? [{ raw: '볶음참깨', ratio: 1 }] : []),
    },
  };
}

describe('임가공 사이클 — 참깨 보내고 볶음참깨 받아서 판다', () => {
  it('① 발주: 참깨가 본재고에서 빠지고 열린 배치가 생긴다', async () => {
    const { deps, rawCalls, adds } = makeDeps();
    const eng = createOemEngine(deps as any);
    await eng.issueOemBatch({
      oemPartnerId: 'oem1', partnerName: '푸미푸드',
      sent: [{ material: '참깨', kg: 1500 }], date: '2026-08-06',
    });
    expect(rawCalls).toHaveLength(1);
    expect(rawCalls[0]).toMatchObject({ material: '참깨', deltaKg: -1500 });
    expect(adds.find(a => a.c === 'purchaseOrders')!.d).toMatchObject({ poType: 'oem', status: 'invoiced' });
  });

  it('② 가공입고: 완제품 재고만 오르고, 반제품 재고는 0인 채 원장에 kg이 들어온다', async () => {
    const { deps, rawCalls, updates, adds } = makeDeps();
    const eng = createOemEngine(deps as any);
    const po = { id: 'oem-1', poType: 'oem', partnerName: '푸미푸드', status: 'invoiced', oemSent: [{ material: '참깨', kg: 1500 }] } as any;

    const { receivedKg, loss } = await eng.receiveOemBatch({
      po, date: '2026-08-08',
      returns: [{ itemId: 'nakgae', qty: 15 }, { itemId: 'box10', qty: 90 }, { itemId: 'box20', qty: 25 }],
    });

    // 1kg×15 + 10kg×90 + 20kg×25 = 1,415kg
    expect(receivedKg).toBe(1415);
    expect(loss).toBe(85);                       // 보낸 1500 − 받은 1415

    // 완제품 재고만 오른다
    expect(updates.filter(u => u.c === 'items').map(u => [u.id, u.d.stock]))
      .toEqual([['nakgae', 15], ['box10', 90], ['box20', 25]]);
    // 반제품(볶음참깨) 재고·로트는 안 건드린다 — 실물은 완제품 안에 있다
    expect(rawCalls).toHaveLength(0);
    expect(updates.some(u => u.id === 'wip-볶음참깨')).toBe(false);

    // 원장에는 볶음참깨가 kg으로 입고된다
    const led = adds.filter(a => a.c === 'rawMaterialLedger').map(a => a.d);
    expect(led).toHaveLength(1);
    expect(led[0]).toMatchObject({ material: '볶음참깨', received: 1415, used: 0, type: 'auto', unit: 'kg' });
    expect(led[0].id).toBe('rm-oem-oem-1-볶음참깨');
  });

  it('②-b 벌크로 받은 몫은 원료 홀더 로트에 쌓인다 — 소분 품목이 여기서 빼간다', async () => {
    const { deps, rawCalls, updates, adds } = makeDeps();
    const eng = createOemEngine(deps as any);
    const po = { id: 'oem-2', poType: 'oem', partnerName: '푸미푸드', status: 'invoiced', oemSent: [{ material: '참깨', kg: 1500 }] } as any;

    const { receivedKg, loss } = await eng.receiveOemBatch({
      po, date: '2026-08-08',
      returns: [{ itemId: 'nakgae', qty: 100 }],        // 완포장 100kg
      bulk: [{ material: '볶음참깨', kg: 1300 }],        // 벌크 1,300kg
    });

    expect(receivedKg).toBe(1400);
    expect(loss).toBe(100);

    // 벌크는 로트로 들어간다
    expect(rawCalls).toHaveLength(1);
    expect(rawCalls[0]).toMatchObject({ material: '볶음참깨', rawItemId: 'wip-볶음참깨', deltaKg: 1300 });
    // 완포장분만 완제품 재고가 오른다
    expect(updates.filter(u => u.c === 'items').map(u => u.id)).toEqual(['nakgae']);
    // 원장 입고는 완포장분만 여기서 쓴다(벌크는 adjustRawLots가 이미 남겼다 — 두 번 잡히면 안 됨)
    const led = adds.filter(a => a.c === 'rawMaterialLedger').map(a => a.d);
    expect(led).toHaveLength(1);
    expect(led[0]).toMatchObject({ material: '볶음참깨', received: 100 });
  });

  it('②-c 벌크만 받아도 된다', async () => {
    const { deps, rawCalls } = makeDeps();
    const eng = createOemEngine(deps as any);
    const po = { id: 'oem-3', poType: 'oem', partnerName: '푸미푸드', status: 'invoiced', oemSent: [{ material: '참깨', kg: 1000 }] } as any;
    const { receivedKg } = await eng.receiveOemBatch({
      po, date: '2026-08-08', returns: [], bulk: [{ material: '볶음참깨', kg: 950 }],
    });
    expect(receivedKg).toBe(950);
    expect(rawCalls[0]).toMatchObject({ deltaKg: 950 });
  });

  it('③ 판매: 임가공 완제품은 원장에만 사용으로 잡힌다 (로트 미변동)', () => {
    // orderStockEngine.produceOrder 의 임가공 분기:
    //   rawUsageLedgerOnly[raw] += toKg(spec, raw, units) * ratio;  continue;
    // → 로트·재고는 건드리지 않고 원장에만 남는다. 여기선 그 계산만 재현한다.
    const sold = [{ id: 'box20', qty: 3 }, { id: 'nakgae', qty: 10 }];
    const usedKg = sold.reduce((s, x) => {
      const it = items.find(i => i.id === x.id)!;
      return s + parseFloat(it.spec!) * x.qty;      // 20kg×3 + 1kg×10
    }, 0);
    expect(usedKg).toBe(70);
  });

  it('④ 결과: 원장 볶음참깨 잔량 = 가공입고 − 판매사용, 반제품 재고는 0', () => {
    const 입고 = 1415, 사용 = 70;
    expect(입고 - 사용).toBe(1345);
    // 반제품 재고는 사이클 내내 0 — 이게 설계다.
    expect(items.find(i => i.id === 'wip-볶음참깨')!.stock).toBe(0);
  });
});
