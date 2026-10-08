"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.costFromPurchaseLine = costFromPurchaseLine;
function costFromPurchaseLine(line, fallback = 'gross-first') {
    var _a, _b, _c;
    const qty = Number((_a = line.qty) !== null && _a !== void 0 ? _a : 0);
    const supply = Number((_b = line.supply) !== null && _b !== void 0 ? _b : NaN);
    if (qty > 0 && Number.isFinite(supply))
        return Math.round(supply / qty);
    const price = Number((_c = line.price) !== null && _c !== void 0 ? _c : 0);
    if (!(price > 0))
        return null;
    // 앱은 단가 합계를 먼저 반올림하고, 기존 서버는 공급가를 먼저 계산한다.
    const gross = fallback === 'gross-first' ? Math.round(price) : price;
    return line.isTaxExempt ? Math.round(gross) : Math.round(gross / 1.1);
}
//# sourceMappingURL=purchaseCost.js.map