"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOAN_INTEREST_ACCOUNT = void 0;
exports.loanPrincipalBalance = loanPrincipalBalance;
exports.planLoanMovement = planLoanMovement;
const won = (n) => Number.isSafeInteger(n) && n >= 0;
exports.LOAN_INTEREST_ACCOUNT = '931';
function createdAtMillis(value) {
    const millis = typeof value === 'string'
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
        ? Date.parse(value)
        : value && typeof value === 'object' && typeof value.toMillis === 'function' ? value.toMillis() : NaN;
    if (!Number.isFinite(millis))
        throw new Error('대출 연결 전표의 생성 시각이 없거나 잘못되었습니다.');
    return millis;
}
function loanPrincipalBalance(loan, entries) {
    var _a;
    if (!['260', '293'].includes(loan.accountCode) || !won(loan.openingPrincipal))
        throw new Error('대출 계약의 시작 잔액이 잘못되었습니다.');
    let balance = loan.openingPrincipal;
    const history = entries.filter(entry => {
        var _a;
        return entry.loanId === loan.id
            && ((_a = entry.companyId) !== null && _a !== void 0 ? _a : 'taebaek') === loan.companyId && entry.date >= loan.openingDate;
    })
        .map(entry => ({ entry, millis: createdAtMillis(entry.createdAt) }))
        .sort((a, b) => a.entry.date.localeCompare(b.entry.date) || a.millis - b.millis
        || a.entry.id.localeCompare(b.entry.id));
    for (const { entry } of history) {
        if (!won(entry.amount) || entry.amount === 0 || (entry.dir !== '입금' && entry.dir !== '출금'))
            throw new Error('연결된 자금전표가 잘못되었습니다.');
        const lines = ((_a = entry.lines) === null || _a === void 0 ? void 0 : _a.length) ? entry.lines : entry.accountCode ? [{ accountCode: entry.accountCode, amount: entry.amount }] : [];
        if (!lines.length)
            throw new Error('연결된 자금전표의 분개 줄이 없습니다.');
        let principal = 0;
        for (const line of lines) {
            if (!Number.isSafeInteger(line.amount) || line.amount === 0 || !line.accountCode)
                throw new Error('연결된 자금전표 줄이 잘못되었습니다.');
            if (line.accountCode === '260' || line.accountCode === '293') {
                if (line.accountCode !== loan.accountCode)
                    throw new Error('대출 계약과 원금 계정이 다릅니다.');
                const positive = line.side ? (line.side === (entry.dir === '입금' ? '대변' : '차변')) : line.amount > 0;
                principal += (entry.dir === '입금' ? 1 : -1) * (positive ? 1 : -1) * Math.abs(line.amount);
            }
        }
        balance += principal;
        if (!Number.isSafeInteger(balance) || balance < 0)
            throw new Error('대출 원금 잔액이 손상되었습니다.');
    }
    return balance;
}
function planLoanMovement(loan, entries, request) {
    const { action, principal, interest } = request;
    if (!won(principal) || !won(interest) || principal + interest <= 0 || !Number.isSafeInteger(principal + interest)
        || (action !== '차입' && action !== '상환') || (action === '차입' && (interest !== 0 || principal === 0)))
        throw new Error('대출 원금·이자 입력이 잘못되었습니다.');
    const balanceBefore = loanPrincipalBalance(loan, entries);
    if (action === '상환' && principal > balanceBefore)
        throw new Error('상환 원금이 대출 잔액을 넘습니다.');
    const principalDelta = action === '차입' ? principal : -principal;
    const balanceAfter = balanceBefore + principalDelta;
    return action === '차입'
        ? { balanceBefore, balanceAfter, principalDelta, dir: '입금', amount: principal, accountCode: loan.accountCode }
        : { balanceBefore, balanceAfter, principalDelta, dir: '출금', amount: principal + interest,
            lines: [
                ...(principal ? [{ accountCode: loan.accountCode, amount: principal, note: '원금' }] : []),
                ...(interest ? [{ accountCode: exports.LOAN_INTEREST_ACCOUNT, amount: interest, note: '이자' }] : []),
            ] };
}
//# sourceMappingURL=loanMovementPlan.js.map