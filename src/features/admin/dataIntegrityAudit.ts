import type { ItemReceipt } from '../../shared/receipt';
import type {
  IssuedStatement, Item, ItemBom, Order, OrderInventorySnapshot,
  ProductionSalesLog, PurchaseOrder, PurchaseOrderItem, RawMaterialEntry,
} from '../../shared/types';
import { companyOf, poLines, type CompanyId } from '../../shared/types';
import { docDateOf, docOilKg, docSaleLines, isSalesJournalProduct, journalSaleLines, reconcileSaleVsRaw } from '../../shared/docOil';
import { DENSITY, PRODUCT_FORMULA, parsePackageKg } from '../../constants/formula';
import { itemKg, stockUnits } from '../../shared/orderUnits';
import { isBulkItem } from '../../shared/itemTaxonomy';
import { rawLotTarget } from '../../shared/rawReceipt';
import { operationDocId, type RawInventoryState } from '../../shared/rawInventoryCore';
import { receiptToKg } from '../../shared/lotUtils';
import { authoritativeLedgerBalanceKg } from '../../shared/rawLedgerBalance';
import { lotQtyRemaining } from '../../shared/lotUtils';

export type IntegrityArea = '작업완료·BOM' | '입고·재고' | '전표·서류' | '판매일지·수불부';
export type IntegritySeverity = 'error' | 'warning' | 'info';
export interface IntegrityIssue { id: string; area: IntegrityArea; severity: IntegritySeverity; title: string; detail: string; date?: string; reference?: string; }

/**
 * 감사 입력은 **전 회사·전 기간의 원본 배열**을 그대로 받는다.
 * 회사 갈래는 `companyOf`, 날짜 범위는 아래 함수 안에서만 자른다 — 부르는 쪽이 미리
 * 걸러 넣으면 **연결 무결성 검사가 기간 밖 원료 이동을 누락으로 오인한다**
 * (예: 스냅샷이 가리키는 원장 문서 id가 그날 원장에 없다고 보고). 스크립트·시험은
 * 항상 전체 배열을 넘겨 준다.
 */
export interface IntegrityAuditInput {
  companyId: CompanyId; dateFrom?: string; dateTo?: string;
  orders: Order[]; items: Item[]; itemBoms: ItemBom[];
  purchaseOrders: PurchaseOrder[]; itemReceipts: ItemReceipt[];
  rawMaterialLedger: RawMaterialEntry[];
  rawInventories: RawInventoryState[];
  issuedStatements: IssuedStatement[];
  productionSalesLogs: ProductionSalesLog[];
}

const refOf = (o: Order) => o.cardNo || o.id;
const nameOf = (items: Item[], id: string) => items.find(item => item.id === id)?.name || id;
const kg3 = (n: number) => Math.round(n * 1000) / 1000;

/** kg 반올림 오차 허용치 — 엔진이 이미 3자리로 맞춰 저장한다. */
const KG_EPS = 0.01;
/** 재고 개수 허용치 — 엔진은 3자리에서 반올림한다. */
const QTY_EPS = 0.001;
/** 처리 중 예약은 정상 작업 중에도 잠깐 보인다. 예약 TTL과 같은 1시간을 넘긴 것만 멈춤으로 본다. */
export const PROCESSING_STALE_MS = 60 * 60 * 1000;
export const isStaleInventoryProcessing = (startedAt: string | undefined, nowMs = Date.now()): boolean => {
  const startedMs = Date.parse(startedAt ?? '');
  return Number.isFinite(startedMs) && nowMs - startedMs >= PROCESSING_STALE_MS;
};

type LedgerMovement = RawMaterialEntry & {
  materialSnapshot?: string;
  effectiveAt?: string;
  source?: { type?: string; id?: string };
  operationId?: string;
  reportedDeltaKg?: number;
  appliedDeltaKg?: number;
  balanceAfterKg?: number;
  kind?: string;
  lotChanges?: { lotId?: string; supplierName?: string; deltaKg?: number; beforeKg?: number; afterKg?: number }[];
};

/**
 * 저장된 스냅샷만으로 재고 증감을 다시 계산한다. 현재 BOM을 다시 읽지 않는다 — 저장 이후
 * BOM이 바뀌었어도 그날의 판단은 그때의 스냅샷에만 근거해야 한다.
 *
 *   +producedUnits[p] · +autoBuilt[c]
 *   −(그 parent 수량) × (snapshot.bomLines 의 quantity)  → 각 non-bulk 자식마다
 *
 * 실제 엔진(orderStockEngine.accrueBom)이 벌크 자식을 스킵하고, autoBuilt·producedUnits 를
 * parent로 반복해 내려간다. 여기서도 같은 규칙을 쓴다.
 */
export function expectedProductionDeltas(
  snap: OrderInventorySnapshot | undefined,
  producedUnits: readonly { itemId: string; qty: number }[] | undefined,
  autoBuilt: readonly { itemId: string; qty: number }[] | undefined,
  itemById: Map<string, Item>,
): Map<string, number> {
  const expected = new Map<string, number>();
  const add = (id: string, delta: number) => {
    if (!delta) return;
    expected.set(id, kg3((expected.get(id) ?? 0) + delta));
  };
  const parents = new Map<string, number>();
  for (const row of producedUnits ?? []) {
    if (!row.qty) continue;
    add(row.itemId, row.qty);
    parents.set(row.itemId, (parents.get(row.itemId) ?? 0) + row.qty);
  }
  for (const row of autoBuilt ?? []) {
    if (!row.qty) continue;
    add(row.itemId, row.qty);
    parents.set(row.itemId, (parents.get(row.itemId) ?? 0) + row.qty);
  }
  for (const line of snap?.bomLines ?? []) {
    const parentQty = parents.get(line.parentItemId);
    if (!parentQty) continue;
    const child = itemById.get(line.childItemId);
    // 엔진은 자식이 벌크면 스킵한다 (기름·원료 배합은 rawUsage로 흐른다). 자식 품목이
    // 삭제됐으면 orphan-bom 검사가 이미 잡는다.
    if (!child || isBulkItem(child)) continue;
    add(line.childItemId, -parentQty * line.quantity);
  }
  // 0에 아주 가까운 값은 지운다.
  for (const [id, value] of [...expected]) {
    if (Math.abs(value) < QTY_EPS) expected.delete(id);
    else expected.set(id, kg3(value));
  }
  return expected;
}

