"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recurringId = exports.recurringDir = void 0;
exports.recurringDate = recurringDate;
exports.recurringType = recurringType;
exports.recurringTransferItems = recurringTransferItems;
exports.recurringStatement = recurringStatement;
const recurringDir = (t) => { var _a; return (_a = t.dir) !== null && _a !== void 0 ? _a : (t.postMode === '분리' ? '줄돈' : '출금'); };
exports.recurringDir = recurringDir;
const recurringId = (id, ym) => `AUTO-${id}-${ym}`;
exports.recurringId = recurringId;
function recurringDate(ym, issueDay = 1, lastDay) {
    const [y, m] = ym.split('-').map(Number);
    const last = lastDay !== null && lastDay !== void 0 ? lastDay : new Date(y, m, 0).getDate();
    return `${ym}-${String(Math.min(Math.max(issueDay, 1), last)).padStart(2, '0')}`;
}
function recurringType(t) {
    if (t.statementType === '매출' || t.statementType === '매입' || t.statementType === '비용')
        return t.statementType;
    return (0, exports.recurringDir)(t) === '받을돈' ? '매출' : t.partnerId ? '매입' : '비용';
}
function recurringTransferItems(t) {
    var _a;
    return ((_a = t.transferLines) !== null && _a !== void 0 ? _a : []).map(l => ({ name: l.name || t.name || '', accountCode: l.accountCode,
        side: l.side, spec: '', qty: 1, price: t.amount, supply: t.amount, tax: 0, total: t.amount, isTaxExempt: true }));
}
/** Caller validation and stamps stay in each adapter. Gross preserves the app's rounding contract. */
function recurringStatement(t, accountName = '', gross = t.amount) {
    var _a, _b;
    const type = recurringType(t), exempt = type === '비용' || !!t.taxExempt;
    const supply = exempt ? gross : Math.round(gross / 1.1), tax = gross - supply;
    const item = { name: ((_a = t.itemName) === null || _a === void 0 ? void 0 : _a.trim()) || accountName || t.name || '', spec: '', qty: 1, price: t.amount,
        supply, tax, total: t.amount, isTaxExempt: exempt, accountCode: t.accountCode };
    return { type, totalSupply: supply, totalTax: tax, totalAmount: t.amount,
        items: type === '비용' && ((_b = t.transferLines) === null || _b === void 0 ? void 0 : _b.length) ? recurringTransferItems(t) : [item] };
}
//# sourceMappingURL=recurringVoucher.js.map