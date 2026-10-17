import { describe, expect, it } from 'vitest';
import type { Item, RawMaterialLot } from '../../../shared/types';
import type { ItemInventoryEntry } from '../../admin/itemLedger';
import { buildLotTimelineRows, canLotForMove, newestFirst, type TimelineRow, type LotShipment } from './lotTimelineRows';
const item: Item = { id: 'raw', name: '원료', type: 'raw', subtype: '벌크', unit: 'kg', stock: 40, minStock: 0, image: '', lots: [{ id: 'lot', lotNo: '당시', supplierName: '공급처', receivedDate: '2026-10-01', createdAt: '2026-10-01', kgIn: 40, kgRemaining: 40, qtyIn: 2.5, status: 'active' }] };
// 옛 원장에는 잔량·스냅샷이 빠진 줄도 있으므로 저장 당시 불완전한 모양을 명시한다.
type LegacyEntry = Omit<ItemInventoryEntry, 'lotChanges'> & { lotChanges?: Array<{ lotId: string; deltaKg: number; beforeKg?: number; afterKg?: number; kgAfter?: number; lotNo?: string; lotSnapshot?: Partial<RawMaterialLot> }> };
const entry = (extra: Partial<LegacyEntry> = {}): ItemInventoryEntry => ({ id: 'e', material: '원료', rawItemId: 'raw', date: '2026-10-02', createdAt: '2026-10-03T00:00:00Z', received: 0, used: 1, note: '', lotChanges: [{ lotId: 'lot', deltaKg: -1 }], ...extra } as unknown as ItemInventoryEntry);
const fmt = (n: number) => `수량${n}`;
const build = (entries: ItemInventoryEntry[] = [], target: Item = item, shipments: Array<LotShipment & { lotId: string }> = []) => buildLotTimelineRows(target, 'lot', entries, shipments, fmt);

describe('로트 사건 조회', () => {
 it('옛 사용만 있으면 최초 kg 입고를 보충하되 실제 입고·개봉이 있으면 중복하지 않는다', () => {
  expect(build([entry()]).find(r => r.id === 'lot-lot')?.delta).toBe(40);
  for (const kind of ['receive', 'opening', 'unpack'] as const) {
   const rows = build([entry({ kind, received: 2, lotChanges: [{ lotId: 'lot', deltaKg: 2 }] })]);
   expect(rows.map(r => r.id)).toEqual(['e']);
  }
  expect(build([entry({ received: 2, lotChanges: [{ lotId: 'lot', deltaKg: 2 }] })]).length).toBe(1);
  expect(build([], { ...item, lots: [{ ...item.lots![0], id: 'anchor-x' }] })).toEqual([]);
 });
 it('회사·품목·로트 경계를 지키고 없는 잔량은 undefined이며 옛 kgAfter만 호환한다', () => {
  expect(build([entry({ companyId: 'punghoe' }), entry({ rawItemId: 'other' }), entry({ lotChanges: [{ lotId: 'other', deltaKg: 2 }] })]).map(r => r.id)).toEqual(['lot-lot']);
  expect(build([entry()])[0].balance).toBeUndefined();
  const legacy = entry({ lotChanges: [{ lotId: 'lot', deltaKg: -1, kgAfter: 39 }] });
  expect(build([legacy])[0].balance).toBe(39);
 });
 it('개봉 캔은 명시 ID 우선, 옛 세 근거가 유일할 때만 연결한다', () => {
  const can: Item = { ...item, id: 'can', type: 'semi', subtype: '캔', lots: [{ ...item.lots![0], qtyIn: 5 }] };
  const move = { lotNo: '당시', supplierName: '공급처', receivedDate: '2026-10-01', cans: 1.5, bulkQty: 24.75 };
  expect(canLotForMove(can, move)?.id).toBe('lot');
  const duplicate: Item = { ...can, lots: [...can.lots!, { ...can.lots![0], id: 'second' }] };
  expect(canLotForMove(duplicate, move)).toBeUndefined();
  expect(canLotForMove(duplicate, { ...move, canLotId: 'second' })?.id).toBe('second');
  expect(canLotForMove(can, { ...move, supplierName: '' })).toBeUndefined();
  expect(canLotForMove(can, { ...move, canLotId: 'missing' })).toBeUndefined();
  const rows = build([entry({ source: { type: 'unpack', id: 'can' }, unpackMoves: [move] })], can);
  expect(rows.find(r => r.kind === 'unpack')).toMatchObject({ delta: -1.5, note: '벌크 수량24.75 kg로 이동' });
  expect(rows.find(r => r.kind === 'lot')?.delta).toBe(5);
 });
 it('합치기는 사건 당시 상대 번호와 전달 formatter를 사용하며 총재고 증감은 0이다', () => {
  const rows = build([entry({ kind: 'merge-lots', lotChanges: [{ lotId: 'lot', deltaKg: -1.23456, afterKg: 38 }, { lotId: 'other', deltaKg: 1.23456, lotNo: '저장번호', lotSnapshot: { lotNo: '사건번호' } }] })]);
  expect(rows[0]).toMatchObject({ title: '로트 합치기', delta: 0, balance: 38, note: '로트 잔량 이동 수량-1.235 kg · 총재고 증감 0kg · 상대 로트 사건번호' });
 });
 it('완제품 출고는 선택 로트와 날짜별로 묶고 상세 순서·미입력 거래처를 보존한다', () => {
  const product: Item = { ...item, type: 'product', subtype: '', unit: '개' };
  const shipments: Array<LotShipment & { lotId: string }> = [{ lotId: 'lot', orderId: 'a', partnerName: '', date: '2026-10-05T01:00:00Z', qty: 1.25 }, { lotId: 'lot', orderId: 'b', partnerName: '가', date: '2026-10-05', qty: 2 }, { lotId: 'other', orderId: 'c', partnerName: '나', date: '2026-10-05', qty: 99 }];
  expect(build([], product, shipments)[0]).toMatchObject({ delta: -3.25, note: '1개 거래처', details: [{ id: 'a-0', partnerName: '거래처 미입력', qty: 1.25 }, { id: 'b-1', partnerName: '가', qty: 2 }] });
 });
 it('정렬은 기록시각·순번·숫자 ID 순이며 유효하지 않은 날짜는 문자열 비교한다', () => {
  const row = (id: string, date: string, sequence?: number): TimelineRow => ({ id, date, sequence, title: '', note: '', kind: 'in' });
  expect([row('2', '2026-10-03'), row('10', '2026-10-03'), row('1', '2026-10-03', 2), row('new', '2026-10-04')].sort(newestFirst).map(r => r.id)).toEqual(['new', '1', '10', '2']);
  expect([row('a', 'a'), row('z', 'z')].sort(newestFirst).map(r => r.id)).toEqual(['z', 'a']);
  const rows = build([entry({ date: '2026-10-09', recordedAt: '2026-10-04', createdAt: '2026-10-02', sequence: 4 })]);
  expect(rows[0]).toMatchObject({ date: '2026-10-04', businessDate: '2026-10-09', sequence: 4 });
 });
 it('입력 품목·원장·출고 배열을 바꾸지 않는다', () => {
  const entries: ItemInventoryEntry[] = [entry()];
  const shipments: Array<LotShipment & { lotId: string }> = [];
  const before = JSON.stringify([item, entries, shipments]);
  build(entries, item, shipments);
  expect(JSON.stringify([item, entries, shipments])).toBe(before);
 });
});
