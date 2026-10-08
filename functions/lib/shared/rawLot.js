"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.nextLotNo = nextLotNo;
exports.buildReceiveLot = buildReceiveLot;
exports.deductFromLots = deductFromLots;
const round3 = (n) => Math.round(n * 1000) / 1000;
/**
 * 자동 로트번호: 입고일(YYMMDD) + 같은 날 순번(2자리). 예) 2026-06-15 → "260615-01", "260615-02"…
 * 이월 번호는 일반 입고 번호와 접두사를 달리한다.
 */
function nextLotNo(lots, receivedDate) {
    const ymd = (receivedDate !== null && receivedDate !== void 0 ? receivedDate : '').replace(/-/g, '').slice(2); // 2026-06-15 → 260615
    const n = (lots !== null && lots !== void 0 ? lots : []).filter(l => { var _a; return ((_a = l.lotNo) !== null && _a !== void 0 ? _a : '').startsWith(ymd + '-'); }).length + 1;
    return `${ymd}-${String(n).padStart(2, '0')}`;
}
/** 입고 1건 → 새 로트 1개 생성 (잔여 = 입고량) */
function buildReceiveLot(params) {
    const now = params.createdAt;
    return {
        id: params.id,
        material: params.material,
        supplierId: params.supplierId,
        supplierName: params.supplierName,
        packageType: params.packageType,
        packageKg: params.packageKg,
        qtyIn: params.qtyIn,
        kgIn: round3(params.kgIn),
        kgRemaining: round3(params.kgIn),
        receivedDate: params.receivedDate,
        status: 'active',
        poId: params.poId,
        createdAt: now,
    };
}
/**
 * 로트 차감.
 * - 기본: 선입선출(FIFO) — 앞쪽 active 로트부터.
 * - 혼합(mix) 지정 시: 지정된 여러 active 로트에 비율대로 먼저 배분한다.
 *   예전 topPercent 설정도 상위 2개 비율로 계속 읽는다. 부족분은 FIFO로 이어서 차감한다.
 * 한 로트가 0이 되면 status='depleted'. 잔량이 부족하면 원본 로트 배열을 그대로 돌려준다.
 * 명령을 적용하는 쪽은 shortageKg > 0 을 반드시 거절해야 한다. 음수 이월을 새로 만들면
 * 같은 원료의 실제 재고와 로트가 함께 음수로 내려가던 사고를 되풀이한다.
 * @returns lots(차감 후), distribution(로트별 차감량), shortageKg(부족량)
 */
function deductFromLots(lots, kgToUse, mix) {
    var _a, _b, _c;
    let remaining = round3(kgToUse);
    // 직접 호출에서 NaN은 부족량 검사도 통과해 로트 잔량까지 NaN으로 번진다.
    // 원자 명령의 검증과 별개로 FIFO 함수 입구에서도 유한한 양수만 받는다.
    if (!Number.isFinite(kgToUse) || !Number.isFinite(remaining) || !(remaining > 0)) {
        throw new RangeError('로트 사용량은 유한한 양수여야 한다');
    }
    const invalidLot = lots.find(lot => {
        var _a;
        return lot.status === 'active'
            && !Number.isFinite(Number((_a = lot.kgRemaining) !== null && _a !== void 0 ? _a : 0));
    });
    if (invalidLot)
        throw new RangeError(`활성 로트 ${invalidLot.id}의 잔량이 유한한 숫자가 아니다`);
    const availableKg = round3(lots.reduce((sum, lot) => { var _a; return sum + (lot.status === 'active' ? Math.max(0, Number((_a = lot.kgRemaining) !== null && _a !== void 0 ? _a : 0)) : 0); }, 0));
    if (!Number.isFinite(availableKg))
        throw new RangeError('활성 로트의 잔량 합계가 유한한 숫자가 아니다');
    const shortageKg = round3(Math.max(0, remaining - availableKg));
    if (shortageKg > 0)
        return { lots, distribution: [], shortageKg };
    const next = lots.map(l => (Object.assign({}, l)));
    const dist = [];
    const activeIdx = next
        .map((l, i) => ({ l, i }))
        .filter(x => { var _a; return x.l.status === 'active' && ((_a = x.l.kgRemaining) !== null && _a !== void 0 ? _a : 0) > 0; })
        .map(x => x.i);
    const take = (idx, amount) => {
        const l = next[idx];
        const t = Math.min(l.kgRemaining, round3(amount), remaining);
        if (t <= 0)
            return;
        l.kgRemaining = round3(l.kgRemaining - t);
        remaining = round3(remaining - t);
        if (l.kgRemaining <= 0.0001) {
            l.kgRemaining = 0;
            l.status = 'depleted';
        }
        const ex = dist.find(d => d.idx === idx);
        if (ex)
            ex.kg = round3(ex.kg + t);
        else
            dist.push({ idx, lotId: l.id, supplierName: l.supplierName, lotNo: l.lotNo, receivedDate: l.receivedDate, kg: round3(t) });
    };
    // 혼합: 선택한 여러 로트에 비율 배분 우선. 합계가 100이 아니어도 정규화해 안전하게 처리한다.
    if (mix && activeIdx.length >= 2 && remaining > 0) {
        const configured = ((_a = mix.ratios) !== null && _a !== void 0 ? _a : [])
            .map(row => ({ idx: next.findIndex(lot => lot.id === row.lotId), percent: Math.max(0, Number(row.percent) || 0) }))
            .filter(row => activeIdx.includes(row.idx) && row.percent > 0);
        const targets = configured.length >= 2
            ? configured
            : [
                { idx: activeIdx[0], percent: Math.max(0, Math.min(100, (_b = mix.topPercent) !== null && _b !== void 0 ? _b : 50)) },
                { idx: activeIdx[1], percent: 100 - Math.max(0, Math.min(100, (_c = mix.topPercent) !== null && _c !== void 0 ? _c : 50)) },
            ];
        const percentTotal = targets.reduce((sum, row) => sum + row.percent, 0);
        const total = round3(kgToUse);
        targets.forEach((row, index) => {
            const amount = index === targets.length - 1
                ? round3(total - targets.slice(0, index).reduce((sum, prior) => sum + round3(total * prior.percent / percentTotal), 0))
                : round3(total * row.percent / percentTotal);
            take(row.idx, amount);
        });
    }
    // 나머지(또는 비혼합): FIFO로 잔여 차감
    for (const idx of activeIdx) {
        if (remaining <= 0)
            break;
        take(idx, remaining);
    }
    return {
        lots: next,
        distribution: dist.map((_a) => {
            var { idx } = _a, d = __rest(_a, ["idx"]);
            return d;
        }),
        shortageKg: round3(Math.max(0, remaining)),
    };
}
//# sourceMappingURL=rawLot.js.map