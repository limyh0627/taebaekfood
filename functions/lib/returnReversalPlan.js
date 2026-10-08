"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planReturnReversal = planReturnReversal;
exports.planStandaloneReturn = planStandaloneReturn;
const returnValidationError_1 = require("./returnValidationError");
const money = (value) => Number.isSafeInteger(value) && value >= 0;
const fail = (message) => { throw new returnValidationError_1.ReturnValidationError(message); };
const payableCode = (codes) => {
    if (codes.includes('251'))
        return '251';
    if (codes.includes('253'))
        return '253';
    if (codes.includes('108'))
        return '251';
    if (!codes.some(code => /^(1[0-9]{2}|2[0-9]{2}|5[1-9][0-9]|6[0-9]{2}|8[0-9]{2}|9[0-9]{2})$/.test(code)))
        return '251';
    return codes.some(code => ['500', '501', '503', '505'].includes(code)) ? '251' : '253';
};
function planReturnReversal(companyId, request, source, priorReturns) {
    var _a, _b;
    if (request.companyId !== companyId || source.companyId !== companyId || request.status !== 'pending'
        || request.linkedStatementId !== source.id || request.partnerId !== source.partnerId
        || request.returnType && request.returnType !== source.type)
        fail('반품 요청과 원전표의 회사·거래처·상태·종류가 맞지 않습니다.');
    if (!Array.isArray(source.items) || !source.items.length || !Array.isArray(request.items) || !request.items.length
        || source.items.some(line => !line.itemId || !line.accountCode || !Number.isFinite(line.qty) || line.qty <= 0
            || !money(line.supply) || !money(line.tax) || !money(line.total)
            || line.supply + line.tax !== line.total)
        || new Set(source.items.map(line => line.itemId)).size !== source.items.length
        || !money(source.totalSupply) || !money(source.totalTax) || !money(source.totalAmount) || source.totalAmount === 0
        || source.items.reduce((sum, line) => sum + line.supply, 0) !== source.totalSupply
        || source.items.reduce((sum, line) => sum + line.tax, 0) !== source.totalTax
        || source.totalSupply + source.totalTax !== source.totalAmount)
        fail('원전표의 품목·계정·금액 근거가 불명확합니다.');
    if (request.items.some(item => !item.itemId || !Number.isFinite(item.quantity) || item.quantity <= 0
        || typeof item.isResellable !== 'boolean')
        || new Set(request.items.map(item => item.itemId)).size !== request.items.length)
        fail('반품 품목·수량이 잘못되었습니다.');
    const byId = new Map(source.items.map(line => [line.itemId, line]));
    const previouslyReturned = new Map();
    for (const old of priorReturns) {
        if (old.id === request.id || old.linkedStatementId !== source.id)
            continue;
        if (old.companyId !== companyId || old.partnerId !== source.partnerId || old.status !== 'processed')
            fail('원전표의 기존 반품 연결이 불완전합니다.');
        for (const item of old.items) {
            if (!byId.has(item.itemId) || !Number.isFinite(item.quantity) || item.quantity <= 0)
                fail('기존 반품 수량 근거가 불명확합니다.');
            previouslyReturned.set(item.itemId, ((_a = previouslyReturned.get(item.itemId)) !== null && _a !== void 0 ? _a : 0) + item.quantity);
        }
    }
    if ([...previouslyReturned].some(([itemId, quantity]) => quantity > byId.get(itemId).qty))
        fail('기존 반품 수량이 원전표 수량을 넘습니다.');
    const lines = new Map();
    const add = (accountCode, side, amount) => {
        var _a;
        if (!amount)
            return;
        const key = `${accountCode}/${side}`, previous = lines.get(key);
        lines.set(key, { accountCode, side, amount: ((_a = previous === null || previous === void 0 ? void 0 : previous.amount) !== null && _a !== void 0 ? _a : 0) + amount });
    };
    let supply = 0, tax = 0;
    const stockEffects = [];
    for (const item of request.items) {
        const original = byId.get(item.itemId);
        if (!original)
            throw new returnValidationError_1.ReturnValidationError('반품 수량이 원전표의 남은 수량을 넘습니다.');
        if (original.total <= 0)
            fail('반품 대상 품목의 원전표 금액이 없습니다.');
        if (item.quantity + ((_b = previouslyReturned.get(item.itemId)) !== null && _b !== void 0 ? _b : 0) > original.qty)
            fail('반품 수량이 원전표의 남은 수량을 넘습니다.');
        const partSupply = original.supply * item.quantity / original.qty;
        const partTax = original.tax * item.quantity / original.qty;
        if (!money(partSupply) || !money(partTax))
            fail('부분 반품의 공급가·세액을 정확히 나눌 수 없습니다.');
        supply += partSupply;
        tax += partTax;
        add(original.accountCode, source.type === '매출' ? '차변' : '대변', partSupply);
        if (source.type === '매출' && item.isResellable)
            stockEffects.push({ itemId: item.itemId, quantityDelta: item.quantity });
        if (source.type === '매입')
            stockEffects.push({ itemId: item.itemId, quantityDelta: -item.quantity });
    }
    const amount = supply + tax;
    if (!money(amount) || amount === 0 || request.totalAmount !== amount)
        fail('반품 요청 금액과 원전표 역분개 금액이 다릅니다.');
    if (source.type === '매출') {
        add('255', '차변', tax);
        add('108', '대변', amount);
    }
    else {
        add('135', '대변', tax);
        add(payableCode(source.items.map(line => line.accountCode)), '차변', amount);
    }
    const journalLines = [...lines.values()];
    if (journalLines.reduce((sum, line) => sum + (line.side === '차변' ? line.amount : -line.amount), 0) !== 0)
        fail('반품 역분개의 차변·대변이 맞지 않습니다.');
    return { amount, supply, tax, journalLines, stockEffects };
}
/** 원전표를 건드리지 않는 신규 반품 전표. 품목의 공급가·세액·계정은 접수 시 명시한다. */
function planStandaloneReturn(request) {
    var _a;
    if (!['매출', '매입'].includes(request.returnType) || !Array.isArray(request.items)
        || !request.items.length || new Set(request.items.map(row => row.itemId)).size !== request.items.length)
        fail('반품 종류·품목을 확인해주세요.');
    if (request.returnType === '매입' && !['251', '253'].includes((_a = request.payableAccountCode) !== null && _a !== void 0 ? _a : ''))
        fail('매입 반품의 채무 계정을 선택해주세요.');
    const lines = new Map();
    const add = (accountCode, side, amount) => {
        var _a, _b;
        if (!amount)
            return;
        const key = `${accountCode}/${side}`;
        lines.set(key, { accountCode, side, amount: ((_b = (_a = lines.get(key)) === null || _a === void 0 ? void 0 : _a.amount) !== null && _b !== void 0 ? _b : 0) + amount });
    };
    let supply = 0, tax = 0;
    const stockEffects = [];
    for (const row of request.items) {
        if (!row.itemId || !Number.isFinite(row.quantity) || row.quantity <= 0
            || !money(row.supply) || !money(row.tax) || row.supply + row.tax <= 0
            || !row.accountCode || typeof row.isResellable !== 'boolean')
            fail('반품 수량·금액·계정이 잘못되었습니다.');
        if (request.returnType === '매출' && !row.isResellable)
            fail('폐기 반품의 실물 처리는 아직 준비되지 않았습니다.');
        supply += row.supply;
        tax += row.tax;
        add(row.accountCode, request.returnType === '매출' ? '차변' : '대변', row.supply);
        stockEffects.push({ itemId: row.itemId, quantityDelta: request.returnType === '매출' ? row.quantity : -row.quantity });
    }
    const amount = supply + tax;
    if (!money(supply) || !money(tax) || !money(amount) || amount !== request.totalAmount)
        fail('반품 전표 합계가 품목 금액과 다릅니다.');
    if (request.returnType === '매출') {
        add('255', '차변', tax);
        add('108', '대변', amount);
    }
    else {
        add('135', '대변', tax);
        add(request.payableAccountCode, '차변', amount);
    }
    const journalLines = [...lines.values()];
    if (journalLines.reduce((sum, row) => sum + (row.side === '차변' ? row.amount : -row.amount), 0) !== 0)
        fail('반품 전표 차변·대변이 맞지 않습니다.');
    return { amount, supply, tax, journalLines, stockEffects };
}
//# sourceMappingURL=returnReversalPlan.js.map