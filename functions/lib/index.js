"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.monthlyInventorySnapshot = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();
// 매일 23:00 KST(= 14:00 UTC) 실행 → 해당 월의 마지막 날인지 체크 후 기말재고 스냅샷 저장
exports.monthlyInventorySnapshot = (0, scheduler_1.onSchedule)({
    schedule: '0 14 * * *',
    timeZone: 'Asia/Seoul',
    region: 'asia-northeast3',
}, async () => {
    var _a, _b;
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    // 오늘이 해당 월의 마지막 날인지 확인
    const nextDay = new Date(kst);
    nextDay.setDate(kst.getDate() + 1);
    const isLastDay = nextDay.getDate() === 1;
    if (!isLastDay)
        return;
    const year = kst.getFullYear();
    const month = kst.getMonth() + 1;
    const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
    // 이미 해당 월 스냅샷이 있으면 스킵
    const snapRef = db.collection('inventorySnapshots').doc(`inv-snap-${yearMonth}`);
    const existing = await snapRef.get();
    if (existing.exists) {
        console.log(`Snapshot for ${yearMonth} already exists, skipping.`);
        return;
    }
    // items 컬렉션에서 재고액 합산 (stock × cost)
    const itemsSnap = await db.collection('items').get();
    let totalValue = 0;
    for (const doc of itemsSnap.docs) {
        const data = doc.data();
        const stock = (_a = data.stock) !== null && _a !== void 0 ? _a : 0;
        const cost = (_b = data.cost) !== null && _b !== void 0 ? _b : 0;
        if (stock > 0 && cost > 0) {
            totalValue += stock * cost;
        }
    }
    await snapRef.set({
        id: `inv-snap-${yearMonth}`,
        yearMonth,
        value: totalValue,
        recordedAt: new Date().toISOString(),
    });
    console.log(`Inventory snapshot saved: ${yearMonth} = ${totalValue}원`);
});
//# sourceMappingURL=index.js.map