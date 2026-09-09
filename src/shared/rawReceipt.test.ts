import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Item } from './types';

/**
 * **같은 입고가 두 번 들어가면 안 된다.**
 *
 * 2026-08-06 에 참깨 1500kg 이 실제로 두 번 들어갔다 —
 * 원장 두 줄(`rm-rcv-1786002454697-78qi` · `rm-rcv-1786002454804-khj5`, **107밀리초 차이**)에
 * 로트도 둘(`260806-02` · `260806-03`). 같은 클릭이 두 번 돈 것이다.
 *
 * 차감 쪽은 원장 id 가 `rm-auto-{주문}-{원료}` 로 고정이라 두 번 처리해도 덮어써지는데,
 * 입고 쪽은 `rm-rcv-{지금}-{난수}` 라 부를 때마다 새 줄이 섰다. 로트도 하나 더 서서
 * 원료가 실제보다 많이 들어온 것으로 남는다.
 */
const 기록 = vi.hoisted(() => ({ 명령: [] as any[], 옵션: [] as any[] }));
vi.mock('./services/firebaseService', () => ({
  addItem: async () => {},
  mutateRawMaterialLots: async () => [],
}));
//  이제 입고는 **한 명령**으로 나간다 — 로트와 원장이 한 트랜잭션에 같이 들어간다.
vi.mock('./services/rawInventoryService', () => ({
  executeRawInventoryCommand: async (command: any, options: any) => {
    기록.명령.push(command); 기록.옵션.push(options);
    return { status: 'applied', state: {}, movement: {} };
  },
}));

const { recordRawMaterialReceipt } = await import('./rawReceipt');

//  `subtype: '벌크'` 가 홀더 판정의 **유일한 근거**다(itemTaxonomy.isBulkItem).
//  예전엔 `type==='raw'` 로도 봐줬는데, 그 탓에 태백 깻묵이 자리마다 다르게 보였다(2026-09-09).
const 참깨 = (): Item => ({ id: 'raw-sesame', name: '참깨', type: 'raw', subtype: '벌크', unit: 'kg', stock: 0, lots: [] } as unknown as Item);
const 입고 = (over: Record<string, unknown> = {}) => recordRawMaterialReceipt({
  allItems: [참깨()], itemName: '참깨', quantity: 1500, unit: 'kg',
  partnerId: 'p1', partnerName: '한국농수산물유통공사',
  dateStr: '2026-08-06', nowIso: '2026-08-06T07:47:34.000Z', ...over,
} as never);

beforeEach(() => { 기록.명령 = []; 기록.옵션 = []; });

describe('겹쳐 들어온 입고를 막는다', () => {
  it('**같은 클릭이 세 번 돌아도 한 번만 들어간다** — 실제로 107ms 차이로 두 번 들어갔다', async () => {
    const r = await Promise.all([입고(), 입고(), 입고()]);
    expect(기록.명령).toHaveLength(1);
    expect(기록.명령).toHaveLength(1);
    //  막힌 쪽은 '기록했다'고 거짓말하지 않는다
    expect(r.filter(x => x.recorded)).toHaveLength(1);
  });

  it('**끝난 뒤에는 다시 받는다** — 분할 입고까지 막으면 안 된다', async () => {
    await 입고();
    await 입고();
    expect(기록.명령).toHaveLength(2);
  });

  it('수량이 다르면 다른 입고다', async () => {
    await Promise.all([입고(), 입고({ quantity: 800 })]);
    expect(기록.명령).toHaveLength(2);
  });

  it('날짜가 다르면 다른 입고다', async () => {
    await Promise.all([입고(), 입고({ dateStr: '2026-08-07' })]);
    expect(기록.명령).toHaveLength(2);
  });

  it('거래처가 다르면 다른 입고다 — 같은 날 같은 양을 두 곳에서 받을 수 있다', async () => {
    await Promise.all([입고(), 입고({ partnerId: 'p2', partnerName: '카프코' })]);
    expect(기록.명령).toHaveLength(2);
  });

  it('발주가 다르면 다른 입고다', async () => {
    await Promise.all([입고({ poId: 'po-1' }), 입고({ poId: 'po-2' })]);
    expect(기록.명령).toHaveLength(2);
  });
});

describe('원료로 안 잡히는 입고', () => {
  it('원료 목록(RM_LIST)에 없으면 아무것도 안 남긴다 — 부자재는 여기 오지 않는다', async () => {
    const r = await recordRawMaterialReceipt({
      allItems: [참깨()], itemName: '병뚜껑', quantity: 100, unit: '개',
      partnerName: '미광팩', dateStr: '2026-08-06', nowIso: '2026-08-06T07:47:34.000Z',
    } as never);
    expect(r.recorded).toBe(false);
    expect(기록.명령).toHaveLength(0);
    expect(기록.명령).toHaveLength(0);
  });
});

describe('입고량을 kg 으로 옮긴다', () => {
  it('kg 으로 들어오면 그대로', async () => {
    await 입고();
    expect(기록.명령[0].kg).toBe(1500);
    expect(기록.명령[0].materialSnapshot).toBe('참깨');
    expect(기록.명령[0].kind).toBe('receive');
  });
});
