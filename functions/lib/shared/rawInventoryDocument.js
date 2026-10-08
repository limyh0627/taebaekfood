"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toLedgerDoc = toLedgerDoc;
exports.normalizeRawInventoryState = normalizeRawInventoryState;
exports.normalizeRawMovement = normalizeRawMovement;
exports.rawMirrorMatches = rawMirrorMatches;
/** 이력 + 옛 칸을 한 문서로. 저장은 이 모양으로 한다. */
function toLedgerDoc(m, legacy = {}) {
    var _a;
    //  실사는 잔량을 targetKg 로 다시 잡는 앵커라 입고·사용 합계를 안 건드린다(앱의 실사와 같은 모양).
    const 실사 = m.kind === 'stocktake';
    const d = m.reportedDeltaKg;
    /**
     * **개봉은 입고도 사용도 아니다 — 실사와 같이 합계를 안 건드린다**(2026-09-16).
     *
     * 2026-09-16 사장님: "캔으로 구매해서 입고할 때 이미 입고로 반영되니까 캔 벌크로
     * 까거나 해도 상관없지 않나".
     *
     * **맞다.** 원료수불부는 원료가 창고에 **들어오고 나간 것**을 적는 장부다. 캔에
     * 담겼든 포대에 담겼든 원료는 원료라, 캔으로 사도 입고는 그날 이미 적혔다.
     * 까는 것은 창고 **안에서** 포장만 바꾸는 일이라 원료가 들어오지도 나가지도 않는다 —
     * **총 kg 이 안 변한다.** 입고로 적으면 사지도 않은 것을 산 것이 되고, 사용 음수로
     * 적으면 쓰지도 않은 것을 무른 것이 된다. 어느 쪽이든 관청에 내는 서류가 틀어진다.
     *
     * 그래도 **줄은 남긴다**(0 으로). 누가 언제 몇 캔 깠는지 못 보면 재고가 어긋났을 때
     * 짚을 데가 없다. 실사가 잔량만 다시 잡고 합계를 안 건드리는 것과 같은 모양이다.
     *
     * 안 깐 캔이 몇 개인지는 **포장 현황**(캔 품목 재고)이 들고 있다 — 원료수불부와
     * 다른 장부다. 둘을 더하면 늘 같은 kg 이 나온다.
     */
    const 개봉 = ((_a = m.source) === null || _a === void 0 ? void 0 : _a.type) === 'unpack';
    return Object.assign(Object.assign(Object.assign({}, m), { date: m.effectiveAt.slice(0, 10), material: m.materialSnapshot, received: (실사 || 개봉) ? 0 : (d > 0 ? d : 0), used: (실사 || 개봉) ? 0 : (d < 0 ? -d : 0), unit: 'kg' }), legacy);
}
/** 4·5단계에서 이미 만든 문서를 새 필드명으로 안전하게 읽는다. DB 직접 수정은 하지 않는다. */
function normalizeRawInventoryState(data) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const legacyDate = typeof data.lastStocktakeDate === 'string' ? data.lastStocktakeDate : undefined;
    const stocktakeAnchor = (_a = data.stocktakeAnchor) !== null && _a !== void 0 ? _a : (legacyDate ? {
        // 옛 자료에는 시각이 없었다. 당시 규칙(그 날짜 전체를 실사 전으로 봄)을 보존하고,
        // 새 실사부터 버튼을 누른 정확한 시각으로 교체한다.
        effectiveAt: `${legacyDate}T23:59:59.999+09:00`,
        operationId: String((_b = data.lastStocktakeOperationId) !== null && _b !== void 0 ? _b : `legacy-stocktake:${legacyDate}`),
        sequence: Number((_c = data.version) !== null && _c !== void 0 ? _c : 0),
    } : undefined);
    return Object.assign(Object.assign({ id: String(data.id), companyId: data.companyId, rawItemId: String(data.rawItemId), materialSnapshot: String((_d = data.materialSnapshot) !== null && _d !== void 0 ? _d : ''), stockKg: Number((_e = data.stockKg) !== null && _e !== void 0 ? _e : 0), activeLots: Array.isArray(data.activeLots) ? data.activeLots : [], recentDepletedLots: Array.isArray(data.recentDepletedLots) ? data.recentDepletedLots : [] }, (stocktakeAnchor ? { stocktakeAnchor } : {})), { revision: Number((_g = (_f = data.revision) !== null && _f !== void 0 ? _f : data.version) !== null && _g !== void 0 ? _g : 0), lastProcessedAt: String((_j = (_h = data.lastProcessedAt) !== null && _h !== void 0 ? _h : data.updatedAt) !== null && _j !== void 0 ? _j : '') });
}
/** 초기 원자화 이력을 새 코어가 읽을 수 있게 정규화한다. */
function normalizeRawMovement(data) {
    var _a, _b, _c;
    return Object.assign(Object.assign({}, data), { commandHash: String((_a = data.commandHash) !== null && _a !== void 0 ? _a : ''), effectiveAt: String((_b = data.effectiveAt) !== null && _b !== void 0 ? _b : `${(_c = data.date) !== null && _c !== void 0 ? _c : '1970-01-01'}T12:00:00+09:00`), lotChanges: (Array.isArray(data.lotChanges) ? data.lotChanges : []).map((ch) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
            const afterKg = Number((_b = (_a = ch.afterKg) !== null && _a !== void 0 ? _a : ch.kgAfter) !== null && _b !== void 0 ? _b : 0);
            const deltaKg = Number((_c = ch.deltaKg) !== null && _c !== void 0 ? _c : 0);
            return Object.assign(Object.assign({}, ch), { deltaKg, beforeKg: Number((_d = ch.beforeKg) !== null && _d !== void 0 ? _d : afterKg - deltaKg), afterKg, lotSnapshot: (_e = ch.lotSnapshot) !== null && _e !== void 0 ? _e : {
                    id: String(ch.lotId), material: String((_g = (_f = data.materialSnapshot) !== null && _f !== void 0 ? _f : data.material) !== null && _g !== void 0 ? _g : ''),
                    supplierName: String((_h = ch.supplierName) !== null && _h !== void 0 ? _h : '이력 복원'),
                    receivedDate: String((_k = (_j = ch.receivedDate) !== null && _j !== void 0 ? _j : data.date) !== null && _k !== void 0 ? _k : ''),
                    qtyIn: 0, kgIn: Math.max(0, afterKg - deltaKg), kgRemaining: Math.max(0, afterKg - deltaKg),
                    status: afterKg - deltaKg > 0 ? 'active' : 'depleted',
                    createdAt: String((_m = (_l = data.recordedAt) !== null && _l !== void 0 ? _l : data.createdAt) !== null && _m !== void 0 ? _m : ''),
                } });
        }) });
}
const r3 = (value) => Math.round(value * 1000) / 1000;
/** 화면용 품목 재고와 원자 상태는 둘 다 0.001kg로 저장한다. 차이가 있으면 정정 없이 덮지 않는다. */
function rawMirrorMatches(itemStockKg, stateStockKg) {
    return Number.isFinite(itemStockKg) && Number.isFinite(stateStockKg)
        && r3(itemStockKg) === r3(stateStockKg);
}
//# sourceMappingURL=rawInventoryDocument.js.map