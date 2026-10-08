"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareRawCommand = prepareRawCommand;
const rawInventoryCore_1 = require("./rawInventoryCore");
const rawInventoryDocument_1 = require("./rawInventoryDocument");
const formula_1 = require("./formula");
/** 주문 취소도 같은 검사를 쓰도록 읽기·계산을 저장 경계에서 분리한다. */
function prepareRawCommand(command, read, options = {}, virtual) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const { movementSnap, oldMovementSnap, stateSnap, itemSnap, originalSnap, oldOriginalSnap, guardSnap } = read;
    const opId = (0, rawInventoryCore_1.operationDocId)(command.operationId);
    const invId = (0, rawInventoryCore_1.inventoryDocId)(command.companyId, command.rawItemId);
    const now = (_a = options.now) !== null && _a !== void 0 ? _a : command.effectiveAt;
    const newLotId = (_b = options.newLotId) !== null && _b !== void 0 ? _b : `lot-${opId}`;
    const carryOverLotId = (_c = options.carryOverLotId) !== null && _c !== void 0 ? _c : `carry-${opId}`;
    const mirror = options.mirrorToItem !== false;
    const 기존스냅 = movementSnap.exists() ? movementSnap : (oldMovementSnap === null || oldMovementSnap === void 0 ? void 0 : oldMovementSnap.exists()) ? oldMovementSnap : null;
    const existing = 기존스냅 ? (0, rawInventoryDocument_1.normalizeRawMovement)(기존스냅.data()) : null;
    const state = (_d = virtual === null || virtual === void 0 ? void 0 : virtual.state) !== null && _d !== void 0 ? _d : (stateSnap.exists() ? (0, rawInventoryDocument_1.normalizeRawInventoryState)(stateSnap.data()) : null);
    const itemData = (_e = virtual === null || virtual === void 0 ? void 0 : virtual.itemData) !== null && _e !== void 0 ? _e : (itemSnap.exists() ? itemSnap.data() : null);
    if (!itemData) {
        return { status: 'rejected', code: 'ITEM_NOT_FOUND', message: `원료 품목을 찾을 수 없다: ${command.rawItemId}` };
    }
    const actualCompany = (_f = itemData.companyId) !== null && _f !== void 0 ? _f : 'taebaek';
    if (actualCompany !== command.companyId) {
        return {
            status: 'rejected', code: 'COMPANY_MISMATCH',
            message: `품목 회사 ${actualCompany}와 명령 회사 ${command.companyId}가 다르다`,
        };
    }
    // 이름은 표시 스냅샷일 뿐이다. 화면이 보낸 값을 믿지 않고 rawItemId로 읽은 품목이 정한다.
    const materialSnapshot = String(itemData.rawMaterialName || (0, formula_1.baseRawName)(String((_g = itemData.name) !== null && _g !== void 0 ? _g : '')));
    const resolvedCommand = Object.assign(Object.assign({}, command), { materialSnapshot });
    const 원본스냅 = (originalSnap === null || originalSnap === void 0 ? void 0 : originalSnap.exists()) ? originalSnap : (oldOriginalSnap === null || oldOriginalSnap === void 0 ? void 0 : oldOriginalSnap.exists()) ? oldOriginalSnap : null;
    const original = 원본스냅 ? (0, rawInventoryDocument_1.normalizeRawMovement)(원본스냅.data()) : null;
    const guard = (guardSnap === null || guardSnap === void 0 ? void 0 : guardSnap.exists()) ? guardSnap.data() : null;
    const 원장전용 = command.kind === 'ledger-consume'
        || (command.kind === 'reverse' && (original === null || original === void 0 ? void 0 : original.kind) === 'ledger-consume');
    /**
     * **상태 문서가 없는데 품목엔 로트가 있으면 멈춘다.**
     * 빈 상태로 계산하면 그 로트를 없는 셈 치고 덮어써서 **재고가 통째로 날아간다.**
     * 이관(설계 §15 4단계)을 안 돌린 원료다 — `scripts/migrate-raw-inventories.mts` 를 먼저.
     */
    const 품목로트 = ((_h = itemData === null || itemData === void 0 ? void 0 : itemData.lots) !== null && _h !== void 0 ? _h : []);
    if (!state && (품목로트.length > 0 || 원장전용)) {
        return { status: 'rejected', code: 'NOT_MIGRATED', message: `이관 안 된 원료다(rawInventories 문서 없음): ${invId}` };
    }
    /**
     * **품목 재고와 상태 문서가 이미 어긋나 있으면 멈춘다.**
     *
     * 여기서 그냥 진행하면 아래 mirror 가 `items.stock` 을 새 값으로 덮어써서 **차이가 조용히
     * 사라진다.** 풍회 깻묵이 그런 상태다 — `items.stock` 8,000 인데 로트도 상태도 0 이다.
     * 그 원료에 입고 한 번 넣으면 8,000 이 날아간다.
     *
     * 어느 쪽이 맞는지는 코드가 못 정한다. 사람이 실사로 정하고 나서 다시 부른다.
     */
    if (mirror && !원장전용 && command.kind !== 'stocktake' && command.kind !== 'adjust-lot' && (itemSnap === null || itemSnap === void 0 ? void 0 : itemSnap.exists())) {
        const 품목재고 = Number((_j = itemData === null || itemData === void 0 ? void 0 : itemData.stock) !== null && _j !== void 0 ? _j : 0);
        const 상태재고 = (_k = state === null || state === void 0 ? void 0 : state.stockKg) !== null && _k !== void 0 ? _k : 0;
        if (!(0, rawInventoryDocument_1.rawMirrorMatches)(품목재고, 상태재고)) {
            return {
                status: 'rejected', code: 'STOCK_MISMATCH',
                message: `품목 재고와 원료 상태가 어긋나 있다: items.stock ${품목재고} ≠ ${상태재고} (${invId}). 실사로 맞춘 뒤에 다시 하라.`,
            };
        }
    }
    const result = (0, rawInventoryCore_1.applyRawCommand)({
        state, command: resolvedCommand, existing, original, guard,
        det: { now, newLotId, carryOverLotId },
    });
    return result;
}
//# sourceMappingURL=rawInventoryPrepare.js.map