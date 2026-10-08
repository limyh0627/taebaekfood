"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.releaseGateRef = void 0;
exports.assertReleaseActive = assertReleaseActive;
exports.assertVoucherDateAllowed = assertVoucherDateAllowed;
const https_1 = require("firebase-functions/v2/https");
/** One server-owned switch shared by all financial and inventory writers at cutover. */
const releaseGateRef = (db) => db.collection('appMeta').doc('releaseCutover');
exports.releaseGateRef = releaseGateRef;
function assertReleaseActive(snapshot, releaseId) {
    const gate = snapshot.data();
    if (!releaseId || !snapshot.exists || (gate === null || gate === void 0 ? void 0 : gate.status) !== 'active' || (gate === null || gate === void 0 ? void 0 : gate.releaseId) !== releaseId)
        throw new https_1.HttpsError('failed-precondition', '배포 전환이 활성화되지 않았습니다.');
}
function assertVoucherDateAllowed(snapshot, companyId, date, allowCatchUp = false) {
    var _a;
    const gate = snapshot.data();
    const notBefore = (_a = gate === null || gate === void 0 ? void 0 : gate.voucherNotBefore) === null || _a === void 0 ? void 0 : _a[companyId];
    const valid = (value) => typeof value === 'string'
        && /^\d{4}-\d{2}-\d{2}$/.test(value)
        && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
        && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if (!valid(notBefore) || !valid(date) || (companyId === 'taebaek' && notBefore < '2026-10-03'))
        throw new https_1.HttpsError('failed-precondition', '전표 발행 가능일이 준비되지 않았거나 전표일이 전환일보다 빠릅니다.');
    const catchUp = gate === null || gate === void 0 ? void 0 : gate.catchUp;
    if (companyId === 'taebaek' && date < notBefore) {
        const inWindow = (catchUp === null || catchUp === void 0 ? void 0 : catchUp.tradeDate) === date && date === '2026-09-30'
            || (catchUp === null || catchUp === void 0 ? void 0 : catchUp.fromDate) === '2026-09-30' && date >= catchUp.fromDate;
        if (allowCatchUp && inWindow && (catchUp === null || catchUp === void 0 ? void 0 : catchUp.companyId) === companyId && (catchUp === null || catchUp === void 0 ? void 0 : catchUp.status) === 'open')
            return 'catchUp';
        if (date === '2026-09-30')
            throw new https_1.HttpsError('failed-precondition', '추가 발행 창이 열려 있지 않거나 이 전표 종류에서 사용할 수 없습니다.');
    }
    if (date < notBefore)
        throw new https_1.HttpsError('failed-precondition', '전표 발행 가능일이 준비되지 않았거나 전표일이 전환일보다 빠릅니다.');
    return 'normal';
}
//# sourceMappingURL=releaseGate.js.map