import { describe, it, expect } from 'vitest';
import { partnerPriceWrites } from './partnerPriceSync';
import type { PartnerItem, Item } from './types';

/**
 * 이 셈이 세 벌로 쓰여 있어서 갈렸다. 갈린 자리를 여기 잠근다 —
 * 발행과 수정이 **같은 답**을 내는지가 이 파일의 전부다.
 */
const 품목: Pick<Item, 'id' | 'name' | '품목'>[] = [
  { id: 'i1', name: '참기름 500ml', 품목: '참기름' },
  { id: 'i2', name: '들기름 500ml', 품목: '들기름' },
] as never;

const 줄 = (name: string, price: number, over: Record<string, unknown> = {}) =>
  ({ itemId: name === '참기름 500ml' ? 'i1' : name === '들기름 500ml' ? 'i2' : undefined,
    name, price, accountCode: '800', isTaxExempt: true, ...over });

const 단가 = (over: Partial<PartnerItem>): PartnerItem =>
  ({ id: 'pi1', itemId: 'i1', partnerId: 'p1', Direction: 'out', price: 5000, taxType: '면세', ...over } as PartnerItem);

describe('전표 단가를 거래처 단가로 되민다', () => {
  it('매출 — 바뀐 값을 되민다', () => {
    const r = partnerPriceWrites({
      type: '매출', partnerId: 'p1', lines: [줄('참기름 500ml', 6000)],
      items: 품목, partnerItems: [단가({ price: 5000 })],
    });
    expect(r.upserts).toHaveLength(1);
    expect(r.upserts[0]).toMatchObject({ id: 'pi1', itemId: 'i1', partnerId: 'p1', Direction: 'out', price: 6000 });
    //  원가는 산 값에서 온다 — 판 값으로 원가를 건드리면 안 된다
    expect(r.costUpdates).toEqual([]);
  });

  it('매출 — 안 바뀌었으면 안 쓴다', () => {
    const r = partnerPriceWrites({
      type: '매출', partnerId: 'p1', lines: [줄('참기름 500ml', 5000)],
      items: 품목, partnerItems: [단가({ price: 5000, Account_Code: '800' })],
    });
    expect(r.upserts).toEqual([]);
  });

  it('매출 — 값은 같아도 계정이 바뀌었으면 쓴다', () => {
    const r = partnerPriceWrites({
      type: '매출', partnerId: 'p1', lines: [줄('참기름 500ml', 5000, { accountCode: '404' })],
      items: 품목, partnerItems: [단가({ price: 5000, Account_Code: '800' })],
    });
    expect(r.upserts[0].Account_Code).toBe('404');
  });

  it('매입 — 안 바뀌었어도 늘 쓴다. 구독이 늦으면 비교가 빗나가 통째로 샌다', () => {
    const r = partnerPriceWrites({
      type: '매입', partnerId: 'p1', lines: [줄('참기름 500ml', 3000)],
      items: 품목, partnerItems: [단가({ id: 'pi-in', Direction: 'in', price: 3000 })],
    });
    expect(r.upserts).toHaveLength(1);
    expect(r.upserts[0].Direction).toBe('in');
    //  매입 단가는 원가로도 흘러간다
    expect(r.costUpdates).toEqual([{ itemId: 'i1', price: 3000 }]);
  });

  it('처음 보는 품목이면 id 를 새로 짓는다 — 방향까지 붙여야 매입·매출이 안 겹친다', () => {
    const r = partnerPriceWrites({
      type: '매출', partnerId: 'p1', lines: [줄('들기름 500ml', 9000)],
      items: 품목, partnerItems: [],
    });
    expect(r.upserts[0].id).toBe('i2_p1_out');
    const 매입 = partnerPriceWrites({
      type: '매입', partnerId: 'p1', lines: [줄('들기름 500ml', 9000)],
      items: 품목, partnerItems: [],
    });
    expect(매입.upserts[0].id).toBe('i2_p1_in');
  });

  it('과세·면세를 단가와 같이 쓴다 — 따로 두면 면세로 끊어도 다음 전표가 과세로 열린다', () => {
    const r = partnerPriceWrites({
      type: '매출', partnerId: 'p1', lines: [줄('참기름 500ml', 6000, { isTaxExempt: false })],
      items: 품목, partnerItems: [단가({ taxType: '면세' })],
    });
    expect(r.upserts[0].taxType).toBe('과세');
  });

  it('그 방향 단가만 본다 — 매입 값을 매출 비교에 쓰면 안 된다', () => {
    const r = partnerPriceWrites({
      type: '매출', partnerId: 'p1', lines: [줄('참기름 500ml', 6000)],
      items: 품목,
      partnerItems: [단가({ id: 'pi-in', Direction: 'in', price: 6000 })],   // 매입은 6000
    });
    //  매출에는 저장된 게 없으니 새로 쓴다
    expect(r.upserts).toHaveLength(1);
    expect(r.upserts[0].id).toBe('i1_p1_out');
  });
});

