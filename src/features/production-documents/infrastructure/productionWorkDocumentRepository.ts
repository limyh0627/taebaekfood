import { COL } from '../../../shared/collections';
import type { CompanyId, Order, RawMaterialEntry, Item } from '../../../shared/types';
import type { RawInventoryMovement } from '../../../shared/rawInventoryCore';
import { dateOfLocal } from '../../../shared/day';
import { fetchWhere } from '../../../shared/services/firebaseService';
import { replaceProductionWorkDocument } from '../../../shared/services/productionWorkDocumentService';
import {
  emptyProductionWorkFields, newProductionWorkDocument,
  type ProductionWorkDocument, type ProductionWorkDocumentLine, type ProductionWorkEvidence,
} from '../domain/productionWorkDocument';

export async function loadProductionWorkDocument(companyId: CompanyId, date: string, actorId: string) {
  const blank = newProductionWorkDocument(companyId, date, actorId, new Date().toISOString());
  for (let attempt = 0; attempt < 3; attempt++) {
    const [headers, allLines] = await Promise.all([
      fetchWhere<ProductionWorkDocument>(COL.productionWorkDocuments, 'companyId', companyId),
      fetchWhere<ProductionWorkDocumentLine>(COL.productionWorkDocumentLines, 'companyId', companyId),
    ]);
    const document = headers.find(row => row.id === blank.id) ?? blank;
    const lines = allLines.filter(row => row.documentId === document.id);
    if (document.companyId !== companyId || lines.some(row => row.companyId !== companyId)) throw new Error('다른 회사의 생산일지입니다.');
    if (lines.length === (document.rowCount ?? 0) && lines.every(row => row.documentRevision === document.revision)) {
      return { document, lines: lines.sort((a, b) => a.sortOrder - b.sortOrder) };
    }
  }
  throw new Error('생산일지가 변경되는 중입니다. 잠시 후 다시 열어 주세요.');
}

export async function saveProductionWorkDocument(document: ProductionWorkDocument, lines: ProductionWorkDocumentLine[], expectedRevision: number) {
  for (const row of lines) {
    if (row.companyId !== document.companyId || row.documentId !== document.id) throw new Error('다른 회사 또는 문서의 행입니다.');
    for (const value of [row.productionQty, row.rawUsedKg]) {
      if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error('수량은 0 이상의 유한한 숫자로 입력해 주세요.');
    }
  }
  const saved = await replaceProductionWorkDocument({ ...document }, lines.map(row => ({ ...row })), expectedRevision);
  return { document: saved.header as unknown as ProductionWorkDocument, lines: saved.lines as unknown as ProductionWorkDocumentLine[] };
}

type LedgerEvidence = RawMaterialEntry & Partial<RawInventoryMovement>;

