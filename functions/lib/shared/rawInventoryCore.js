"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inventoryDocId = exports.DEPLETED_RETENTION = void 0;
exports.operationDocId = operationDocId;
exports.legacyOperationDocId = legacyOperationDocId;
exports.commandHash = commandHash;
exports.emptyRawInventory = emptyRawInventory;
exports.applyRawCommand = applyRawCommand;
const rawLot_1 = require("./rawLot");
const r3 = (n) => Math.round(n * 1000) / 1000;
/** 소진 로트를 얼마나 들고 있을지 — 문서가 커지면 FIFO 가 아니라 문서 한도가 먼저 걸린다(§3). */
exports.DEPLETED_RETENTION = 40;
/**
 * Firestore 문서 id 로 쓸 수 있게 다듬는다.
 *
 * **치환·잘라내기는 충돌한다** — `/` 를 `_` 로 바꾸면 `po1/x` 와 `po1_x` 가 한 문서가 되고,
 * 400자에서 자르면 앞이 같은 두 작업이 겹친다. 겹치면 뒤에 온 작업이 `duplicate` 로 조용히
 * 사라진다(§7). 그래서 사람이 읽을 수 있는 앞부분 + 원본 전체의 **해시**로 만든다.
 * 원본은 문서 안 `operationId` 필드에 그대로 남는다.
 */
