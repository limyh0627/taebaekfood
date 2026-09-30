import { describe, expect, it } from 'vitest';
import { buildItemLedger, rawEntriesForItemLedger, type ItemInventoryEntry } from './itemLedger';
import type { Item } from '../../shared/types';

const can = { id: 'can', name: '깨분참기름-캔', companyId: 'taebaek', type: 'semi', subtype: '캔', unit: '개', stock: 12,
  stocktakeAnchors: [{ id: 'stocktake-anchor', date: '2026-09-01', createdAt: '2026-09-01T00:00:00Z', beforeQty: 20, targetQty: 20 }] } as Item;
const unpack = { id: 'unpack', companyId: 'taebaek', rawItemId: 'bulk', material: '깨분참기름',
  kind: 'unpack', source: { type: 'unpack', id: 'can' }, date: '2026-09-02', createdAt: '2026-09-02T02:00:00Z',
  recordedAt: '2026-09-02T02:00:00Z', received: 0, used: 0, appliedDeltaKg: 132,
  canCount: 8, note: '8캔 → 벌크 132kg',
  unpackMoves: [{ lotNo: 'LOT-1', supplierName: '공급처', receivedDate: '2026-09-01', cans: 8, bulkQty: 132 }],
} as ItemInventoryEntry;

describe('개봉·합치기 제품별원장', () => {
  it('캔 개봉은 원본 사건 한 번만 개수로 차감하며 실사 이후 잔량을 대조한다', () => {
    const original = JSON.stringify(unpack);
    const ledger = buildItemLedger('can', [], [can], [], [unpack]);
    expect(ledger.rows.map(row => [row.kind, row.qty])).toEqual([['기초', 20], ['실사', 0], ['캔 개봉', -8]]);
    expect(ledger.rows.at(-1)?.balance).toBe(12);
    expect(ledger.outSum).toBe(-8);
    expect(ledger.gap).toBe(0);
    expect(ledger.independentlyVerified).toBe(true);
    expect(JSON.stringify(unpack)).toBe(original);
  });

  it('다른 회사와 다른 캔 품목 기록은 차감하지 않고, 개봉 개수가 없으면 kg로 꾸며내지 않는다', () => {
    const entries = [
      { ...unpack, companyId: 'punghoe' },
      { ...unpack, source: { type: 'unpack', id: 'other-can' } },
      { ...unpack, canCount: undefined, unpackMoves: undefined },
    ] as ItemInventoryEntry[];
    expect(buildItemLedger('can', [], [can], [], entries).rows.filter(row => row.kind === '캔 개봉')).toEqual([]);
    expect(buildItemLedger('bulk', [], [{ ...can, id: 'bulk' }], [], [unpack]).outSum).toBe(0);
  });

  it('canCount가 없던 기록도 저장된 moves의 캔 개수만 합산한다', () => {
    const row = { ...unpack, canCount: undefined, unpackMoves: [
      { ...unpack.unpackMoves![0], cans: 3, bulkQty: 49.5 },
      { ...unpack.unpackMoves![0], lotNo: 'LOT-2', cans: 5, bulkQty: 82.5 },
    ] };
    expect(buildItemLedger('can', [], [can], [], [row]).outSum).toBe(-8);
  });

  it('벌크 화면만 실제 증가 kg를 읽고, 서류용 원본 received/used=0은 그대로 둔다', () => {
    const original = JSON.stringify(unpack);
    const projected = rawEntriesForItemLedger([unpack]);
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({ received: 132, used: 0 });
    expect(projected[0].note).toContain('캔 -8개 → 벌크 +132kg');
    expect(JSON.stringify(unpack)).toBe(original);
    expect(rawEntriesForItemLedger([{ ...unpack, appliedDeltaKg: undefined }])[0].received).toBe(132);
  });

  it('합치기는 재고 증감 0이고 원본의 다른 입출고는 보존한다', () => {
    const merge = { ...unpack, kind: 'merge-lots', source: { type: 'manual', id: 'merge' }, note: '음수·양수 로트 통합', appliedDeltaKg: 0 } as ItemInventoryEntry;
    const normal = { ...unpack, kind: 'receive', source: { type: 'purchase', id: 'po' }, received: 10 } as ItemInventoryEntry;
    const original = JSON.stringify([merge, normal]);
    const projected = rawEntriesForItemLedger([merge, normal]);
    expect(projected[0]).toMatchObject({ received: 0, used: 0 });
    expect(projected[0].note).toContain('로트 합치기 · 재고 증감 0kg');
    expect(projected[1]).toBe(normal);
    expect(JSON.stringify([merge, normal])).toBe(original);
  });
});
