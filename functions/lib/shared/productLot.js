"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProductLot = buildProductLot;
exports.withCarryOverProductLot = withCarryOverProductLot;
exports.lotQtyRemaining = lotQtyRemaining;
exports.deductLotsByQty = deductLotsByQty;
const round3 = (n) => Math.round(n * 1000) / 1000;
function buildProductLot(params, clock) {
    var _a;
    const now = clock.now;
    const qty = Math.round(params.qtyIn * 1000) / 1000;
    const kg = round3(qty * params.unitKg);
    return {
        id: clock.id,
        material: params.material,
        supplierId: params.supplierId,
        supplierName: params.supplierName,
        qtyIn: qty,
        qtyRemaining: qty,
        unitKg: params.unitKg,
        kgIn: kg,
        kgRemaining: kg,
        receivedDate: (_a = params.receivedDate) !== null && _a !== void 0 ? _a : clock.date,
        status: 'active',
        poId: params.poId,
        lotNo: params.lotNo,
        createdAt: now,
    };
}
/**
 * 로트를 안 쓰던 완제품에 첫 로트를 얹을 때, 그때까지의 재고를 '이월' 로트로 보존한다.
 * 안 하면 로트 합계(0) < 재고(15박스)라 첫 출고부터 전부 미상으로 빠진다.
 * 이월분은 출처를 모르는 게 사실이므로 supplierName='이월'로 정직하게 남긴다.
 */
function withCarryOverProductLot(lots, currentQty, material, unitKg, carryOver, clock) {
    var _a, _b, _c, _d;
    if (lots.length > 0)
        return lots;
    const qty = round3(currentQty);
    if (!Number.isFinite(qty) || qty <= 0)
        return lots;
    if (!Number.isFinite(unitKg) || unitKg < 0)
        throw new Error('이월 로트의 단위 중량을 확인해 주세요.');
    return [{
            id: (_a = carryOver === null || carryOver === void 0 ? void 0 : carryOver.id) !== null && _a !== void 0 ? _a : clock.id,
            lotNo: `이월-${((_b = carryOver === null || carryOver === void 0 ? void 0 : carryOver.receivedDate) !== null && _b !== void 0 ? _b : clock.date).replace(/-/g, '')}`,
            material,
            supplierName: '이월',
            qtyIn: qty, qtyRemaining: qty, unitKg,
            kgIn: round3(qty * unitKg), kgRemaining: round3(qty * unitKg),
            receivedDate: (_c = carryOver === null || carryOver === void 0 ? void 0 : carryOver.receivedDate) !== null && _c !== void 0 ? _c : clock.date,
            status: 'active',
            createdAt: (_d = carryOver === null || carryOver === void 0 ? void 0 : carryOver.createdAt) !== null && _d !== void 0 ? _d : clock.now,
        }];
}
/** 완제품 로트의 잔여 개수 합 */
function lotQtyRemaining(lots) {
    return round3((lots !== null && lots !== void 0 ? lots : []).reduce((s, l) => { var _a; return s + ((_a = l.qtyRemaining) !== null && _a !== void 0 ? _a : 0); }, 0));
}
/**
 * 개수 기준 FIFO 차감 — 출고 때 앞쪽 로트부터 깐다. 혼합(mix)은 없다: 박스는 섞이지 않는다.
 *
 * 로트 잔량이 부족하면 원본을 유지하고 부족량을 돌려준다. 호출자는 부족량을 거절해야 한다.
 * 수량 재고는 남아도 로트가 모자랄 수 있으므로 이 함수에서 음수 이월을 만들지 않는다.
 */
function deductLotsByQty(lots, qtyToUse) {
    var _a, _b, _c, _d, _e, _f;
    if (!Number.isFinite(qtyToUse) || qtyToUse < 0) {
        throw new Error(`로트 차감 수량은 0 이상의 유한한 숫자여야 합니다: ${qtyToUse}`);
    }
    if (lots.some(lot => lot.qtyRemaining != null && !Number.isFinite(lot.qtyRemaining))) {
        throw new Error('로트 잔량이 올바르지 않습니다.');
    }
    let remaining = round3(qtyToUse);
    const dist = [];
    if (remaining <= 0)
        return { lots: lots.map(l => (Object.assign({}, l))), distribution: dist, shortageQty: 0 };
    const usable = round3(lots.reduce((sum, lot) => { var _a; return sum + (lot.status === 'active' ? Math.max(0, Number((_a = lot.qtyRemaining) !== null && _a !== void 0 ? _a : 0)) : 0); }, 0));
    const available = Math.max(0, Math.min(usable, lotQtyRemaining(lots)));
    const shortageQty = round3(Math.max(0, remaining - available));
    if (shortageQty > 0)
        return { lots, distribution: [], shortageQty };
    const next = lots.map(l => (Object.assign({}, l)));
    for (const l of next) {
        if (remaining <= 0)
            break;
        if (l.status !== 'active' || ((_a = l.qtyRemaining) !== null && _a !== void 0 ? _a : 0) <= 0)
            continue;
        const t = Math.min((_b = l.qtyRemaining) !== null && _b !== void 0 ? _b : 0, remaining);
        if (t <= 0)
            continue;
        l.qtyRemaining = round3(((_c = l.qtyRemaining) !== null && _c !== void 0 ? _c : 0) - t);
        l.kgRemaining = round3(((_d = l.qtyRemaining) !== null && _d !== void 0 ? _d : 0) * ((_e = l.unitKg) !== null && _e !== void 0 ? _e : 0));
        remaining = round3(remaining - t);
        if (((_f = l.qtyRemaining) !== null && _f !== void 0 ? _f : 0) <= 0.0001) {
            l.qtyRemaining = 0;
            l.kgRemaining = 0;
            l.status = 'depleted';
        }
        dist.push({ lotId: l.id, lotNo: l.lotNo, receivedDate: l.receivedDate, supplierName: l.supplierName, qty: round3(t) });
    }
    if (remaining > 0)
        return { lots, distribution: [], shortageQty: remaining };
    return { lots: next, distribution: dist, shortageQty: 0 };
}
//# sourceMappingURL=productLot.js.map