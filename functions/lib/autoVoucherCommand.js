"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.issueScheduledVoucher = issueScheduledVoucher;
const autoVoucherDraft_1 = require("./autoVoucherDraft");
const voucherIssue_1 = require("./voucherIssue");
/** The scheduler and tests both enter through this complete issue command. */
async function issueScheduledVoucher(db, template, yearMonth, issueDate, releaseId) {
    var _a, _b;
    let decision = (0, autoVoucherDraft_1.autoVoucherDraft)(template, yearMonth, issueDate);
    if (!decision.draft)
        return decision;
    if (decision.draft.kind === 'cashEntries') {
        const accounts = await db.collection('cashAccounts').get();
        const accountId = (0, autoVoucherDraft_1.scheduledCashAccountId)(accounts.docs.map(doc => (Object.assign(Object.assign({}, doc.data()), { id: doc.id }))), decision.draft.companyId);
        decision = (0, autoVoucherDraft_1.autoVoucherDraft)(template, yearMonth, issueDate, accountId);
        if (!decision.draft)
            return decision;
    }
    else {
        const accounts = await db.collection('accountCodes').get();
        if (decision.draft.document.type === '비용' && template.statementType === '비용') {
            const have = new Set(accounts.docs.filter(doc => doc.data().companyId === decision.draft.companyId)
                .map(doc => { var _a; return String((_a = doc.data().code) !== null && _a !== void 0 ? _a : ''); }));
            const codes = [template.accountCode, ...((_a = template.transferLines) !== null && _a !== void 0 ? _a : []).map(line => line.accountCode)];
            const missing = [...new Set(codes.filter((code) => !!code && !have.has(code)))];
            if (missing.length)
                return { skip: `현재 회사 계정표에 없는 계정: ${missing.join(', ')}` };
        }
        const accountName = (0, autoVoucherDraft_1.scheduledAccountName)(accounts.docs.map(doc => (Object.assign(Object.assign({}, doc.data()), { id: doc.id }))), decision.draft.companyId, String((_b = template.accountCode) !== null && _b !== void 0 ? _b : ''));
        decision = (0, autoVoucherDraft_1.autoVoucherDraft)(template, yearMonth, issueDate, '', accountName);
        if (!decision.draft)
            return decision;
    }
    const { kind, companyId, operationId, tradeDate, document } = decision.draft;
    const result = await (0, voucherIssue_1.issueVoucher)(db, companyId, { kind, operationId, tradeDate, document, releaseId, prefix: document.type === '비용' ? '대체' : '' });
    return { result };
}
//# sourceMappingURL=autoVoucherCommand.js.map