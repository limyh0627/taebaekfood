"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.issueOemFeeVoucherCommand = void 0;
exports.issueOemFeeVoucher = issueOemFeeVoucher;
const newScopeCounter_1 = require("./newScopeCounter");
const admin = require("firebase-admin");
const crypto_1 = require("crypto");
const https_1 = require("firebase-functions/v2/https");
const voucherIssue_1 = require("./voucherIssue");
const releaseGate_1 = require("./releaseGate");
const fail = (message) => { throw new https_1.HttpsError('failed-precondition', message); };
const invalid = (message) => { throw new https_1.HttpsError('invalid-argument', message); };
const ownCompany = (row) => { var _a; return (_a = row.companyId) !== null && _a !== void 0 ? _a : 'taebaek'; };
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const lineAmount = (qty, price, exempt) => {
    const total = Math.round(qty * price);
    const supply = exempt ? total : Math.round(total / 1.1);
    return { supply, tax: total - supply, total };
};
const packageKg = (value) => {
    const matched = /([\d.]+)\s*kg/i.exec(String(value !== null && value !== void 0 ? value : ''));
    return matched ? Number(matched[1]) : 0;
};
const specCount = (value) => {
    const matched = /[*x×]\s*([\d.]+)/i.exec(String(value !== null && value !== void 0 ? value : ''));
    const count = matched ? Number(matched[1]) : NaN;
    return Number.isFinite(count) && count > 0 ? count : 1;
};
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
        : value;
