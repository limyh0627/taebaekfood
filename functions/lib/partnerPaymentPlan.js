"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PartnerPaymentValidationError = void 0;
exports.openClaimBalances = openClaimBalances;
exports.claimsAfterReturns = claimsAfterReturns;
exports.planPartnerPayment = planPartnerPayment;
class PartnerPaymentValidationError extends Error {
}
exports.PartnerPaymentValidationError = PartnerPaymentValidationError;
/** Uses the same settlement and unpinned-cash rules as partner payment. */
function openClaimBalances(input) {
    const total = input.claims.filter(row => row.companyId === input.companyId && row.partnerId === input.partnerId
        && isRelevantCode(row.accountCode, input.direction)).reduce((sum, row) => sum + row.amount, 0);
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(total + 1))
        throw new PartnerPaymentValidationError('Claim total overflow');
    const probe = planPartnerPayment(Object.assign(Object.assign({}, input), { amount: Math.max(0, total) + 1, pin: false, allocations: [] }));
    if (probe.ignoredOrphanSettlementIds.length)
        throw new PartnerPaymentValidationError('Orphan settlement');
    return new Map(probe.applications.map(row => [row.statementId, row.amount]));
}
const integer = (value) => Number.isSafeInteger(value);
const isRelevantCode = (code, direction) => direction === '입금' ? code === '108' : code === '251' || code === '253';
/** A return reverses the original claim without creating a fake cash payment. */
function claimsAfterReturns(claims, applications) {
    var _a;
    const byId = new Map(claims.map(row => [row.id, row]));
    const used = new Map();
    for (const row of applications) {
        const claim = byId.get(row.statementId);
        if (!claim || claim.companyId !== row.companyId || claim.partnerId !== row.partnerId
            || !integer(row.amount) || row.amount <= 0)
            throw new PartnerPaymentValidationError('반품 역적용의 원전표·회사·거래처·금액이 맞지 않습니다.');
        const total = ((_a = used.get(row.statementId)) !== null && _a !== void 0 ? _a : 0) + row.amount;
        if (!integer(total) || total > claim.amount)
            throw new PartnerPaymentValidationError('반품 역적용이 원전표 금액을 넘습니다.');
        used.set(row.statementId, total);
    }
    return claims.map(row => { var _a; return (Object.assign(Object.assign({}, row), { amount: row.amount - ((_a = used.get(row.id)) !== null && _a !== void 0 ? _a : 0) })); });
}
function planPartnerPayment(input) {
    var _a, _b, _c;
    if (!input.partnerId || !integer(input.amount) || input.amount <= 0)
        throw new PartnerPaymentValidationError('지급 금액이 잘못되었습니다.');
    if (input.pin && (!input.allocations.length || input.allocations.some(row => !row.statementId || !integer(row.amount) || row.amount <= 0)
        || input.allocations.reduce((sum, row) => sum + row.amount, 0) !== input.amount
        || new Set(input.allocations.map(row => row.statementId)).size !== input.allocations.length))
        throw new PartnerPaymentValidationError('전표 배분이 잘못되었습니다.');
    const claims = input.claims.filter(row => row.companyId === input.companyId && row.partnerId === input.partnerId);
    const cash = input.cashEntries.filter(row => row.companyId === input.companyId && row.partnerId === input.partnerId);
    const byClaim = new Map(claims.map(row => [row.id, row]));
    const byCash = new Map(cash.map(row => [row.id, row]));
    const ignoredOrphanSettlementIds = [];
    const validSettlements = [];
    const settledByCashCode = new Map();
    for (const row of input.settlements) {
        const claim = byClaim.get(row.statementId), entry = byCash.get(row.cashEntryId);
        if (!claim && !entry)
            continue;
        if (!claim || !entry) {
            ignoredOrphanSettlementIds.push(row.id);
            continue;
        }
        if (!integer(row.amount) || row.amount <= 0)
            throw new PartnerPaymentValidationError('기존 정산 금액이 잘못되었습니다.');
        const payable = claim.accountCode === '251' || claim.accountCode === '253';
        const key = `${entry.id}/${payable ? 'payable' : '108'}`;
        const applied = ((_a = settledByCashCode.get(key)) !== null && _a !== void 0 ? _a : 0) + row.amount;
        const eligible = entry.parts.filter(part => payable
            ? part.accountCode === '251' || part.accountCode === '253' : part.accountCode === '108')
            .reduce((sum, part) => sum + part.reduce, 0);
        if (!integer(eligible) || applied > eligible)
            throw new PartnerPaymentValidationError('기존 정산의 자금 방향·계정·한도가 맞지 않습니다.');
        settledByCashCode.set(key, applied);
        validSettlements.push(row);
    }
    const relevant = claims.filter(row => isRelevantCode(row.accountCode, input.direction));
    if (relevant.some(row => !integer(row.amount)))
        throw new PartnerPaymentValidationError('비정수 미결을 확인해야 합니다.');
    const positive = relevant.filter(row => row.amount > 0);
    const returnCredit = -relevant.filter(row => row.amount < 0).reduce((sum, row) => sum + row.amount, 0);
    if (!integer(returnCredit))
        throw new PartnerPaymentValidationError('반품 합계가 원화 범위를 넘습니다.');
    const open = new Map(positive.map(row => [row.id, row.amount]));
    let pinned = 0;
    for (const row of validSettlements) {
        if (!open.has(row.statementId))
            continue;
        const apply = Math.min(open.get(row.statementId), row.amount);
        open.set(row.statementId, open.get(row.statementId) - apply);
        pinned += apply;
    }
    const paid = cash.reduce((sum, entry) => sum + entry.parts
        .filter(part => isRelevantCode(part.accountCode, input.direction))
        .reduce((subtotal, part) => subtotal + part.reduce, 0), 0);
    if (!integer(paid) || paid < pinned)
        throw new PartnerPaymentValidationError('기존 지급 원본과 정산이 맞지 않습니다.');
    let previous = paid - pinned + returnCredit;
    if (!integer(previous) || previous < 0)
        throw new PartnerPaymentValidationError('기존 지급·반품 원본과 정산이 맞지 않습니다.');
    const sorted = [...positive].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.id.localeCompare(b.id));
    for (const row of sorted) {
        const applied = Math.min(previous, open.get(row.id));
        open.set(row.id, open.get(row.id) - applied);
        previous -= applied;
    }
    const rows = input.pin ? input.allocations : sorted.map(row => ({ statementId: row.id, amount: open.get(row.id) }));
    const lines = new Map();
    const applications = [];
    const settlements = [];
    let remaining = input.amount;
    let over = 0;
    for (const row of rows) {
        if (remaining <= 0)
            break;
        const claim = byClaim.get(row.statementId);
        if (!claim || !isRelevantCode(claim.accountCode, input.direction))
            throw new PartnerPaymentValidationError('대상 전표의 회사·거래처·방향이 다릅니다.');
        const applied = Math.min(remaining, row.amount, (_b = open.get(row.statementId)) !== null && _b !== void 0 ? _b : 0);
        if (applied > 0) {
            lines.set(claim.accountCode, ((_c = lines.get(claim.accountCode)) !== null && _c !== void 0 ? _c : 0) + applied);
            applications.push({ statementId: claim.id, amount: applied, accountCode: claim.accountCode });
            if (input.pin)
                settlements.push({ statementId: claim.id, amount: applied });
        }
        remaining -= input.pin ? row.amount : applied;
        if (input.pin)
            over += row.amount - applied;
    }
    if (!input.pin)
        over = remaining;
    if (over > 0) {
        const code = input.direction === '입금' ? '254' : '133';
        lines.set(code, over);
    }
    return { lines: [...lines].map(([accountCode, amount]) => ({ accountCode, amount })), applications, settlements, ignoredOrphanSettlementIds };
}
//# sourceMappingURL=partnerPaymentPlan.js.map