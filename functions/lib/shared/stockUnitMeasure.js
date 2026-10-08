"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unpackStockComponent = unpackStockComponent;
exports.itemPackageKg = itemPackageKg;
exports.stockUnitKg = stockUnitKg;
exports.receiptToKg = receiptToKg;
const formula_1 = require("./formula");
function unpackStockComponent(lines) {
    const components = lines.filter(line => { var _a, _b; return ((_a = line.child) === null || _a === void 0 ? void 0 : _a.type) === 'product' || ((_b = line.child) === null || _b === void 0 ? void 0 : _b.type) === '완제품'; });
    return components.length === 1 && components[0].qty > 1
        ? { itemId: components[0].childId, count: components[0].qty } : null;
}
function itemPackageKg(item, isBox) {
    var _a, _b;
    if (item.packageKg)
        return item.packageKg;
    const perUnit = (_b = (_a = (0, formula_1.parsePackageKg)(item.spec)) !== null && _a !== void 0 ? _a : (0, formula_1.parsePackageKg)(item.name)) !== null && _b !== void 0 ? _b : 0;
    return perUnit * (isBox || item.unit === '박스' ? (0, formula_1.parseSpecCount)(item.spec) : 1);
}
function stockUnitKg(product, component, findItem) {
    var _a;
    if (!product)
        return undefined;
    if (!component)
        return (0, formula_1.parsePackageKg)(product.spec);
    const looseKg = (0, formula_1.parsePackageKg)((_a = findItem(component.itemId)) === null || _a === void 0 ? void 0 : _a.spec);
    return looseKg === undefined ? undefined : looseKg * component.count;
}
/** 입고 수량의 kg 환산. 앱과 서버는 같은 포장·밀도 계약을 사용한다. */
function receiptToKg(params) {
    var _a;
    const unit = ((_a = params.unit) !== null && _a !== void 0 ? _a : '').toLowerCase();
    let kg;
    if (unit === 'kg')
        kg = params.quantity;
    else if (unit === 'l')
        kg = params.quantity * params.density;
    else if (params.packageKg)
        kg = params.quantity * params.packageKg;
    else
        kg = params.quantity;
    return Math.round(kg * 1000) / 1000;
}
//# sourceMappingURL=stockUnitMeasure.js.map