const hash = (value) => (0, crypto_1.createHash)('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const business = (row) => {
    const { id: _id, docNo: _no, issuedAt: _time, createdBy: _by, issueOperationId: _op, issuePayloadHash: _hash, issueVoucherNo: _savedNo } = row, body = __rest(row, ["id", "docNo", "issuedAt", "createdBy", "issueOperationId", "issuePayloadHash", "issueVoucherNo"]);
    return body;
};
/** One OEM fee, its PO link and the shared 가공 sequence are a single transaction. */
async function issueOemFeeVoucher(db, companyId, input) {
    if (!input || typeof input !== 'object')
        invalid('가공비 발행 요청이 잘못되었습니다.');
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId))
        invalid('배포 전환 ID가 필요합니다.');
    const { poId, perKg, statement: supplied } = input;
    if (typeof poId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(poId)
        || !finite(perKg) || perKg <= 0 || !supplied || typeof supplied !== 'object' || Array.isArray(supplied))
        invalid('가공비 입력이 잘못되었습니다.');
    const stmt = supplied;
    const statementId = `OEMFEE-${poId}`;
    if (stmt.id !== statementId || stmt.orderId !== poId || stmt.type !== '매입'
        || (stmt.companyId !== undefined && stmt.companyId !== companyId))
        invalid('가공비 전표 회사·배치가 일치하지 않습니다.');
    const date = stmt.tradeDate;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
        || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date)
        invalid('가공비 전표일이 잘못되었습니다.');
    if (!Array.isArray(stmt.items) || !stmt.items.length || stmt.items.some((line) => !line || typeof line !== 'object' || !line.accountCode || !finite(line.qty)
        || line.qty <= 0 || !finite(line.price) || line.price <= 0
        || !finite(line.supply) || line.supply < 0 || !finite(line.tax) || line.tax < 0
        || !finite(line.total) || line.total <= 0 || line.supply + line.tax !== line.total
        || line.accountCode !== '540' || typeof line.isTaxExempt !== 'boolean'
        || lineAmount(1, line.total, line.isTaxExempt).supply !== line.supply))
        invalid('가공비 전표 줄이 잘못되었습니다.');
    const sums = stmt.items.reduce((acc, line) => [acc[0] + line.supply, acc[1] + line.tax, acc[2] + line.total], [0, 0, 0]);
    if (![stmt.totalSupply, stmt.totalTax, stmt.totalAmount].every(finite)
        || sums.some((n, i) => n !== [stmt.totalSupply, stmt.totalTax, stmt.totalAmount][i]))
        invalid('가공비 전표 합계가 일치하지 않습니다.');
    const exempt = stmt.items.every((line) => line.isTaxExempt === true);
    const taxable = stmt.items.every((line) => line.isTaxExempt === false);
    if (!exempt && !taxable)
        invalid('가공비 과세 기준이 섞였습니다.');
    const semantic = Object.assign(Object.assign({}, business(stmt)), { companyId });
    const payloadHash = hash({ statement: semantic, perKg });
    const poRef = db.collection('purchaseOrders').doc(poId);
    const statementRef = db.collection('issuedStatements').doc(statementId);
    const feeRef = db.collection('adjustmentRequests').doc(statementId);
    const counterRef = db.collection('appMeta').doc((0, voucherIssue_1.voucherSequenceKey)(companyId, date, '가공'));
    const sameBatchQuery = db.collection('issuedStatements').where('orderId', '==', poId);
    const codeQuery = db.collection('accountCodes');
    const releaseGate = (0, releaseGate_1.releaseGateRef)(db);
    return db.runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const [poSnap, stmtSnap, feeSnap, batchStatements, codes, releaseSnap] = await Promise.all([
            tx.get(poRef), tx.get(statementRef), tx.get(feeRef), tx.get(sameBatchQuery), tx.get(codeQuery), tx.get(releaseGate),
        ]);
        (0, releaseGate_1.assertReleaseActive)(releaseSnap, input.releaseId);
        (0, releaseGate_1.assertVoucherDateAllowed)(releaseSnap, companyId, date);
        if (!poSnap.exists)
            fail('OEM 배치가 없습니다.');
        const po = poSnap.data();
        if (ownCompany(po) !== companyId || po.poType !== 'oem' || po.status !== 'received')
            fail('가공비를 발행할 수 없는 OEM 배치입니다.');
        if (feeSnap.exists) {
            const fee = feeSnap.data();
            if (ownCompany(fee) !== companyId || fee.type !== 'oem_fee' || fee.oemPoId !== poId
                || fee.oemFeePerKg !== perKg || fee.status !== 'pending' && fee.status !== 'processed') {
                fail('OEM 가공비 확인 요청이 입고와 일치하지 않습니다.');
            }
        }
        const partnerId = (_a = po.oemPartnerId) !== null && _a !== void 0 ? _a : po.partnerId;
        if (!partnerId || stmt.partnerId !== partnerId)
            fail('OEM 거래처가 일치하지 않습니다.');
        const partner = await tx.get(db.collection('partners').doc(partnerId));
        if (!partner.exists || ownCompany(partner.data()) !== companyId)
            fail('OEM 거래처 회사가 일치하지 않습니다.');
        if (!finite(po.oemReceivedKg) || po.oemReceivedKg <= 0)
            fail('가공입고 중량이 확인되지 않았습니다.');
        const gross = Math.round(po.oemReceivedKg * perKg);
        if (feeSnap.exists && feeSnap.data().oemTotal !== gross)
            fail('OEM 가공비 확인 요청 금액이 입고와 다릅니다.');
        const supply = exempt ? gross : Math.round(gross / 1.1);
        if (gross <= 0 || stmt.totalAmount !== gross)
            fail('가공입고 중량·단가와 전표 금액이 다릅니다.');
        const poItems = ((_b = po.items) !== null && _b !== void 0 ? _b : []).filter((item) => Number(item.quantity) > 0);
        const bulk = ((_c = po.oemReceivedBulk) !== null && _c !== void 0 ? _c : []).filter((item) => Number(item.kg) > 0);
        const [products, bomRows] = await Promise.all([
            Promise.all(poItems.map(item => tx.get(db.collection('items').doc(item.itemId)))),
            Promise.all(poItems.map(item => tx.get(db.collection('item_bom').where('parent_id', '==', item.itemId)))),
        ]);
        const childIds = [...new Set(bomRows.flatMap(rows => rows.docs.map(snap => snap.data().child_id)).filter(Boolean))];
        const childDocs = await Promise.all(childIds.map(id => tx.get(db.collection('items').doc(id))));
        const children = new Map(childDocs.filter(snap => snap.exists).map(snap => [snap.id, snap.data()]));
        const expected = [];
        for (const [index, product] of products.entries()) {
            const poItem = poItems[index];
            if (!product.exists || ownCompany(product.data()) !== companyId)
                fail('현재 회사의 OEM 전표 품목을 찾을 수 없습니다.');
            const item = product.data();
            const finishedChildren = bomRows[index].docs.map(snap => snap.data())
                .filter(row => { var _a; return ['product', '완제품'].includes((_a = children.get(row.child_id)) === null || _a === void 0 ? void 0 : _a.type); });
            const boxed = (finishedChildren.length === 1 && Number((_d = finishedChildren[0].quantity) !== null && _d !== void 0 ? _d : 1) > 1)
                || Number((_f = (_e = item.unpackTo) === null || _e === void 0 ? void 0 : _e.count) !== null && _f !== void 0 ? _f : 0) > 1 || item.unit === '박스';
            const kg = item.packageKg || (packageKg(item.spec) || packageKg(item.name)) * (boxed ? specCount(item.spec) : 1);
            const unitTotal = Math.round(kg * perKg);
            const amount = lineAmount(poItem.quantity, unitTotal, exempt);
            if (amount.total <= 0)
                continue;
            expected.push(Object.assign(Object.assign({ name: poItem.name, spec: (_h = (_g = item.spec) !== null && _g !== void 0 ? _g : poItem.unit) !== null && _h !== void 0 ? _h : '', qty: poItem.quantity, price: lineAmount(1, unitTotal, exempt).supply }, amount), { isTaxExempt: exempt, accountCode: '540' }));
        }
        for (const row of bulk) {
            const amount = lineAmount(row.kg, perKg, exempt);
            expected.push(Object.assign(Object.assign({ name: `${row.material} 벌크 가공비`, spec: 'kg', qty: row.kg, price: lineAmount(1, perKg, exempt).supply }, amount), { isTaxExempt: exempt, accountCode: '540' }));
        }
        if (!expected.length) {
            const sent = ((_j = po.oemSent) !== null && _j !== void 0 ? _j : []).reduce((sum, row) => sum + Number(row.kg || 0), 0);
            expected.push({ name: `외주가공비 (${sent}kg→${po.oemReceivedKg}kg)`, spec: '', qty: 1,
                price: supply, supply, tax: gross - supply, total: gross,
                isTaxExempt: exempt, accountCode: '540' });
        }
        const gap = gross - expected.reduce((sum, line) => sum + line.total, 0);
        if (gap !== 0) {
            const last = expected[expected.length - 1];
            const corrected = lineAmount(last.total + gap, 1, exempt);
            if (corrected.total < 0)
                fail('가공입고 중량과 전표 줄이 일치하지 않습니다.');
            expected[expected.length - 1] = Object.assign(Object.assign(Object.assign({}, last), corrected), { price: Math.round(corrected.supply / last.qty) });
        }
        if (hash(stmt.items) !== hash(expected)
            || stmt.totalSupply !== expected.reduce((sum, line) => sum + line.supply, 0)
            || stmt.totalTax !== expected.reduce((sum, line) => sum + line.tax, 0)) {
            fail('가공비 전표 줄이 OEM 입고 내역과 다릅니다.');
        }
        const allowedCodes = new Set(codes.docs.filter(snap => ownCompany(snap.data()) === companyId).map(snap => snap.data().code));
        if (stmt.items.some((line) => !allowedCodes.has(line.accountCode)))
            fail('가공비 회사 계정과목이 일치하지 않습니다.');
        if (batchStatements.docs.some(snap => snap.id !== statementId
            && ownCompany(snap.data()) === companyId && snap.data().type === '매입'))
            fail('연결되지 않은 기존 가공비 전표가 있습니다.');
        if (po.linkedStatementId && po.linkedStatementId !== statementId)
            fail('이미 다른 가공비 전표가 연결된 배치입니다.');
        if (po.linkedStatementId === statementId && !stmtSnap.exists)
            fail('연결된 가공비 전표가 없어 정합성 확인이 필요합니다.');
        if (stmtSnap.exists) {
            const existing = stmtSnap.data();
            if (ownCompany(existing) !== companyId || existing.orderId !== poId || existing.type !== '매입'
                || existing.partnerId !== partnerId || existing.tradeDate !== date
                || typeof existing.docNo !== 'string' || !existing.docNo
                || hash(Object.assign(Object.assign({}, business(existing)), { companyId })) !== hash(semantic)
                || (existing.issueOperationId && (existing.issueOperationId !== statementId || existing.issuePayloadHash !== payloadHash
                    || existing.issueVoucherNo !== existing.docNo)))
                fail('기존 가공비 전표와 요청 내용이 다릅니다.');
            if (!po.linkedStatementId) {
                if (po.oemFeePerKg !== undefined && po.oemFeePerKg !== perKg)
                    fail('기존 가공비 단가가 변경되었습니다.');
                tx.update(poRef, { linkedStatementId: statementId, oemFeePerKg: perKg });
            }
            else if ((existing.issueOperationId && po.oemFeePerKg !== perKg)
                || (po.oemFeePerKg !== undefined && po.oemFeePerKg !== perKg))
                fail('기존 가공비 단가가 변경되었습니다.');
            if (feeSnap.exists && feeSnap.data().status === 'pending')
                tx.update(feeRef, { status: 'processed', processedAt: new Date().toISOString() });
            return statementId;
        }
        const sequence = await tx.get(counterRef);
        const state = await (0, newScopeCounter_1.readVoucherCounter)(db, tx, sequence, releaseSnap, companyId, date, '가공');
        if (state.companyId !== companyId || state.tradeDate !== date || state.prefix !== '가공'
            || !Number.isSafeInteger(state.last) || state.last < 0 || !Number.isSafeInteger(state.last + 1))
            fail('가공비 전표 번호 카운터가 손상되었습니다.');
        const docNo = (0, voucherIssue_1.formatVoucherNo)(date, state.last + 1, '가공');
        (0, newScopeCounter_1.writeVoucherCounter)(tx, sequence, state, state.last + 1);
        tx.create(statementRef, Object.assign(Object.assign({}, stmt), { companyId, docNo, issueOperationId: statementId, issuePayloadHash: payloadHash, issueVoucherNo: docNo }));
        tx.update(poRef, { linkedStatementId: statementId, oemFeePerKg: perKg });
        if (feeSnap.exists && feeSnap.data().status === 'pending')
            tx.update(feeRef, { status: 'processed', processedAt: new Date().toISOString() });
        return statementId;
    });
}
exports.issueOemFeeVoucherCommand = (0, https_1.onCall)({ region: 'asia-northeast3' }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', '로그인이 필요합니다.');
    const companyId = request.auth.token.companyId;
    if (!request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe')) {
        throw new https_1.HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
    }
    return issueOemFeeVoucher(admin.firestore(), companyId, request.data);
});
//# sourceMappingURL=oemFeeVoucher.js.map