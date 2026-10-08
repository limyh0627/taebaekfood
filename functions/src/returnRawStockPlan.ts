import { ReturnValidationError } from './returnValidationError';
import * as admin from 'firebase-admin';
import { prepareRawCommand } from './shared/rawInventoryPrepare';
import { inventoryDocId, operationDocId, legacyOperationDocId,
  type RawInventoryCommand, type RawInventoryState } from './shared/rawInventoryCore';
import { toLedgerDoc } from './shared/rawInventoryDocument';
import { rawLotTarget, type RawHolderItem } from './shared/rawHolder';
import { DENSITY } from './shared/formula';
import { itemPackageKg, unpackStockComponent, receiptToKg } from './shared/stockUnitMeasure';
import type { CompanyId } from './shared/rawLot';

type Item = RawHolderItem & { unit?: string; spec?: string; packageKg?: number; packageType?: string;
  stock?: number; lots?: unknown[] };
type Input = { operationId: string; requestId: string; companyId: CompanyId; date: string; createdAt: string;
  partnerId: string; partnerName: string; item: Item; quantityDelta: number; allItems: Item[];
  bomLines: { parent_id: string; child_id: string; quantity?: number }[] };
type Applied = { state: RawInventoryState; itemData: Record<string, any> };
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const snapshot = (value: admin.firestore.DocumentSnapshot | null) => value ? {
  exists: () => value.exists, data: () => value.data()!,
} : null;

/** 기존 원료 명령의 읽기·계산만 수행한다. 모든 반품의 읽기가 끝난 뒤 함께 저장한다. */
export async function prepareReturnRawStock(db: admin.firestore.Firestore, tx: admin.firestore.Transaction,
  input: Input, virtual: Map<string, Applied>) {
  const target = rawLotTarget(input.allItems, input.item, input.item.name, input.companyId);
  if (!target) return null;
  const byId = new Map(input.allItems.map(item => [item.id, item]));
  const component = unpackStockComponent(input.bomLines.filter(line => line.parent_id === input.item.id)
    .map(line => ({ childId: line.child_id, qty: typeof line.quantity === 'number' ? line.quantity : 1,
      child: byId.get(line.child_id) as Item & { type?: string } | undefined })));
  const packageKg = itemPackageKg(input.item, component !== null) || undefined;
  const unit = String(input.item.unit ?? '').toLowerCase();
  const kg = receiptToKg({ quantity: Math.abs(input.quantityDelta), unit,
    density: DENSITY[target.baseName] ?? 1, packageKg });
  if (!Number.isFinite(kg) || kg <= 0) throw new ReturnValidationError('원료 반품 kg를 확인해 주세요.');
  const operationId = `return:${input.operationId}:${input.item.id}`;
  const base = { operationId, companyId: input.companyId, rawItemId: target.rawItem.id,
    materialSnapshot: target.baseName,
    effectiveAt: input.createdAt.slice(0, 10) === input.date ? input.createdAt : `${input.date}T12:00:00+09:00`,
    source: { type: 'manual' as const, id: input.requestId } };
  const command: RawInventoryCommand = input.quantityDelta > 0 ? { ...base, kind: 'receive', kg,
    lot: { supplierId: input.partnerId, supplierName: input.partnerName, packageKg,
      packageType: input.item.packageType ?? (packageKg && unit !== 'kg' && unit !== 'l' ? '캔' : undefined),
      qtyIn: input.quantityDelta, poId: input.requestId } } : { ...base, kind: 'consume', kg };
  const movementRef = db.collection('rawMaterialLedger').doc(operationDocId(operationId));
  const oldId = legacyOperationDocId(operationId);
  const stateRef = db.collection('rawInventories').doc(inventoryDocId(input.companyId, target.rawItem.id));
  const itemRef = db.collection('items').doc(target.rawItem.id);
  const movementSnap = await tx.get(movementRef);
  const oldMovementSnap = oldId === movementRef.id ? null : await tx.get(db.collection('rawMaterialLedger').doc(oldId));
  const stateSnap = await tx.get(stateRef), itemSnap = await tx.get(itemRef);
  const result = prepareRawCommand(command, { movementSnap: snapshot(movementSnap)!,
    oldMovementSnap: snapshot(oldMovementSnap), stateSnap: snapshot(stateSnap)!, itemSnap: snapshot(itemSnap)!,
    originalSnap: null, oldOriginalSnap: null, guardSnap: null }, {
    now: input.createdAt, newLotId: `lot-${operationDocId(operationId)}`,
  }, virtual.get(target.rawItem.id));
  if (result.status === 'rejected') throw new ReturnValidationError(result.message);
  if (result.status !== 'applied') throw new Error('이 반품의 원료 작업 ID가 이미 사용 중입니다.');
  const itemPatch = clean({ stock: result.state.stockKg,
    lots: [...result.state.activeLots, ...result.state.recentDepletedLots] });
  virtual.set(target.rawItem.id, { state: result.state, itemData: { ...itemSnap.data(), ...itemPatch } });
  const movement = clean({ ...toLedgerDoc(result.movement, { note: `${input.partnerName} 반품`, type: 'manual' }),
    returnOperationId: input.operationId, returnRequestId: input.requestId, partnerId: input.partnerId,
    returnedItemId: input.item.id, returnedQuantityDelta: input.quantityDelta });
  return { stateRef, itemRef, movementRef, state: clean(result.state), itemPatch, movement,
    requestItemId: input.item.id, quantityDelta: input.quantityDelta };
}

export function writeReturnRawStock(tx: admin.firestore.Transaction,
  prepared: NonNullable<Awaited<ReturnType<typeof prepareReturnRawStock>>>) {
  tx.set(prepared.stateRef, prepared.state);
  tx.update(prepared.itemRef, prepared.itemPatch);
  tx.create(prepared.movementRef, prepared.movement);
}
