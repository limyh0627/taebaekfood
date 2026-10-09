"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PartnerAdvanceValidationError = exports.sourceKey = void 0;
exports.planAdvanceApplication = planAdvanceApplication;
exports.planAdvanceCancellation = planAdvanceCancellation;
exports.isAdvanceStatement = isAdvanceStatement;
exports.activeAdvanceApplications = activeAdvanceApplications;
exports.claimWithoutAdvance = claimWithoutAdvance;
exports.appliedToTargets = appliedToTargets;
exports.claimsAfterAdvance = claimsAfterAdvance;
const sourceKey = (source) => JSON.stringify([source.collection, source.id, source.lineKey]);
exports.sourceKey = sourceKey;
const positive = (n) => Number.isSafeInteger(n) && n > 0;
class PartnerAdvanceValidationError extends Error {
}
exports.PartnerAdvanceValidationError = PartnerAdvanceValidationError;
function fail(message) { throw new PartnerAdvanceValidationError(message); }
const sum = (a, b) => Number.isSafeInteger(a + b) ? a + b : fail('적용액 범위를 초과했습니다.');
const calendarDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(new Date(`${date}T00:00:00Z`).valueOf())
    && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
function planAdvanceApplication(context, request) {
    var _a, _b, _c, _d;
    if (!context.complete || context.unattributedReduction)
        fail('원천의 전체 미사용 근거를 확인해야 합니다.');
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(request.operationId) || !calendarDate(request.date)
        || !request.purpose.trim() || !request.allocations.length)
        fail('적용 날짜·목적·대상을 확인해 주세요.');
    const sources = new Map(context.sources.map(row => [(0, exports.sourceKey)(row.key), row]));
    const targets = new Map(context.targets.map(row => [row.statementId, row]));
    if (sources.size !== context.sources.length || targets.size !== context.targets.length)
        fail('원천·대상 식별자가 중복됩니다.');
    const usedSources = new Map(), usedTargets = new Map();
    const pairs = new Set(), sourceFingerprints = {}, targetFingerprints = {};
    const lines = new Map();
    for (const row of request.allocations) {
        const key = (0, exports.sourceKey)(row.source), source = sources.get(key), target = targets.get(row.statementId);
        const pair = JSON.stringify([key, row.statementId]);
        if (!source || !target || pairs.has(pair) || !positive(row.amount))
            fail('원천·대상·적용액이 잘못되었습니다.');
        pairs.add(pair);
        if (context.blockedSourceKeys.includes(key))
            fail('보류된 원천에는 적용할 수 없습니다.');
        if (source.companyId !== context.companyId || target.companyId !== context.companyId
            || source.partnerId !== context.partnerId || target.partnerId !== context.partnerId)
            fail('회사·거래처가 일치하지 않습니다.');
        if (!source.fingerprint || !target.fingerprint || source.purpose !== request.purpose.trim()
            || target.purpose !== request.purpose.trim())
            fail('거래 목적·원본 근거를 확인해 주세요.');
        if (!calendarDate(source.date) || !calendarDate(target.date)
            || request.date < source.date || request.date < target.date)
            fail('원천·대상 발생 전에는 적용할 수 없습니다.');
        if (row.accountCode !== target.accountCode || !(source.code === '133' && ['251', '253'].includes(target.accountCode)
            || source.code === '254' && target.accountCode === '108'))
            fail('허용되지 않은 계정 짝입니다.');
        const previous = (_a = context.priorSourceUse.get(key)) !== null && _a !== void 0 ? _a : 0;
        if (!Number.isSafeInteger(previous) || previous < 0 || !positive(source.originalAmount)
            || !Number.isSafeInteger(target.remaining) || target.remaining < 0)
            fail('잔량 근거가 잘못되었습니다.');
        const sourceUse = sum((_b = usedSources.get(key)) !== null && _b !== void 0 ? _b : 0, row.amount), targetUse = sum((_c = usedTargets.get(target.statementId)) !== null && _c !== void 0 ? _c : 0, row.amount);
        if (sum(previous, sourceUse) > source.originalAmount || targetUse > target.remaining)
            fail('원천 미사용액 또는 대상 미결액을 넘습니다.');
        usedSources.set(key, sourceUse);
        usedTargets.set(target.statementId, targetUse);
        sourceFingerprints[key] = source.fingerprint;
        targetFingerprints[target.statementId] = target.fingerprint;
        for (const [code, side] of source.code === '133'
            ? [[target.accountCode, '차변'], [source.code, '대변']] : [[source.code, '차변'], [target.accountCode, '대변']]) {
            const lineKey = `${code}:${side}`;
            lines.set(lineKey, sum((_d = lines.get(lineKey)) !== null && _d !== void 0 ? _d : 0, row.amount));
        }
    }
    const allocations = request.allocations.map(row => (Object.assign(Object.assign({}, row), { source: Object.assign({}, row.source) })))
        .sort((a, b) => (0, exports.sourceKey)(a.source).localeCompare((0, exports.sourceKey)(b.source)) || a.statementId.localeCompare(b.statementId));
    const metadata = {
        kind: 'advance-application', version: 1, operationId: request.operationId,
        companyId: context.companyId, partnerId: context.partnerId, purpose: request.purpose.trim(),
        sourceFingerprints, targetFingerprints, allocations,
        // 순수 정규화 입력. 서버는 이 문자열의 SHA256과 저장결과를 함께 확인한다.
        requestFingerprint: JSON.stringify([context.companyId, context.partnerId, request.date, request.purpose.trim(),
            allocations.map(row => [(0, exports.sourceKey)(row.source), row.statementId, row.accountCode, row.amount,
                sourceFingerprints[(0, exports.sourceKey)(row.source)], targetFingerprints[row.statementId]])]),
    };
    const items = [...lines].sort(([a], [b]) => a.localeCompare(b)).map(([key, amount]) => {
        const [accountCode, side] = key.split(':');
        return { name: request.purpose.trim(), spec: '', qty: 1, price: amount, supply: amount, tax: 0,
            total: amount, isTaxExempt: true, accountCode, side: side };
    });
    return { metadata, items, amount: [...usedSources.values()].reduce(sum, 0) };
}
function planAdvanceCancellation(statement, operationId, reason) {
    if (!isAdvanceStatement(statement) || statement.noncashApplication.kind !== 'advance-application'
        || !/^[A-Za-z0-9_-]{1,120}$/.test(operationId) || !reason.trim())
        fail('취소 원본·사유를 확인해 주세요.');
    const metadata = { kind: 'advance-cancellation', version: 1, operationId,
        companyId: statement.noncashApplication.companyId, partnerId: statement.partnerId,
        applicationStatementId: statement.id, applicationFingerprint: statement.noncashApplication.requestFingerprint, reason: reason.trim() };
    return { metadata, items: statement.items.map(row => (Object.assign(Object.assign({}, row), { side: row.side === '차변' ? '대변' : '차변' }))) };
}
/** 적용/취소는 발생 채무가 아니다. 잘못된 꼬리표를 조용히 일반전표로 해석하지 않는다. */
function isAdvanceStatement(statement) {
    var _a, _b, _c, _d, _e, _f, _g;
    const meta = statement.noncashApplication;
    if (meta === undefined)
        return false;
    if (!meta || meta.version !== 1 || !['advance-application', 'advance-cancellation'].includes(meta.kind)
        || meta.companyId !== ((_a = statement.companyId) !== null && _a !== void 0 ? _a : 'taebaek') || meta.partnerId !== statement.partnerId
        || !meta.operationId || statement.type !== '비용')
        fail('비현금 적용 기록을 확인해야 합니다.');
    if (meta.kind === 'advance-application') {
        if (!Array.isArray(meta.allocations) || !meta.allocations.length || !meta.requestFingerprint
            || !((_b = meta.purpose) === null || _b === void 0 ? void 0 : _b.trim()))
            fail('비현금 적용 기록을 확인해야 합니다.');
        const expected = new Map();
        let amount = 0;
        for (const row of meta.allocations) {
            if (!row.source || !['cashEntries', 'issuedStatements'].includes(row.source.collection)
                || !row.source.id || !row.source.lineKey || !row.statementId
                || !['108', '251', '253'].includes(row.accountCode) || !positive(row.amount)
                || !((_c = meta.sourceFingerprints) === null || _c === void 0 ? void 0 : _c[(0, exports.sourceKey)(row.source)]) || !((_d = meta.targetFingerprints) === null || _d === void 0 ? void 0 : _d[row.statementId]))
                fail('비현금 적용 기록을 확인해야 합니다.');
            amount = sum(amount, row.amount);
            const pairs = row.accountCode === '108' ? [['254', '차변'], ['108', '대변']]
                : [[row.accountCode, '차변'], ['133', '대변']];
            for (const [code, side] of pairs) {
                const key = `${code}:${side}`;
                expected.set(key, sum((_e = expected.get(key)) !== null && _e !== void 0 ? _e : 0, row.amount));
            }
        }
        const actual = new Map();
        for (const row of statement.items) {
            const key = `${row.accountCode}:${row.side}`;
            if (!positive(row.total) || row.tax !== 0)
                fail('적용 분개와 기록이 다릅니다.');
            actual.set(key, sum((_f = actual.get(key)) !== null && _f !== void 0 ? _f : 0, row.total));
        }
        if (statement.totalAmount !== amount || actual.size !== expected.size
            || [...expected].some(([key, value]) => actual.get(key) !== value))
            fail('적용 분개와 기록이 다릅니다.');
    }
    else if (!meta.applicationStatementId || !meta.applicationFingerprint || !((_g = meta.reason) === null || _g === void 0 ? void 0 : _g.trim())) {
        fail('취소 원본·사유를 확인해야 합니다.');
    }
    return true;
}
function activeAdvanceApplications(statements, companyId, partnerId) {
    var _a;
    const mine = statements.filter(row => { var _a; return ((_a = row.companyId) !== null && _a !== void 0 ? _a : 'taebaek') === companyId && row.partnerId === partnerId && isAdvanceStatement(row); });
    const byId = new Map(mine.map(row => [row.id, row]));
    if (byId.size !== mine.length)
        fail('적용 기록 ID가 중복됩니다.');
    if (new Set(mine.map(row => row.noncashApplication.operationId)).size !== mine.length)
        fail('적용 작업 ID가 중복됩니다.');
    const cancelled = new Set();
    for (const row of mine) {
        const meta = row.noncashApplication;
        if (meta.kind !== 'advance-cancellation')
            continue;
        const original = (_a = byId.get(meta.applicationStatementId)) === null || _a === void 0 ? void 0 : _a.noncashApplication;
        if (!original || original.kind !== 'advance-application' || original.requestFingerprint !== meta.applicationFingerprint
            || cancelled.has(meta.applicationStatementId))
            fail('취소 원본·중복 취소를 확인해야 합니다.');
        const originalStatement = byId.get(meta.applicationStatementId);
        const lines = (document, reverse) => document.items.map(item => [item.accountCode, reverse ? (item.side === '차변' ? '대변' : '차변') : item.side, item.total, item.tax].join(':')).sort();
        if (row.totalAmount !== originalStatement.totalAmount || row.tradeDate < originalStatement.tradeDate
            || JSON.stringify(lines(row, false)) !== JSON.stringify(lines(originalStatement, true)))
            fail('취소 분개가 원본과 다릅니다.');
        cancelled.add(meta.applicationStatementId);
    }
    return mine.filter(row => row.noncashApplication.kind === 'advance-application' && !cancelled.has(row.id));
}
/** 서버의 기존 claimFromStatement를 주입한다. 적용·취소 모두 새 채무로 만들지 않는다. */
function claimWithoutAdvance(id, statement, adapter) {
    return isAdvanceStatement(statement) ? null : adapter(id, statement);
}
function appliedToTargets(statements, companyId, partnerId, after) {
    var _a;
    const result = new Map();
    const active = activeAdvanceApplications(statements, companyId, partnerId);
    const events = after ? statements.filter(row => { var _a; return ((_a = row.companyId) !== null && _a !== void 0 ? _a : 'taebaek') === companyId && row.partnerId === partnerId && isAdvanceStatement(row); }) : active;
    for (const statement of events) {
        // 앵커 잔량은 그 날짜까지 적용을 이미 포함한다. 이후 적용만 추가 차감한다.
        if (after && statement.tradeDate <= after)
            continue;
        const event = statement.noncashApplication;
        const meta = event.kind === 'advance-application' ? event : statements.find(row => row.id === event.applicationStatementId).noncashApplication;
        const sign = event.kind === 'advance-cancellation' ? -1 : 1;
        for (const row of meta.allocations) {
            const old = result.get(row.statementId);
            if (old && old.accountCode !== row.accountCode)
                throw new Error('대상 계정이 서로 다릅니다.');
            const amount = ((_a = old === null || old === void 0 ? void 0 : old.amount) !== null && _a !== void 0 ? _a : 0) + sign * row.amount;
            if (!Number.isSafeInteger(row.amount) || row.amount <= 0 || !Number.isSafeInteger(amount))
                throw new Error('적용액이 잘못되었습니다.');
            result.set(row.statementId, { accountCode: row.accountCode, amount });
        }
    }
    return result;
}
/** 반품 투영 이후, 현금 배분 전에 한 번만 호출한다. 원본 분개 입력에는 사용하지 않는다. */
function claimsAfterAdvance(claims, statements, companyId, partnerId) {
    const used = appliedToTargets(statements, companyId, partnerId);
    const byId = new Map(claims.map(row => [row.id, row]));
    for (const [id, row] of used) {
        const claim = byId.get(id);
        if (!claim || claim.companyId !== companyId || claim.partnerId !== partnerId || claim.accountCode !== row.accountCode
            || !Number.isSafeInteger(claim.amount) || row.amount > claim.amount)
            throw new Error('대상 원전표·계정·미결을 확인해야 합니다.');
    }
    return claims.map(claim => { var _a, _b; return (Object.assign(Object.assign({}, claim), { amount: claim.amount - ((_b = (_a = used.get(claim.id)) === null || _a === void 0 ? void 0 : _a.amount) !== null && _b !== void 0 ? _b : 0) })); });
}
//# sourceMappingURL=partnerAdvance.js.map