interface LinePOClassify {
  isRaw: boolean;
  holder?: Item;
  baseName?: string;
  expectedKg?: number;   // raw 라인일 때 kg 환산치
}

/**
 * 발주 라인이 원료로 처리되는지 판정 — **실제 입고 경로와 같은 판정을 쓴다**(rawLotTarget).
 * `type === 'wip'` 만 보고 원료로 치던 옛 규칙은 캔 반제품(단위 '개') 을 원료로 오인한다.
 * 원료 라인이면 예상 입고 kg 도 함께 낸다.
 */
export function classifyPurchaseLine(
  items: Item[],
  line: PurchaseOrderItem,
  companyId: CompanyId,
): LinePOClassify {
  const product = items.find(i => i.id === line.itemId);
  const target = rawLotTarget(items, product, product?.name ?? line.name, companyId);
  if (!target) return { isRaw: false };
  const packageKg = product ? (itemKg(product) || undefined) : parsePackageKg(line.name);
  const density = DENSITY[target.baseName] ?? 1;
  const u = (line.unit ?? product?.unit ?? '').toLowerCase();
  const kg = receiptToKg({ quantity: line.quantity, unit: u, density, packageKg });
  return { isRaw: true, holder: target.rawItem, baseName: target.baseName, expectedKg: kg };
}

/**
 * 하루치 데이터 점검 감사. **저장 당시 스냅샷**만 근거로 삼는다 — 현재 BOM으로 과거 차감량을
 * 다시 셈하지 않는다. 규칙과 예외는 인수인계.md 및 스냅샷 필드 정의에 있다.
 */