describe('안 쓰는 자리', () => {
  it('ID 없는 옛 전표는 이름이 같아도 거래처 단가를 건드리지 않는다', () => {
    for (const itemId of [undefined, '', '삭제된품목']) {
      expect(partnerPriceWrites({ type: '매출', partnerId: 'p1',
        lines: [줄('참기름 500ml', 7000, { itemId })], items: 품목, partnerItems: [],
      }).upserts).toEqual([]);
    }
  });
  it('"이번 전표에만"이라고 답한 품목은 안 쓴다 — 발행이든 수정이든', () => {
    const 입력 = {
      partnerId: 'p1', lines: [줄('참기름 500ml', 6000)], items: 품목, partnerItems: [],
      noLinkIds: new Set(['i1']),
    };
    expect(partnerPriceWrites({ ...입력, type: '매출' }).upserts).toEqual([]);
    expect(partnerPriceWrites({ ...입력, type: '매입' }).upserts).toEqual([]);
    expect(partnerPriceWrites({ ...입력, type: '매입' }).costUpdates).toEqual([]);
  });

  it('단가가 0이거나 없으면 안 쓴다 — 0을 되밀면 다음 전표가 0으로 열린다', () => {
    for (const p of [0, undefined, -100]) {
      const r = partnerPriceWrites({
        type: '매출', partnerId: 'p1', lines: [줄('참기름 500ml', p as number)],
        items: 품목, partnerItems: [],
      });
      expect(r.upserts).toEqual([]);
    }
  });

  it('품목 원장에 없는 이름(택배비·상차비 같은 비용 줄)은 안 쓴다', () => {
    const r = partnerPriceWrites({
      type: '매입', partnerId: 'p1', lines: [줄('택배비', 30000)],
      items: 품목, partnerItems: [],
    });
    expect(r.upserts).toEqual([]);
    expect(r.costUpdates).toEqual([]);
  });

  it('거래처를 안 골랐으면 아무것도 안 쓴다', () => {
    const r = partnerPriceWrites({
      type: '매출', partnerId: '', lines: [줄('참기름 500ml', 6000)],
      items: 품목, partnerItems: [],
    });
    expect(r.upserts).toEqual([]);
  });

  it('매출·매입이 아닌 전표(비용·기초이월)는 거래처 단가를 안 건드린다', () => {
    const r = partnerPriceWrites({
      type: '비용', partnerId: 'p1', lines: [줄('참기름 500ml', 6000)],
      items: 품목, partnerItems: [],
    });
    expect(r.upserts).toEqual([]);
  });
});

describe('해피유통 단가 누락 회귀', () => {
  it('이름이 같은 박스 대신 선택한 낱개 ID에 단가와 과세를 쓴다', () => {
    const items = [{ id: 'box', name: '생들기름/300ml' }, { id: 'loose', name: '생들기름/300ml' }];
    const r = partnerPriceWrites({ type: '매출', partnerId: 'p1', items,
      lines: [{ itemId: 'loose', name: '생들기름/300ml', price: 6000, isTaxExempt: false, accountCode: '800' }],
      partnerItems: [{ id: 'box-p1', itemId: 'box', partnerId: 'p1', Direction: 'out', price: 6000, Account_Code: '800' }],
    });
    expect(r.upserts).toHaveLength(1);
    expect(r.upserts[0]).toMatchObject({ itemId: 'loose', price: 6000, taxType: '과세' });
  });

  it.each([
    ['과세', true, '면세'], ['면세', false, '과세'], [undefined, false, '과세'], [undefined, true, '면세'],
  ] as const)('단가·계정이 같아도 %s에서 면세=%s로 정하면 %s를 저장한다', (before, isTaxExempt, after) => {
    const r = partnerPriceWrites({ type: '매출', partnerId: 'p1', items: 품목,
      lines: [줄('참기름 500ml', 5000, { isTaxExempt })],
      partnerItems: [단가({ taxType: before, Account_Code: '800' })],
    });
    expect(r.upserts).toHaveLength(1);
    expect(r.upserts[0].taxType).toBe(after);
  });

  it('표시 이름을 달리 적어도 ID가 같으면 같은 품목에 저장한다', () => {
    const r = partnerPriceWrites({ type: '매출', partnerId: 'p1', items: 품목, partnerItems: [],
      lines: [줄('별도 인쇄 이름', 6000, { itemId: 'i1' })],
    });
    expect(r.upserts[0].itemId).toBe('i1');
  });
});

