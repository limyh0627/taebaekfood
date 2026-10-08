"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planReturnAllocation = planReturnAllocation;
const returnValidationError_1 = require("./returnValidationError");
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
//# sourceMappingURL=returnAllocationPlan.js.map