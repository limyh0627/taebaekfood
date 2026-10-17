import { companyOf, type Item, type RawMaterialEntry } from '../../../shared/types';
import type { ItemInventoryEntry } from '../../admin/itemLedger';
import type { UnpackLotMove } from '../../../shared/unpackLots';
import { isRawHolder } from '../../../shared/rawHolder';

export interface LotShipment {
  orderId: string;
  partnerName: string;
  date: string;
  qty: number;
}

export type TimelineRow = {
  id: string; date: string; title: string; note: string;
  businessDate?: string; sequence?: number;
  delta?: number; balance?: number;
  details?: { id: string; partnerName: string; qty: number }[];
  kind: 'in' | 'out' | 'stocktake' | 'correction' | 'lot' | 'unpack' | 'merge';
};

// 옛 개봉 기록에는 캔 lotId가 없다. 번호·공급처·입고일이 유일하게 일치할 때만 연결한다.
export const canLotForMove = (item: Item, move: UnpackLotMove) => {
  if (move.canLotId) return (item.lots ?? []).find(lot => lot.id === move.canLotId);
  if (!move.lotNo || !move.receivedDate || !move.supplierName) return undefined;
  const matches = (item.lots ?? []).filter(lot => lot.lotNo === move.lotNo
    && lot.supplierName === move.supplierName && lot.receivedDate === move.receivedDate);
  return matches.length === 1 ? matches[0] : undefined;
};

export const newestFirst = (a: TimelineRow, b: TimelineRow) => {
  const aTime = Date.parse(a.date);
  const bTime = Date.parse(b.date);
  return (Number.isFinite(aTime) && Number.isFinite(bTime) ? bTime - aTime : b.date.localeCompare(a.date))
    || Number(b.sequence ?? 0) - Number(a.sequence ?? 0)
    || b.id.localeCompare(a.id, undefined, { numeric: true });
};

export function buildLotTimelineRows(item: Item, lotId: string, rawEntries: RawMaterialEntry[], shipmentRows: Array<LotShipment & { lotId: string }>, fmt: (n: number) => string): TimelineRow[] {
    const raw = isRawHolder(item);
    const packed: TimelineRow[] = [];
    let hasReceipt = false;
    if (raw && rawEntries.length) {
      for (const entry of rawEntries as ItemInventoryEntry[]) {
        if (companyOf(entry) !== companyOf(item) || (entry.rawItemId && entry.rawItemId !== item.id)) continue;
        const change = entry.lotChanges?.find(row => row.lotId === lotId);
        if (!change) continue;
        const delta = Math.round(Number(change.deltaKg ?? 0) * 1000) / 1000;
        const stocktake = entry.targetKg != null || entry.kind === 'stocktake';
        const correction = entry.type === 'correction' || entry.kind === 'adjust-lot'
          || entry.kind === 'merge-lots' || entry.kind === 'deplete-lot';
        const unpack = entry.kind === 'unpack' || entry.source?.type === 'unpack';
        const merge = entry.kind === 'merge-lots';
        // 정정·사용만 남은 옛 로트는 최초 입고를 로트 정보에서 보충한다. 실제 입고·개봉과 중복하지 않는다.
        hasReceipt ||= delta > 0 && (entry.kind === 'receive' || entry.kind === 'opening' || unpack
          || (!entry.kind && !correction && !stocktake && Number(entry.received ?? 0) > 0));
        const counterpart = merge ? entry.lotChanges?.filter(row => row.lotId !== lotId)
          .map(row => row.lotSnapshot?.lotNo || row.lotNo || row.lotId).join(', ') : '';
        const timestamp = entry.recordedAt || entry.createdAt || entry.effectiveAt || entry.date;
        const afterKg = Number(change.afterKg ?? (change as { kgAfter?: number }).kgAfter);
        packed.push({
          id: entry.id || `${entry.date}-${entry.createdAt}`,
          date: timestamp,
          businessDate: entry.date || entry.effectiveAt?.slice(0, 10), sequence: entry.sequence,
          title: merge ? '로트 합치기' : unpack ? '캔 개봉' : correction ? '재고 정정' : stocktake ? '재고 실사' : delta >= 0 ? '입고' : '사용',
          note: merge ? [`로트 잔량 이동 ${delta > 0 ? '+' : ''}${fmt(delta)} kg · 총재고 증감 0kg`, counterpart && `상대 로트 ${counterpart}`, entry.note].filter(Boolean).join(' · ') : entry.note || entry.addedBy || '',
          delta: merge ? 0 : delta,
          balance: Number.isFinite(afterKg) ? afterKg : undefined,
          kind: merge ? 'merge' : unpack ? 'unpack' : correction ? 'correction' : stocktake ? 'stocktake' : delta >= 0 ? 'in' : 'out',
        });
      }
    }
    if (!raw) for (const row of rawEntries as ItemInventoryEntry[]) {
      if (companyOf(row) !== companyOf(item) || row.source?.type !== 'unpack' || row.source.id !== item.id) continue;
      const moves = (row.unpackMoves ?? []).filter(move => canLotForMove(item, move)?.id === lotId);
      if (!moves.length) continue;
      packed.push({
        id: row.id, date: row.recordedAt || row.createdAt || row.effectiveAt || row.date,
        businessDate: row.date, sequence: row.sequence, title: '캔 개봉', kind: 'unpack',
        delta: -moves.reduce((sum, move) => sum + move.cans, 0),
        note: `벌크 ${fmt(moves.reduce((sum, move) => sum + move.bulkQty, 0))} kg로 이동`,
      });
    }
    for (const lot of (item.lots ?? []).filter(row => row.id === lotId)) {
      if (raw && hasReceipt) continue;
      if (lot.id.startsWith('anchor-') || lot.id.startsWith('adjust-')) continue;
      // 원료의 qtyIn은 포·캔 개수다. kgIn과 섞으면 2.5포 입고가 2.5kg으로 보인다.
      const receiptQty = raw ? Number(lot.kgIn) : Number(lot.qtyIn);
      packed.push({
        id: `lot-${lot.id}`, date: lot.createdAt || lot.receivedDate || '',
        title: lot.supplierName === '실사조정' ? '재고 실사' : '로트 입고',
        note: [lot.supplierName, lot.lotNo].filter(Boolean).join(' · '),
        delta: Number.isFinite(receiptQty) ? receiptQty : undefined,
        kind: lot.supplierName === '실사조정' ? 'stocktake' : 'lot',
      });
    }
    if (raw) return packed.sort(newestFirst);
    const byDate = new Map<string, { qty: number; rows: Array<LotShipment & { lotId: string }> }>();
    for (const shipment of shipmentRows.filter(row => row.lotId === lotId)) {
      const date = shipment.date?.slice(0, 10) || '-';
      const grouped = byDate.get(date) ?? { qty: 0, rows: [] };
      grouped.qty += Number(shipment.qty ?? 0);
      grouped.rows.push(shipment);
      byDate.set(date, grouped);
    }
    for (const [date, grouped] of byDate) packed.push({
      id: `ship-${lotId}-${date}`, date,
      title: '출고', note: `${new Set(grouped.rows.map(row => row.partnerName).filter(Boolean)).size}개 거래처`,
      delta: -grouped.qty, kind: 'out',
      details: grouped.rows.map((row, index) => ({
        id: `${row.orderId}-${index}`, partnerName: row.partnerName || '거래처 미입력', qty: Number(row.qty ?? 0),
      })),
    });
    return packed.sort(newestFirst);
}
