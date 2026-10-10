import { buildItemLedger, type ItemInventoryEntry } from '../src/features/admin/itemLedger';
import { companyOf, type CompanyId, type Item, type Order } from '../src/shared/types';
import type { ItemReceipt } from '../src/shared/receipt';
import type { OrderUnitInputs } from '../src/shared/orderUnits';
import type { ReturnStockOperation } from '../src/shared/returnStockMovement';
import { buildBomIndex } from '../src/shared/bomIndex';
import { buildPackIndex } from '../src/shared/packIndex';

/** 별도 확인한 실물 조사 증빙. stocktake- 접두사만으로 생성하지 않는다. */
export interface PhysicalCountEvidence {
  itemId: string; anchorId: string; targetQty: number; createdAt: string; evidenceRef: string;
}
export interface DailyLedgerInput {
  companyId: CompanyId;
  /** 현재 stock을 읽은 KST 날짜. 과거 종료 재고를 현재 stock에서 역산하지 않는다. */
  snapshotDate: string;
  items: Item[]; orders: Order[]; receipts: ItemReceipt[]; inventoryEntries: ItemInventoryEntry[];
  returnOperations: ReturnStockOperation[]; unitInputs: OrderUnitInputs;
  /** 호출자 확인값일 뿐 수집 증명은 아님. 빈 배열을 완료 자료로 추정하지 않는다. */
  complete: boolean;
  physicalEvidence: PhysicalCountEvidence[];
}
export type LedgerFile = Omit<DailyLedgerInput, 'unitInputs'> & {
  itemBoms: { companyId?: CompanyId; parent_id: string; child_id: string; quantity?: number }[];
  itemPacks: { companyId?: CompanyId; item_id: string; units_per_box?: number }[];
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
/** 원문은 보존하고 점검할 수 없는 주문만 별도 진단한다. */
export function partitionLedgerOrders<T extends { id: string; companyId?: CompanyId; items?: unknown; status?: unknown }>(orders: T[]) {
  const valid: T[] = []; const invalid: { id: string; companyId: CompanyId; status: unknown; fields: string[]; reason: string }[] = [];
  for (const order of orders) {
    if (!Array.isArray(order.items) || order.items.some(line => !object(line))) {
      invalid.push({ id: order.id, companyId: companyOf(order), status: order.status, fields: Object.keys(order).sort(), reason: '주문 items 배열 없음 또는 품목 줄 형식 오류' });
    } else valid.push(order);
  }
  return { valid, invalid };
}
function validateFile(value: unknown): asserts value is LedgerFile {
  if (!object(value) || !['taebaek', 'punghoe'].includes(String(value.companyId)) || value.complete !== true
    || typeof value.snapshotDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.snapshotDate)
    || !Number.isFinite(Date.parse(value.snapshotDate)) || new Date(value.snapshotDate).toISOString().slice(0, 10) !== value.snapshotDate) throw new Error('회사·현재 재고 스냅샷 날짜·complete:true를 확인하세요.');
  for (const key of ['items', 'orders', 'receipts', 'inventoryEntries', 'returnOperations', 'itemBoms', 'itemPacks', 'physicalEvidence']) {
    const rows = value[key];
    if (!Array.isArray(rows) || rows.some(row => !object(row))) throw new Error(`${key}: 전체 배열이 필요합니다.`);
    for (const row of rows) {
      if (!object(row) || (row.companyId != null && !['taebaek', 'punghoe'].includes(String(row.companyId)))) throw new Error(`${key}: 회사 형식을 확인하세요.`);
      if (key === 'items' && (!text(row.id) || !text(row.name) || !text(row.type) || !finite(row.stock))) throw new Error('items: 품목/재고가 필요합니다.');
      if (key === 'items' && row.stocktakeAnchors != null && (!Array.isArray(row.stocktakeAnchors) || row.stocktakeAnchors.some(a => !object(a) || !text(a.id) || !text(a.date) || !finite(a.targetQty) || !finite(a.beforeQty)))) throw new Error('items: 앵커 원문이 불완전합니다.');
      if (key === 'orders') {
        if (!text(row.id) || !Array.isArray(row.items) || row.items.some(line => !object(line) || !text(line.itemId) || !finite(line.quantity))) throw new Error('orders: 주문 품목이 불완전합니다.');
        for (const k of ['producedUnits', 'autoBuilt']) if (row[k] != null && (!Array.isArray(row[k]) || row[k].some(line => !object(line) || !text(line.itemId) || !finite(line.qty)))) throw new Error(`orders: ${k} 원문이 불완전합니다.`);
      }
      if (key === 'receipts' && (!text(row.id) || !text(row.itemId) || !finite(row.quantity) || !text(row.date) || !text(row.createdAt))) throw new Error('receipts: 입고 원문이 불완전합니다.');
      if (key === 'inventoryEntries' && (!text(row.id) || !text(row.date))) throw new Error('inventoryEntries: 원장 원문이 불완전합니다.');
      if (key === 'returnOperations' && (!text(row.id) || !text(row.companyId))) throw new Error('returnOperations: 회사/문서 ID가 필요합니다.');
      if (key === 'itemBoms' && (!text(row.parent_id) || !text(row.child_id) || (row.quantity != null && !finite(row.quantity)))) throw new Error('itemBoms: 구성 원문이 불완전합니다.');
      if (key === 'itemPacks' && (!text(row.item_id) || (row.units_per_box != null && !finite(row.units_per_box)))) throw new Error('itemPacks: 포장 원문이 불완전합니다.');
      if (key === 'physicalEvidence' && (!text(row.itemId) || !text(row.anchorId) || !finite(row.targetQty) || !text(row.createdAt) || !text(row.evidenceRef))) throw new Error('physicalEvidence: 확인된 조사 증빙이 필요합니다.');
    }
  }
}
export function auditLedgerFile(value: unknown) {
  validateFile(value);
  const rows = dailyLedgerAudit({ ...value, unitInputs: ledgerUnitInputs(value.companyId, value.items, value.itemBoms, value.itemPacks) });
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return { companyId: value.companyId, snapshotDate: value.snapshotDate,
    completenessBasis: '전체 자료 수집 성공이라는 호출자 확인값; 내용 진실/실측 증명 아님',
    scope: '저장 기록 대조; 원료 별도, 당시 BOM 및 실물 전체 검증 아님', counts, rows };
}
export function ledgerUnitInputs(companyId: CompanyId, allItems: Item[], itemBoms: LedgerFile['itemBoms'], itemPacks: LedgerFile['itemPacks']): OrderUnitInputs {
  const items = allItems.filter(row => companyOf(row) === companyId);
  const ids = new Set(items.map(row => row.id));
  // 공용 BOM/pack에는 회사 필드가 없으므로 소유 품목 ID로 범위를 정한다.
  return {
    bom: buildBomIndex(items, itemBoms.filter(row => ids.has(row.parent_id) && (row.companyId == null || row.companyId === companyId))),
    pack: buildPackIndex(itemPacks.filter(row => ids.has(row.item_id) && (row.companyId == null || row.companyId === companyId))),
  };
}
export function dailyLedgerAudit(input: DailyLedgerInput) {
  if (!['taebaek', 'punghoe'].includes(input.companyId)
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.snapshotDate)
    || new Date(input.snapshotDate).toISOString().slice(0, 10) !== input.snapshotDate) throw new Error('회사와 스냅샷 날짜를 확인하세요.');
  if (!input.complete) throw new Error('불완전한 자료로 대조할 수 없습니다.');
  const items = input.items.filter(item => companyOf(item) === input.companyId);
  const orders = input.orders.filter(row => companyOf(row) === input.companyId);
  const receipts = input.receipts.filter(row => companyOf(row) === input.companyId);
  const entries = input.inventoryEntries.filter(row => companyOf(row) === input.companyId);
  const operations = input.returnOperations.filter(row => row.companyId === input.companyId);
  return items.map(item => {
    const base = { itemId: item.id, name: item.name, spec: item.spec, stock: item.stock, snapshotDate: input.snapshotDate };
    if (item.type === 'raw' || item.type === 'wip') return { ...base, status: '원료별도대조', reason: '제품 원장으로 원료 네 축을 검증하지 않음' };
    const ledger = buildItemLedger(item.id, orders, items, receipts, entries, input.unitInputs, operations);
    if (!input.complete || !Number.isFinite(item.stock) || ledger.rows.some(row => !Number.isFinite(row.balance) || row.date > input.snapshotDate)) {
      return { ...base, status: '입력미확인', reason: '전체 자료·수량·스냅샷 날짜 확인 필요' };
    }
    const latest = ledger.rows.filter(row => row.targetBalance != null).at(-1);
    const evidence = input.physicalEvidence.find(proof => proof.itemId === item.id && proof.anchorId === latest?.orderId
      && proof.targetQty === latest?.targetBalance && proof.createdAt === latest?.occurredAt && proof.evidenceRef.trim());
    if (!latest) return { ...base, status: '기준없음', reason: '현재 재고 역산은 독립 검증이 아님' };
    if (!evidence) return { ...base, status: '전산기준만', reason: '최신 앵커의 실측 증빙 미확인',
      expectedStock: ledger.net, gap: ledger.gap, anchorId: latest.orderId, anchorAt: latest.occurredAt };
    return { ...base, status: ledger.gap === 0 ? '기록일치' : '기록불일치',
      expectedStock: ledger.net, gap: ledger.gap, anchorId: latest.orderId, evidenceRef: evidence.evidenceRef,
      reason: '확인된 실측 이후 저장 기록 대조; 생산 BOM은 현재 입력을 사용하는 구간이 있어 실제 차감 완전성 보장은 아님' };
  });
}