function operationDocId(operationId) {
    const encoded = base64Url(operationId);
    // Firestore 문서 id 한도(1,500 bytes)보다 여유 있게 둔다. 보통 id 는 원문 전체를
    // 가역 인코딩하므로 서로 다른 값이 절대 겹치지 않는다. 비정상적으로 긴 id 만 고정 길이
    // 지문으로 줄인다.
    return encoded.length <= 1400 ? `op_${encoded}` : `op_long_${fingerprint128(operationId)}`;
}
/** 5단계 초기에 쓰던 문서 id. 이미 기록된 명령을 새 id 로 다시 먹지 않게 서비스가 같이 읽는다. */
function legacyOperationDocId(operationId) {
    const safe = operationId.replace(/[/\\.#$[\]]/g, '_').slice(0, 400);
    return safe === '' || /^__.*__$/.test(safe) ? `op_${safe}` : safe;
}
/** 명령의 내용을 hash 한다 — 같은 id 인데 내용이 다르면 `conflict` 로 잡히도록. */
function commandHash(c) {
    // 객체 키 순서에 흔들리지 않게 정렬한다. 짧은 32-bit hash는 충돌하면 서로 다른 명령을
    // duplicate로 오인하므로, 정규화한 명령 전체를 가역 인코딩해 비교한다.
    return `v1_${base64Url(stableStringify(hashPayload(c)))}`;
}
/** hash 대상만 뽑는다 — 기록 작성자(actor)는 빼되 재고 결과를 바꾸는 backdatedIntent는 넣는다. */
function hashPayload(c) {
    var _a, _b, _c;
    const base = {
        kind: c.kind,
        operationId: c.operationId,
        companyId: c.companyId,
        rawItemId: c.rawItemId,
        effectiveAt: c.effectiveAt,
        backdatedIntent: (_a = c.backdatedIntent) !== null && _a !== void 0 ? _a : null,
        source: c.source,
    };
    switch (c.kind) {
        case 'receive':
            return Object.assign(Object.assign({}, base), { kg: r3(c.kg), lot: sortedLot(c.lot) });
        case 'opening':
            return Object.assign(Object.assign({}, base), { kg: r3(c.kg), supplierName: (_b = c.supplierName) !== null && _b !== void 0 ? _b : '' });
        case 'consume':
            return Object.assign(Object.assign({}, base), { kg: r3(c.kg), mix: (_c = c.mix) !== null && _c !== void 0 ? _c : null });
        case 'consume-lot':
            return Object.assign(Object.assign({}, base), { kg: r3(c.kg), lotId: c.lotId });
        case 'ledger-consume':
            return Object.assign(Object.assign({}, base), { kg: r3(c.kg) });
        case 'stocktake':
            return Object.assign(Object.assign({}, base), { targetKg: r3(c.targetKg) });
        case 'adjust-lot':
            return Object.assign(Object.assign({}, base), { lotId: c.lotId, targetKg: r3(c.targetKg) });
        case 'deplete-lot':
            return Object.assign(Object.assign({}, base), { lotId: c.lotId });
        case 'merge-lots':
            return Object.assign(Object.assign({}, base), { sourceLotId: c.sourceLotId, targetLotId: c.targetLotId });
        case 'reverse':
            return Object.assign(Object.assign({}, base), { originalOperationId: c.originalOperationId });
    }
}
function sortedLot(lot) {
    var _a, _b, _c, _d, _e;
    return {
        supplierId: (_a = lot.supplierId) !== null && _a !== void 0 ? _a : '',
        supplierName: lot.supplierName,
        packageType: (_b = lot.packageType) !== null && _b !== void 0 ? _b : '',
        packageKg: (_c = lot.packageKg) !== null && _c !== void 0 ? _c : 0,
        qtyIn: (_d = lot.qtyIn) !== null && _d !== void 0 ? _d : 0,
        poId: (_e = lot.poId) !== null && _e !== void 0 ? _e : '',
    };
}
function stableStringify(v) {
    if (v === null || typeof v !== 'object')
        return JSON.stringify(v);
    if (Array.isArray(v))
        return '[' + v.map(stableStringify).join(',') + ']';
    const keys = Object.keys(v).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}
function base64Url(s) {
    const bytes = new TextEncoder().encode(s);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i];
        const b = bytes[i + 1];
        const c = bytes[i + 2];
        out += alphabet[a >> 2];
        out += alphabet[((a & 3) << 4) | (b === undefined ? 0 : b >> 4)];
        if (b !== undefined)
            out += alphabet[((b & 15) << 2) | (c === undefined ? 0 : c >> 6)];
        if (c !== undefined)
            out += alphabet[c & 63];
    }
    return out;
}
/** 아주 긴 operationId만 줄일 때 쓰는 128-bit 결정적 지문. */
function fingerprint128(s) {
    const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
    return seeds.map(seed => {
        let h = seed >>> 0;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h.toString(16).padStart(8, '0');
    }).join('');
}
const inventoryDocId = (companyId, rawItemId) => `${companyId}__${rawItemId}`;
exports.inventoryDocId = inventoryDocId;
/** 빈 상태 — 아직 문서가 없는 원료. */
function emptyRawInventory(companyId, rawItemId, materialSnapshot, now) {
    return {
        id: (0, exports.inventoryDocId)(companyId, rawItemId),
        companyId, rawItemId, materialSnapshot,
        stockKg: 0, activeLots: [], recentDepletedLots: [],
        revision: 0, lastProcessedAt: now,
    };
}
// ─────────────────────────────────────────────────────────────────────────────
//  계산
// ─────────────────────────────────────────────────────────────────────────────
const lotSum = (lots) => r3(lots.reduce((a, l) => { var _a; return a + Number((_a = l.kgRemaining) !== null && _a !== void 0 ? _a : 0); }, 0));
/** 활성/소진을 갈라 담는다. FIFO 순서는 활성 배열이 그대로 지킨다. */
function partition(worked, prevDepleted) {
    const active = worked.filter(l => l.status !== 'depleted');
    const justDepleted = worked.filter(l => l.status === 'depleted');
    //  새로 소진된 것을 앞에 둔다 — 보존기간에서 잘려나가는 건 가장 오래된 쪽이어야 한다.
    const depleted = [...justDepleted, ...prevDepleted].slice(0, exports.DEPLETED_RETENTION);
    return { activeLots: active, recentDepletedLots: depleted };
}
/** 앞뒤 로트 배열을 견줘 움직인 것만 뽑는다. */
function changesBetween(before, after) {
    var _a, _b;
    const prev = new Map(before.map(l => [l.id, l]));
    const out = [];
    for (const l of after) {
        const was = prev.get(l.id);
        const beforeKg = Number((_a = was === null || was === void 0 ? void 0 : was.kgRemaining) !== null && _a !== void 0 ? _a : 0);
        const nowKg = Number((_b = l.kgRemaining) !== null && _b !== void 0 ? _b : 0);
        const d = r3(nowKg - beforeKg);
        if (d === 0 && prev.has(l.id))
            continue;
        //  스냅샷은 그 명령 직전의 로트다 — 없던 로트(입고로 새로 선 것)면 잔량 0 짜리 자기 자신.
        const snap = was !== null && was !== void 0 ? was : Object.assign(Object.assign({}, l), { kgRemaining: 0, status: 'active' });
        out.push({
            lotId: l.id, supplierName: l.supplierName, lotNo: l.lotNo, receivedDate: l.receivedDate,
            deltaKg: d, beforeKg: r3(beforeKg), afterKg: r3(nowKg), lotSnapshot: snap,
        });
    }
    return out;
}
/**
 * **명령 하나를 상태에 적용한다.** 순수 함수 — 같은 입력이면 언제나 같은 결과다.
 *
 * @param state    지금 상태. 없으면 null(첫 문서).
 * @param existing 같은 `operationId` 로 이미 저장된 이력. hash 가 같으면 `duplicate`, 다르면 `conflict`.
 * @param original `reverse` 가 되돌릴 원본 이력.
 * @param guard    원본을 이미 취소한 표. 있으면 `ALREADY_REVERSED` 로 거절.
 */