describe('발행과 수정이 같은 답을 낸다 — 갈려 있던 자리', () => {
  const 공통 = { partnerId: 'p1', items: 품목, partnerItems: [] as PartnerItem[] };

  it('매출을 고쳐도 발행과 같이 되민다 — 예전엔 수정 경로에 매출이 아예 없었다', () => {
    const 발행 = partnerPriceWrites({ ...공통, type: '매출', lines: [줄('참기름 500ml', 7000)] });
    const 수정 = partnerPriceWrites({ ...공통, type: '매출', lines: [줄('참기름 500ml', 7000)] });
    expect(수정).toEqual(발행);
    expect(수정.upserts[0].price).toBe(7000);
  });

  it('"아니요"의 뜻이 수정에서도 지켜진다 — 예전엔 수정이 무시했다', () => {
    const noLinkIds = new Set(['i1']);
    const 발행 = partnerPriceWrites({ ...공통, type: '매입', lines: [줄('참기름 500ml', 3000)], noLinkIds });
    const 수정 = partnerPriceWrites({ ...공통, type: '매입', lines: [줄('참기름 500ml', 3000)], noLinkIds });
    expect(수정).toEqual(발행);
    expect(수정.upserts).toEqual([]);
  });
});

/**
 * **옛 전표를 고쳐도 거래처 단가는 안 바뀐다**(2026-09-09 사장님:
 * "옛 전표는 고쳐도 단가 반영이 안되도 돼 그게 그 거래처의 최신 전표가 아니면").
 *
 * 거래처 단가는 "지금 파는 값"이다. 6월 오타를 고쳤다고 오늘 값이 6월로 돌아가면 안 된다.
 * **어느 전표가 최신인지는 여기서 안 센다** — [latestStatement](./latestStatement.ts) 가 판정해
 * 넘겨준다. 여기는 그 답을 지키기만 한다.
 */
describe('최신 전표일 때만 되민다', () => {
  const 공통 = { partnerId: 'p1', items: 품목, partnerItems: [] as PartnerItem[], type: '매출' as const };

  it('최신이면 되민다', () => {
    const r = partnerPriceWrites({ ...공통, lines: [줄('참기름 500ml', 7000)], isLatest: true });
    expect(r.upserts).toHaveLength(1);
  });

  it('최신이 아니면 아무것도 안 쓴다 — 매출도 매입도', () => {
    expect(partnerPriceWrites({ ...공통, lines: [줄('참기름 500ml', 7000)], isLatest: false }).upserts).toEqual([]);
    const 매입 = partnerPriceWrites({ ...공통, type: '매입', lines: [줄('참기름 500ml', 3000)], isLatest: false });
    expect(매입.upserts).toEqual([]);
    //  매입은 원가로도 흘러간다 — 그것도 같이 막혀야 한다
    expect(매입.costUpdates).toEqual([]);
  });

  it('안 넘기면 되민다 — 이 규칙을 모르는 옛 부름자의 뜻은 "늘 되민다" 였다', () => {
    expect(partnerPriceWrites({ ...공통, lines: [줄('참기름 500ml', 7000)] }).upserts).toHaveLength(1);
  });
});

/**
 * **거래처 매입단가와 품목 원가는 밑이 다르다**(2026-09-09).
 *
 * 전표에 치는 단가는 **세금 포함**이고 품목 원가는 **공급가액**이다.
 * 두 값을 한 칸처럼 복사하다 2026-09-06 에 60개 원가가 10% 부풀었고,
 * ÷1.1 스크립트로 되돌렸는데 **전표를 다시 끊으면 그대로 되살아났다** — 복사하는 자리를
 * 안 고쳤기 때문이다. 그 자리를 여기서 잠근다.
 */
describe('매입 — 거래처 단가는 세포함, 품목 원가는 공급가액', () => {
  const 공통 = { partnerId: 'p1', items: 품목, partnerItems: [] as PartnerItem[], type: '매입' as const };

  it('과세 11,000원 → 거래처 단가 11,000 · 원가 10,000', () => {
    const r = partnerPriceWrites({ ...공통, lines: [줄('참기름 500ml', 11000, { isTaxExempt: false })] });
    expect(r.upserts[0]).toMatchObject({ price: 11000, taxType: '과세' });
    expect(r.costUpdates).toEqual([{ itemId: 'i1', price: 10000 }]);
  });

  it('면세 11,000원 → 둘 다 11,000 — 면세는 세금이 없다', () => {
    const r = partnerPriceWrites({ ...공통, lines: [줄('참기름 500ml', 11000, { isTaxExempt: true })] });
    expect(r.upserts[0]).toMatchObject({ price: 11000, taxType: '면세' });
    expect(r.costUpdates).toEqual([{ itemId: 'i1', price: 11000 }]);
  });

  it('매출은 원가를 안 건드린다 — 원가는 산 값에서만 온다', () => {
    const r = partnerPriceWrites({ ...공통, type: '매출', lines: [줄('참기름 500ml', 11000)] });
    expect(r.costUpdates).toEqual([]);
  });
});