export function auditDataIntegrity(input: IntegrityAuditInput): IntegrityIssue[] {
  const out: IntegrityIssue[] = [];
  const items = input.items.filter(item => companyOf(item) === input.companyId);
  const itemIds = new Set(items.map(item => item.id));
  const itemById = new Map(items.map(item => [item.id, item]));
  const orders = input.orders.filter(order => companyOf(order) === input.companyId);
  // 원료수불부는 **회사만** 잘라 낸다. 날짜로 자르면 스냅샷이 가리키는 그날 이전·이후의
  // 원장 문서를 못 찾아 '연결 누락'으로 오인한다.
  const rawLedger = (input.rawMaterialLedger as LedgerMovement[]).filter(entry => companyOf(entry) === input.companyId);
  const rawLedgerById = new Map(rawLedger.map(entry => [entry.id, entry]));
  const rawLedgerByOperationId = new Map<string, LedgerMovement>();
  for (const entry of rawLedger) if (entry.operationId) rawLedgerByOperationId.set(entry.operationId, entry);
  const rawLedgerIds = new Set(rawLedger.map(entry => entry.id));

  const inRange = (value?: string) => !value || ((!input.dateFrom || value.slice(0, 10) >= input.dateFrom) && (!input.dateTo || value.slice(0, 10) <= input.dateTo));

  for (const state of input.rawInventories.filter(state => state.companyId === input.companyId)) {
    const lotTotal = state.activeLots.reduce((sum, lot) => sum + lot.kgRemaining, 0);
    if (state.stockKg < -QTY_EPS) out.push({ id: `raw-stock-negative:${state.id}`, area: '입고·재고', severity: 'error', title: '원료 현재고가 음수', detail: `${state.materialSnapshot} 현재고가 ${state.stockKg.toLocaleString()}kg입니다. 입고되지 않은 수량을 사용한 상태가 아직 해소되지 않았습니다.`, date: state.lastProcessedAt, reference: state.rawItemId });
    if (Math.abs(state.stockKg - lotTotal) > QTY_EPS) out.push({ id: `raw-lot-gap:${state.id}`, area: '입고·재고', severity: 'error', title: '원료 현재고와 활성 로트 합계 불일치', detail: `${state.materialSnapshot}: 현재고 ${state.stockKg.toLocaleString()}kg, 로트 합계 ${lotTotal.toLocaleString()}kg로 ${(state.stockKg - lotTotal).toLocaleString()}kg 차이입니다.`, date: state.lastProcessedAt, reference: state.rawItemId });
    const stateLedger = rawLedger.filter(entry => entry.rawItemId === state.rawItemId || (!entry.rawItemId && entry.material === state.materialSnapshot));
    const ledgerBalance = authoritativeLedgerBalanceKg(stateLedger, DENSITY[state.materialSnapshot] ?? 1);
    if (Math.abs(state.stockKg - ledgerBalance) > QTY_EPS) out.push({ id: `raw-ledger-state-gap:${state.id}`, area: '입고·재고', severity: 'error', title: '원료 실제 원장과 현재고 불일치', detail: `${state.materialSnapshot}: 실제 원장 잔량 ${kg3(ledgerBalance)}kg, 현재고 ${kg3(state.stockKg)}kg로 ${kg3(state.stockKg - ledgerBalance)}kg 차이입니다.`, date: state.lastProcessedAt, reference: state.rawItemId });
    const holder = itemById.get(state.rawItemId);
    if (holder && Math.abs(Number(holder.stock ?? 0) - state.stockKg) > QTY_EPS) out.push({ id: `raw-item-state-gap:${state.id}`, area: '입고·재고', severity: 'error', title: '재고관리와 원자화 상태 불일치', detail: `${state.materialSnapshot}: 재고관리 ${kg3(Number(holder.stock ?? 0))}kg, 원자화 상태 ${kg3(state.stockKg)}kg로 ${kg3(Number(holder.stock ?? 0) - state.stockKg)}kg 차이입니다.`, date: state.lastProcessedAt, reference: state.rawItemId });
    if (!itemIds.has(state.rawItemId)) out.push({ id: `raw-item-missing:${state.id}`, area: '입고·재고', severity: 'error', title: '원료 재고가 없는 품목을 참조함', detail: `${state.materialSnapshot} 재고의 품목 ${state.rawItemId}를 현재 회사에서 찾을 수 없습니다.`, date: state.lastProcessedAt, reference: state.id });
  }

  // 개수로 세는 완제품·박스는 rawInventories가 없다. 로트를 쓰는 품목만 stock과 로트 개수를 대조한다.
  const rawStateItemIds = new Set(input.rawInventories.filter(state => state.companyId === input.companyId).map(state => state.rawItemId));
  for (const item of items) {
    if (rawStateItemIds.has(item.id)) continue;
    const stock = Number(item.stock ?? 0);
    if (stock < -QTY_EPS) out.push({
      id: `item-stock-negative:${item.id}`, area: '입고·재고', severity: 'error',
      title: '완제품 현재재고가 음수',
      detail: `${item.name}: 재고관리 현재재고가 ${kg3(stock)}${item.unit ?? '개'}입니다. 생산·입고보다 출고가 먼저 반영됐거나 과거 부족분이 남아 있습니다.`,
      reference: item.id,
    });
    if (!item.lots?.some(lot => lot.qtyRemaining != null)) continue;
    const lotQty = lotQtyRemaining(item.lots);
    if (lotQty < -QTY_EPS) out.push({
      id: `item-lot-negative:${item.id}`, area: '입고·재고', severity: 'error',
      title: '완제품 제품 로트가 음수',
      detail: `${item.name}: 활성 제품 로트 합계가 ${kg3(lotQty)}${item.unit ?? '개'}입니다. 출고 당시 부족분이 이월 로트에 남아 있습니다.`,
      reference: item.id,
    });
    if (Math.abs(stock - lotQty) > QTY_EPS) out.push({
      id: `item-lot-gap:${item.id}`, area: '입고·재고', severity: 'error',
      title: '완제품 재고와 제품 로트 불일치',
      detail: `${item.name}: 재고관리 ${kg3(stock)}${item.unit ?? '개'}, 활성 로트 합계 ${kg3(lotQty)}${item.unit ?? '개'}로 ${kg3(stock - lotQty)} 차이입니다. 실사정정이 재고만 바꾼 과거 경로인지 확인해야 합니다.`,
      reference: item.id,
    });
  }

  for (const order of orders) {
    const reference = refOf(order);
    if (order.inventoryOperation?.state === 'failed' && inRange(order.inventoryOperation.startedAt)) out.push({ id: `op-failed:${order.id}`, area: '작업완료·BOM', severity: 'error', title: '재고 작업이 실패한 주문', detail: order.inventoryOperation.error || '실패 사유가 기록되지 않았습니다.', date: order.inventoryOperation.startedAt, reference });
    if (order.inventoryOperation?.state === 'processing' && inRange(order.inventoryOperation.startedAt) && isStaleInventoryProcessing(order.inventoryOperation.startedAt)) out.push({ id: `op-processing:${order.id}`, area: '작업완료·BOM', severity: 'warning', title: '재고 작업이 1시간 이상 처리 중으로 남은 주문', detail: '정상 작업 시간을 넘겼습니다. 브라우저 종료나 저장 실패로 잠금만 남았는지 확인해야 합니다.', date: order.inventoryOperation.startedAt, reference });

    order.items.forEach((line, index) => {
      if (!line.checked) return;
      const state = line.lineId ? order.itemInventory?.[line.lineId] : undefined;
      const completedAt = state?.completedAt || state?.production?.capturedAt || line.checkedAt;
      if ((input.dateFrom || input.dateTo) && !completedAt) return;
      if (!inRange(completedAt)) return;
      if (!line.lineId || !state?.applied) {
        out.push({ id: `checked-no-state:${order.id}:${line.lineId || index}`, area: '작업완료·BOM', severity: 'error', title: '완료 품목의 재고 처리 근거 없음', detail: `${line.name} ${line.quantity}개가 완료됐지만 품목별 재고 스냅샷이 없습니다.`, date: line.checkedAt || order.deliveryDate, reference });
        return;
      }
      if (state.itemId !== line.itemId) out.push({ id: `wrong-item:${order.id}:${line.lineId}`, area: '작업완료·BOM', severity: 'error', title: '완료 품목과 재고 처리 품목 불일치', detail: `${line.name}의 재고 기록이 ${nameOf(items, state.itemId)}에 연결돼 있습니다.`, date: state.completedAt, reference });

      const snap = state.production;
      const productionWasNeeded = state.producedUnits.some(row => row.qty !== 0) || state.autoBuilt.some(row => row.qty !== 0) || state.rawConsumedLots.length > 0;
      const hasMovement = !!snap && (snap.stockDeltas.length > 0 || !!snap.rawConsumedLots?.length || !!snap.productConsumedLots?.length);
      if (!snap?.capturedAt || (productionWasNeeded && !hasMovement)) out.push({ id: `empty-snapshot:${order.id}:${line.lineId}`, area: '작업완료·BOM', severity: 'warning', title: '생산 품목의 차감 내역이 비어 있음', detail: `${line.name}은 생산 처리됐지만 완제품·구성품·원료 이동 기록이 모두 비어 있습니다.`, date: state.completedAt, reference });
      for (const delta of snap?.stockDeltas || []) if (!itemIds.has(delta.itemId)) out.push({ id: `missing-delta:${order.id}:${line.lineId}:${delta.itemId}`, area: '작업완료·BOM', severity: 'error', title: '재고 증감 품목이 품목 목록에 없음', detail: `저장된 증감 ${delta.delta}의 품목 ${delta.itemId}를 찾을 수 없습니다.`, date: snap.capturedAt, reference });
      for (const bom of snap?.bomLines || []) if (!itemIds.has(bom.parentItemId) || !itemIds.has(bom.childItemId)) out.push({ id: `missing-bom:${order.id}:${line.lineId}:${bom.parentItemId}:${bom.childItemId}`, area: '작업완료·BOM', severity: 'error', title: '저장된 BOM 품목이 품목 목록에 없음', detail: `${nameOf(items, bom.parentItemId)} → ${nameOf(items, bom.childItemId)} 연결을 확인할 수 없습니다.`, date: snap.capturedAt, reference });
      if ((snap?.rawConsumedLots?.length || 0) > 0 && !snap?.rawLedgerIds?.length) out.push({ id: `raw-no-ledger:${order.id}:${line.lineId}`, area: '작업완료·BOM', severity: 'error', title: '원료 사용은 있으나 수불부 연결 없음', detail: `${line.name}의 원료 로트 차감은 기록됐지만 원료수불부 문서 ID가 없습니다.`, date: snap.capturedAt, reference });
      for (const ledgerId of snap?.rawLedgerIds || []) {
        if (rawLedgerIds.has(ledgerId)) continue;
        // 옛 앱은 같은 operationId를 다른 문서 ID로 저장했다. 재개 시 새 계산 ID를 스냅샷에
        // 남긴 주문은 문서 ID만 보면 누락처럼 보이므로, 원자 작업번호가 실제 존재하는지도 본다.
        const matchingTrace = snap.rawConsumedLots?.find(trace =>
          trace.operationId && operationDocId(trace.operationId) === ledgerId
        );
        if (matchingTrace?.operationId && rawLedgerByOperationId.has(matchingTrace.operationId)) continue;
        out.push({ id: `raw-ledger-missing:${order.id}:${line.lineId}:${ledgerId}`, area: '작업완료·BOM', severity: 'error', title: '연결된 원료수불부 기록을 찾을 수 없음', detail: `${line.name}이 가리키는 수불부 문서 ${ledgerId}가 없습니다.`, date: snap.capturedAt, reference });
      }

      // ── P0.1 · 스냅샷 산술 정합성 ─────────────────────────────────────
      // 기존 재고로만 충당한 완료 줄(producedUnits·autoBuilt·stockDeltas 가 모두 비어 있음)은
      // 계산할 것이 없으므로 통과시킨다. 이 경우 rawConsumedLots 도 없다.
      if (snap) {
        const expected = expectedProductionDeltas(snap, state.producedUnits, state.autoBuilt, itemById);
        const actual = new Map<string, number>();
        for (const row of snap.stockDeltas ?? []) actual.set(row.itemId, kg3((actual.get(row.itemId) ?? 0) + row.delta));
        const seen = new Set<string>();
        for (const itemId of [...expected.keys(), ...actual.keys()]) {
          if (seen.has(itemId)) continue;
          seen.add(itemId);
          const e = expected.get(itemId) ?? 0;
          const a = actual.get(itemId) ?? 0;
          if (Math.abs(e - a) > QTY_EPS) {
            const displayName = nameOf(items, itemId);
            out.push({
              id: `snapshot-arith:${order.id}:${line.lineId}:${itemId}`,
              area: '작업완료·BOM', severity: 'error',
              title: '저장된 생산·자동제조·BOM으로 계산한 재고 증감이 스냅샷과 다름',
              detail: `${displayName}: 스냅샷 ${a}개, 스냅샷의 생산·자동제조·BOM으로 다시 계산하면 ${e}개(차이 ${kg3(a - e)}). 저장 당시 스냅샷 자체가 어긋나 있어 되돌리기가 어긋난다.`,
              date: snap.capturedAt, reference,
            });
          }
        }
      }

      // ── P0.2 · 원료 trace vs 실제 원장 대조 ─────────────────────────
      // 스냅샷에 원료 trace(rawConsumedLots) 가 있고 각 trace 는 operationId 를 들고 있다.
      // 같은 operationId 로 실제 원장 문서를 찾아 회사·주문·품목·kg·로트 변화를 대조한다.
      const tracesByOperation = new Map<string, NonNullable<typeof state.rawConsumedLots>>();
      for (const trace of state.rawConsumedLots ?? []) {
        if (!trace.operationId) continue;
        const group = tracesByOperation.get(trace.operationId);
        if (group) group.push(trace); else tracesByOperation.set(trace.operationId, [trace]);
      }
      for (const [traceOperationId, traces] of tracesByOperation) {
        const ledger = rawLedgerByOperationId.get(traceOperationId)
                    ?? rawLedgerById.get(operationDocId(traceOperationId));
        if (!ledger) continue;   // raw-ledger-missing 이 이미 잡는다
        const traceKg = kg3(traces.reduce((sum, trace) => sum + trace.kg, 0));
        const traceMaterials = [...new Set(traces.map(trace => trace.material).filter(Boolean))];
        const traceRawItemIds = [...new Set(traces.map(trace => trace.rawItemId).filter(Boolean))];
        const ledgerOnly = traces.every(trace => trace.ledgerOnly);
        const diffs: string[] = [];
        if (ledger.companyId && companyOf(ledger) !== companyOf(order)) diffs.push(`회사 ${companyOf(ledger)} ≠ 주문 ${companyOf(order)}`);
        const sourceType = ledger.source?.type;
        const expectedSourceType = ledgerOnly ? 'oem' : 'production';
        if (sourceType && sourceType !== expectedSourceType) diffs.push(`원장 source.type ${sourceType} ≠ ${expectedSourceType}`);
        if (ledger.source?.id && ledger.source.id !== order.id) diffs.push(`원장 source.id ${ledger.source.id} ≠ 주문 ${order.id}`);
        if (ledger.rawItemId && (traceRawItemIds.length !== 1 || ledger.rawItemId !== traceRawItemIds[0])) diffs.push(`품목 ${ledger.rawItemId} ≠ trace ${traceRawItemIds.join(', ') || '(없음)'}`);
        if (ledger.materialSnapshot && (traceMaterials.length !== 1 || ledger.materialSnapshot !== traceMaterials[0])) diffs.push(`원료명 ${ledger.materialSnapshot} ≠ trace ${traceMaterials.join(', ') || '(없음)'}`);
        // consume·ledger-consume 은 reportedDeltaKg = -kg 로 저장된다. trace.kg 은 양수(소비량).
        const reported = ledger.reportedDeltaKg;
        if (typeof reported === 'number' && Math.abs(reported + traceKg) > KG_EPS) {
          diffs.push(`원장 reportedDeltaKg ${kg3(reported)} ≠ trace 합계 -${traceKg}`);
        }
        // consume 은 로트를 실제로 깎으므로 lotChanges 합이 -trace.kg 이어야 한다.
        // ledger-consume 은 로트를 안 건드리므로 합이 0이거나 lotChanges 가 비어 있어야 한다.
        const lotSum = (ledger.lotChanges ?? []).reduce((sum, change) => sum + (change.deltaKg ?? 0), 0);
        if (ledgerOnly) {
          if (Math.abs(lotSum) > KG_EPS) diffs.push(`임가공 원장인데 로트 변화 합 ${kg3(lotSum)}kg`);
        } else if (Math.abs(lotSum + traceKg) > KG_EPS) {
          diffs.push(`원장 로트 변화 합 ${kg3(lotSum)}kg ≠ trace 합계 -${traceKg}kg`);
        }
        // 일반 로트가 음수가 되는 건 오류다. 다만 `carry-*` 이월 로트는 재고 부족분을 명시적으로
        // 기록했다가 다음 입고에서 먼저 상계하는 설계이므로 오류가 아니라 운영 경고로 보고한다.
        let carryShortage: number | undefined;
        for (const change of ledger.lotChanges ?? []) {
          if (typeof change.afterKg === 'number' && change.afterKg < -KG_EPS) {
            const isCarry = change.supplierName === '이월' || String(change.lotId ?? '').startsWith('carry-');
            if (isCarry) carryShortage = Math.min(carryShortage ?? 0, change.afterKg);
            else diffs.push(`일반 로트 잔량 음수 ${kg3(change.afterKg)}kg`);
            break;
          }
        }
        if (diffs.length) out.push({
          id: `raw-ledger-mismatch:${order.id}:${line.lineId}:${ledger.id}`,
          area: '작업완료·BOM', severity: 'error',
          title: '주문 원료 trace 와 원장 문서가 다름',
          detail: `${traceMaterials.join(', ') || ledger.materialSnapshot || ledger.material || '원료'} — ${diffs.join(' · ')}.`,
          date: ledger.effectiveAt || snap?.capturedAt, reference,
        });
        if (carryShortage != null) out.push({
          id: `raw-carry-shortage:${order.id}:${line.lineId}:${ledger.id}`,
          area: '입고·재고', severity: 'warning',
          title: '생산 시점 원료 부족분이 이월로 기록됨',
          detail: `${traceMaterials.join(', ') || ledger.materialSnapshot || ledger.material || '원료'} 사용 직후 부족분이 ${Math.abs(kg3(carryShortage))}kg였습니다. 현재고가 0 이상이면 이후 입고로 해소된 기록입니다.`,
          date: ledger.effectiveAt || snap?.capturedAt, reference,
        });
      }
    });
  }

  // ── 입고 기록 자체의 형식 검사 ────────────────────────────────────────
  const allReceipts = input.itemReceipts.filter(r => companyOf(r) === input.companyId);
  const receiptsInRange = allReceipts.filter(r => inRange(r.date));
  for (const receipt of receiptsInRange) {
    if (!itemIds.has(receipt.itemId)) out.push({ id: `receipt-item:${receipt.id}`, area: '입고·재고', severity: 'error', title: '입고 기록의 품목이 없음', detail: `${receipt.itemName} 입고 기록이 삭제됐거나 다른 회사 품목을 가리킵니다.`, date: receipt.date, reference: receipt.poId || receipt.id });
    if (!Number.isFinite(receipt.quantity) || receipt.quantity <= 0) out.push({ id: `receipt-qty:${receipt.id}`, area: '입고·재고', severity: 'error', title: '입고 수량 오류', detail: `${receipt.itemName} 입고 수량이 ${receipt.quantity}입니다.`, date: receipt.date, reference: receipt.poId || receipt.id });
  }

  // ── P0.3 · 입고 완료 발주를 라인·품목별로 대조 ──────────────────────
  const receiptsByPo = new Map<string, ItemReceipt[]>();
  for (const receipt of allReceipts) {
    if (!receipt.poId) continue;
    const list = receiptsByPo.get(receipt.poId);
    if (list) list.push(receipt); else receiptsByPo.set(receipt.poId, [receipt]);
  }
  const receivedPos = input.purchaseOrders.filter(po => companyOf(po as PurchaseOrder & { companyId?: CompanyId }) === input.companyId && po.status === 'received' && po.poType !== 'oem' && inRange(po.receivedAt || po.createdAt));
  for (const po of receivedPos) {
    const poRef = po.cardNo || po.id;
    const poDate = (po.receivedAt || po.createdAt)?.slice(0, 10);
    const linesByItem = new Map<string, PurchaseOrderItem[]>();
    for (const l of poLines(po)) {
      const key = l.itemId || l.name;
      const bucket = linesByItem.get(key);
      if (bucket) bucket.push(l); else linesByItem.set(key, [l]);
    }
    const relatedReceipts = receiptsByPo.get(po.id) ?? [];
    const receiptsByItem = new Map<string, ItemReceipt[]>();
    for (const r of relatedReceipts) {
      const bucket = receiptsByItem.get(r.itemId);
      if (bucket) bucket.push(r); else receiptsByItem.set(r.itemId, [r]);
    }

    for (const [key, poLineGroup] of linesByItem) {
      const first = poLineGroup[0];
      const expectedQty = poLineGroup.reduce((sum, l) => sum + (Number.isFinite(l.quantity) ? l.quantity : 0), 0);
      const classify = classifyPurchaseLine(items, first, input.companyId);
      if (classify.isRaw) {
        // 원료 라인: rawMaterialLedger 에 purchase 근거가 있어야 하고 kg 합이 발주 kg 과 같아야 한다.
        const holderId = classify.holder?.id;
        const expectedKgTotal = poLineGroup.reduce((sum, l) => {
          const cls = classifyPurchaseLine(items, l, input.companyId);
          return sum + (cls.expectedKg ?? 0);
        }, 0);
        const rawMovements = rawLedger.filter(entry =>
          (entry.source?.type === 'purchase' && entry.source?.id === po.id)
          || (entry.operationId?.startsWith(`purchase:${po.id}:${holderId ?? ''}:`) === true),
        );
        if (rawMovements.length === 0) {
          out.push({
            id: `po-no-raw:${po.id}:${first.itemId || key}`,
            area: '입고·재고', severity: 'error',
            title: '원료 입고 완료지만 원료 이동 기록 없음',
            detail: `${first.name} ${expectedQty}${first.unit || ''}의 로트·수불부 반영 근거가 없습니다.`,
            date: poDate, reference: poRef,
          });
          continue;
        }
        const holderMovements = holderId
          ? rawMovements.filter(m => m.rawItemId === holderId)
          : rawMovements;
        if (holderId && holderMovements.length === 0) {
          out.push({
            id: `po-raw-item-mismatch:${po.id}:${first.itemId || key}`,
            area: '입고·재고', severity: 'error',
            title: '원료 입고 기록이 다른 원료 품목을 가리킴',
            detail: `${first.name}의 발주와 원장 사이에 rawItemId 가 다릅니다 (예상 ${holderId}, 원장에는 없음).`,
            date: poDate, reference: poRef,
          });
        }
        const actualKg = holderMovements.reduce((sum, m) => sum + (typeof m.reportedDeltaKg === 'number' ? m.reportedDeltaKg : 0), 0);
        if (expectedKgTotal > 0 && Math.abs(actualKg - expectedKgTotal) > KG_EPS) {
          out.push({
            id: `po-raw-qty:${po.id}:${first.itemId || key}`,
            area: '입고·재고', severity: 'error',
            title: '원료 입고 수량 불일치',
            detail: `${first.name}: 발주 kg 환산 ${kg3(expectedKgTotal)}kg, 원장 합계 ${kg3(actualKg)}kg (${kg3(actualKg - expectedKgTotal)}kg 차이).`,
            date: poDate, reference: poRef,
          });
        }
        continue;
      }

      // 비원료 라인: itemReceipts 로 대조. 여러 품목 발주면 품목별로 자른다.
      if (!first.itemId) {
        // 품목 id 가 없는 옛 발주 라인은 매칭할 열쇠가 없다.
        continue;
      }
      const receiptsForItem = receiptsByItem.get(first.itemId) ?? [];
      if (receiptsForItem.length === 0) {
        out.push({
          id: `po-no-receipt:${po.id}:${first.itemId}`,
          area: '입고·재고', severity: 'error',
          title: '입고 완료지만 입고 기록 없음',
          detail: `${first.name}의 재고 반영 근거(입고 기록)를 찾을 수 없습니다.`,
          date: poDate, reference: poRef,
        });
        continue;
      }
      const actualQty = receiptsForItem.reduce((sum, r) => sum + (Number.isFinite(r.quantity) ? r.quantity : 0), 0);
      if (expectedQty > 0 && Math.abs(actualQty - expectedQty) > QTY_EPS) {
        const severity: IntegritySeverity = actualQty < expectedQty ? 'error' : 'warning';
        const title = actualQty < expectedQty
          ? '입고 수량이 발주 수량보다 적음(부분 입고)'
          : '입고 수량이 발주 수량보다 많음(중복 가능)';
        out.push({
          id: `po-receipt-qty:${po.id}:${first.itemId}`,
          area: '입고·재고', severity, title,
          detail: `${first.name}: 발주 ${expectedQty}${first.unit || ''}, 입고 합계 ${actualQty}${first.unit || ''}.`,
          date: poDate, reference: poRef,
        });
      }
      // 같은 발주·같은 품목에 입고 문서가 여러 개면 중복 저장 후보로 표시(수량이 맞아도 검토 대상).
      if (receiptsForItem.length > 1) {
        out.push({
          id: `po-receipt-dup:${po.id}:${first.itemId}`,
          area: '입고·재고', severity: 'warning',
          title: '같은 발주·같은 품목에 입고 기록이 여러 건',
          detail: `${first.name} 입고 기록 ${receiptsForItem.length}건이 같은 발주에 붙어 있습니다. 중복 저장인지 부분 입고인지 확인이 필요합니다.`,
          date: poDate, reference: poRef,
        });
      }
    }
  }

  // ── 전표 검사 ─────────────────────────────────────────────────────────
  for (const statement of input.issuedStatements.filter(s => companyOf(s) === input.companyId && inRange(s.tradeDate))) statement.items.forEach((line, index) => {
    if (line.lineKind === 'account') return;
    if (!line.itemId) out.push({ id: `stmt-no-item:${statement.id}:${index}`, area: '전표·서류', severity: 'warning', title: '전표 품목 ID 없음', detail: `${line.name} 줄은 품목과 ID로 연결되지 않아 이후 변경을 추적할 수 없습니다.`, date: statement.tradeDate, reference: statement.docNo });
    else if (!itemIds.has(line.itemId)) out.push({ id: `stmt-missing-item:${statement.id}:${index}`, area: '전표·서류', severity: 'error', title: '전표가 없는 품목을 참조함', detail: `${line.name}의 품목 ${line.itemId}를 찾을 수 없습니다.`, date: statement.tradeDate, reference: statement.docNo });
    if (!line.name.trim()) out.push({ id: `stmt-name:${statement.id}:${index}`, area: '전표·서류', severity: 'error', title: '전표 품목명 누락', detail: '인쇄되는 품목명이 비어 있습니다.', date: statement.tradeDate, reference: statement.docNo });
    const linkedItem = line.itemId ? itemById.get(line.itemId) : undefined;
    if (linkedItem?.spec?.trim() && !String(line.spec ?? '').trim()) out.push({ id: `stmt-spec:${statement.id}:${index}`, area: '전표·서류', severity: 'warning', title: '전표 출력 규격 누락', detail: `${line.name}은 연결 품목 규격 '${linkedItem.spec}'이 있지만 전표에 저장된 출력 규격이 비어 있습니다.`, date: statement.tradeDate, reference: statement.docNo });
  });

  // ── 서류용 판매 줄·저장된 판매일지·서류수불부 환산 대조 ────────────
  // 판매일지를 만드는 실제 화면과 같은 docDateOf → stockUnits → docSaleLines 순서를 쓴다.
  // 이 셈을 따로 흉내 내면 박스 수량을 두 번 푸는 사고가 다시 생긴다.
  const expectedSalesByDate = new Map<string, Map<string, number>>();
  const expectedOrderCountByDate = new Map<string, number>();
  const saleKgByDate: Record<string, Record<string, number>> = {};
  const saleKey = (partner: string, item: string, spec: string) => [partner.trim(), item.trim(), spec.trim()].join('\u0001');
  const addSale = (map: Map<string, number>, key: string, qty: number) => map.set(key, kg3((map.get(key) ?? 0) + qty));
  const documentOrders = orders.filter(order =>
    (order.status === 'SHIPPED' || order.status === 'DELIVERED')
    && !!docDateOf(order)
    && inRange(docDateOf(order)),
  );
  for (const order of documentOrders) {
    const docDate = docDateOf(order);
    expectedOrderCountByDate.set(docDate, (expectedOrderCountByDate.get(docDate) ?? 0) + 1);
    const byKey = expectedSalesByDate.get(docDate) ?? new Map<string, number>();
    expectedSalesByDate.set(docDate, byKey);
    order.items.forEach((line, index) => {
      const product = items.find(item => item.id === line.itemId);
      if (!isSalesJournalProduct(product)) return;
      const isGiftSet = String(product?.subtype ?? product?.category ?? '').includes('선물세트');
      if (isGiftSet && product) {
        const components = input.itemBoms.filter(bom => bom.parent_id === product.id && Number(bom.quantity) > 0);
        const productComponents = components.filter(bom => {
          const child = itemById.get(bom.child_id);
          return child?.type === 'product' || child?.type === '완제품';
        });
        if (components.length === 0 || productComponents.length === 0) out.push({ id: `doc-set-empty:${order.id}:${line.lineId || index}`, area: '전표·서류', severity: 'error', title: '선물세트의 서류용 완제품 구성 없음', detail: `${line.name}은 선물세트지만 판매일지로 풀 완제품 BOM이 없습니다.`, date: docDate, reference: refOf(order) });
        for (const bom of components) {
          const child = itemById.get(bom.child_id);
          if (!child) out.push({ id: `doc-set-child-missing:${order.id}:${line.lineId || index}:${bom.child_id}`, area: '전표·서류', severity: 'error', title: '선물세트 구성 품목이 삭제됨', detail: `${line.name}의 구성 ${bom.child_id}를 품목 목록에서 찾을 수 없어 판매일지에서 일부가 빠질 수 있습니다.`, date: docDate, reference: refOf(order) });
          else if ((child.type === 'product' || child.type === '완제품') && !docSaleLines(child, Number(bom.quantity) || 1, id => items.find(item => item.id === id)).length) out.push({ id: `doc-set-child-no-doc:${order.id}:${line.lineId || index}:${bom.child_id}`, area: '전표·서류', severity: 'error', title: '선물세트 구성품의 서류 품목 누락', detail: `${line.name} 구성품 ${child.name}은 서류용 품목으로 변환되지 않아 판매일지에서 빠집니다.`, date: docDate, reference: refOf(order) });
        }
      }
      // 생산판매일지 화면은 주문의 표시 수량을 docUnpack에 넘긴다. stockUnits를 먼저 적용하면
      // 박스가 낱개로 바뀐 뒤 docUnpack에서 다시 풀려 개입수가 두 번 곱해진다.
      const expanded = journalSaleLines(product, line.quantity, { name: line.name, displaySize: line.displaySize }, id => items.find(item => item.id === id));
      if (!expanded.length) out.push({ id: `doc-empty:${order.id}:${line.lineId || index}`, area: '전표·서류', severity: 'error', title: '서류용 품목이 없어 판매 줄이 누락됨', detail: `${line.name} ${line.quantity}개가 서류 품목으로 변환되지 않습니다.`, date: docDate, reference: refOf(order) });
      else if (!docSaleLines(product, stockUnits(line, product), id => items.find(item => item.id === id)).length) out.push({ id: `doc-fallback:${order.id}:${line.lineId || index}`, area: '전표·서류', severity: 'warning', title: '서류용 품목명이 없어 상품명으로 대체됨', detail: `${line.name}은 판매일지에 포함됐지만 품목의 서류용 품목명이 비어 상품명을 대신 사용했습니다.`, date: docDate, reference: refOf(order) });
      expanded.forEach((row, rowIndex) => {
        addSale(byKey, saleKey(order.partnerName || '', row.품목, row.spec), row.qty);
        const kg = docOilKg(row.spec, row.qty);
        if (PRODUCT_FORMULA[row.품목] && kg <= 0) out.push({ id: `doc-capacity:${order.id}:${index}:${rowIndex}`, area: '전표·서류', severity: 'error', title: '서류용 용량을 읽을 수 없음', detail: `${row.품목}의 용량 '${row.spec || '(비어 있음)'}' 때문에 원료 사용량이 0으로 계산됩니다.`, date: docDate, reference: refOf(order) });
        if (kg > 0) {
          const byItem = saleKgByDate[docDate] ?? (saleKgByDate[docDate] = {});
          byItem[row.품목] = (byItem[row.품목] ?? 0) + kg;
        }
      });
    });
  }

  const companyLogs = input.productionSalesLogs.filter(log =>
    companyOf(log as ProductionSalesLog & { companyId?: CompanyId }) === input.companyId && inRange(log.date),
  );
  const logsByDate = new Map<string, ProductionSalesLog[]>();
  for (const log of companyLogs) {
    const list = logsByDate.get(log.date);
    if (list) list.push(log); else logsByDate.set(log.date, [log]);
  }
  for (const [docDate, expected] of expectedSalesByDate) {
    const logs = logsByDate.get(docDate) ?? [];
    if (logs.length === 0) {
      out.push({ id: `sales-log-missing:${docDate}`, area: '판매일지·수불부', severity: 'error', title: '배송완료 주문의 생산판매일지가 없음', detail: `${expectedOrderCountByDate.get(docDate) ?? 0}건의 주문은 서류일 ${docDate}로 확정됐지만 저장된 생산판매일지가 없습니다.`, date: docDate, reference: docDate });
      continue;
    }
    if (logs.length > 1) out.push({ id: `sales-log-duplicate:${docDate}`, area: '판매일지·수불부', severity: 'warning', title: '같은 날짜의 생산판매일지가 여러 건', detail: `${docDate} 생산판매일지가 ${logs.length}건입니다. 다시 저장해 중복됐는지 확인해야 합니다.`, date: docDate, reference: logs.map(log => log.id).join(', ') });
    const actual = new Map<string, number>();
    for (const log of logs) for (const row of log.salesRows ?? []) addSale(actual, saleKey(row.상호 || '', row.품목 || '', row.용량 || ''), row.수량);
    const seen = new Set<string>();
    for (const key of [...expected.keys(), ...actual.keys()]) {
      if (seen.has(key)) continue;
      seen.add(key);
      const expectedQty = expected.get(key) ?? 0;
      const actualQty = actual.get(key) ?? 0;
      if (Math.abs(expectedQty - actualQty) <= QTY_EPS) continue;
      const [partner, item, spec] = key.split('\u0001');
      out.push({ id: `sales-log-qty:${docDate}:${key}`, area: '판매일지·수불부', severity: 'error', title: '주문과 생산판매일지 수량 불일치', detail: `${partner || '(거래처 없음)'} / ${item || '(품목 없음)'} / ${spec || '(용량 없음)'}: 주문 환산 ${expectedQty}, 저장 일지 ${actualQty}.`, date: docDate, reference: logs.map(log => log.id).join(', ') });
    }
    const loggedOrderCount = logs.reduce((sum, log) => sum + (Number.isFinite(log.orderCount) ? log.orderCount : 0), 0);
    const expectedOrderCount = expectedOrderCountByDate.get(docDate) ?? 0;
    if (loggedOrderCount !== expectedOrderCount) out.push({ id: `sales-log-order-count:${docDate}`, area: '판매일지·수불부', severity: 'warning', title: '생산판매일지 주문 건수 불일치', detail: `주문 ${expectedOrderCount}건, 저장 일지 표기 ${loggedOrderCount}건입니다.`, date: docDate, reference: logs.map(log => log.id).join(', ') });
  }
  for (const [docDate, logs] of logsByDate) {
    if (expectedSalesByDate.has(docDate)) continue;
    const rowCount = logs.reduce((sum, log) => sum + (log.salesRows?.length ?? 0), 0);
    if (rowCount > 0) out.push({ id: `sales-log-orphan:${docDate}`, area: '판매일지·수불부', severity: 'warning', title: '주문 근거를 찾을 수 없는 생산판매일지', detail: `${docDate} 일지에 판매 ${rowCount}줄이 있으나 같은 서류일의 배송완료 주문이 없습니다.`, date: docDate, reference: logs.map(log => log.id).join(', ') });
  }
  for (const mismatch of reconcileSaleVsRaw(saleKgByDate)) out.push({
    id: `doc-raw-ratio:${mismatch.date}`, area: '판매일지·수불부', severity: 'error',
    title: '판매일지와 서류수불부 환산량 불일치',
    detail: `판매 ${mismatch.saleKg}kg를 서류 배합비로 원료에 배분하면 ${mismatch.rawKg}kg입니다 (차이 ${mismatch.diffKg}kg).${mismatch.unmapped.length ? ` 배합비 없는 품목: ${mismatch.unmapped.join(', ')}` : ''}`,
    date: mismatch.date, reference: mismatch.date,
  });

  // ── P1.5 · 판매일지 회사별 분리 ──────────────────────────────────────
  // 스키마에 companyId 가 붙기 전 로그는 태백으로 본다(`companyOf` 와 같은 규칙). 태백 감사에서만
  // 한 번 보고하고, 풍회 감사에서는 스킵해 같은 줄이 두 번 나오지 않게 한다.
  for (const log of input.productionSalesLogs) {
    const logCompanyId = companyOf(log as ProductionSalesLog & { companyId?: CompanyId });
    if (logCompanyId !== input.companyId) continue;
    if (!inRange(log.date)) continue;
    const unscopedTag = (log as ProductionSalesLog & { companyId?: CompanyId }).companyId ? '' : ' (회사 미기록 · 태백으로 간주)';
    (log.salesRows || []).forEach((row, index) => {
      if (!row.품목.trim()) out.push({ id: `sales-name:${log.id}:${index}`, area: '판매일지·수불부', severity: 'error', title: '판매일지 품목명 누락', detail: `${row.상호} 판매 줄의 품목명이 비어 있습니다.${unscopedTag}`, date: log.date, reference: log.id });
      if (PRODUCT_FORMULA[row.품목] && docOilKg(row.용량, row.수량) <= 0) out.push({ id: `sales-capacity:${log.id}:${index}`, area: '판매일지·수불부', severity: 'error', title: '판매일지 용량 해석 실패', detail: `${row.품목} '${row.용량 || '(비어 있음)'}'은 서류 원료량으로 환산되지 않습니다.${unscopedTag}`, date: log.date, reference: log.id });
      if (!Number.isFinite(row.수량) || row.수량 <= 0) out.push({ id: `sales-qty:${log.id}:${index}`, area: '판매일지·수불부', severity: 'warning', title: '판매일지 수량 오류', detail: `${row.품목} 수량이 ${row.수량}입니다.${unscopedTag}`, date: log.date, reference: log.id });
    });
  }

  for (const bom of input.itemBoms) {
    // 다른 회사 품목끼리의 BOM은 현재 회사 점검 결과에 섞지 않는다. 한쪽만 현재 회사면 회사 경계 오류이므로 잡는다.
    if (!itemIds.has(bom.parent_id) && !itemIds.has(bom.child_id)) continue;
    if (!itemIds.has(bom.parent_id) || !itemIds.has(bom.child_id)) out.push({ id: `orphan-bom:${bom.id}`, area: '작업완료·BOM', severity: 'error', title: '삭제됐거나 다른 회사인 품목을 가리키는 BOM', detail: `${nameOf(items, bom.parent_id)} → ${nameOf(items, bom.child_id)} 연결을 정리해야 합니다.`, reference: bom.id });
  }
  return out;
}
