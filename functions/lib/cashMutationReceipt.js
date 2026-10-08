"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cashOriginalHash = exports.cashMutationHash = void 0;
exports.readCashCreationMutation = readCashCreationMutation;
const crypto_1 = require("crypto");
const https_1 = require("firebase-functions/v2/https");
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (value && typeof value.toMillis === 'function')
        return { timestampMillis: value.toMillis() };
    if (value instanceof Date)
        return { dateISO: value.toISOString() };
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
    return value;
}
const cashMutationHash = (value) => (0, crypto_1.createHash)('sha256').update(JSON.stringify(canonical(value))).digest('hex');
exports.cashMutationHash = cashMutationHash;
const cashOriginalHash = (row) => (0, exports.cashMutationHash)(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id')));
exports.cashOriginalHash = cashOriginalHash;
function fail() { throw new https_1.HttpsError('failed-precondition', '원 발행 증거와 현금 변경 감사 사슬이 맞지 않습니다.'); }
/** Validates every revision. A committed mutation never authorizes re-creating its deleted cash. */
async function readCashCreationMutation(db, tx, companyId, cashId, current, validatesCreation) {
    var _a, _b;
    const rows = await tx.get(db.collection('voucherMutationOperations').where('cashEntryIds', 'array-contains', cashId));
    if (!rows.docs.length)
        return null;
    const history = rows.docs.map(doc => {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const receipt = doc.data();
        const before = receipt.transferOperationId ? (_a = receipt.transferBeforeSnapshots) === null || _a === void 0 ? void 0 : _a[cashId] : receipt.beforeSnapshot;
        const afterHash = receipt.transferOperationId ? (_c = (_b = receipt.transferAfterHashes) === null || _b === void 0 ? void 0 : _b[cashId]) !== null && _c !== void 0 ? _c : null : receipt.afterHash;
        if (receipt.transferOperationId) {
            const snapshots = receipt.transferBeforeSnapshots;
            const ids = receipt.cashEntryIds;
            if (!Array.isArray(ids) || ids.length !== 2 || new Set(ids).size !== 2 || !ids.includes(cashId)
                || !snapshots || Object.keys(snapshots).length !== 2
                || new Set(ids.map((id) => { var _a; return (_a = snapshots[id]) === null || _a === void 0 ? void 0 : _a.companyId; })).size !== 2
                || ids.some((id) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
                    return !['taebaek', 'punghoe'].includes((_a = snapshots[id]) === null || _a === void 0 ? void 0 : _a.companyId)
                        || ((_b = snapshots[id]) === null || _b === void 0 ? void 0 : _b.transferOperationId) !== receipt.transferOperationId
                        || !Number.isSafeInteger((_d = (_c = snapshots[id]) === null || _c === void 0 ? void 0 : _c.mutationRevision) !== null && _d !== void 0 ? _d : 0)
                        || ((_f = (_e = snapshots[id]) === null || _e === void 0 ? void 0 : _e.mutationRevision) !== null && _f !== void 0 ? _f : 0) < 0
                        || (receipt.action === 'edit' ? !/^[a-f0-9]{64}$/.test((_h = (_g = receipt.transferAfterHashes) === null || _g === void 0 ? void 0 : _g[id]) !== null && _h !== void 0 ? _h : '')
                            : ((_j = receipt.transferAfterHashes) === null || _j === void 0 ? void 0 : _j[id]) !== null);
                }))
                fail();
        }
        if (receipt.kind !== 'cashEntries' || receipt.status !== 'applied' || !['edit', 'delete'].includes(receipt.action)
            || typeof receipt.createdBy !== 'string' || !receipt.createdBy || !before || ((_d = before.companyId) !== null && _d !== void 0 ? _d : 'taebaek') !== companyId
            || !Number.isSafeInteger((_e = before.mutationRevision) !== null && _e !== void 0 ? _e : 0) || ((_f = before.mutationRevision) !== null && _f !== void 0 ? _f : 0) < 0
            || (!receipt.transferOperationId && (receipt.companyId !== companyId || receipt.voucherId !== cashId
                || receipt.expectedRevision !== ((_g = before.mutationRevision) !== null && _g !== void 0 ? _g : 0) || receipt.beforeHash !== (0, exports.cashOriginalHash)(before)))
            || (receipt.action === 'edit' ? typeof afterHash !== 'string' || !/^[a-f0-9]{64}$/.test(afterHash) : afterHash !== null))
            fail();
        return { receipt, before, afterHash, revision: (_h = before.mutationRevision) !== null && _h !== void 0 ? _h : 0 };
    }).sort((a, b) => a.revision - b.revision);
    const original = history[0].before;
    if (history[0].revision !== 0 || !validatesCreation(original))
        fail();
    for (let index = 1; index < history.length; index++) {
        if (history[index - 1].receipt.action === 'delete' || history[index].revision !== history[index - 1].revision + 1
            || (0, exports.cashOriginalHash)(history[index].before) !== history[index - 1].afterHash)
            fail();
    }
    const last = history[history.length - 1];
    if (last.receipt.action === 'delete') {
        if (current.exists)
            fail();
    }
    else if (!current.exists || ((_b = (_a = current.data()) === null || _a === void 0 ? void 0 : _a.mutationRevision) !== null && _b !== void 0 ? _b : 0) !== last.revision + 1
        || (0, exports.cashOriginalHash)(current.data()) !== last.afterHash)
        fail();
    return original;
}
//# sourceMappingURL=cashMutationReceipt.js.map