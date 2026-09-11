import type { Item, Order, OrderStatus } from '../../shared/types';
import { bomOf } from '../../shared/bomIndex';
import { isBulkItem } from '../../shared/itemTaxonomy';
import { stockUnits } from '../../shared/orderUnits';

/**
 * **되돌리면 무엇이 되돌아오는가** — 작업완료·출고에서 대기중·작업중으로 보낼 때 보여줄 문구.
 *
 * 되돌리기는 재고를 조용히 움직인다: 출고취소로 완제품이 다시 채워지고, 생산취소로 BOM 구성품과
 * 원료 로트가 복원되며 원료수불부 줄이 지워진다. 눌러 놓고 나중에 "왜 재고가 늘었지"로 만나면
 * 되짚기 어렵다. 그래서 **누르기 전에** 무엇이 움직이는지 적어 보여주고 확인을 받는다.
 *
 * 순수 함수다 — 화면은 이 글을 띄우기만 한다.
 */
export interface RollbackPlan {
  /** 되돌릴 게 하나도 없으면 false — 물어볼 것도 없다 */
  needed: boolean;
  lines: string[];
  text: string;
  adjustments: { itemId: string; name: string; unit: string; delta: number; reason: '출고 취소' | '생산 취소' }[];
  legacyEvidenceWarning: boolean;
  warnings: string[];
}

const fmt = (n: number) => Math.round(n * 1000) / 1000;

