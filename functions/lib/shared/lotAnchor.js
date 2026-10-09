"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.anchorLotsByQty = anchorLotsByQty;
const productLot_1 = require("./productLot");
const calculation_1 = require("./calculation");
const todayStr = () => (0, calculation_1.kstDateOf)(new Date());
function anchorLotsByQty(params) {
    var _a, _b, _c, _d, _e, _f;
    const { lots, targetQty, unitKg = 0, det } = params;
    if (!Number.isFinite(targetQty) || targetQty < 0) {
        throw new Error(`실사 목표 재고는 0 이상이어야 합니다: ${targetQty}`);
    }
    const before = (0, productLot_1.lotQtyRemaining)(lots);
    const delta = r3(targetQty - before);
    if (Math.abs(delta) < 0.0001)
        return { lots: lots.map(l => (Object.assign({}, l))), deltaQty: 0, beforeQty: before };
    if (delta < 0) {
        // 실사 목표가 양수여도 실제로 깔 수 있는 로트가 모자라면 음수 이월 대신 거절한다.
        const r = (0, productLot_1.deductLotsByQty)(lots, -delta);
        if (r.shortageQty > 0)
            throw new Error(`실사 로트 재고가 부족합니다. 부족 ${r.shortageQty}`);
        return { lots: r.lots, deltaQty: delta, beforeQty: before };
    }
    //  **늘린다** — 이월 버킷에 넣는다. 이미 음수로 깔려 있으면 거기서 메워져 자연히 털린다.
    const next = lots.map(l => (Object.assign({}, l)));
    let idx = next.findIndex(l => l.supplierName === '이월' && l.qtyRemaining != null);
    if (idx < 0) {
        next.push({
            id: (_a = det === null || det === void 0 ? void 0 : det.id) !== null && _a !== void 0 ? _a : `lot-anchor-${Date.now()}`,
            supplierName: '이월',
            qtyIn: 0, qtyRemaining: 0, unitKg,
            kgIn: 0, kgRemaining: 0,
            receivedDate: (_b = det === null || det === void 0 ? void 0 : det.receivedDate) !== null && _b !== void 0 ? _b : todayStr(),
            status: 'active',
            createdAt: (_c = det === null || det === void 0 ? void 0 : det.createdAt) !== null && _c !== void 0 ? _c : new Date().toISOString(),
        });
        idx = next.length - 1;
    }
    const b = next[idx];
    b.qtyRemaining = r3(((_d = b.qtyRemaining) !== null && _d !== void 0 ? _d : 0) + delta);
    b.unitKg = b.unitKg || unitKg;
    b.kgRemaining = r3(((_e = b.qtyRemaining) !== null && _e !== void 0 ? _e : 0) * ((_f = b.unitKg) !== null && _f !== void 0 ? _f : 0));
    //  **다시 살린다** — 0 이 돼서 소진으로 꺼 뒀던 버킷에 실사로 수량이 들어오면 살아 있어야 한다.
    b.status = 'active';
    return { lots: next, deltaQty: delta, beforeQty: before };
}
const r3 = (n) => Math.round(n * 1000) / 1000;
//# sourceMappingURL=lotAnchor.js.map