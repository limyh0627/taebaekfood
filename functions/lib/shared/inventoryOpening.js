"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calendarDay = void 0;
exports.inventoryOpeningStatement = inventoryOpeningStatement;
const calendarDay = (date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date + 'T00:00:00Z')) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date;
exports.calendarDay = calendarDay;
/** 기초 수량과 평가액의 146/375 분개. 앱과 서버가 같은 본문을 사용한다. */
function inventoryOpeningStatement(companyId, date, item, quantity, value) {
    var _a;
    if (!item.id || !((_a = item.name) === null || _a === void 0 ? void 0 : _a.trim()) || !(0, exports.calendarDay)(date) || !Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(value) || value <= 0)
        throw new Error('기초 재고의 품목·날짜·수량·평가금액을 확인하세요.');
    const line = (accountCode, side, name) => { var _a; return ({ name, spec: (_a = item.spec) !== null && _a !== void 0 ? _a : '', qty: 1, price: value, supply: value, tax: 0, total: value, isTaxExempt: true, accountCode, side, lineKind: 'account' }); };
    return { id: `opening-inventory-${companyId}-${item.id}`, companyId, openingItemId: item.id, openingQuantity: quantity,
        issuedAt: `${date}T00:00:00+09:00`, tradeDate: date, type: '비용', partnerId: '', partnerName: '', orderId: '', docNo: `기초재고-${item.id}`,
        totalSupply: value, totalTax: 0, totalAmount: value, memo: `${item.name} ${quantity}${item.unit || ''} 기초 재고`,
        items: [line('146', '차변', item.name), line('375', '대변', '기초 이월이익잉여금')] };
}
//# sourceMappingURL=inventoryOpening.js.map