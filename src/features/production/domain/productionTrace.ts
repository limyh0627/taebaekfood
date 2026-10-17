import type { Item, Order, RawMaterialEntry, ProductionRecord } from '../../../shared/types';
import { PRODUCT_FORMULA, toKg } from '../../../constants/formula';
import { docName } from '../../../shared/docName';
import { productionRecordOrderId } from '../../../shared/productionRecordProjection';
export type ItemFormulaRow = { parent_key: string; child_name: string; ratio: number; yield_rate?: number };

export function buildConsumedByOrderId(orders: Order[]) {
    const m = new Map<string, NonNullable<Order['rawConsumedLots']>>();
    for (const o of orders) if (o.rawConsumedLots && o.rawConsumedLots.length) m.set(o.id, o.rawConsumedLots);
    return m;
}

export function buildLedgerByOrderId(ledger: RawMaterialEntry[]) {
    const m = new Map<string, RawMaterialEntry[]>();
    for (const e of ledger) {
      const oid = (e as { orderId?: string }).orderId;
      if (!oid || !((Number(e.used) || 0) > 0)) continue;
      if (!m.has(oid)) m.set(oid, []);
      m.get(oid)!.push(e);
    }
    return m;
}

export function buildLotConsumption(orders: Order[]) {
    const map = new Map<string, { key: string; material: string; supplierName: string; lotNo?: string; receivedDate?: string; totalKg: number; entries: { order: Order; kg: number }[] }>();
    for (const o of orders) {
      for (const c of (o.rawConsumedLots ?? [])) {
        const key = c.lotId || `${c.material}|${c.supplierName}|${c.lotNo ?? c.receivedDate ?? ''}`;
        let g = map.get(key);
        if (!g) { g = { key, material: c.material, supplierName: c.supplierName, lotNo: c.lotNo, receivedDate: c.receivedDate, totalKg: 0, entries: [] }; map.set(key, g); }
        g.entries.push({ order: o, kg: c.kg });
        g.totalKg += c.kg || 0;
      }
    }
    return [...map.values()].sort((a, b) => (b.receivedDate ?? '').localeCompare(a.receivedDate ?? ''));
}

export function filterRecallResults(lotConsumption: ReturnType<typeof buildLotConsumption>, recallQuery: string) {
    const q = recallQuery.trim().toLowerCase();
    if (!q) return lotConsumption;
    return lotConsumption.filter(g =>
      g.material.toLowerCase().includes(q) ||
      (g.supplierName ?? '').toLowerCase().includes(q) ||
      (g.lotNo ?? '').toLowerCase().includes(q));
}

export function buildOrderIdsWithData(consumedByOrderId: ReturnType<typeof buildConsumedByOrderId>, ledgerByOrderId: ReturnType<typeof buildLedgerByOrderId>) { return [...new Set([...consumedByOrderId.keys(), ...ledgerByOrderId.keys()])].sort((a, b) => b.length - a.length); }

export function productionTraceOf(r: ProductionRecord, items: Item[], itemFormulas: ItemFormulaRow[], consumedByOrderId: ReturnType<typeof buildConsumedByOrderId>, ledgerByOrderId: ReturnType<typeof buildLedgerByOrderId>, orderIdsWithData: string[]): { material: string; kg: number; detail: string }[] | undefined {
    // 제품(BOM) 단위로 투입 원료 계산 → 같은 주문의 다른 제품 원료가 섞이지 않음
    const product = items.find(p => p.id === r.itemId);
    if (!product) return undefined;
    const prodKey = docName(product);
    const bomRows = itemFormulas.filter(b => b.parent_key === prodKey);
    const formula = bomRows.length > 0
      ? bomRows.map(b => ({ raw: b.child_name, ratio: b.ratio * (b.yield_rate || 1) }))
      : PRODUCT_FORMULA[prodKey];
    if (!formula || formula.length === 0) return undefined;

    // 원료별 lot 출처(공급처·입고일) — 주문 단위 소비 스냅샷/수불부에서 material로 매칭
    const orderId = productionRecordOrderId(r) ?? (r.id.startsWith('pr-') ? orderIdsWithData.find(o => r.id.startsWith('pr-' + o + '-') || r.id === 'pr-' + o) : undefined);
    const lotByMat = new Map<string, string>();
    if (orderId) {
      const structured = consumedByOrderId.get(orderId);
      if (structured && structured.length) {
        for (const d of structured) {
          const det = [d.supplierName, d.receivedDate && `(${d.receivedDate})`, d.lotNo && `lot ${d.lotNo}`].filter(Boolean).join(' ');
          if (det) lotByMat.set(d.material, lotByMat.has(d.material) ? `${lotByMat.get(d.material)} + ${det}` : det);
        }
      } else {
        const es = ledgerByOrderId.get(orderId);
        if (es) for (const e of es) { const det = (e.note || '').split('▸')[1]?.trim(); if (det) lotByMat.set(e.material, det); }
      }
    }

    return formula
      .map(f => ({
        material: f.raw,
        kg: Math.round(toKg(product.spec || '', f.raw, r.finishedQty) * f.ratio * 10) / 10,
        detail: lotByMat.get(f.raw) || '',
      }))
      .filter(x => x.kg > 0);
}
