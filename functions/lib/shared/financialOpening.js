"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openingCashAccountCode = exports.openingDocumentId = exports.openingCompanyOf = void 0;
exports.openingCalendarDay = openingCalendarDay;
exports.cashOpeningBalanceForCurrent = cashOpeningBalanceForCurrent;
exports.cashOpeningStatement = cashOpeningStatement;
exports.loanOpeningStatement = loanOpeningStatement;
exports.openingPartnerStatement = openingPartnerStatement;
exports.loanOpeningPrincipalForBalance = loanOpeningPrincipalForBalance;
const cashAccountLedger_1 = require("./cashAccountLedger");
const cashLineProjection_1 = require("./cashLineProjection");
const calculation_1 = require("./calculation");
const openingCompanyOf = (row) => { var _a; return (_a = row.companyId) !== null && _a !== void 0 ? _a : 'taebaek'; };
exports.openingCompanyOf = openingCompanyOf;
const openingDocumentId = (company) => company === 'taebaek' ? 'main' : `main-${company}`;
exports.openingDocumentId = openingDocumentId;
function openingCalendarDay(date) { return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date; }
const isCalendarDay = openingCalendarDay;
const companyOf = exports.openingCompanyOf;
const today = () => (0, calculation_1.kstDateOf)(new Date());
const BANK = '103', AR = '108', AP = '251';
const STANDARD_ACCOUNT = { CASH: '102' };
const totalCashOnHand = (accounts, entries, asOf) => accounts.reduce((sum, account) => sum + (0, cashAccountLedger_1.buildAccountLedger)(account, entries, account.openingDate, asOf).closing, 0);
const journalizeTransfer = (voucher) => voucher.items.reduce((sum, line) => sum + (line.side === '차변' ? line.total : -line.total), 0) === 0;
const openingCashAccountCode = (account) => account.type === '현금' ? STANDARD_ACCOUNT.CASH : BANK;
exports.openingCashAccountCode = openingCashAccountCode;
/** 입력한 현재 잔액에서 새 기준일 이후 실제 입출금을 빼서 기초 잔액을 구한다. */
function cashOpeningBalanceForCurrent(account, entries, newDate, currentBalance, asOf = today()) {
    var _a;
    if (!isCalendarDay(newDate) || !isCalendarDay(asOf) || !Number.isSafeInteger(currentBalance))
        throw new Error('계좌 기준일과 정수 잔액을 확인하세요.');
    const mine = entries.filter(entry => companyOf(entry) === companyOf(account));
    if (((_a = account.confirmedBalances) !== null && _a !== void 0 ? _a : []).some(point => point.date >= newDate && point.date <= asOf)
        || mine.some(entry => { var _a; return entry.cashAccountId === account.id && entry.date >= newDate && entry.date <= asOf && ((_a = entry.balanceAdjustment) === null || _a === void 0 ? void 0 : _a.confirmedBalance) === true; }))
        throw new Error('확정 잔액 기준점이 있는 기간은 기초잔액 변경으로 현재 잔액을 수정할 수 없습니다. 확정 잔액 기준점을 확인해 주세요.');
    if (mine.some(entry => entry.cashAccountId === account.id && entry.date >= newDate && entry.date <= asOf && !Number.isSafeInteger(entry.amount)))
        throw new Error('계좌 연결 전표의 금액을 확인하세요.');
    const movement = totalCashOnHand([Object.assign(Object.assign({}, account), { openingDate: newDate, openingBalance: 0 })], mine, asOf);
    const opening = currentBalance - movement;
    if (!Number.isSafeInteger(opening))
        throw new Error('계좌 기초 잔액이 계산 범위를 벗어났습니다.');
    return opening;
}
function cashOpeningStatement(account) {
    if (!account.id || !account.companyId || !isCalendarDay(account.openingDate) ||
        !Number.isInteger(account.openingBalance) || account.openingBalance <= 0 || account.type === '카드') {
        throw new Error('현금·통장 기초일과 0원 초과 정수 잔액을 확인하세요.');
    }
    const amount = account.openingBalance;
    const line = (accountCode, side, name) => ({
        name, spec: '', qty: 1, price: amount, supply: amount, tax: 0, total: amount,
        isTaxExempt: true, accountCode, side, lineKind: 'account',
    });
    const voucher = {
        id: `opening-cash-${account.companyId}-${account.id}`, companyId: account.companyId,
        issuedAt: `${account.openingDate}T00:00:00+09:00`, tradeDate: account.openingDate,
        type: '비용', partnerId: '', partnerName: '', orderId: '',
        docNo: `기초계좌-${account.id}`, totalSupply: amount, totalTax: 0, totalAmount: amount,
        items: [line((0, exports.openingCashAccountCode)(account), '차변', account.name), line('375', '대변', '기초 이월이익잉여금')],
    };
    if (!journalizeTransfer(voucher))
        throw new Error('계좌 기초 전표 차변·대변이 일치하지 않습니다.');
    return voucher;
}
function loanOpeningStatement(loan) {
    var _a;
    if (!loan.id || !loan.companyId || !isCalendarDay(loan.openingDate) ||
        !Number.isInteger(loan.openingPrincipal) || loan.openingPrincipal <= 0 ||
        (loan.accountCode !== '260' && loan.accountCode !== '293')) {
        throw new Error('대출 기초일·계정·0원 초과 정수 원금을 확인하세요.');
    }
    const amount = loan.openingPrincipal;
    const line = (accountCode, side, name) => ({
        name, spec: '', qty: 1, price: amount, supply: amount, tax: 0, total: amount,
        isTaxExempt: true, accountCode, side, lineKind: 'account',
    });
    const voucher = {
        id: `opening-loan-${loan.companyId}-${loan.id}`, companyId: loan.companyId,
        issuedAt: `${loan.openingDate}T00:00:00+09:00`, tradeDate: loan.openingDate,
        type: '비용', partnerId: (_a = loan.partnerId) !== null && _a !== void 0 ? _a : '', partnerName: loan.lenderName,
        orderId: '', docNo: `기초대출-${loan.id}`,
        totalSupply: amount, totalTax: 0, totalAmount: amount,
        items: [line('375', '차변', '기초 이월이익잉여금'), line(loan.accountCode, '대변', loan.name)],
    };
    if (!journalizeTransfer(voucher))
        throw new Error('대출 기초 전표 차변·대변이 일치하지 않습니다.');
    return voucher;
}
/** One opening receivable/payable is one balanced, partner-linked transfer voucher. */
function openingPartnerStatement(companyId, date, partner, code, amount) {
    if (!isCalendarDay(date) || !Number.isInteger(amount) || amount <= 0 || !partner.id || !partner.name) {
        throw new Error('기초일·거래처·0원 초과 정수 금액을 확인하세요.');
    }
    if (partner.companyId && partner.companyId !== companyId)
        throw new Error('다른 회사 거래처입니다.');
    const receivable = code === AR;
    const id = `opening-partner-${companyId}-${date}-${partner.id}-${code}`;
    const line = (accountCode, side, name) => ({
        name, spec: '', qty: 1, price: amount, supply: amount, tax: 0, total: amount,
        isTaxExempt: true, accountCode, side, lineKind: 'account',
    });
    const voucher = {
        id, companyId, issuedAt: `${date}T00:00:00+09:00`, tradeDate: date, type: '비용',
        partnerId: partner.id, partnerName: partner.name, orderId: '', docNo: `기초-${date.replace(/-/g, '')}-${partner.id}-${code}`,
        totalSupply: amount, totalTax: 0, totalAmount: amount,
        items: receivable
            ? [line(AR, '차변', '기초 미수금(이월)'), line('375', '대변', '기초 이월이익잉여금')]
            : [line('375', '차변', '기초 이월이익잉여금'), line(AP, '대변', '기초 미지급금(이월)')],
    };
    if (!journalizeTransfer(voucher))
        throw new Error('기초 전표 차변·대변이 일치하지 않습니다.');
    return voucher;
}
/** 원계약의 차대 투영으로 새 시작 원금을 역산한다. */
function loanOpeningPrincipalForBalance(loan, entries, openingDate, currentBalance) {
    var _a;
    if (!isCalendarDay(openingDate) || !Number.isSafeInteger(currentBalance) || currentBalance < 0)
        throw new Error('시작일과 0원 이상의 정수 잔액을 확인하세요.');
    let delta = 0;
    for (const entry of entries) {
        if (entry.loanId !== loan.id || companyOf(entry) !== loan.companyId || entry.date < openingDate)
            continue;
        const { parts, total } = (0, cashLineProjection_1.projectCashLines)(entry);
        if (!parts.length || (!((_a = entry.lines) === null || _a === void 0 ? void 0 : _a.some(line => line.accountCode && line.amount !== 0)) && (!entry.amount || !entry.accountCode)) || (!total && entry.dir !== '대체'))
            continue;
        if (entry.dir === '대체' && (!parts.some(line => line.amount > 0) || parts.reduce((sum, line) => sum + line.amount, 0) !== 0))
            continue;
        delta += parts.filter(line => line.accountCode === loan.accountCode).reduce((sum, line) => sum + (entry.dir === '입금' ? line.amount : -line.amount), 0);
    }
    const principal = currentBalance - delta;
    if (!Number.isSafeInteger(principal) || principal < 0)
        throw new Error('해당 시작일의 원금이 음수가 됩니다. 시작일과 현재 잔액을 확인하세요.');
    return principal;
}
//# sourceMappingURL=financialOpening.js.map