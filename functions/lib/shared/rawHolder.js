"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rawLedgerKeys = exports.isRawHolder = void 0;
exports.rawHolderById = rawHolderById;
exports.rawHolderByName = rawHolderByName;
exports.resolveRawHolder = resolveRawHolder;
exports.rawLotTarget = rawLotTarget;
const formula_1 = require("./formula");
const isRawHolder = (item) => { var _a; return !!item && String((_a = item.subtype) !== null && _a !== void 0 ? _a : '') === '벌크' && !item.phantom && !item.archived; };
exports.isRawHolder = isRawHolder;
const companyOf = (item) => { var _a; return (_a = item.companyId) !== null && _a !== void 0 ? _a : 'taebaek'; };
function rawHolderById(allItems, rawItemId, companyId) {
    if (!rawItemId)
        return undefined;
    const hit = allItems.find(item => item.id === rawItemId);
    if (!hit || !(0, exports.isRawHolder)(hit))
        return undefined;
    if (companyId && companyOf(hit) !== companyId)
        return undefined;
    return hit;
}
function rawHolderByName(allItems, material, companyId) {
    const want = (0, formula_1.baseRawName)(material !== null && material !== void 0 ? material : '');
    if (!want)
        return undefined;
    const holders = allItems.filter(item => { var _a; return (0, exports.isRawHolder)(item) && (0, formula_1.baseRawName)((_a = item.name) !== null && _a !== void 0 ? _a : '') === want; });
    if (!holders.length)
        return undefined;
    if (companyId)
        return holders.find(item => companyOf(item) === companyId);
    const taebaek = holders.find(item => companyOf(item) === 'taebaek');
    if (taebaek)
        return taebaek;
    return holders.length === 1 ? holders[0] : undefined;
}
function resolveRawHolder(allItems, { rawItemId, material, companyId }) {
    var _a;
    return (_a = rawHolderById(allItems, rawItemId, companyId)) !== null && _a !== void 0 ? _a : (material ? rawHolderByName(allItems, material, companyId) : undefined);
}
const rawLedgerKeys = (holder) => ({
    companyId: companyOf(holder), rawItemId: holder.id,
});
exports.rawLedgerKeys = rawLedgerKeys;
function rawLotTarget(allItems, product, itemName, companyId) {
    var _a;
    const baseName = (product === null || product === void 0 ? void 0 : product.rawMaterialName) || (0, formula_1.baseRawName)(itemName);
    if (!formula_1.RM_LIST.includes(baseName))
        return null;
    const rawItem = (_a = rawHolderByName(allItems, baseName, companyId)) !== null && _a !== void 0 ? _a : (product && companyId == null && (0, exports.isRawHolder)(product) ? product : undefined);
    return rawItem ? { baseName, rawItem } : null;
}
//# sourceMappingURL=rawHolder.js.map