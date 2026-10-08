"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planGeneralReturnReceipt = planGeneralReturnReceipt;
exports.planReturnReceiptBase = planReturnReceiptBase;
exports.planGeneralReturnIssue = planGeneralReturnIssue;
const returnValidationError_1 = require("./returnValidationError");
/** Pure write plan for the existing receipt.ts general-stock branch only. */
const crypto_1 = require("crypto");
function planGeneralReturnReceipt(input) {
    var _a;
    const { item } = input;
    if (item.companyId !== input.companyId || !item.name || !['goods', 'submaterial'].includes((_a = item.type) !== null && _a !== void 0 ? _a : '')
        || item.subtype === '벌크' || item.rawMaterialName || input.rawTargetExists !== false
        || (item.lots !== undefined && (!Array.isArray(item.lots) || item.lots.length > 0)))
        throw new returnValidationError_1.ReturnValidationError('원료·단위·로트 품목은 일반 재고 adapter로 처리할 수 없습니다.');
    return planReturnReceiptBase(input);
}
/** 분류별 adapter가 공유하는 원문 수량·입고 근거 계산. */
function planReturnReceiptBase(input) {
    var _a;
    const { item, quantityDelta } = input;
    if (!/^[A-Za-z0-9_-]{1,150}$/.test(input.operationId) || !input.partnerId
        || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(Date.parse(input.createdAt)))
        throw new returnValidationError_1.ReturnValidationError('반품 입고 작업 근거가 잘못되었습니다.');
    if (item.companyId !== input.companyId || !item.name)
        throw new returnValidationError_1.ReturnValidationError('반품 품목 회사가 다릅니다.');
    const deltaMilli = Math.round(quantityDelta * 1000);
    const stockMilli = Math.round(Number(item.stock) * 1000);
    if (!Number.isFinite(quantityDelta) || quantityDelta <= 0 || !Number.isSafeInteger(deltaMilli) || deltaMilli <= 0
        || Math.abs(deltaMilli / 1000 - quantityDelta) > 1e-9
        || !Number.isFinite(item.stock) || !Number.isSafeInteger(stockMilli)
        || Math.abs(stockMilli / 1000 - Number(item.stock)) > 1e-9
        || stockMilli < 0 || !Number.isSafeInteger(stockMilli + deltaMilli))
        throw new returnValidationError_1.ReturnValidationError('반품 일반 재고 수량이 잘못되었습니다.');
    const confirmedQuantity = deltaMilli / 1000;
    const nextStock = (stockMilli + deltaMilli) / 1000;
    if (!Number.isFinite(nextStock) || nextStock < 0)
        throw new returnValidationError_1.ReturnValidationError('반품 일반 재고 잔액이 잘못되었습니다.');
    const identity = [input.companyId, input.operationId, item.id];
    const receiptId = `rcv-return-${(0, crypto_1.createHash)('sha256').update(JSON.stringify(identity)).digest('hex')}`;
    const receiptFingerprint = (0, crypto_1.createHash)('sha256').update(JSON.stringify([
        ...identity, input.date, confirmedQuantity, input.partnerId,
    ])).digest('hex');
    return { itemId: item.id, nextStock, receiptId, receipt: {
            id: receiptId, companyId: input.companyId, itemId: item.id, itemName: item.name,
            quantity: confirmedQuantity, unit: (_a = item.unit) !== null && _a !== void 0 ? _a : '', partnerId: input.partnerId,
            partnerName: input.partnerName, date: input.date, createdAt: input.createdAt,
            returnOperationId: input.operationId, returnReceiptFingerprint: receiptFingerprint,
        } };
}
/** 매입 반품 출고는 입고 원장에 음수 입고로 기록하지 않는다. */
function planGeneralReturnIssue(input) {
    var _a;
    if (!((_a = input.item.unit) === null || _a === void 0 ? void 0 : _a.trim()))
        throw new returnValidationError_1.ReturnValidationError('매입 반품 품목의 재고 단위가 불명확합니다.');
    if (!Number.isFinite(input.quantityDelta) || input.quantityDelta >= 0)
        throw new returnValidationError_1.ReturnValidationError('매입 반품 출고 수량이 잘못되었습니다.');
    const validated = planGeneralReturnReceipt(Object.assign(Object.assign({}, input), { quantityDelta: -input.quantityDelta }));
    const nextMilli = Math.round(Number(input.item.stock) * 1000) - Math.round(validated.receipt.quantity * 1000);
    if (!Number.isSafeInteger(nextMilli) || nextMilli < 0)
        throw new returnValidationError_1.ReturnValidationError('매입 반품 재고가 부족합니다.');
    return { itemId: input.item.id, nextStock: nextMilli / 1000, movement: {
            itemId: input.item.id, quantityDelta: -validated.receipt.quantity,
            companyId: input.companyId, partnerId: input.partnerId, date: input.date,
            operationId: input.operationId, createdAt: input.createdAt,
        } };
}
//# sourceMappingURL=returnGeneralStockPlan.js.map