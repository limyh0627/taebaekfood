import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Item } from './types';

/**
 * **입고는 문 하나로 들어온다.**
 *
 * 예전엔 부르는 자리마다 "원료면 로트+수불부, 아니면 재고만 더하기"를 손으로 갈랐다.
 * 그래서 ① 부자재는 겹쳐 눌러도 막을 데가 없었고(참깨 1500kg 이 원료 쪽에서 실제로 겹쳤다)
 * ② 부자재 입고가 **아무 기록도 안 남아** 제품별원장이 통째로 '설명 안 되는 차이'로 냈다
 * (흐름 0인데 재고만 있는 품목 134개 · 858만원).
 */
const 기록 = vi.hoisted(() => ({ 재고: [] as any[], 입고: [] as any[], 원장: [] as any[], 로트: [] as string[] }));
vi.mock('./services/firebaseService', () => ({
  addItem: async (col: string, data: any) => {
    if (col === 'itemReceipts') 기록.입고.push(data);
    if (col === 'rawMaterialLedger') 기록.원장.push(data);
  },
  adjustItemStock: async (_c: string, id: string, d: number) => { 기록.재고.push({ id, d }); },
  mutateRawMaterialLots: async (id: string) => { 기록.로트.push(id); return []; },
}));

const { recordReceipt } = await import('./receipt');

//  `subtype: '벌크'` 가 홀더 판정의 **유일한 근거**다(itemTaxonomy.isBulkItem).
//  예전엔 `type==='raw'` 로도 봐줬는데, 그 탓에 태백 깻묵이 자리마다 다르게 보였다(2026-09-09).
const 참깨 = (): Item => ({ id: 'raw-sesame', name: '참깨', type: 'raw', subtype: '벌크', unit: 'kg', stock: 0, lots: [] } as unknown as Item);
const 병 = (): Item => ({ id: 'GLA-S-300', name: '300ML-사각병', type: 'submaterial', unit: '개', stock: 0 } as unknown as Item);

const 들어옴 = (product: Item, over: Record<string, unknown> = {}) => recordReceipt({
  allItems: [참깨(), 병()], product, itemName: product.name, quantity: 500, unit: product.unit,
  partnerId: 'p1', partnerName: '미광팩', dateStr: '2026-09-03', nowIso: '2026-09-03T10:00:00.000Z', ...over,
} as never);

beforeEach(() => { 기록.재고 = []; 기록.입고 = []; 기록.원장 = []; 기록.로트 = []; });

describe('갈림은 문 안에 있다', () => {
  it('**원료는 로트와 원료수불부로** — 재고 숫자를 직접 안 만진다', async () => {
    const r = await 들어옴(참깨());
    expect(r.kind).toBe('raw');
    expect(기록.로트).toHaveLength(1);
    expect(기록.원장).toHaveLength(1);
    expect(기록.재고).toHaveLength(0);      // 로트가 재고를 소유한다
    expect(기록.입고).toHaveLength(0);      // 수불부가 이미 담고 있다 — 두 벌로 안 남긴다
  });

  it('**부자재는 재고와 입고기록으로** — 이게 여태 없던 것이다', async () => {
    const r = await 들어옴(병());
    expect(r.kind).toBe('stock');
    expect(기록.재고).toEqual([{ id: 'GLA-S-300', d: 500 }]);
    expect(기록.입고).toHaveLength(1);
    expect(기록.입고[0]).toMatchObject({ itemId: 'GLA-S-300', itemName: '300ML-사각병', quantity: 500, partnerName: '미광팩', date: '2026-09-03' });
    expect(기록.로트).toHaveLength(0);
  });

  it('발주에서 왔으면 어느 발주인지 남긴다 — 되짚을 근거다', async () => {
    await 들어옴(병(), { poId: 'po-9' });
    expect(기록.입고[0].poId).toBe('po-9');
  });

  it('품목을 모르면 아무것도 안 한다 — 지어내지 않는다', async () => {
    const r = await recordReceipt({ allItems: [], itemName: '없는것', quantity: 5,
      partnerName: 'x', dateStr: '2026-09-03', nowIso: '2026-09-03T10:00:00.000Z' } as never);
    expect(r.kind).toBe('none');
    expect(기록.재고).toHaveLength(0);
    expect(기록.입고).toHaveLength(0);
  });

  it('수량이 0이면 안 남긴다 — 0짜리 줄이 원장에 쌓이면 읽기만 어려워진다', async () => {
    expect((await 들어옴(병(), { quantity: 0 })).kind).toBe('none');
    expect(기록.입고).toHaveLength(0);
  });

  it('반품 재입고처럼 음수도 지나간다 — 되돌리는 것도 입고 사건이다', async () => {
    await 들어옴(병(), { quantity: -20 });
    expect(기록.재고).toEqual([{ id: 'GLA-S-300', d: -20 }]);
    expect(기록.입고[0].quantity).toBe(-20);
  });
});

describe('겹쳐 들어온 입고를 막는다 — 부자재도', () => {
  it('**같은 클릭이 세 번 돌아도 한 번만** — 원료만 막혀 있던 자리다', async () => {
    const r = await Promise.all([들어옴(병()), 들어옴(병()), 들어옴(병())]);
    expect(기록.재고).toHaveLength(1);
    expect(기록.입고).toHaveLength(1);
    expect(r.filter(x => x.kind === 'stock')).toHaveLength(1);
    expect(r.filter(x => x.kind === 'skipped')).toHaveLength(2);
  });

  it('끝난 뒤에는 다시 받는다 — 나눠서 두 번 받는 것을 막으면 안 된다', async () => {
    await 들어옴(병());
    await 들어옴(병());
    expect(기록.입고).toHaveLength(2);
  });

  it('발주가 다르면 다른 입고다', async () => {
    await Promise.all([들어옴(병(), { poId: 'a' }), 들어옴(병(), { poId: 'b' })]);
    expect(기록.입고).toHaveLength(2);
  });
});