export function productionEvidenceFromRecords(
  companyId: CompanyId, date: string, orders: Order[], ledger: LedgerEvidence[], items: Item[],
): ProductionWorkEvidence[] {
  const evidence: ProductionWorkEvidence[] = [];
  const ownLedger = ledger.filter(row => row.companyId === companyId);
  const byLedgerId = new Map(ownLedger.map(row => [row.id, row]));
  const reversed = new Set(ownLedger.flatMap(row => row.reversalOf ? [row.reversalOf] : []));
  const linked = new Set<string>();
  const ownItems = new Map(items.filter(item => item.companyId === companyId).map(item => [item.id, item]));
  const productionKeys = new Set<string>();
  for (const order of orders) {
    if (order.companyId !== companyId) continue;
    // 전체 생산과 품목별 생산의 저장된 실적만 읽는다. 취소 뒤 남은 snapshot은 실적으로 해석하지 않는다.
    const states = Object.values(order.itemInventory ?? {});
    if (order.producedAt && Array.isArray(order.producedUnits)) states.push({
      version: 1, lineId: 'whole', itemId: '', applied: true, attempt: order.rawInventoryAttempt ?? 0,
      completedAt: order.producedAt, producedUnits: order.producedUnits, rawConsumedLots: order.rawConsumedLots ?? [],
      autoBuilt: order.autoBuilt ?? [], production: order.inventorySnapshots?.production,
    } as typeof states[number]);
    for (const state of states) {
      if (!state.applied || order.inventoryOperation || dateOfLocal(state.completedAt) !== date) continue;
      const products = state.producedUnits.filter(row => row.qty > 0 && Number.isFinite(row.qty));
      for (const product of products) {
        // 같은 생산 lot trace가 두 경로에 남아 있을 때만 중복을 제거한다. 수량 유사성으로 추정하지 않는다.
        const lotIds = (state.production?.productProducedLots ?? []).filter(row => row.itemId === product.itemId).map(row => row.lotId).sort();
        const productionKey = lotIds.length ? JSON.stringify([order.id, product.itemId, lotIds]) : JSON.stringify([order.id, state.lineId, state.attempt, product.itemId]);
        if (productionKeys.has(productionKey)) continue;
        productionKeys.add(productionKey);
        const item = ownItems.get(product.itemId);
        const sourceLine = order.items.find(row => row.lineId === state.lineId && row.itemId === product.itemId);
        const batchKey = `${order.id}__${state.lineId}__${state.attempt}__${product.itemId}`;
        const fields = { ...emptyProductionWorkFields(), manufacturedDate: date,
          itemId: product.itemId, itemNameSnapshot: sourceLine?.name ?? item?.name ?? '',
          productionQty: product.qty, productionUnit: item?.unit ?? '',
          specSnapshot: item?.spec ?? '',
          note: '제조 LOT·소비기한·작업자는 별도 확인. 규격·단위는 현재 품목정보 대조 필요.',
        };
        // 한 작업에서 여러 생산품이 나왔으면 원료를 제품별로 배분한 근거가 없으므로 추정하지 않는다.
        const traces = products.length === 1 ? state.rawConsumedLots.filter(row => !row.ledgerOnly) : [];
        let count = 0;
        for (const trace of traces) {
          const movement = trace.ledgerId ? byLedgerId.get(trace.ledgerId) : undefined;
          if (!movement || !trace.operationId || movement.operationId !== trace.operationId
            || !trace.rawItemId || movement.rawItemId !== trace.rawItemId || !trace.lotId
            || !['consume', 'consume-lot'].includes(movement.kind ?? '') || reversed.has(trace.operationId)
            || reversed.has(movement.id)) continue;
          const changes = movement.lotChanges?.filter(change => change.lotId === trace.lotId && change.deltaKg < 0) ?? [];
          if (changes.length !== 1 || Math.abs(-changes[0].deltaKg - trace.kg) > 0.0001) continue;
          const change = changes[0];
          const key = `${batchKey}__${movement.id}__${trace.lotId}`;
          if (linked.has(`${movement.id}__${trace.lotId}`)) continue;
          linked.add(`${movement.id}__${trace.lotId}`);
          evidence.push({ companyId, key, batchKey, reversed: false,
            fields: { ...fields, rawItemId: trace.rawItemId, rawNameSnapshot: movement.materialSnapshot ?? movement.material,
              rawUsedKg: -change.deltaKg, rawLotId: trace.lotId, rawLotNoSnapshot: change.lotNo ?? change.lotSnapshot?.lotNo ?? '' },
            source: { kind: 'production', sourceId: order.id, operationId: trace.operationId,
              ledgerId: movement.id, lotId: trace.lotId, recordedAt: movement.recordedAt ?? movement.createdAt },
          });
          count++;
        }
        if (!count) evidence.push({ companyId, key: batchKey, batchKey, reversed: false, fields,
          source: { kind: 'production', sourceId: order.id, operationId: '', ledgerId: '', lotId: '', recordedAt: state.completedAt ?? '' } });
      }
    }
  }
  // 수동 사용에는 생산품을 추정 연결하지 않는다. 원료 근거만 채운 미확인 행으로 남긴다.
  for (const row of ownLedger) {
    if (dateOfLocal(row.effectiveAt ?? row.date) !== date || !['consume', 'consume-lot'].includes(row.kind ?? '')
      || !row.rawItemId || !row.operationId || reversed.has(row.id) || reversed.has(row.operationId)) continue;
    for (const change of row.lotChanges ?? []) {
      if (!(change.deltaKg < 0) || linked.has(`${row.id}__${change.lotId}`)) continue;
      const key = `raw__${row.id}__${change.lotId}`;
      evidence.push({ companyId, key, batchKey: key, reversed: false,
        fields: { ...emptyProductionWorkFields(), manufacturedDate: date, rawItemId: row.rawItemId,
          rawNameSnapshot: row.materialSnapshot ?? row.material, rawUsedKg: -change.deltaKg,
          rawLotId: change.lotId, rawLotNoSnapshot: change.lotNo ?? change.lotSnapshot?.lotNo ?? '',
          note: '원료 사용 근거만 확인됨. 생산 품목·생산량·제조 LOT를 확인해 주세요.' },
        source: { kind: 'raw-usage', sourceId: row.source?.id ?? row.id, operationId: row.operationId,
          ledgerId: row.id, lotId: change.lotId, recordedAt: row.recordedAt ?? row.createdAt },
      });
    }
  }
  return evidence;
}

export async function loadProductionWorkEvidence(companyId: CompanyId, date: string): Promise<ProductionWorkEvidence[]> {
  const [orders, ledger, items] = await Promise.all([
    fetchWhere<Order>(COL.orders, 'companyId', companyId),
    fetchWhere<LedgerEvidence>(COL.rawMaterialLedger, 'companyId', companyId),
    fetchWhere<Item>(COL.items, 'companyId', companyId),
  ]);
  return productionEvidenceFromRecords(companyId, date, orders, ledger, items);
}
