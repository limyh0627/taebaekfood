"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.returnStockKind = returnStockKind;
const rawHolder_1 = require("./rawHolder");
/** 접수 화면과 서버는 같은 실물 처리 경로를 선택한다. */
function returnStockKind(companyId, item, allItems) {
    var _a, _b, _c, _d, _e;
    if (((_a = item.companyId) !== null && _a !== void 0 ? _a : 'taebaek') !== companyId || (item.lots !== undefined && !Array.isArray(item.lots)))
        return 'unsupported';
    if (['product', 'wip'].includes((_b = item.type) !== null && _b !== void 0 ? _b : '') && item.subtype !== '벌크'
        && !['kg', 'KG', 'L', 'l', '리터', 'ℓ'].includes(String((_c = item.unit) !== null && _c !== void 0 ? _c : '').trim()))
        return 'unit';
    if ((0, rawHolder_1.rawLotTarget)(allItems, item, item.name, companyId))
        return 'raw';
    return ['goods', 'submaterial'].includes((_d = item.type) !== null && _d !== void 0 ? _d : '') && item.subtype !== '벌크'
        && !item.rawMaterialName && !((_e = item.lots) === null || _e === void 0 ? void 0 : _e.length) ? 'general' : 'unsupported';
}
//# sourceMappingURL=returnStockKind.js.map