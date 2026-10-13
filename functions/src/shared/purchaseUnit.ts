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
export const MANUAL_PURCHASE_UNIT_ID = 'manual-kg';
/** 이름·규격·포대에서 무게를 추정하지 않는다. 사용자가 직접 쓴 kg·g만 kg로 환산한다. */
export function parseManualPurchaseUnitKg(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (/^kg$/i.test(text)) return 1;
  const matched = /^(\d+(?:\.\d+)?|\.\d+)\s*(kg|g)$/i.exec(text);
  const kg = matched ? Number(matched[1]) / (matched[2].toLowerCase() === 'g' ? 1000 : 1) : NaN;
  return positive(kg) ? kg : null;
}
export function makeManualPurchaseUnitSnapshot(purchaseUnit: string, purchaseQty: number): PurchaseUnitSnapshot {
  const unitKg = parseManualPurchaseUnitKg(purchaseUnit);
  if (unitKg === null || !positive(purchaseQty)) throw new Error('매입 단위는 kg 또는 양수 숫자와 kg·g로 입력해 주세요.');
  const suffix = purchaseUnit.trim().toLowerCase().endsWith('kg') ? 'kg' : 'g';
  const text = purchaseUnit.trim().toLowerCase().replace(/\s*(kg|g)$/, '');
  const [whole, fraction = ''] = text.split('.');
  const normalizedFraction = fraction.replace(/0+$/, '');
  const normalizedUnit = text ? `${whole.replace(/^0+/, '') || '0'}${normalizedFraction ? `.${normalizedFraction}` : ''}${suffix}` : 'kg';
  return readPurchaseUnitSnapshot({ purchaseUnitId: MANUAL_PURCHASE_UNIT_ID, purchaseUnit: normalizedUnit,
    purchaseQty, unitKg, inventoryQty: purchaseUnitKg3(purchaseQty * unitKg) })!;
}
export function isManualPurchaseUnitSnapshot(snapshot: Partial<PurchaseUnitSnapshot>): boolean {
  return readPurchaseUnitSnapshot(snapshot)?.purchaseUnitId === MANUAL_PURCHASE_UNIT_ID;
}

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
  if (line.purchaseUnitId === MANUAL_PURCHASE_UNIT_ID && parseManualPurchaseUnitKg(line.purchaseUnit) !== line.unitKg)
    throw new Error('직접 입력한 매입 단위와 재고 kg 환산량이 다릅니다.');
  return { purchaseUnitId: line.purchaseUnitId, purchaseUnit: line.purchaseUnit, purchaseQty: line.purchaseQty, unitKg: line.unitKg, inventoryQty: line.inventoryQty };
}

export function makePurchaseUnitSnapshot(registration: ItemPurchaseUnit, purchaseQty: number): PurchaseUnitSnapshot {
  if (registration.active !== true || !nonempty(registration.id) || registration.id === MANUAL_PURCHASE_UNIT_ID || !nonempty(registration.purchaseUnit)
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
  if (snapshot.purchaseUnitId === MANUAL_PURCHASE_UNIT_ID || registration.id === MANUAL_PURCHASE_UNIT_ID)
    throw new Error('직접 입력 단위를 등록된 매입 단위로 사용할 수 없습니다.');
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
