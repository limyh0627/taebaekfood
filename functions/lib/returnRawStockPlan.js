"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareReturnRawStock = prepareReturnRawStock;
exports.writeReturnRawStock = writeReturnRawStock;
const returnValidationError_1 = require("./returnValidationError");
const rawInventoryPrepare_1 = require("./shared/rawInventoryPrepare");
const rawInventoryCore_1 = require("./shared/rawInventoryCore");
const rawInventoryDocument_1 = require("./shared/rawInventoryDocument");
const rawHolder_1 = require("./shared/rawHolder");
const formula_1 = require("./shared/formula");
const stockUnitMeasure_1 = require("./shared/stockUnitMeasure");
const clean = (value) => JSON.parse(JSON.stringify(value));
const snapshot = (value) => value ? {
    exists: () => value.exists, data: () => value.data(),
} : null;
/** 기존 원료 명령의 읽기·계산만 수행한다. 모든 반품의 읽기가 끝난 뒤 함께 저장한다. */
async function prepareReturnRawStock(db, tx, input, virtual) {
    var _a, _b, _c;
    const target = (0, rawHolder_1.rawLotTarget)(input.allItems, input.item, input.item.name, input.companyId);
    if (!target)
        return null;
    const byId = new Map(input.allItems.map(item => [item.id, item]));
    const component = (0, stockUnitMeasure_1.unpackStockComponent)(input.bomLines.filter(line => line.parent_id === input.item.id)
        .map(line => ({ childId: line.child_id, qty: typeof line.quantity === 'number' ? line.quantity : 1,
        child: byId.get(line.child_id) })));
    const packageKg = (0, stockUnitMeasure_1.itemPackageKg)(input.item, component !== null) || undefined;
    const unit = String((_a = input.item.unit) !== null && _a !== void 0 ? _a : '').toLowerCase();
    const kg = (0, stockUnitMeasure_1.receiptToKg)({ quantity: Math.abs(input.quantityDelta), unit,
        density: (_b = formula_1.DENSITY[target.baseName]) !== null && _b !== void 0 ? _b : 1, packageKg });
    if (!Number.isFinite(kg) || kg <= 0)
        throw new returnValidationError_1.ReturnValidationError('원료 반품 kg를 확인해 주세요.');
    const operationId = `return:${input.operationId}:${input.item.id}`;
    const base = { operationId, companyId: input.companyId, rawItemId: target.rawItem.id,
        materialSnapshot: target.baseName,
        effectiveAt: input.createdAt.slice(0, 10) === input.date ? input.createdAt : `${input.date}T12:00:00+09:00`,
        source: { type: 'manual', id: input.requestId } };
    const command = input.quantityDelta > 0 ? Object.assign(Object.assign({}, base), { kind: 'receive', kg, lot: { supplierId: input.partnerId, supplierName: input.partnerName, packageKg,
            packageType: (_c = input.item.packageType) !== null && _c !== void 0 ? _c : (packageKg && unit !== 'kg' && unit !== 'l' ? '캔' : undefined),
            qtyIn: input.quantityDelta, poId: input.requestId } }) : Object.assign(Object.assign({}, base), { kind: 'consume', kg });
    const movementRef = db.collection('rawMaterialLedger').doc((0, rawInventoryCore_1.operationDocId)(operationId));
    const oldId = (0, rawInventoryCore_1.legacyOperationDocId)(operationId);
    const stateRef = db.collection('rawInventories').doc((0, rawInventoryCore_1.inventoryDocId)(input.companyId, target.rawItem.id));
    const itemRef = db.collection('items').doc(target.rawItem.id);
    const movementSnap = await tx.get(movementRef);
    const oldMovementSnap = oldId === movementRef.id ? null : await tx.get(db.collection('rawMaterialLedger').doc(oldId));
    const stateSnap = await tx.get(stateRef), itemSnap = await tx.get(itemRef);
    const result = (0, rawInventoryPrepare_1.prepareRawCommand)(command, { movementSnap: snapshot(movementSnap),
        oldMovementSnap: snapshot(oldMovementSnap), stateSnap: snapshot(stateSnap), itemSnap: snapshot(itemSnap),
        originalSnap: null, oldOriginalSnap: null, guardSnap: null }, {
        now: input.createdAt, newLotId: `lot-${(0, rawInventoryCore_1.operationDocId)(operationId)}`,
    }, virtual.get(target.rawItem.id));
    if (result.status === 'rejected')
        throw new returnValidationError_1.ReturnValidationError(result.message);
    if (result.status !== 'applied')
        throw new Error('이 반품의 원료 작업 ID가 이미 사용 중입니다.');
    const itemPatch = clean({ stock: result.state.stockKg,
        lots: [...result.state.activeLots, ...result.state.recentDepletedLots] });
    virtual.set(target.rawItem.id, { state: result.state, itemData: Object.assign(Object.assign({}, itemSnap.data()), itemPatch) });
    const movement = clean(Object.assign(Object.assign({}, (0, rawInventoryDocument_1.toLedgerDoc)(result.movement, { note: `${input.partnerName} 반품`, type: 'manual' })), { returnOperationId: input.operationId, returnRequestId: input.requestId, partnerId: input.partnerId, returnedItemId: input.item.id, returnedQuantityDelta: input.quantityDelta }));
    return { stateRef, itemRef, movementRef, state: clean(result.state), itemPatch, movement,
        requestItemId: input.item.id, quantityDelta: input.quantityDelta };
}
function writeReturnRawStock(tx, prepared) {
    tx.set(prepared.stateRef, prepared.state);
    tx.update(prepared.itemRef, prepared.itemPatch);
    tx.create(prepared.movementRef, prepared.movement);
}
//# sourceMappingURL=returnRawStockPlan.js.map