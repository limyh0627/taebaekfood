import type { CompanyId } from './rawLot';

/** 등록표 변경 후에도 발행 당시 재고 환산량은 바뀌면 안 된다. */
export interface PurchaseUnitSnapshot {
  purchaseUnitId: string;
  purchaseUnit: string;
  purchaseQty: number;
  unitKg: number;
  inventoryQty: number;
}
export interface ItemPurchaseUnit {
  id: string;
  companyId: CompanyId;
  itemId: string;
  partnerId?: string;
  purchaseUnit: string;
  unitKg: number;
  isDefault: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
export const purchaseUnitKg3 = (value: number): number => Math.round(value * 1000) / 1000;
const fields = ['purchaseUnitId', 'purchaseUnit', 'purchaseQty', 'unitKg', 'inventoryQty'] as const;
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

export function readPurchaseUnitSnapshot(line: Partial<PurchaseUnitSnapshot> & { qty?: number; quantity?: number }): PurchaseUnitSnapshot | null {
  const present = fields.filter(field => line[field] !== undefined);
  if (!present.length) return null;
  if (present.length !== fields.length || !nonempty(line.purchaseUnitId) || !nonempty(line.purchaseUnit)
    || !positive(line.purchaseQty) || !positive(line.unitKg) || !positive(line.inventoryQty)
    || purchaseUnitKg3(line.purchaseQty * line.unitKg) !== line.inventoryQty
    || (line.qty !== undefined && line.qty !== line.purchaseQty)
    || (line.quantity !== undefined && line.quantity !== line.purchaseQty)) {
    throw new Error('매입 단위와 거래 수량·재고 kg 스냅샷을 확인해 주세요.');
  }
  return { purchaseUnitId: line.purchaseUnitId, purchaseUnit: line.purchaseUnit, purchaseQty: line.purchaseQty, unitKg: line.unitKg, inventoryQty: line.inventoryQty };
}

export function makePurchaseUnitSnapshot(registration: ItemPurchaseUnit, purchaseQty: number): PurchaseUnitSnapshot {
  if (registration.active !== true || !nonempty(registration.id) || !nonempty(registration.purchaseUnit)
    || !positive(registration.unitKg) || !positive(purchaseQty)) throw new Error('사용 중인 매입 단위와 양수 수량을 선택해 주세요.');
  const snapshot = { purchaseUnitId: registration.id, purchaseUnit: registration.purchaseUnit,
    purchaseQty, unitKg: registration.unitKg, inventoryQty: purchaseUnitKg3(purchaseQty * registration.unitKg) };
  return readPurchaseUnitSnapshot(snapshot)!;
}

/** 작성 중 수량만 바꿀 때 선택 당시 kg를 유지한다. 등록표를 다시 읽지 않는다. */
export function recalculatePurchaseUnitSnapshot(snapshot: PurchaseUnitSnapshot, purchaseQty: number): PurchaseUnitSnapshot {
  readPurchaseUnitSnapshot(snapshot);
  return readPurchaseUnitSnapshot({ ...snapshot, purchaseQty, inventoryQty: purchaseUnitKg3(purchaseQty * snapshot.unitKg) })!;
}
/** 신규 발행에만 등록표를 대조한다. 과거 반품은 당시 스냅샷만 읽는다. */
export function validatePurchaseUnitRegistration(snapshot: PurchaseUnitSnapshot, registration: ItemPurchaseUnit,
  scope: { companyId: CompanyId; itemId: string; partnerId?: string }): void {
  readPurchaseUnitSnapshot(snapshot);
  if (registration.active !== true || registration.companyId !== scope.companyId || registration.itemId !== scope.itemId
    || (registration.partnerId !== undefined && registration.partnerId !== scope.partnerId)
    || registration.id !== snapshot.purchaseUnitId || registration.purchaseUnit !== snapshot.purchaseUnit
    || registration.unitKg !== snapshot.unitKg) throw new Error('다른 회사·품목·거래처이거나 변경된 매입 단위입니다. 다시 선택해 주세요.');
}

export function returnKgFromPurchaseSnapshot(snapshot: PurchaseUnitSnapshot, returnedQty: number, previousReturnedQty = 0): number {
  readPurchaseUnitSnapshot(snapshot);
  if (!Number.isFinite(returnedQty) || returnedQty < 0 || !Number.isFinite(previousReturnedQty) || previousReturnedQty < 0 || previousReturnedQty + returnedQty > snapshot.purchaseQty) throw new Error('반품 수량이 원매입 수량을 벗어났습니다.');
  // 원전표 확정 kg를 비례하므로 등록표 수정이나 오늘 품목 규격은 읽지 않는다.
  const before = purchaseUnitKg3(snapshot.inventoryQty * previousReturnedQty / snapshot.purchaseQty);
  const after = purchaseUnitKg3(snapshot.inventoryQty * (previousReturnedQty + returnedQty) / snapshot.purchaseQty);
  return purchaseUnitKg3(after - before);
}
