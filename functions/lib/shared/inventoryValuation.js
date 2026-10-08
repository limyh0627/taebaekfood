"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.valueInventory = valueInventory;
exports.valueInventoryForCompany = valueInventoryForCompany;
/** 월말 장부 범위: 저장 원가가 있는 모든 품목(용역 포함), 음수 재고 포함. */
function valueInventory(items, basis) {
    var _a, _b, _c;
    const companies = new Map();
    const getCompany = (companyId) => {
        let result = companies.get(companyId);
        if (!result) {
            result = { basis, companyId, rawValue: 0, value: 0, lines: [] };
            companies.set(companyId, result);
        }
        return result;
    };
    // 태백은 재고 0원이어도 기존 월말 문서를 만든다.
    getCompany('taebaek');
    for (const item of items) {
        const companyId = (_a = item.companyId) !== null && _a !== void 0 ? _a : 'taebaek';
        const stock = Number((_b = item.stock) !== null && _b !== void 0 ? _b : 0);
        const cost = Number((_c = item.cost) !== null && _c !== void 0 ? _c : 0);
        if (!companyId || !Number.isFinite(stock) || !Number.isFinite(cost)) {
            throw new Error(`재고평가 입력 오류: ${item.id}`);
        }
        if (stock === 0 || cost === 0)
            continue;
        const value = stock * cost;
        if (!Number.isFinite(value))
            throw new Error(`재고평가 금액 오류: ${item.id}`);
        const company = getCompany(companyId);
        company.rawValue += value;
        if (!Number.isFinite(company.rawValue))
            throw new Error(`재고평가 회사 합계 오류: ${companyId}`);
        company.lines.push({ id: item.id, stock, cost, value });
    }
    for (const company of companies.values())
        company.value = Math.round(company.rawValue);
    return [...companies.values()];
}
/** 회사별 화면에서는 다른 회사의 오류 입력이 현재 회사 기록을 막지 않도록 한다. */
function valueInventoryForCompany(items, basis, companyId) {
    return valueInventory(items.filter(item => { var _a; return ((_a = item.companyId) !== null && _a !== void 0 ? _a : 'taebaek') === companyId; }), basis)
        .find(result => result.companyId === companyId);
}
//# sourceMappingURL=inventoryValuation.js.map