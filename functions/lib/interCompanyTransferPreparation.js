"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareInterCompanyTransferCommand = void 0;
exports.prepareInterCompanyTransfer = prepareInterCompanyTransfer;
const returnClaimReader_1 = require("./returnClaimReader");
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const interCompanyAuthority_1 = require("./interCompanyAuthority");
const releaseGate_1 = require("./releaseGate");
const partnerPaymentCommand_1 = require("./partnerPaymentCommand");
const partnerPaymentPlan_1 = require("./partnerPaymentPlan");
const name = (company) => company === 'taebaek' ? '태백푸드' : '풍회유통';
function fail(message) { throw new https_1.HttpsError('failed-precondition', message); }
/** 양사 권한을 확인한 뒤 각 회사의 실제 선택지와 정산 revision만 돌려준다. */
async function prepareInterCompanyTransfer(db, uid, claims, input) {
    if (!input || !['taebaek', 'punghoe'].includes(input.from) || !['taebaek', 'punghoe'].includes(input.to) || input.from === input.to || typeof claims.employeeId !== 'string' || !uid)
        fail('회사이체 요청과 직원 인증을 확인해 주세요.');
    return db.runTransaction(async (tx) => {
        const gate = await tx.get((0, releaseGate_1.releaseGateRef)(db));
        const [grant, employee, ...cutovers] = await Promise.all([tx.get(db.collection('companyTransferGrants').doc(uid)), tx.get(db.collection('employees').doc(claims.employeeId)), ...[input.from, input.to].map(company => tx.get(db.collection('appMeta').doc(`companyTransferCutover_${company}`)))]);
        (0, releaseGate_1.assertReleaseActive)(gate, input.releaseId);
        (0, releaseGate_1.assertVoucherDateAllowed)(gate, input.from, input.tradeDate);
        (0, releaseGate_1.assertVoucherDateAllowed)(gate, input.to, input.tradeDate);
        try {
            (0, interCompanyAuthority_1.assertInterCompanyAuthority)(claims, input.from, input.to, grant.data(), uid);
        }
        catch (_a) {
            fail('양사 관리자 권한을 증명할 수 없습니다.');
        }
        const staff = employee.data();
        if (!staff || staff.authUid !== uid || staff.companyId !== input.from || staff.adminAccess !== true || staff.status === 'out')
            fail('현재 직원 관리자 권한이 없습니다.');
        cutovers.forEach((snap, index) => { const row = snap.data(); if (!row || row.companyId !== [input.from, input.to][index] || row.enabled !== true || row.legacyWritersBlocked !== true || row.auditPassed !== true)
            fail('회사이체 writer 전환이 준비되지 않았습니다.'); });
        const companies = [input.from, input.to];
        const accounts = await Promise.all(companies.map(company => tx.get(db.collection('cashAccounts').where('companyId', '==', company))));
        const partners = await Promise.all(companies.map((company, index) => tx.get(db.collection('partners').where('companyId', '==', company).where('name', '==', name(companies[1 - index])))));
        const options = await Promise.all(companies.map(async (company, index) => {
            const bankRows = accounts[index].docs.filter(snap => snap.data().active === true && snap.data().type === '통장').map(snap => (Object.assign(Object.assign({}, snap.data()), { id: snap.id })));
            const partnerRows = await Promise.all(partners[index].docs.map(async (partner) => {
                var _a, _b, _c, _d;
                try {
                    const [state, statements, cash, settlements, returns] = await Promise.all([tx.get(db.collection('appMeta').doc(`partnerPaymentState_${company}_${partner.id}`)), tx.get(db.collection('issuedStatements').where('partnerId', '==', partner.id)), tx.get(db.collection('cashEntries').where('partnerId', '==', partner.id)), tx.get(db.collection('settlements').where('companyId', '==', company)), tx.get(db.collection('returnApplications').where('partnerId', '==', partner.id))]);
                    const revision = (_b = (_a = state.data()) === null || _a === void 0 ? void 0 : _a.revision) !== null && _b !== void 0 ? _b : 0;
                    if (!Number.isSafeInteger(revision) || revision < 0 || state.exists && (((_c = state.data()) === null || _c === void 0 ? void 0 : _c.companyId) !== company || ((_d = state.data()) === null || _d === void 0 ? void 0 : _d.partnerId) !== partner.id))
                        fail('거래처 정산 상태를 확인해 주세요.');
                    const claimRows = await (0, returnClaimReader_1.readClaimsAfterReturns)(db, tx, statements.docs.map(snap => (0, partnerPaymentCommand_1.claimFromStatement)(snap.id, snap.data())).filter((row) => row !== null), returns.docs.filter(snap => snap.data().companyId === company).map(snap => (Object.assign(Object.assign({}, snap.data()), { id: snap.id }))), statements.docs.map(snap => (Object.assign(Object.assign({}, snap.data()), { id: snap.id }))));
                    const plan = (0, partnerPaymentPlan_1.planPartnerPayment)({ companyId: company, partnerId: partner.id, direction: index === 0 ? '출금' : '입금', amount: Number.MAX_SAFE_INTEGER, pin: false, allocations: [], claims: claimRows, cashEntries: cash.docs.map(snap => (0, partnerPaymentCommand_1.cashFromEntry)(snap.id, snap.data())).filter((row) => row !== null), settlements: settlements.docs.map(snap => (Object.assign({ id: snap.id }, snap.data()))) });
                    if (plan.ignoredOrphanSettlementIds.length)
                        fail('양사 정산 원본이 불완전합니다.');
                    return { id: partner.id, companyId: company, name: partner.data().name, revision, available: plan.applications.reduce((sum, row) => sum + row.amount, 0) };
                }
                catch (error) {
                    if (error instanceof partnerPaymentPlan_1.PartnerPaymentValidationError)
                        throw new https_1.HttpsError('failed-precondition', error.message);
                    throw error;
                }
            }));
            return { companyId: company, accounts: bankRows, partners: partnerRows };
        }));
        return { from: options[0], to: options[1], releaseId: input.releaseId };
    });
}
exports.prepareInterCompanyTransferCommand = (0, https_1.onCall)({ region: 'asia-northeast3' }, async (request) => { if (!request.auth)
    throw new https_1.HttpsError('unauthenticated', '로그인이 필요합니다.'); const { employeeId, companyId, isAdmin } = request.auth.token; return prepareInterCompanyTransfer(admin.firestore(), request.auth.uid, { employeeId, companyId, isAdmin }, request.data); });
//# sourceMappingURL=interCompanyTransferPreparation.js.map