import { describe, it, expect } from 'vitest';
import { createOemEngine, itemKg } from './oemEngine';
import type { Item, PurchaseOrder } from '../../shared/types';

/**
 * 외주 한 바퀴 시뮬레이션 — 실제 데이터 모양 그대로.
 *
 *   보낼 때   참깨(원료)를 푸미푸드로 → 본재고에서 빠짐
 *   받을 때   볶음참깨-낱개/1kg 완제품으로 돌아옴
 *             → 완제품 재고 +N, **원료수불부에는 '볶음참깨'로 입고**
 *
 * 원료수불부에 볶음참깨로 들어오는지가 이 시나리오의 핵심이다.
 * 완제품 이름(볶음참깨-낱개/1kg)이 아니라 BOM이 가리키는 원료 이름으로 잡혀야
 * 수불부가 원료 단위로 묶인다.
 */
/** 원료 홀더 — findRawHolder가 **벌크 서브타입**으로 찾는다(subtype). 실제 DB와 같은 모양. */
const raw = (name: string, stock = 0): Item => ({
  id: `raw-${name}`, name, type: 'goods', category: '참깨', subtype: '벌크',
  price: 0, stock, minStock: 0, unit: 'kg', image: '',
} as unknown as Item);

const oemProduct = (): Item => ({
  id: 'PLDhkjOgcPIhO1hhReHm', name: '볶음참깨-낱개/1kg',
  category: 'goods', subtype: '참깨', spec: '1kg * 1', unit: '개',
  품목: '시골향볶음참깨', procureType: '임가공',
  price: 0, stock: 2, minStock: 0, image: '',
} as unknown as Item);

/** 20개입 박스 — 규격이 다르면 재고도 로트도 품목별로 따로 선다 */
const oemBox20 = (): Item => ({
  id: 'box20', name: '볶음참깨/1kg',
  category: 'goods', subtype: '참깨', spec: '1kg * 20', unit: '박스',
  품목: '시골향볶음참깨', procureType: '임가공',
  price: 0, stock: 15, minStock: 0, image: '',
} as unknown as Item);

/** 시골향볶음참깨 = 볶음참깨 1.0 (constants/formula.ts와 같다) */
const buildFormula = (품목: string) =>
  품목 === '시골향볶음참깨' ? [{ raw: '볶음참깨', ratio: 1.0 }] : [];

function harness(items: Item[]) {
  const lots: { material: string; deltaKg: number; note: string }[] = [];
  const ledger: Record<string, any>[] = [];
  const stocks: Record<string, number> = {};
  const productLots: Record<string, any[]> = {};
  const pos: Record<string, any> = {};
  const engine = createOemEngine({
    items,
    adjustRawLots: async (o) => { lots.push({ material: o.material, deltaKg: o.deltaKg, note: o.note }); },
    updateItem: async (col, id, data) => {
      if (col === 'items' && data.stock != null) stocks[id] = data.stock;
      if (col === 'items' && data.lots) productLots[id] = data.lots;
      if (col === 'purchaseOrders') pos[id] = { ...(pos[id] ?? {}), ...data };
    },
    addItem: async (col, data: any) => {
      if (col === 'rawMaterialLedger') ledger.push(data);
      if (col === 'purchaseOrders') pos[data.id] = data;
      return data.id;
    },
    buildFormula,
  });
  return { engine, lots, ledger, stocks, productLots, pos };
}

