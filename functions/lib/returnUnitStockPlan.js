"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planUnitReturnReceipt = planUnitReturnReceipt;
exports.planUnitReturnIssue = planUnitReturnIssue;
const returnValidationError_1 = require("./returnValidationError");
const productLot_1 = require("./shared/productLot");
const returnGeneralStockPlan_1 = require("./returnGeneralStockPlan");
/** receiveUnitStock과 같은 개수 재고/로트 계산. unitKg은 서버의 회사 BOM·포장 원본에서 해석한다. */
function planUnitReturnReceipt(input, unitKg) {
    var _a, _b, _c, _d;
    const item = input.item;
    if (!['product', 'wip'].includes((_a = item.type) !== null && _a !== void 0 ? _a : '') || item.subtype === '벌크' || ['kg', 'KG', 'L', 'l', '리터', 'ℓ'].includes(String((_b = item.unit) !== null && _b !== void 0 ? _b : '').trim()))
        throw new returnValidationError_1.ReturnValidationError('개수로 재고를 드는 완제품·반제품이 아닙니다.');
    if (!Number.isFinite(unitKg) || unitKg < 0 || (item.lots !== undefined && !Array.isArray(item.lots)))
        throw new returnValidationError_1.ReturnValidationError('품목 로트·중량을 확인해 주세요.');
    const stock = Number((_c = item.stock) !== null && _c !== void 0 ? _c : 0);
    const base = (0, returnGeneralStockPlan_1.planReturnReceiptBase)(Object.assign(Object.assign({}, input), { item: Object.assign(Object.assign({}, item), { stock }) })), clock = { now: input.createdAt, date: input.date, id: `carry:${base.receiptId}` };
    const lots = (0, productLot_1.withCarryOverProductLot)(((_d = item.lots) !== null && _d !== void 0 ? _d : []), stock, item.rawMaterialName || item.name, unitKg, undefined, clock);
    if (Math.abs((0, productLot_1.lotQtyRemaining)(lots) - stock) > 0.0001)
        throw new returnValidationError_1.ReturnValidationError('품목 재고와 로트 잔량이 다릅니다.');
    const lot = (0, productLot_1.buildProductLot)({ material: item.rawMaterialName || item.name, itemId: item.id, supplierName: input.partnerName, supplierId: input.partnerId, qtyIn: base.receipt.quantity, unitKg, receivedDate: input.date }, Object.assign(Object.assign({}, clock), { id: `receipt:${base.receiptId}` }));
    return Object.assign(Object.assign({}, base), { receipt: Object.assign(Object.assign({}, base.receipt), { productLotId: lot.id }), lots: [...lots, lot] });
}
/** 매입 반품은 기존 개수 FIFO 출고와 동일하게 kg 잔량을 함께 내린다. */
function planUnitReturnIssue(input, unitKg) {
    if (!Number.isFinite(input.quantityDelta) || input.quantityDelta >= 0)
        throw new returnValidationError_1.ReturnValidationError('매입 반품 출고 수량이 잘못되었습니다.');
    const validated = planUnitReturnReceipt(Object.assign(Object.assign({}, input), { quantityDelta: -input.quantityDelta }), unitKg);
    const lots = validated.lots.slice(0, -1), result = (0, productLot_1.deductLotsByQty)(lots, validated.receipt.quantity);
    if (result.shortageQty > 0)
        throw new returnValidationError_1.ReturnValidationError('매입 반품 로트 재고가 부족합니다.');
    const nextStock = Math.round((Number(input.item.stock) - validated.receipt.quantity) * 1000) / 1000;
    if (nextStock < 0)
        throw new returnValidationError_1.ReturnValidationError('매입 반품 재고가 부족합니다.');
    return { itemId: input.item.id, nextStock, lots: result.lots, lotTaken: result.distribution, movement: { lotTaken: result.distribution, itemId: input.item.id, quantityDelta: -validated.receipt.quantity, companyId: input.companyId, partnerId: input.partnerId, date: input.date, operationId: input.operationId, createdAt: input.createdAt } };
}
//# sourceMappingURL=returnUnitStockPlan.js.map