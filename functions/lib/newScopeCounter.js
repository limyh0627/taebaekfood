"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readVoucherCounter = readVoucherCounter;
exports.writeVoucherCounter = writeVoucherCounter;
exports.readOemCounter = readOemCounter;
const https_1 = require("firebase-functions/v2/https");
const releaseGate_1 = require("./releaseGate");
const fail = () => { throw new https_1.HttpsError('failed-precondition', '신규 번호 카운터 초기화 조건이 준비되지 않았습니다.'); };
const owner = (row) => { var _a; return (_a = row.companyId) !== null && _a !== void 0 ? _a : 'taebaek'; };
function assertNewScope(gate, companyId, date, oem = false) {
    var _a;
    if (!oem)
        (0, releaseGate_1.assertVoucherDateAllowed)(gate, companyId, date);
    else {
        const cutover = (_a = gate.data()) === null || _a === void 0 ? void 0 : _a.oemLotCutoverDate;
        const valid = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
            && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
        if (!valid(cutover) || !valid(date) || date < cutover)
            fail();
    }
    const row = gate.data();
    if ((row === null || row === void 0 ? void 0 : row.status) !== 'active' || typeof row.releaseId !== 'string' || !row.releaseId
        || row.oldWritersBlocked !== true || typeof row.oldWritersBlockedEvidence !== 'string'
        || !row.oldWritersBlockedEvidence.trim())
        fail();
}
/** 신규 scope에만 전체 번호 원장을 확인한다. 과거/추가번호 누락은 재생성하지 않는다. */
async function readVoucherCounter(db, tx, snap, gate, companyId, date, prefix) {
    if (snap.exists)
        return snap.data();
    if (!['', '가공', '반품', '대체', '급여'].includes(prefix))
        fail();
    assertNewScope(gate, companyId, date);
    // ponytail: 첫 발행만 전체 조회. 규모가 커지면 검증된 번호 사용 ledger로 교체한다.
    const collections = await Promise.all(['issuedStatements', 'cashEntries'].map(name => tx.get(db.collection(name))));
    const stamp = date.slice(2).replace(/-/g, '');
    for (const collection of collections)
        for (const doc of collection.docs) {
            const row = doc.data();
            if (owner(row) !== companyId)
                continue;
            const number = typeof row.docNo === 'string' ? row.docNo : '';
            const parsed = /^(.*)(\d{6})-(\d+)$/.exec(number);
            if (number.startsWith(`${prefix}${stamp}-`)
                || (row.tradeDate === date || row.date === date) && (!parsed || parsed[1] === prefix)
                || row.issuePrefix === prefix && (row.tradeDate === date || row.date === date))
                fail();
        }
    return { companyId, tradeDate: date, prefix, last: 0, initializedByRelease: gate.data().releaseId };
}
function writeVoucherCounter(tx, snap, state, last) {
    if (snap.exists)
        tx.update(snap.ref, { last });
    else
        tx.create(snap.ref, Object.assign(Object.assign({}, state), { last }));
}
async function readOemCounter(db, tx, snap, gate, companyId, date, material) {
    var _a, _b, _c, _d, _e;
    if (snap.exists)
        return snap.data();
    assertNewScope(gate, companyId, date, true);
    const [items, orders, operations] = await Promise.all([
        tx.get(db.collection('items')), tx.get(db.collection('purchaseOrders')), tx.get(db.collection('oemReceiptOperations')),
    ]);
    const prefix = `${date.slice(2).replace(/-/g, '')}-`;
    for (const doc of items.docs) {
        const row = doc.data();
        if (owner(row) !== companyId)
            continue;
        if (row.lots !== undefined && !Array.isArray(row.lots))
            fail();
        for (const lot of (_a = row.lots) !== null && _a !== void 0 ? _a : []) {
            if (!lot || typeof lot !== 'object')
                fail();
            if ((String((_b = lot.receivedDate) !== null && _b !== void 0 ? _b : '').slice(0, 10) === date || String((_c = lot.lotNo) !== null && _c !== void 0 ? _c : '').startsWith(prefix))
                && (!lot.material || lot.material === material))
                fail();
        }
    }
    // 소진 로트가 삭제되어도 발주/operation 근거가 있으면 0으로 되돌리지 않는다.
    for (const doc of orders.docs) {
        const row = doc.data();
        if (owner(row) === companyId && row.poType === 'oem' && row.status === 'received'
            && String((_d = row.receivedAt) !== null && _d !== void 0 ? _d : '').slice(0, 10) === date) {
            const operation = operations.docs.map(candidate => candidate.data()).find(candidate => owner(candidate) === companyId && candidate.poId === doc.id);
            if (!operation || operation.date !== date || !Array.isArray(operation.materials)
                || operation.materials.includes(material))
                fail();
        }
    }
    for (const doc of operations.docs) {
        const row = doc.data();
        if (owner(row) === companyId && Object.values((_e = row.lotNos) !== null && _e !== void 0 ? _e : {}).some(no => String(no).startsWith(prefix))
            && (!Array.isArray(row.materials) || row.materials.includes(material)))
            fail();
    }
    return { companyId, date, material, lastSequence: 0, initializedByRelease: gate.data().releaseId };
}
//# sourceMappingURL=newScopeCounter.js.map