describe('외주 한 바퀴 — 참깨 보내고 볶음참깨 받기', () => {
  const items = [raw('참깨', 500), raw('볶음참깨', 0), oemProduct()];

  it('보낼 때 — 참깨가 본재고에서 빠진다', async () => {
    const h = harness(items);
    await h.engine.issueOemBatch({
      oemPartnerId: 'p-pumi', partnerName: '푸미푸드',
      sent: [{ material: '참깨', kg: 100 }], date: '2026-08-20',
    });
    expect(h.lots).toHaveLength(1);
    expect(h.lots[0]).toMatchObject({ material: '참깨', deltaKg: -100 });
    expect(h.lots[0].note).toContain('푸미푸드');
  });

  it('받을 때 — 완제품 재고가 늘고, **실제 원장에는 안 쓴다**(원자화 5단계)', async () => {
    //  예전엔 서류용 kg 을 `rm-oem-...` 로 실제 원장에 남겼는데, 그러면 재고 코어가 그 줄을
    //  원료 이동으로 오해한다(설계 §11·§12). 완포장은 완제품 로트로만 잡히고, 서류(원료수불부)는
    //  판매·완제품 로트를 후처리로 만든다.
    const h = harness(items);
    const po = {
      id: 'oem-1', poType: 'oem', status: 'invoiced', partnerName: '푸미푸드',
      oemSent: [{ material: '참깨', kg: 100 }],
    } as unknown as PurchaseOrder;

    const { receivedKg, loss } = await h.engine.receiveOemBatch({
      po, returns: [{ itemId: 'PLDhkjOgcPIhO1hhReHm', qty: 95 }], date: '2026-08-25',
    });

    // 완제품 95개 = 95kg (1kg * 1)
    expect(receivedKg).toBe(95);
    expect(loss).toBe(5);                       // 보낸 100 − 받은 95
    expect(h.stocks['PLDhkjOgcPIhO1hhReHm']).toBe(2 + 95);

    // 실제 원장에는 완포장 kg 이 안 들어간다 — 재고 코어가 원료 이동으로 오인하지 않게.
    expect(h.ledger).toHaveLength(0);
    // 완포장분은 원료 로트도 안 건드린다 — 재고는 완제품 쪽에 있다
    expect(h.lots).toHaveLength(0);
  });

  it('벌크로 받으면 로트에 쌓이고, 수불부는 두 번 안 잡힌다', async () => {
    const h = harness(items);
    const po = {
      id: 'oem-2', poType: 'oem', status: 'invoiced', partnerName: '푸미푸드',
      oemSent: [{ material: '참깨', kg: 100 }],
    } as unknown as PurchaseOrder;

    const { receivedKg } = await h.engine.receiveOemBatch({
      po, returns: [], bulk: [{ material: '볶음참깨', kg: 96 }], date: '2026-08-25',
    });

    expect(receivedKg).toBe(96);
    // 로트에 +96 — adjustRawLots가 원장 기록까지 함께 한다
    expect(h.lots).toEqual([{ material: '볶음참깨', deltaKg: 96, note: expect.stringContaining('푸미푸드') }]);
    // 그래서 여기서 또 쓰면 두 번 잡힌다 — 안 쓴다
    expect(h.ledger).toHaveLength(0);
  });

  it('완포장 + 벌크를 같이 받아도 각각 제자리로 간다', async () => {
    const h = harness(items);
    const po = {
      id: 'oem-3', poType: 'oem', status: 'invoiced', partnerName: '푸미푸드',
      oemSent: [{ material: '참깨', kg: 100 }],
    } as unknown as PurchaseOrder;

    const { receivedKg } = await h.engine.receiveOemBatch({
      po,
      returns: [{ itemId: 'PLDhkjOgcPIhO1hhReHm', qty: 50 }],
      bulk: [{ material: '볶음참깨', kg: 45 }],
      date: '2026-08-25',
    });

    expect(receivedKg).toBe(95);
    expect(h.stocks['PLDhkjOgcPIhO1hhReHm']).toBe(2 + 50);
    //  완포장분은 원장에 안 남긴다(2026-09-10 원자화 5단계). 벌크만 실제 원장에 붙는다.
    expect(h.ledger).toEqual([]);
    expect(h.lots).toEqual([expect.objectContaining({ material: '볶음참깨', deltaKg: 45 })]);
  });

  it('서류용 품목이 비어 있으면 수불부에 안 잡힌다 — 이게 빠지는 원인', async () => {
    const noPumok = { ...oemProduct(), 품목: '' } as unknown as Item;
    const h = harness([raw('참깨', 500), raw('볶음참깨', 0), noPumok]);
    const po = { id: 'oem-4', poType: 'oem', status: 'invoiced', oemSent: [{ material: '참깨', kg: 100 }] } as unknown as PurchaseOrder;
    await h.engine.receiveOemBatch({ po, returns: [{ itemId: 'PLDhkjOgcPIhO1hhReHm', qty: 95 }], date: '2026-08-25' });
    expect(h.stocks['PLDhkjOgcPIhO1hhReHm']).toBe(2 + 95);   // 재고는 는다
    expect(h.ledger).toHaveLength(0);                         // 수불부엔 안 남는다
  });
});