function applyRawCommand(input) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const { command: c, existing, original, guard, det } = input;
    const hash = commandHash(c);
    //  ① 이미 먹은 작업이면 hash 를 견준다. 같으면 duplicate, 다르면 conflict — 조용히 통과 X.
    if (existing) {
        // 5단계 초기에 저장된 이력에는 commandHash가 없다. 내용 비교가 불가능하므로 재적용해
        // 수량을 두 번 움직이는 것보다 기존 작업으로 보는 편이 안전하다.
        return !existing.commandHash || existing.commandHash === hash
            ? { status: 'duplicate', movement: existing }
            : { status: 'conflict', movement: existing };
    }
    const state = (_a = input.state) !== null && _a !== void 0 ? _a : emptyRawInventory(c.companyId, c.rawItemId, c.materialSnapshot, det.now);
    //  ② 회사·품목이 다르면 거절한다. 이름이 같은 태백·풍회 원료가 서로를 깎던 자리다.
    if (state.companyId !== c.companyId || state.rawItemId !== c.rawItemId) {
        return {
            status: 'rejected', code: 'COMPANY_MISMATCH',
            message: `대상이 다르다: 상태 ${state.companyId}/${state.rawItemId} ≠ 명령 ${c.companyId}/${c.rawItemId}`,
        };
    }
    const sequence = state.revision + 1;
    const base = Object.assign(Object.assign({ id: operationDocId(c.operationId), operationId: c.operationId, commandHash: hash, companyId: c.companyId, rawItemId: c.rawItemId, materialSnapshot: c.materialSnapshot, effectiveAt: c.effectiveAt, recordedAt: det.now, sequence, source: c.source }, (c.actorId ? { actorId: c.actorId } : {})), (c.actorName ? { actorName: c.actorName } : {}));
    const validateBalances = (activeLots, stockKg) => {
        var _a;
        // 기존 음수는 입고·실사·상계로 회복할 수 있어야 한다. 다만 정상 잔량을 새 음수로
        // 만들거나 기존 음수를 더 악화시키는 명령은 같은 트랜잭션 안에서 거절한다.
        const beforeLots = new Map(state.activeLots.map(lot => { var _a; return [lot.id, Number((_a = lot.kgRemaining) !== null && _a !== void 0 ? _a : 0)]; }));
        const worsenedLot = activeLots.find(lot => {
            var _a;
            const before = (_a = beforeLots.get(lot.id)) !== null && _a !== void 0 ? _a : 0;
            return lot.kgRemaining < 0 && r3(lot.kgRemaining) < Math.min(0, r3(before));
        });
        if (worsenedLot) {
            return {
                status: 'rejected', code: 'INSUFFICIENT_STOCK',
                message: `로트 ${(_a = worsenedLot.lotNo) !== null && _a !== void 0 ? _a : worsenedLot.id}의 부족량 ${r3(-worsenedLot.kgRemaining)}kg: 음수 잔량을 새로 만들거나 늘릴 수 없다`,
            };
        }
        if (stockKg < 0 && r3(stockKg) < Math.min(0, r3(state.stockKg))) {
            return {
                status: 'rejected', code: 'INSUFFICIENT_STOCK',
                message: `원료 재고 부족량 ${r3(-stockKg)}kg: 현재 ${state.stockKg}kg에서 이 명령을 적용할 수 없다`,
            };
        }
        return null;
    };
    const commit = (kind, worked, lotChanges, reportedDeltaKg, extra = {}) => {
        const split = partition(worked, state.recentDepletedLots);
        const stockKg = lotSum(split.activeLots);
        const balanceError = validateBalances(split.activeLots, stockKg);
        if (balanceError)
            return balanceError;
        const nextState = Object.assign(Object.assign(Object.assign(Object.assign({}, state), split), { materialSnapshot: c.materialSnapshot, stockKg, revision: sequence, lastProcessedAt: det.now }), (kind === 'stocktake'
            ? { stocktakeAnchor: { effectiveAt: c.effectiveAt, operationId: c.operationId, sequence } }
            : {}));
        const movement = Object.assign(Object.assign(Object.assign({}, base), { kind, reportedDeltaKg: r3(reportedDeltaKg), appliedDeltaKg: r3(stockKg - state.stockKg), balanceAfterKg: stockKg, lotChanges }), extra);
        return { status: 'applied', state: nextState, movement };
    };
    /**
     * ③ 소급 판정 — `effectiveAt < anchor.effectiveAt` 일 때만 소급이다(§10).
     *    **같은 시각은 실사 뒤로 본다.** 그날 것을 그날 넣는 게 가장 흔한 입력이라, 같으면
     *    소급으로 치면 실사 당일 사용이 영영 재고에 안 잡힌다.
     *    화면이 `backdatedIntent: 'before'` 를 명시하면 그 뜻대로 소급 처리한다.
     */
    const anchor = state.stocktakeAnchor;
    const 시각소급 = anchor != null && c.effectiveAt < anchor.effectiveAt;
    const backdated = c.backdatedIntent === 'before' ? true
        : c.backdatedIntent === 'after' ? false
            : 시각소급;
    const recordWithoutStock = (kind, reportedDeltaKg, backdatedBeforeStocktake = false) => {
        return {
            status: 'applied',
            state: Object.assign(Object.assign({}, state), { revision: sequence, lastProcessedAt: det.now }),
            movement: Object.assign(Object.assign(Object.assign({}, base), { kind, reportedDeltaKg: r3(reportedDeltaKg), appliedDeltaKg: 0, balanceAfterKg: state.stockKg, lotChanges: [] }), (backdatedBeforeStocktake ? { backdatedBeforeStocktake: true } : {})),
        };
    };
    //  소급 이력도 `revision` 은 올린다(설계 §4·§10). 잔량만 안 움직인다.
    const skipBackdated = (kind, reportedDeltaKg) => recordWithoutStock(kind, reportedDeltaKg, true);
    const working = [...state.activeLots];
    switch (c.kind) {
        case 'receive':
        case 'opening': {
            const kg = r3(c.kg);
            if (!(kg > 0))
                return { status: 'rejected', code: 'INVALID_QUANTITY', message: '입고 수량은 0보다 커야 한다' };
            if (backdated)
                return skipBackdated(c.kind, kg);
            if (!det.newLotId)
                return { status: 'rejected', code: 'MISSING_LOT_ID', message: '새 로트 id 를 밖에서 정해 넘겨야 한다' };
            const lotIn = c.kind === 'receive'
                ? c.lot
                : { supplierName: (_b = c.supplierName) !== null && _b !== void 0 ? _b : '이월' };
            const lot = (0, rawLot_1.buildReceiveLot)({
                material: c.materialSnapshot,
                supplierId: lotIn.supplierId,
                supplierName: lotIn.supplierName,
                packageType: lotIn.packageType,
                packageKg: lotIn.packageKg,
                qtyIn: (_c = lotIn.qtyIn) !== null && _c !== void 0 ? _c : 0,
                kgIn: kg,
                receivedDate: c.effectiveAt.slice(0, 10),
                poId: lotIn.poId,
                id: det.newLotId,
                createdAt: det.now,
            });
            //  음수 이월과 새 입고는 사람이 로트 합치기로 검증하기 전까지 각각 보존한다.
            //  둘의 합은 그대로 총재고에 반영되므로 자동 상계가 없어도 재고를 두 번 세지 않는다.
            const after = [...working, Object.assign(Object.assign({}, lot), { lotNo: (0, rawLot_1.nextLotNo)(working, lot.receivedDate) })];
            return commit(c.kind, after, changesBetween(working, after), kg);
        }
        case 'consume': {
            const kg = r3(c.kg);
            if (!(kg > 0))
                return { status: 'rejected', code: 'INVALID_QUANTITY', message: '사용 수량은 0보다 커야 한다' };
            if (backdated)
                return skipBackdated('consume', -kg);
            const stockShortage = r3(Math.max(0, kg - Math.max(0, state.stockKg)));
            if (stockShortage > 0)
                return {
                    status: 'rejected', code: 'INSUFFICIENT_STOCK',
                    message: `원료 재고 ${state.stockKg}kg, 사용량 ${kg}kg, 부족량 ${stockShortage}kg`,
                };
            const { lots: after, shortageKg } = (0, rawLot_1.deductFromLots)(working, kg, c.mix);
            if (shortageKg > 0)
                return {
                    status: 'rejected', code: 'INSUFFICIENT_STOCK',
                    message: `사용 가능한 로트 부족량 ${shortageKg}kg`,
                };
            return commit('consume', after, changesBetween(working, after), -kg);
        }
        case 'consume-lot': {
            const kg = r3(c.kg);
            if (!(kg > 0))
                return { status: 'rejected', code: 'INVALID_QUANTITY', message: '사용 수량은 0보다 커야 한다' };
            if (backdated)
                return skipBackdated('consume-lot', -kg);
            const idx = working.findIndex(lot => lot.id === c.lotId);
            if (idx < 0)
                return { status: 'rejected', code: 'LOT_NOT_FOUND', message: `사용할 활성 로트가 없다: ${c.lotId}` };
            const available = Number((_d = working[idx].kgRemaining) !== null && _d !== void 0 ? _d : 0);
            if (available < kg)
                return { status: 'rejected', code: 'INSUFFICIENT_STOCK', message: `선택 로트 잔량 ${available}kg, 사용량 ${kg}kg, 부족량 ${r3(kg - Math.max(0, available))}kg` };
            if (state.stockKg < kg)
                return { status: 'rejected', code: 'INSUFFICIENT_STOCK', message: `원료 재고 ${state.stockKg}kg, 사용량 ${kg}kg, 부족량 ${r3(kg - Math.max(0, state.stockKg))}kg` };
            const after = working.map((lot, index) => index === idx
                ? Object.assign(Object.assign({}, lot), { kgRemaining: r3(available - kg), status: r3(available - kg) === 0 ? 'depleted' : 'active' }) : lot);
            return commit('consume-lot', after, changesBetween(working, after), -kg, { targetLotId: c.lotId });
        }
        case 'ledger-consume': {
            const kg = r3(c.kg);
            if (!(kg > 0))
                return { status: 'rejected', code: 'INVALID_QUANTITY', message: '원장 사용 수량은 0보다 커야 한다' };
            // 임가공 완제품은 자기 제품 로트에서 이미 빠진다. 원료 로트를 또 빼면 이중 차감이므로
            // 현재 상태는 그대로 두고, 원료수불부가 읽을 사용 이력만 한 순번으로 남긴다.
            return recordWithoutStock('ledger-consume', -kg);
        }
        case 'stocktake': {
            const target = r3(c.targetKg);
            if (!Number.isFinite(target))
                return { status: 'rejected', code: 'TARGET_MISMATCH', message: '실사 목표량이 숫자가 아니다' };
            const delta = r3(target - state.stockKg);
            //  실사는 소급 판정을 받지 않는다 — 실사 자체가 새 앵커다.
            const stocktakeExtra = { targetKg: target, stocktakeAnchorBefore: state.stocktakeAnchor };
            if (Math.abs(delta) < 0.0001)
                return commit('stocktake', working, [], 0, stocktakeExtra);
            if (delta > 0) {
                if (!det.newLotId)
                    return { status: 'rejected', code: 'MISSING_LOT_ID', message: '새 로트 id 를 밖에서 정해 넘겨야 한다' };
                const lot = (0, rawLot_1.buildReceiveLot)({
                    material: c.materialSnapshot, supplierName: '재고실사', qtyIn: 0, kgIn: delta,
                    receivedDate: c.effectiveAt.slice(0, 10), id: det.newLotId, createdAt: det.now,
                });
                //  실사로 생긴 양수 로트도 음수 이월과 자동 상계하면 출처 확인 전에 이력이 사라진다.
                const after = [...working, Object.assign(Object.assign({}, lot), { lotNo: (0, rawLot_1.nextLotNo)(working, lot.receivedDate) })];
                return commit('stocktake', after, changesBetween(working, after), delta, stocktakeExtra);
            }
            const { lots: after, shortageKg } = (0, rawLot_1.deductFromLots)(working, -delta);
            if (shortageKg > 0)
                return {
                    status: 'rejected', code: 'INSUFFICIENT_STOCK',
                    message: `실사 차감에 사용할 로트 부족량 ${shortageKg}kg`,
                };
            return commit('stocktake', after, changesBetween(working, after), delta, stocktakeExtra);
        }
        case 'adjust-lot': {
            const target = r3(c.targetKg);
            if (!Number.isFinite(target))
                return { status: 'rejected', code: 'TARGET_MISMATCH', message: '로트 실사 목표량이 숫자가 아니다' };
            const idx = working.findIndex(lot => lot.id === c.lotId);
            if (idx < 0)
                return { status: 'rejected', code: 'LOT_NOT_FOUND', message: `정정할 활성 로트가 없다: ${c.lotId}` };
            const before = Number((_e = working[idx].kgRemaining) !== null && _e !== void 0 ? _e : 0);
            const delta = r3(target - before);
            const after = working.map((lot, index) => index === idx
                ? Object.assign(Object.assign({}, lot), { kgRemaining: target, status: target === 0 ? 'depleted' : 'active' }) : lot);
            return commit('adjust-lot', after, changesBetween(working, after), delta, {
                targetLotId: c.lotId,
                targetLotKg: target,
            });
        }
        case 'deplete-lot': {
            const idx = working.findIndex(l => l.id === c.lotId);
            if (idx < 0)
                return { status: 'rejected', code: 'LOT_NOT_FOUND', message: `활성 로트에 없다: ${c.lotId}` };
            const gone = working[idx];
            const removed = r3(Number((_f = gone.kgRemaining) !== null && _f !== void 0 ? _f : 0));
            //  hard delete 하지 않는다 — 소진 처리하고 이력을 남긴다(§9).
            const after = working.map((l, i) => (i === idx ? Object.assign(Object.assign({}, l), { kgRemaining: 0, status: 'depleted' }) : l));
            return commit('deplete-lot', after, [{
                    lotId: gone.id, supplierName: gone.supplierName, lotNo: gone.lotNo,
                    receivedDate: gone.receivedDate, deltaKg: r3(-removed),
                    beforeKg: removed, afterKg: 0, lotSnapshot: Object.assign({}, gone),
                }], -removed);
        }
        case 'merge-lots': {
            if (c.sourceLotId === c.targetLotId) {
                return { status: 'rejected', code: 'TARGET_MISMATCH', message: '같은 로트끼리는 합칠 수 없다' };
            }
            const sourceIdx = working.findIndex(l => l.id === c.sourceLotId);
            const targetIdx = working.findIndex(l => l.id === c.targetLotId);
            if (sourceIdx < 0 || targetIdx < 0) {
                return { status: 'rejected', code: 'LOT_NOT_FOUND', message: '합칠 활성 로트를 찾을 수 없다' };
            }
            const source = working[sourceIdx];
            const target = working[targetIdx];
            const mergedKg = r3(Number((_g = source.kgRemaining) !== null && _g !== void 0 ? _g : 0) + Number((_h = target.kgRemaining) !== null && _h !== void 0 ? _h : 0));
            const after = working.map((lot, idx) => {
                if (idx === sourceIdx)
                    return Object.assign(Object.assign({}, lot), { kgRemaining: 0, status: 'depleted' });
                if (idx !== targetIdx)
                    return lot;
                return Object.assign(Object.assign({}, lot), { kgRemaining: mergedKg, status: mergedKg === 0 ? 'depleted' : 'active' });
            });
            // 합치기는 총재고를 바꾸지 않는다. 어느 로트로 모았는지는 두 로트의 변화 이력으로 남긴다.
            return commit('merge-lots', after, changesBetween(working, after), 0);
        }
        case 'reverse': {
            if (!original)
                return { status: 'rejected', code: 'ORIGINAL_NOT_FOUND', message: `되돌릴 원본이 없다: ${c.originalOperationId}` };
            if (original.operationId !== c.originalOperationId) {
                return { status: 'rejected', code: 'ORIGINAL_MISMATCH', message: '요청한 작업과 읽어 온 원본이 다르다' };
            }
            if (original.companyId !== c.companyId || original.rawItemId !== c.rawItemId) {
                return { status: 'rejected', code: 'COMPANY_MISMATCH', message: '원본이 다른 회사·품목이다' };
            }
            if (original.kind === 'reverse')
                return { status: 'rejected', code: 'CANNOT_REVERSE_REVERSAL', message: '되돌리기를 또 되돌릴 수 없다' };
            // 실사는 이후 입력의 소급 기준이다. 뒤에 움직임이 쌓인 뒤 앵커만 되돌리면 이미 처리한
            // 명령들의 의미가 바뀌므로, 실사가 가장 마지막 movement일 때만 취소한다.
            if (original.kind === 'stocktake' && state.revision !== original.sequence) {
                return { status: 'rejected', code: 'STOCKTAKE_HAS_FOLLOWING_MOVEMENT', message: '이 실사 뒤에 다른 입출고가 있어 취소할 수 없다' };
            }
            //  guard 는 원본당 하나 — id 가 다른 두 번째 취소를 여기서 막는다(§9).
            if (guard && guard.reverseOperationId !== c.operationId) {
                return { status: 'rejected', code: 'ALREADY_REVERSED', message: `이미 취소된 원본이다: ${c.originalOperationId}` };
            }
            const newGuard = {
                id: operationDocId(original.operationId),
                originalOperationId: original.operationId,
                reverseOperationId: c.operationId,
                companyId: c.companyId,
                rawItemId: c.rawItemId,
                createdAt: det.now,
            };
            if (original.backdatedBeforeStocktake || original.appliedDeltaKg === 0) {
                //  재고를 안 움직인 줄이라 되돌릴 것도 없다. 이력만 남기고 guard 는 세운다.
                const r = commit('reverse', working, [], r3(-original.reportedDeltaKg), { reversalOf: original.operationId });
                if (r.status !== 'applied')
                    return r;
                const reversedState = original.kind === 'stocktake'
                    ? Object.assign(Object.assign({}, r.state), { stocktakeAnchor: original.stocktakeAnchorBefore }) : r.state;
                return Object.assign(Object.assign({}, r), { state: reversedState, guard: newGuard });
            }
            //  원본이 적은 로트 그대로 되돌린다 — FIFO 로 다시 계산하면 다른 로트가 움직인다.
            //  **되돌리기의 유일한 근거는 이력의 `lotSnapshot` 이다** — 상태의 recentDepletedLots 를 쓰지 않는다.
            const byId = new Map(working.map((l, i) => [l.id, i]));
            const next = working.map(l => (Object.assign({}, l)));
            const revived = [];
            const changes = [];
            for (const ch of original.lotChanges) {
                const back = r3(-ch.deltaKg);
                if (back === 0)
                    continue;
                const i = byId.get(ch.lotId);
                if (i != null) {
                    const l = next[i];
                    const before = Number((_j = l.kgRemaining) !== null && _j !== void 0 ? _j : 0);
                    const now = r3(before + back);
                    //  입고 취소는 **남은 양 안에서만** — 이미 쓴 것까지 지우면 재고가 사라진다(§9).
                    if (back < 0 && now < 0) {
                        return { status: 'rejected', code: 'RECEIPT_CONSUMED', message: `이미 사용된 입고는 취소할 수 없다: 로트 ${ch.lotId}` };
                    }
                    l.kgRemaining = now;
                    if (now > 0)
                        l.status = 'active';
                    else
                        l.status = 'depleted';
                    changes.push({
                        lotId: l.id, supplierName: l.supplierName, lotNo: l.lotNo,
                        receivedDate: l.receivedDate, deltaKg: back, beforeKg: r3(before), afterKg: now,
                        lotSnapshot: Object.assign(Object.assign({}, l), { kgRemaining: before, status: before > 0 ? 'active' : 'depleted' }),
                    });
                    continue;
                }
                //  상태에서 물러난 로트 — 이력의 스냅샷으로 되살린다(**40개 캐시에 의존하지 않는다**).
                const snap = ch.lotSnapshot;
                if (!snap)
                    return { status: 'rejected', code: 'LOT_NOT_FOUND', message: `되돌릴 로트를 찾지 못했다: ${ch.lotId}` };
                if (back < 0)
                    return { status: 'rejected', code: 'RECEIPT_CONSUMED', message: `이미 사용된 입고는 취소할 수 없다: 로트 ${ch.lotId}` };
                const l = Object.assign(Object.assign({}, snap), { kgRemaining: back, status: 'active' });
                revived.push(l);
                changes.push({
                    lotId: l.id, supplierName: l.supplierName, lotNo: l.lotNo,
                    receivedDate: l.receivedDate, deltaKg: back, beforeKg: 0, afterKg: back,
                    lotSnapshot: Object.assign(Object.assign({}, snap), { kgRemaining: 0, status: 'depleted' }),
                });
            }
            //  되살린 로트는 앞(먼저 쓸 자리)에 — 원래 그 자리에 있던 오래된 로트다.
            const after = [...revived, ...next];
            const keptDepleted = state.recentDepletedLots.filter(l => !revived.some(rv => rv.id === l.id));
            const split = partition(after, keptDepleted);
            const stockKg = lotSum(split.activeLots);
            const balanceError = validateBalances(split.activeLots, stockKg);
            if (balanceError)
                return balanceError;
            return {
                status: 'applied',
                state: Object.assign(Object.assign(Object.assign(Object.assign({}, state), split), { materialSnapshot: c.materialSnapshot, stockKg, revision: sequence, lastProcessedAt: det.now }), (original.kind === 'stocktake' ? { stocktakeAnchor: original.stocktakeAnchorBefore } : {})),
                movement: Object.assign(Object.assign({}, base), { kind: 'reverse', reportedDeltaKg: r3(-original.reportedDeltaKg), appliedDeltaKg: r3(stockKg - state.stockKg), balanceAfterKg: stockKg, lotChanges: changes, reversalOf: original.operationId }),
                guard: newGuard,
            };
        }
    }
}
//# sourceMappingURL=rawInventoryCore.js.map