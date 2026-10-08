"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signedAmount = signedAmount;
exports.buildAccountLedger = buildAccountLedger;
/** 입금 +, 출금 −. 대체(상계)는 돈이 안 움직였으므로 0 — 통장 잔액을 건드리면 안 된다. */
function signedAmount(e) {
    if (e.dir === '대체')
        return 0;
    return e.dir === '입금' ? e.amount : -e.amount;
}
/** 같은 날짜면 생성순(createdAt)으로 안정 정렬 — 통장 순서를 재현하기 위함 */
function byDateThenCreated(a, b) {
    var _a, _b;
    const d = (a.date || '').localeCompare(b.date || '');
    if (d !== 0)
        return d;
    // 확정 잔액은 해당 날짜의 모든 실제 거래 이후 적용한다.
    const anchor = Number(((_a = a.balanceAdjustment) === null || _a === void 0 ? void 0 : _a.confirmedBalance) === true) - Number(((_b = b.balanceAdjustment) === null || _b === void 0 ? void 0 : _b.confirmedBalance) === true);
    if (anchor !== 0)
        return anchor;
    return (a.createdAt || '').localeCompare(b.createdAt || '') || a.id.localeCompare(b.id);
}
/**
 * 한 계좌의 원장을 [from, to] 기간으로 만든다.
 * opening = 기초잔액 + (openingDate ~ from 직전) 거래 누적. 그래서 기간을 좁혀도 잔액이 틀어지지 않는다.
 */
function buildAccountLedger(account, allEntries, from, to) {
    var _a, _b;
    const confirmations = new Map();
    for (const confirmation of (_a = account.confirmedBalances) !== null && _a !== void 0 ? _a : []) {
        const previous = confirmations.get(confirmation.date);
        if (!previous || confirmation.recordedAt >= previous.recordedAt)
            confirmations.set(confirmation.date, confirmation);
    }
    const confirmedEntries = [...confirmations.values()].map(confirmation => {
        var _a;
        return ({
            id: `account-confirmed:${encodeURIComponent(account.id)}:${confirmation.date}`,
            companyId: (_a = account.companyId) !== null && _a !== void 0 ? _a : 'taebaek', cashAccountId: account.id, date: confirmation.date,
            createdAt: confirmation.recordedAt, dir: '입금', amount: 0,
            balanceAdjustment: { before: confirmation.balance, target: confirmation.balance, delta: 0,
                reason: confirmation.reason, confirmedBalance: true },
        });
    });
    const confirmedIds = new Set(confirmedEntries.map(entry => entry.id));
    const mine = [...allEntries, ...confirmedEntries]
        .filter(e => e.cashAccountId === account.id && e.date >= account.openingDate)
        .sort(byDateThenCreated);
    let opening = account.openingBalance;
    const rows = [];
    let totalIn = 0, totalOut = 0, totalAdjustment = 0;
    let running = account.openingBalance;
    for (const e of mine) {
        const delta = ((_b = e.balanceAdjustment) === null || _b === void 0 ? void 0 : _b.confirmedBalance) === true
            ? e.balanceAdjustment.target - running : signedAmount(e);
        running += delta;
        if (from && e.date < from) {
            opening = running; // 기간 이전 → 이월잔액에만 반영
            continue;
        }
        if (to && e.date > to)
            break; // 정렬돼 있으므로 이후는 볼 필요 없음 (to 비면 전체)
        if (e.balanceAdjustment)
            totalAdjustment += delta;
        else if (e.dir === '입금')
            totalIn += e.amount;
        else if (e.dir === '출금')
            totalOut += e.amount;
        rows.push(Object.assign(Object.assign({ entry: e, balance: running }, (e.balanceAdjustment ? { adjustmentDelta: delta } : {})), (confirmedIds.has(e.id) ? { confirmedAccountBalance: true } : {})));
    }
    return { account, opening, rows, totalIn, totalOut, totalAdjustment, closing: opening + totalIn - totalOut + totalAdjustment };
}
//# sourceMappingURL=cashAccountLedger.js.map