describe('박스 로트 — 어느 로트가 어디로 갔는지 남는다', () => {
  const items = [raw('참깨', 500), raw('볶음참깨', 0), oemProduct(), oemBox20()];

  it('박스로 받으면 그 품목에 로트가 선다 — 벌크 홀더가 아니라', async () => {
    const h = harness(items);
    const po = {
      id: 'oem-5', poType: 'oem', status: 'invoiced', partnerName: '푸미푸드', oemPartnerId: 'p-pumi',
      oemSent: [{ material: '참깨', kg: 500 }],
    } as unknown as PurchaseOrder;

    await h.engine.receiveOemBatch({ po, returns: [{ itemId: 'box20', qty: 5 }], date: '2026-08-25' });

    // 로트는 박스 품목에 붙었다 — 벌크 홀더(raw-볶음참깨)는 안 건드린다
    expect(h.productLots['raw-볶음참깨']).toBeUndefined();
    const lots = h.productLots['box20'];

    // 로트를 안 쓰던 15박스는 이월로 보존되고, 새로 받은 5박스가 뒤에 붙는다
    expect(lots.map((l: any) => [l.supplierName, l.qtyRemaining])).toEqual([['이월', 15], ['푸미푸드', 5]]);

    const fresh = lots[1];
    expect(fresh).toMatchObject({
      material: '볶음참깨',      // 물질 축 — 벌크 로트와 같은 키로 묶인다
      lotNo: '260825-01',        // 우리가 매긴다
      qtyRemaining: 5,
      unitKg: 20,
      kgRemaining: 100,          // 5박스 × 20kg
      poId: 'oem-5',             // 어느 가공 배치에서 나왔나 → 보낸 참깨로 이어진다
    });
    // 재고 숫자도 그대로 늘어난다 — 로트는 그 옆에 서는 이력이지 재고 권한이 아니다
    expect(h.stocks['box20']).toBe(15 + 5);
  });

  it('규격이 달라도 같은 날 볶은 건 로트번호가 이어진다', async () => {
    const h = harness(items);
    const po = {
      id: 'oem-6', poType: 'oem', status: 'invoiced', partnerName: '푸미푸드',
      oemSent: [{ material: '참깨', kg: 500 }],
    } as unknown as PurchaseOrder;

    await h.engine.receiveOemBatch({
      po,
      returns: [{ itemId: 'box20', qty: 5 }, { itemId: 'PLDhkjOgcPIhO1hhReHm', qty: 30 }],
      date: '2026-08-25',
    });

    // 박스 20입 → -01, 낱개 → -02. 품목이 달라도 번호가 겹치지 않는다(실물 박스와 장부가 같아진다)
    expect(h.productLots['box20'].at(-1).lotNo).toBe('260825-01');
    expect(h.productLots['PLDhkjOgcPIhO1hhReHm'].at(-1).lotNo).toBe('260825-02');
  });

  it('벌크로 받은 몫엔 완제품 로트를 안 만든다 — 원료 로트로 이미 갔다', async () => {
    const h = harness(items);
    const po = { id: 'oem-7', poType: 'oem', status: 'invoiced', partnerName: '푸미푸드', oemSent: [{ material: '참깨', kg: 100 }] } as unknown as PurchaseOrder;
    await h.engine.receiveOemBatch({ po, returns: [], bulk: [{ material: '볶음참깨', kg: 96 }], date: '2026-08-25' });
    expect(h.productLots).toEqual({});
    expect(h.lots).toHaveLength(1);
  });
});

describe('재고 1단위가 몇 kg인가 — 박스 개입수', () => {
  const kgOf = (name: string, spec: string, unit: string) =>
    itemKg({ name, spec, unit } as unknown as Item);

  it('박스는 개입수를 곱한다 — 1kg * 20 = 1박스 20kg', () => {
    expect(kgOf('볶음참깨/1kg', '1kg * 20', '박스')).toBe(20);
    expect(kgOf('볶음참깨/1kg', '1kg * 10', '박스')).toBe(10);
  });

  it('낱개는 그대로 — 1kg * 1 = 1개 1kg', () => {
    expect(kgOf('볶음참깨-낱개/1kg', '1kg * 1', '개')).toBe(1);
  });

  it('이름에 박스 용량이 박혀 있던 옛 품목도 그대로 읽힌다', () => {
    // 규격이 없으면 이름에서 읽는다. 단위가 박스여도 개입수가 없으니 곱하지 않는다.
    expect(kgOf('볶음참깨/20kg박스', '', '박스')).toBe(20);
  });

  it('packageKg가 박혀 있으면 그게 먼저다', () => {
    expect(itemKg({ name: '볶음참깨/1kg', spec: '1kg * 20', unit: '박스', packageKg: 18 } as unknown as Item)).toBe(18);
  });
});