export function buildRollbackPlan(
  order: Pick<Order, 'items' | 'producedUnits' | 'rawConsumedLots' | 'shippedOut' | 'autoBuilt' | 'producedAt' | 'inventorySnapshots'>,
  allItems: Item[],
  from: OrderStatus | string,
  to: OrderStatus | string,
): RollbackPlan {
  const nameOf = (id: string) => {
    const p = allItems.find(i => i.id === id);
    return p ? `${p.name}${p.spec ? ` ${p.spec}` : ''}` : id;
  };
  const unitOf = (id: string) => allItems.find(i => i.id === id)?.unit ?? '개';
  const lines: string[] = [];
  const adjustments: RollbackPlan['adjustments'] = [];
  const warnings: string[] = [];
  let legacyEvidenceWarning = false;

  const addSnapshot = (snapshot: NonNullable<Order['inventorySnapshots']>['production'] | NonNullable<Order['inventorySnapshots']>['shipment'], reason: '출고 취소' | '생산 취소') => {
    for (const row of snapshot?.stockDeltas ?? []) {
      adjustments.push({ itemId: row.itemId, name: nameOf(row.itemId), unit: unitOf(row.itemId), delta: -Number(row.delta || 0), reason });
    }
  };
  const stockStage = (value: OrderStatus | string) => value === 'SHIPPED' || value === 'DELIVERED' ? 2 : value === 'DISPATCHED' ? 1 : 0;
  const expectsShipmentRollback = stockStage(from) >= 2 && stockStage(to) < 2;
  const expectsProductionRollback = stockStage(from) >= 1 && stockStage(to) < 1;
  const undoShipment = !!order.shippedOut && stockStage(to) < 2;
  const hasProductionEvidence = !!order.producedAt || (order.producedUnits?.length ?? 0) > 0
    || (order.rawConsumedLots?.length ?? 0) > 0 || (order.autoBuilt?.length ?? 0) > 0;
  const undoProduction = hasProductionEvidence && stockStage(to) < 1;
  if ((expectsShipmentRollback && !order.shippedOut) || (expectsProductionRollback && !hasProductionEvidence)) {
    legacyEvidenceWarning = true;
  }

  if (undoShipment) {
    if (order.inventorySnapshots?.shipment) addSnapshot(order.inventorySnapshots.shipment, '출고 취소');
    else {
      legacyEvidenceWarning = true;
      for (const row of order.items) {
        const item = allItems.find(candidate => candidate.id === row.itemId);
        if (!item || isBulkItem(item)) continue;
        adjustments.push({ itemId: item.id, name: nameOf(item.id), unit: unitOf(item.id), delta: stockUnits(row, item), reason: '출고 취소' });
      }
    }
    const rows = order.items
      .map(it => ({ name: nameOf(it.itemId), qty: (it as { isBoxUnit?: boolean; boxQuantity?: number }).isBoxUnit && (it as { boxQuantity?: number }).boxQuantity ? (it as { boxQuantity?: number }).boxQuantity! : it.quantity, unit: unitOf(it.itemId) }))
      .filter(r => r.qty > 0);
    if (rows.length) lines.push(`· 출고취소 — 재고가 다시 늘어납니다: ${rows.map(r => `${r.name} +${fmt(r.qty)}`).join(', ')}`);
  }

  const produced = (order.producedUnits ?? []).filter(p => Number(p.qty) > 0);
  if (undoProduction) {
    if (order.inventorySnapshots?.production) addSnapshot(order.inventorySnapshots.production, '생산 취소');
    else {
      legacyEvidenceWarning = true;
      const addLegacyBom = (itemId: string, qty: number, depth = 0) => {
        if (depth > 4 || qty <= 0) return;
        adjustments.push({ itemId, name: nameOf(itemId), unit: unitOf(itemId), delta: -qty, reason: '생산 취소' });
        for (const line of bomOf(itemId)) {
          const child = allItems.find(candidate => candidate.id === line.childId);
          if (!child || isBulkItem(child)) continue;
          adjustments.push({ itemId: child.id, name: nameOf(child.id), unit: unitOf(child.id), delta: qty * line.qty, reason: '생산 취소' });
        }
      };
      const legacyProduced = Array.isArray(order.producedUnits)
        ? order.producedUnits
        : order.items.map(row => {
            const item = allItems.find(candidate => candidate.id === row.itemId);
            return { itemId: row.itemId, qty: item ? stockUnits(row, item) : 0 };
          });
      legacyProduced.forEach(row => addLegacyBom(row.itemId, Number(row.qty)));
      for (const row of order.autoBuilt ?? []) addLegacyBom(row.itemId, Number(row.qty));
    }
  }
  if (undoProduction && produced.length) {
    lines.push(`· 생산취소 — 만든 만큼 재고에서 뺍니다: ${produced.map(p => `${nameOf(p.itemId)} −${fmt(Number(p.qty))}`).join(', ')}`);
    lines.push(`  (그 BOM 구성품 — 병·캡·라벨·박스 — 은 도로 채워집니다)`);
  }

  const raw = order.rawConsumedLots ?? [];
  if (undoProduction && raw.length) {
    const byMat = new Map<string, number>();
    for (const r of raw) byMat.set(r.material, fmt((byMat.get(r.material) ?? 0) + Number(r.kg || 0)));
    lines.push(`· 원료가 로트로 되돌아갑니다: ${[...byMat].map(([m, kg]) => `${m} ${fmt(kg)}kg`).join(', ')}`);
    lines.push(`  원료수불부에 적힌 그 사용 줄도 함께 지워집니다`);
  }

  if (undoProduction && (order.autoBuilt ?? []).length) {
    lines.push(`· 모자라서 먼저 만들었던 구성품도 되돌립니다: ${(order.autoBuilt ?? []).map(b => `${nameOf(b.itemId)} ${fmt(Number(b.qty))}`).join(', ')}`);
  }

  if (legacyEvidenceWarning) warnings.push('이 주문은 작업 당시 실제 재고 증감 또는 BOM 스냅샷이 없습니다. 현재 데이터로 추정해 원복합니다.');

  const normalizedAdjustments = [...adjustments.reduce((grouped, row) => {
    const key = `${row.reason}:${row.itemId}`;
    const current = grouped.get(key);
    grouped.set(key, current ? { ...current, delta: fmt(current.delta + row.delta) } : { ...row, delta: fmt(row.delta) });
    return grouped;
  }, new Map<string, RollbackPlan['adjustments'][number]>()).values()].filter(row => row.delta !== 0);

  const adjustmentLines = normalizedAdjustments
    .filter(row => row.delta !== 0)
    .map(row => `· ${row.reason} — ${row.name} ${row.delta > 0 ? '+' : '−'}${fmt(Math.abs(row.delta))}${row.unit}`);
  if (adjustmentLines.length) lines.unshift(...adjustmentLines);

  const label = (s: string) => ({ PENDING: '대기중', PROCESSING: '작업중', DISPATCHED: '작업완료', SHIPPED: '출고', DELIVERED: '배송완료' } as Record<string, string>)[String(s)] ?? String(s);
  const head = `'${label(from)}' → '${label(to)}'로 되돌립니다.`;
  return {
    needed: lines.length > 0,
    lines,
    adjustments: normalizedAdjustments,
    legacyEvidenceWarning,
    warnings,
    text: lines.length
      ? `${head}\n\n되돌아가는 것:\n${lines.join('\n')}\n\n계속할까요?`
      : `${head}\n\n되돌릴 재고는 없습니다. 계속할까요?`,
  };
}
