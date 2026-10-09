"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOpeningInventoryCommand = void 0;
exports.createInventoryOpening = createInventoryOpening;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const inventoryOpening_1 = require("./shared/inventoryOpening");
const lotAnchor_1 = require("./shared/lotAnchor");
const stockUnitMeasure_1 = require("./shared/stockUnitMeasure");
const rawHolder_1 = require("./shared/rawHolder");
const rawInventoryPrepare_1 = require("./shared/rawInventoryPrepare");
const rawInventoryCore_1 = require("./shared/rawInventoryCore");
const rawInventoryDocument_1 = require("./shared/rawInventoryDocument");
const releaseGate_1 = require("./releaseGate");
const clean = (value) => JSON.parse(JSON.stringify(value));
const companyOf = (row) => { var _a; return (_a = row.companyId) !== null && _a !== void 0 ? _a : 'taebaek'; };
function fail(message) { throw new https_1.HttpsError('failed-precondition', message); }
const snapshot = (row) => ({ exists: () => row.exists, data: () => row.data() });
/** 기초 재고·로트·원료 원장·146/375 전표는 하나의 서버 거래로 저장한다. */
async function createInventoryOpening(db, actor, input) {
    if (!(actor === null || actor === void 0 ? void 0 : actor.uid))
        throw new https_1.HttpsError('unauthenticated', '로그인이 필요합니다.');
    if (actor.token.isAdmin !== true || !['taebaek', 'punghoe'].includes(actor.token.companyId) || actor.token.companyId !== (input === null || input === void 0 ? void 0 : input.companyId))
        throw new https_1.HttpsError('permission-denied', '현재 회사 관리자만 기초 재고를 등록할 수 있습니다.');
    const { companyId, date, itemId, quantity, value } = input;
    if (typeof itemId !== 'string' || !itemId || itemId.includes('/') || !(0, inventoryOpening_1.calendarDay)(date) || !Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(value) || value <= 0)
        fail('기초 재고 날짜·수량·평가금액을 확인하세요.');
    const itemRef = db.collection('items').doc(itemId), openingRef = db.collection('openingBalances').doc(companyId === 'taebaek' ? 'main' : 'main-punghoe');
    const voucherRef = db.collection('issuedStatements').doc(`opening-inventory-${companyId}-${itemId}`);
    const operationId = `opening-inventory:${companyId}:${itemId}`, recordedAt = new Date().toISOString();
    const command = { kind: 'opening', operationId, companyId, rawItemId: itemId, materialSnapshot: '', effectiveAt: `${date}T00:00:00+09:00`, source: { type: 'opening', id: itemId }, kg: quantity };
    return db.runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        // 첫 읽기를 먼저 완료하여 SDK의 transaction 시작도 한 번으로 고정한다.
        const release = await tx.get((0, releaseGate_1.releaseGateRef)(db));
        (0, releaseGate_1.assertReleaseActive)(release, input.releaseId);
        const itemSnap = await tx.get(itemRef);
        const [openingSnap, voucherSnap] = await Promise.all([tx.get(openingRef), tx.get(voucherRef)]);
        if (!itemSnap.exists)
            fail('기초 재고 품목이 없습니다.');
        const item = Object.assign(Object.assign({}, itemSnap.data()), { id: itemSnap.id });
        if (companyOf(item) !== companyId || item.type === 'service' || item.archived || item.phantom)
            fail('현재 회사의 실물 품목만 기초 재고로 등록할 수 있습니다.');
        if (Math.abs(quantity - Math.round(quantity * 1000) / 1000) > 1e-9 || (!(0, rawHolder_1.isRawHolder)(item) && !Number.isInteger(quantity)))
            fail('기초 재고 수량은 개수 품목은 정수, 벌크 원료는 소수 셋째 자리까지 입력하세요.');
        const voucher = (0, inventoryOpening_1.inventoryOpeningStatement)(companyId, date, item, quantity, value);
        if (voucherSnap.exists) {
            const saved = voucherSnap.data();
            if (saved.companyId === companyId && saved.tradeDate === date && saved.totalAmount === value && saved.openingQuantity === quantity && saved.openingItemId === itemId)
                return 'unchanged';
            fail('같은 품목의 기초 재고가 다른 내용으로 이미 등록됐습니다.');
        }
        const opening = openingSnap.data();
        if (!opening || opening.companyId !== companyId || opening.date !== date)
            fail('먼저 해당 날짜의 회계 기초잔액을 저장하세요.');
        if (Number((_b = (_a = opening.amounts) === null || _a === void 0 ? void 0 : _a['146']) !== null && _b !== void 0 ? _b : 0) !== 0)
            fail('146 재고자산 계정에 수기 기초 합계가 있어 이중계상됩니다. 기존 금액을 확인하세요.');
        if (Number((_c = item.stock) !== null && _c !== void 0 ? _c : 0) !== 0 || ((_d = item.lots) !== null && _d !== void 0 ? _d : []).some((lot) => { var _a, _b; return Number((_a = lot.qtyRemaining) !== null && _a !== void 0 ? _a : 0) !== 0 || Number((_b = lot.kgRemaining) !== null && _b !== void 0 ? _b : 0) !== 0; }) || ((_e = item.stocktakeAnchors) !== null && _e !== void 0 ? _e : []).length > 0)
            fail('이미 재고나 실사 이력이 있는 품목은 기초 재고로 등록할 수 없습니다.');
        if ((0, rawHolder_1.isRawHolder)(item)) {
            const movementRef = db.collection('rawMaterialLedger').doc((0, rawInventoryCore_1.operationDocId)(operationId));
            const oldId = (0, rawInventoryCore_1.legacyOperationDocId)(operationId), stateRef = db.collection('rawInventories').doc((0, rawInventoryCore_1.inventoryDocId)(companyId, itemId));
            const [movementSnap, oldMovementSnap, stateSnap] = await Promise.all([tx.get(movementRef), oldId === movementRef.id ? Promise.resolve(null) : tx.get(db.collection('rawMaterialLedger').doc(oldId)), tx.get(stateRef)]);
            if (stateSnap.exists && (Number((_g = (_f = stateSnap.data()) === null || _f === void 0 ? void 0 : _f.stockKg) !== null && _g !== void 0 ? _g : 0) !== 0 || Number((_j = (_h = stateSnap.data()) === null || _h === void 0 ? void 0 : _h.revision) !== null && _j !== void 0 ? _j : 0) !== 0))
                fail('원료 상태에 기존 재고 이력이 있어 기초 재고로 등록할 수 없습니다.');
            const result = (0, rawInventoryPrepare_1.prepareRawCommand)(command, { itemSnap: snapshot(itemSnap), stateSnap: snapshot(stateSnap), movementSnap: snapshot(movementSnap), oldMovementSnap: oldMovementSnap ? snapshot(oldMovementSnap) : null }, { now: recordedAt, legacy: { note: '기초 재고', type: 'manual' } });
            if (result.status !== 'applied')
                fail(result.status === 'rejected' ? result.message : '기초 원료 명령이 이미 처리됐습니다.');
            tx.set(stateRef, clean(result.state));
            tx.set(movementRef, clean((0, rawInventoryDocument_1.toLedgerDoc)(result.movement, { note: '기초 재고', type: 'manual' })));
            tx.update(itemRef, { stock: result.state.stockKg, lots: clean([...result.state.activeLots, ...result.state.recentDepletedLots]) });
        }
        else {
            const bom = await tx.get(db.collection('item_bom').where('parent_id', '==', itemId));
            const ownLines = bom.docs.filter(row => companyOf(row.data()) === companyId);
            const childSnaps = await Promise.all(ownLines.map(row => tx.get(db.collection('items').doc(String(row.data().child_id)))));
            if (childSnaps.some(row => row.exists && companyOf(row.data()) !== companyId))
                fail('다른 회사의 구성 품목입니다.');
            const component = (0, stockUnitMeasure_1.unpackStockComponent)(ownLines.map((row, index) => ({ childId: String(row.data().child_id), qty: typeof row.data().quantity === 'number' ? row.data().quantity : 1, child: childSnaps[index].data() })));
            const unitKg = (0, stockUnitMeasure_1.itemPackageKg)(item, component !== null);
            const anchored = (0, lotAnchor_1.anchorLotsByQty)({ lots: [], targetQty: quantity, unitKg, det: { id: `lot-${operationId}`, createdAt: recordedAt, receivedDate: date } });
            tx.update(itemRef, { stock: quantity, lots: clean(anchored.lots), stocktakeAnchors: [{ id: operationId, date, createdAt: recordedAt, targetQty: quantity, beforeQty: 0, deltaQty: quantity, note: '기초 재고' }] });
        }
        tx.update(openingRef, { hasInventoryOpening: true });
        tx.set(voucherRef, voucher);
        return 'created';
    });
}
exports.createOpeningInventoryCommand = (0, https_1.onCall)({ region: 'asia-northeast3' }, request => createInventoryOpening(admin.firestore(), request.auth, request.data));
//# sourceMappingURL=inventoryOpeningCommand.js.map