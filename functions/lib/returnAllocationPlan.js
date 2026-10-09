"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planReturnAllocation = planReturnAllocation;
exports.prepareStandaloneReturn = prepareStandaloneReturn;
const returnValidationError_1 = require("./returnValidationError");
const returnReversalPlan_1 = require("./returnReversalPlan");
const money = (value) => Number.isSafeInteger(value) && value >= 0;
function planReturnAllocation(input) {
    if (!input.returnId || !input.companyId || !input.partnerId || !money(input.amount) || !input.amount
        || !['입금', '출금'].includes(input.direction) || !Array.isArray(input.claims)
        || !Array.isArray(input.priorAllocations))
        throw new returnValidationError_1.ReturnValidationError('반품 배분 입력이 잘못되었습니다.');
    const byId = new Map();
    const open = new Map();
    for (const claim of input.claims) {
        if (!claim.id || byId.has(claim.id) || claim.companyId !== input.companyId
            || claim.partnerId !== input.partnerId || claim.direction !== input.direction
            || !/^\d{4}-\d{2}-\d{2}$/.test(claim.tradeDate) || !money(claim.amount)
            || !money(claim.cashApplied) || claim.cashApplied > claim.amount)
            throw new returnValidationError_1.ReturnValidationError('원전표 배분 근거가 잘못되었습니다.');
        byId.set(claim.id, claim);
        open.set(claim.id, claim.amount - claim.cashApplied);
    }
    for (const row of input.priorAllocations) {
        if (!row.returnId || !byId.has(row.statementId) || !money(row.amount) || !row.amount)
            throw new returnValidationError_1.ReturnValidationError('기존 반품 배분 근거가 잘못되었습니다.');
        const left = open.get(row.statementId) - row.amount;
        if (left < 0)
            throw new returnValidationError_1.ReturnValidationError('기존 반품 배분이 미결액을 초과합니다.');
        open.set(row.statementId, left);
        if (row.returnId === input.returnId)
            throw new returnValidationError_1.ReturnValidationError('기존 반품 요청은 operation ledger에서 확인해야 합니다.');
    }
    const sorted = [...byId.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.id.localeCompare(b.id));
    const linked = input.linkedStatementId ? byId.get(input.linkedStatementId) : undefined;
    if (input.linkedStatementId && !linked)
        throw new returnValidationError_1.ReturnValidationError('지정 원전표를 찾을 수 없습니다.');
    const claims = linked ? [linked, ...sorted.filter(claim => claim.id !== linked.id)] : sorted;
    const allocations = [];
    let remaining = input.amount;
    for (const claim of claims) {
        const amount = Math.min(remaining, open.get(claim.id));
        if (amount)
            allocations.push({ statementId: claim.id, amount });
        remaining -= amount;
        if (!remaining)
            break;
    }
    return { allocations, unappliedAmount: remaining };
}
/** 원전표 없는 반품도 명시 금액으로 역분개하고, 금융 미결만 같은 계정 FIFO로 준비한다. */
function prepareStandaloneReturn(input) {
    const reversal = (0, returnReversalPlan_1.planStandaloneReturn)(input.request);
    const direction = input.request.returnType === '매출' ? '입금' : '출금';
    const accountCode = input.request.returnType === '매출' ? '108' : input.request.payableAccountCode;
    if (!Array.isArray(input.claims) || input.claims.some(claim => claim.companyId !== input.companyId
        || claim.partnerId !== input.partnerId || claim.direction !== direction
        || claim.accountCode !== accountCode))
        throw new returnValidationError_1.ReturnValidationError('반품 미결의 회사·거래처·방향·계정이 맞지 않습니다.');
    const allocation = planReturnAllocation({ returnId: input.returnId, companyId: input.companyId,
        partnerId: input.partnerId, direction, amount: reversal.amount,
        linkedStatementId: input.linkedStatementId, claims: input.claims, priorAllocations: input.priorAllocations });
    return Object.assign(Object.assign({}, reversal), allocation);
}
//# sourceMappingURL=returnAllocationPlan.js.map