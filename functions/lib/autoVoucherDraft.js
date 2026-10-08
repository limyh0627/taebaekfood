"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduledCashAccountId = scheduledCashAccountId;
exports.scheduledAccountName = scheduledAccountName;
exports.autoVoucherDraft = autoVoucherDraft;
const recurringVoucher_1 = require("./shared/recurringVoucher");
function scheduledCashAccountId(accounts, companyId) {
    var _a, _b, _c, _d, _e, _f;
    const active = accounts.filter(a => (a.companyId === companyId || (!a.companyId && companyId === 'taebaek')) && a.active)
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return (_f = (_d = (_b = (_a = active.find(a => a.id === 'cashacct-temp-main')) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : (_c = active.find(a => a.type !== '카드')) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : (_e = active[0]) === null || _e === void 0 ? void 0 : _e.id) !== null && _f !== void 0 ? _f : '';
}
function scheduledAccountName(accounts, companyId, code) {
    var _a;
    return (_a = accounts.filter(a => a.companyId === companyId).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        .find(a => a.code === code)) === null || _a === void 0 ? void 0 : _a.name;
}
/** Scheduler policy stays here; the app and scheduler consume the same pure projection. */
function autoVoucherDraft(t, ym, today, cashAccountId = '', accountName = '') {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (!t.autoIssue)
        return { skip: '자동 발행 꺼짐' };
    if (t.kind === 'voucher')
        return { skip: '수동 전표 양식' };
    if (t.companyId !== 'taebaek' && t.companyId !== 'punghoe')
        return { skip: '회사 미지정' };
    if (!t.accountCode)
        return { skip: '계정 미지정' };
    if (typeof t.amount !== 'number' || !Number.isSafeInteger(t.amount) || t.amount <= 0)
        return { skip: '유효하지 않은 원화 총액' };
    if (!/^\d{4}-\d{2}$/.test(ym) || !/^\d{4}-\d{2}-\d{2}$/.test(today))
        return { skip: '발행월/날짜 오류' };
    if (t.startYm && ym < t.startYm)
        return { skip: '시작월 이전' };
    if (t.endYm && ym > t.endYm)
        return { skip: '종료월 이후' };
    const [year, month] = ym.split('-').map(Number);
    if (month < 1 || month > 12 || today.slice(0, 7) !== ym)
        return { skip: '발행월/날짜 오류' };
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const issueDay = t.issueDay === undefined ? 1 : Number(t.issueDay);
    if (!Number.isFinite(issueDay))
        return { skip: '발행일 오류' };
    const tradeDate = (0, recurringVoucher_1.recurringDate)(ym, Math.trunc(issueDay), last);
    if (today !== tradeDate)
        return { skip: '발행일 아님' };
    if (t.mode === '상환' || t.loanId || ((_a = t.principal) !== null && _a !== void 0 ? _a : 0) > 0 || ((_b = t.interest) !== null && _b !== void 0 ? _b : 0) > 0)
        return { skip: '대출 상환 분할 필요' };
    const dir = (0, recurringVoucher_1.recurringDir)(Object.assign(Object.assign({}, t), { dir: t.dir || undefined }));
    if (dir === '회사이체')
        return { skip: '회사이체 원자 명령 필요' };
    if (!['입금', '출금', '줄돈', '받을돈', '대체'].includes(dir))
        return { skip: '전표 갈래 오류' };
    const isCash = dir === '입금' || dir === '출금';
    if (isCash && ((_c = t.transferLines) === null || _c === void 0 ? void 0 : _c.length))
        return { skip: '대체 분개 줄 필요' };
    if (t.statementType !== undefined && !['매출', '매입', '비용'].includes(t.statementType))
        return { skip: '전표 종류 오류' };
    const statementType = (0, recurringVoucher_1.recurringType)(Object.assign(Object.assign({}, t), { dir }));
    if (!isCash && t.statementType && ((dir === '줄돈' && statementType !== '매입') || (dir === '받을돈' && statementType !== '매출')))
        return { skip: '전표 종류와 갈래 불일치' };
    const transferLines = ((_d = t.transferLines) !== null && _d !== void 0 ? _d : []);
    if (!isCash && statementType === '비용') {
        if (t.statementType !== '비용' || transferLines.length !== 2
            || !transferLines.every(line => line && typeof line.accountCode === 'string' && !!line.accountCode)
            || transferLines.filter(line => line.side === '차변').length !== 1
            || transferLines.filter(line => line.side === '대변').length !== 1)
            return { skip: '대체 분개 줄 필요' };
    }
    else if (!t.statementType && transferLines.length)
        return { skip: '대체 분개 줄 필요' };
    if (!isCash && statementType !== '비용' && !t.partnerId)
        return { skip: '비현금 거래처 미지정' };
    const operationId = (0, recurringVoucher_1.recurringId)(t.id, ym);
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(operationId))
        return { skip: '작업 ID 오류' };
    const base = { id: operationId, companyId: t.companyId };
    if (isCash)
        return { draft: {
                kind: 'cashEntries', companyId: t.companyId, operationId, tradeDate,
                document: Object.assign(Object.assign(Object.assign(Object.assign({}, base), { date: tradeDate, cashAccountId, dir, amount: t.amount, accountCode: t.accountCode }), (t.partnerId ? { partnerId: t.partnerId, partnerName: (_e = t.partnerName) !== null && _e !== void 0 ? _e : '' } : {})), { note: `정기 · ${(_f = t.name) !== null && _f !== void 0 ? _f : ''}${t.partnerName ? ` · ${t.partnerName}` : ''}`, createdAt: new Date().toISOString() }),
            } };
    const projection = (0, recurringVoucher_1.recurringStatement)(Object.assign(Object.assign({}, t), { statementType, amount: t.amount, transferLines }), accountName);
    return { draft: {
            kind: 'issuedStatements', companyId: t.companyId, operationId, tradeDate,
            document: Object.assign(Object.assign(Object.assign({}, base), { issuedAt: new Date(`${tradeDate}T09:00:00+09:00`).toISOString(), tradeDate, partnerId: (_g = t.partnerId) !== null && _g !== void 0 ? _g : '', partnerName: (_h = t.partnerName) !== null && _h !== void 0 ? _h : '', orderId: operationId }), projection),
        } };
}
//# sourceMappingURL=autoVoucherDraft.js.map