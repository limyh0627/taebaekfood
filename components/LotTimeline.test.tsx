/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LotTimeline from './LotTimeline';
import type { Item, RawMaterialEntry } from '../src/shared/types';

const item = {
  id: 'raw-a', name: '볶음참깨', type: 'raw', subtype: '벌크', unit: 'kg', stock: 10, minStock: 0, price: 0, image: '',
  lots: [{ id: 'lot-a', supplierName: '가게', receivedDate: '2026-09-01', kgIn: 10, kgRemaining: 10, status: 'active', createdAt: '2026-09-01T09:00:00+09:00' }],
} as Item;

const entry = (n: number, lotId = 'lot-a') => ({
  id: `e-${n}`, date: `2026-09-${String(n).padStart(2, '0')}`,
  recordedAt: `2026-09-${String(n).padStart(2, '0')}T09:00:00+09:00`,
  note: `기록-${n}`, received: 1, used: 0,
  lotChanges: [{ lotId, deltaKg: 1, beforeKg: n - 1, afterKg: n }],
} as unknown as RawMaterialEntry);

describe('로트 상세 타임라인', () => {
  it('개봉은 캔 로트의 개수 차감과 기존 입고·출고를 같이 표시하고 벌크는 kg 증가로 표시한다', () => {
    const product = { ...item, id: 'can', type: 'semi', subtype: '캔', unit: '개', lots: [{ ...item.lots![0], lotNo: 'LOT-1', qtyIn: 10 }] } as Item;
    const unpack = { ...entry(2), rawItemId: item.id, kind: 'unpack', source: { type: 'unpack', id: 'can' },
      unpackMoves: [{ lotNo: 'LOT-1', supplierName: '가게', receivedDate: '2026-09-01', cans: 8, bulkQty: 132 }],
      lotChanges: [{ lotId: 'lot-a', deltaKg: 132, afterKg: 142 }] } as unknown as RawMaterialEntry;
    const view = render(<LotTimeline item={product} lotId="lot-a" rawEntries={[unpack]}
      shipmentRows={[{ lotId: 'lot-a', orderId: 'o', date: '2026-09-03', partnerName: '거래처', qty: 1 }]} />);
    expect(screen.getByText('캔 개봉')).toBeTruthy();
    expect(screen.getByText('-8 개')).toBeTruthy();
    expect(screen.getByText('+10 개')).toBeTruthy();
    expect(screen.getByText('-1 개')).toBeTruthy();
    expect(screen.getByText(/벌크 132 kg로 이동/)).toBeTruthy();
    expect(screen.queryByText('+132 개')).toBeNull();
    view.unmount();
    render(<LotTimeline item={item} lotId="lot-a" rawEntries={[unpack]} />);
    expect(screen.getByText('+132 kg')).toBeTruthy();
    expect(screen.queryByText('로트 입고')).toBeNull();
  });

  it('캔 로트 연결 근거가 중복되거나 없으면 임의로 붙이지 않고 품목원장 확인을 안내한다', () => {
    const lot = { ...item.lots![0], lotNo: 'LOT-1', qtyIn: 10 };
    const product = { ...item, id: 'can', type: 'semi', subtype: '캔', unit: '개', lots: [lot, { ...lot, id: 'duplicate' }] } as Item;
    const unpack = { ...entry(2), source: { type: 'unpack', id: 'can' }, unpackMoves: [
      { lotNo: 'LOT-1', supplierName: '가게', receivedDate: '2026-09-01', cans: 8, bulkQty: 132 },
    ] } as unknown as RawMaterialEntry;
    const view = render(<LotTimeline item={product} lotId="lot-a" rawEntries={[unpack]} />);
    expect(screen.queryByText('캔 개봉')).toBeNull();
    expect(screen.getByText(/로트를 특정할 수 없는 개봉 기록/)).toBeTruthy();
    view.unmount();
    render(<LotTimeline item={{ ...product, lots: [lot] }} lotId="lot-a" rawEntries={[{ ...unpack, companyId: 'punghoe' }]} />);
    expect(screen.queryByText('캔 개봉')).toBeNull();
    expect(screen.queryByText(/로트를 특정할 수 없는 개봉 기록/)).toBeNull();
  });

  it('새 개봉은 캔 lotId로 연결하므로 번호·공급처·날짜가 중복돼도 선택한 로트만 표시한다', () => {
    const lot = { ...item.lots![0], lotNo: 'LOT-1', qtyIn: 10 };
    const product = { ...item, id: 'can', type: 'semi', subtype: '캔', unit: '개', lots: [lot, { ...lot, id: 'duplicate' }] } as Item;
    const unpack = { ...entry(2), source: { type: 'unpack', id: 'can' }, unpackMoves: [
      { canLotId: 'lot-a', lotNo: 'LOT-1', supplierName: '가게', receivedDate: '2026-09-01', cans: 8, bulkQty: 132 },
    ] } as unknown as RawMaterialEntry;
    const view = render(<LotTimeline item={product} lotId="lot-a" rawEntries={[unpack]} />);
    expect(screen.getByText('-8 개')).toBeTruthy();
    expect(screen.queryByText(/로트를 특정할 수 없는 개봉 기록/)).toBeNull();
    view.unmount();
    render(<LotTimeline item={product} lotId="duplicate" rawEntries={[unpack]} />);
    expect(screen.queryByText('캔 개봉')).toBeNull();
  });

  it('합치기는 양쪽 로트에서 총재고 증감 0으로 표시하고 로트 이동량·잔량을 따로 남긴다', () => {
    const merge = { ...entry(2), kind: 'merge-lots', lotChanges: [
      { lotId: 'lot-a', deltaKg: -132, afterKg: 0 }, { lotId: 'lot-b', deltaKg: 132, afterKg: 142 },
    ] } as unknown as RawMaterialEntry;
    const view = render(<LotTimeline item={item} lotId="lot-a" rawEntries={[merge]} />);
    expect(screen.getByText('로트 합치기')).toBeTruthy();
    expect(screen.getByText('0 kg')).toBeTruthy();
    expect(screen.getByText(/로트 잔량 이동 -132 kg · 총재고 증감 0kg/)).toBeTruthy();
    expect(screen.getByText(/상대 로트 lot-b/)).toBeTruthy();
    expect(screen.getByText('기록 직후 로트 잔량 0 kg')).toBeTruthy();
    view.unmount();
    render(<LotTimeline item={item} lotId="lot-b" rawEntries={[merge]} />);
    expect(screen.getByText('0 kg')).toBeTruthy();
    expect(screen.getByText(/로트 잔량 이동 \+132 kg · 총재고 증감 0kg/)).toBeTruthy();
    expect(screen.getByText(/상대 로트 lot-a/)).toBeTruthy();
    expect(screen.queryByText('재고 정정')).toBeNull();
  });
  it('합친 상대 로트는 현재 이름이 아닌 사건 당시 번호로 표시하며 비고가 없어도 남긴다', () => {
    const product = { ...item, lots: [...item.lots!, { ...item.lots![0], id: 'lot-b', lotNo: '현재-번호' }] };
    const merge = { ...entry(2), note: '', kind: 'merge-lots', lotChanges: [
      { lotId: 'lot-a', deltaKg: -10, afterKg: 0 },
      { lotId: 'lot-b', deltaKg: 10, afterKg: 20, lotNo: '저장-번호', lotSnapshot: { lotNo: '당시-번호' } },
    ] } as unknown as RawMaterialEntry;
    render(<LotTimeline item={product} lotId="lot-a" rawEntries={[merge]} />);
    expect(screen.getByText(/상대 로트 당시-번호/)).toBeTruthy();
    expect(screen.queryByText(/현재-번호|저장-번호/)).toBeNull();
  });

  it('사용·정정만 남아도 옛 로트의 최초 입고를 보충하고 입력 기록은 바꾸지 않는다', () => {
    const rows = [
      { ...entry(2), kind: 'consume', received: 0, used: 2, lotChanges: [{ lotId: 'lot-a', deltaKg: -2, afterKg: 8 }] },
      { ...entry(3), kind: 'adjust-lot', type: 'correction' },
    ] as unknown as RawMaterialEntry[];
    const before = JSON.stringify([item, rows]);
    render(<LotTimeline item={item} lotId="lot-a" rawEntries={rows} />);
    expect(screen.getByText('로트 입고')).toBeTruthy();
    expect(screen.getByText('+10 kg')).toBeTruthy();
    expect(screen.getByText('사용')).toBeTruthy();
    expect(screen.getByText('재고 정정')).toBeTruthy();
    expect(JSON.stringify([item, rows])).toBe(before);
  });

  it('실제 입고 사건이 있으면 로트 정보로 입고를 중복 표시하지 않는다', () => {
    const receive = { ...entry(1), kind: 'receive', received: 10, lotChanges: [{ lotId: 'lot-a', deltaKg: 10, afterKg: 10 }] } as unknown as RawMaterialEntry;
    render(<LotTimeline item={item} lotId="lot-a" rawEntries={[receive]} />);
    expect(screen.getByText('입고')).toBeTruthy();
    expect(screen.queryByText('로트 입고')).toBeNull();
    expect(screen.getAllByText('+10 kg')).toHaveLength(1);
  });

  it('같은 lotId여도 다른 회사·품목의 사건은 표시하지 않는다', () => {
    const rows = [{ ...entry(2), companyId: 'punghoe' }, { ...entry(3), rawItemId: 'other-item' }] as RawMaterialEntry[];
    render(<LotTimeline item={item} lotId="lot-a" rawEntries={rows} />);
    expect(screen.queryByText(/기록-2|기록-3/)).toBeNull();
    expect(screen.getByText('로트 입고')).toBeTruthy();
  });
  it('원료 로트 입고는 포 개수가 아니라 kgIn을 kg로 표시하고, 완제품은 개수를 표시한다', () => {
    const rawItem = { ...item, lots: [{ ...item.lots![0], qtyIn: 2.5, packageKg: 20, kgIn: 50, kgRemaining: 30 }] } as Item;
    const rawView = render(<LotTimeline item={rawItem} lotId="lot-a" />);
    expect(screen.getByText('+50 kg')).toBeTruthy();
    expect(screen.queryByText('+2.5 kg')).toBeNull();
    rawView.unmount();

    const product = { ...item, type: 'goods', subtype: '낱개', unit: '개', lots: [{ ...item.lots![0], qtyIn: 12, kgIn: 6 }] } as Item;
    render(<LotTimeline item={product} lotId="lot-a" />);
    expect(screen.getByText('+12 개')).toBeTruthy();
  });

  it('선택한 로트의 이력만 최신 5건을 보이고 나머지는 펼친다', () => {
    render(<LotTimeline item={item} lotId="lot-a"
      rawEntries={[...Array.from({ length: 7 }, (_, i) => entry(i + 1)), entry(8, '다른-로트')]} />);

    expect(screen.getByText(/기록-7/)).toBeTruthy();
    expect(screen.getByText(/기록-3/)).toBeTruthy();
    expect(screen.queryByText(/기록-2/)).toBeNull();
    expect(screen.queryByText(/기록-8/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '나머지 2개 펼쳐 보기' }));
    expect(screen.getByText(/기록-2/)).toBeTruthy();
    expect(screen.getByText(/기록-1/)).toBeTruthy();
    expect(screen.queryByText(/기록-8/)).toBeNull();
  });

  it('화면에 표시하는 기록시각으로 정렬하고 정정은 사용이 아니라 재고 정정으로 표시한다', () => {
    const rows = [
      { ...entry(17), id: 'late-business', date: '2026-09-17', recordedAt: '2026-09-13T14:20:00+09:00', note: '늦게 표시되면 안 됨' },
      { ...entry(13), id: 'new-record', date: '2026-09-13', recordedAt: '2026-09-17T08:00:00+09:00', note: '먼저 표시', type: 'correction', kind: 'adjust-lot' },
    ] as unknown as RawMaterialEntry[];
    const { container } = render(<LotTimeline item={item} lotId="lot-a" rawEntries={rows} />);

    expect(container.textContent!.indexOf('먼저 표시')).toBeLessThan(container.textContent!.indexOf('늦게 표시되면 안 됨'));
    expect(screen.getByText('재고 정정')).toBeTruthy();
    expect(screen.getByText(/기록 2026-09-13 14:20 · 업무일 2026-09-17/)).toBeTruthy();
    expect(screen.getAllByText(/기록 직후 로트 잔량/)).toHaveLength(2);
  });

  it('같은 기록시각에는 적용 순번대로 보이고, 잔량 스냅샷이 없는 줄에 0kg을 꾸며내지 않는다', () => {
    const rows = [
      { ...entry(13), id: 'first', recordedAt: '2026-09-13T01:00:00Z', sequence: 1, note: '첫 적용' },
      { ...entry(13), id: 'second', recordedAt: '2026-09-13T10:00:00+09:00', sequence: 2, note: '둘째 적용',
        lotChanges: [{ lotId: 'lot-a', deltaKg: -1 }] },
    ] as unknown as RawMaterialEntry[];
    const { container } = render(<LotTimeline item={item} lotId="lot-a" rawEntries={rows} />);

    expect(container.textContent!.indexOf('둘째 적용')).toBeLessThan(container.textContent!.indexOf('첫 적용'));
    expect(screen.getAllByText(/기록 2026-09-13 10:00 · 업무일 2026-09-13/)).toHaveLength(2);
    expect(screen.getAllByText(/기록 직후 로트 잔량/)).toHaveLength(1);
  });
});
