"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReturnClaimProjectionError = void 0;
exports.deletedReturnCredits = deletedReturnCredits;
const crypto_1 = require("crypto");
class ReturnClaimProjectionError extends Error {
}
exports.ReturnClaimProjectionError = ReturnClaimProjectionError;
function fail() { throw new ReturnClaimProjectionError('반품 원장·역분개·배분 증거가 맞지 않습니다.'); }
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
const hash = (row) => (0, crypto_1.createHash)('sha256').update(JSON.stringify(canonical(Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'id'))))).digest('hex');
/** Only the allocation whose source was deleted becomes independent noncash credit. */
function deletedReturnCredits(claims, applications, journals, operations) {
    var _a;
    const claimIds = new Set(claims.map(row => row.id));
    if (new Set(applications.map(row => row.id)).size !== applications.length)
        fail();
    if (applications.some(row => !claimIds.has(row.statementId) && journals.some(journal => journal.id === row.statementId)))
        fail();
    const operationIds = new Set(applications.filter(row => !claimIds.has(row.statementId)).map(row => row.operationId));
    const credits = [];
    const validDate = (date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
        && Number.isFinite(Date.parse(date + 'T00:00:00Z')) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date;
    for (const operationId of operationIds) {
        if (typeof operationId !== 'string' || !operationId)
            fail();
        const operation = operations.find(row => row.id === operationId);
        const journal = journals.find(row => row.id === (operation === null || operation === void 0 ? void 0 : operation.journalId));
        const rows = applications.filter(row => row.operationId === operationId);
        if (!operation || !journal || !validDate(journal.tradeDate) || (operation.status !== undefined && operation.status !== 'applied')
            || operation.journalId !== journal.id || journal.returnOperationId !== operationId || journal.type !== '비용'
            || operation.companyId !== journal.companyId || !journal.partnerId || hash(journal) !== operation.journalHash
            || !Number.isSafeInteger(operation.amount) || operation.amount <= 0 || journal.totalAmount !== operation.amount
            || !Array.isArray(operation.applications) || operation.applications.length !== rows.length
            || new Set(operation.applications.map((row) => row.id)).size !== rows.length)
            fail();
        let sum = 0, deleted = 0;
        for (const row of rows) {
            const proof = operation.applications.find((proof) => proof.id === row.id);
            if (row.companyId !== journal.companyId || row.partnerId !== journal.partnerId
                || row.returnRequestId !== operation.returnRequestId || !Number.isSafeInteger(row.amount) || row.amount <= 0
                || !proof || proof.statementId !== row.statementId || proof.amount !== row.amount || hash(row) !== proof.applicationHash)
                fail();
            sum += row.amount;
            if (!claimIds.has(row.statementId))
                deleted += row.amount;
        }
        if (!Number.isSafeInteger(sum) || sum !== operation.amount || !Number.isSafeInteger(deleted))
            fail();
        let debit = 0, credit = 0;
        const reverse = new Map();
        if (!Array.isArray(journal.items))
            fail();
        for (const line of journal.items) {
            if (!Number.isSafeInteger(line.total) || line.total <= 0 || !['차변', '대변'].includes(line.side))
                fail();
            if (line.side === '차변')
                debit += line.total;
            else
                credit += line.total;
            if ((line.accountCode === '108' && line.side === '대변') || (['251', '253'].includes(line.accountCode) && line.side === '차변'))
                reverse.set(line.accountCode, ((_a = reverse.get(line.accountCode)) !== null && _a !== void 0 ? _a : 0) + line.total);
        }
        if (!Number.isSafeInteger(debit) || debit !== credit || reverse.size !== 1)
            fail();
        const [accountCode, amount] = [...reverse][0];
        if (amount !== operation.amount)
            fail();
        for (const row of rows) {
            const claim = claims.find(claim => claim.id === row.statementId);
            if (claim && (claim.companyId !== journal.companyId || claim.partnerId !== journal.partnerId || claim.accountCode !== accountCode))
                fail();
        }
        credits.push({ id: journal.id, companyId: journal.companyId, partnerId: journal.partnerId,
            tradeDate: journal.tradeDate, amount: -deleted, accountCode: accountCode });
    }
    return credits;
}
//# sourceMappingURL=returnClaimProjection.js.map