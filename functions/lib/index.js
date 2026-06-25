"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.monthlyInventorySnapshot = exports.requestPasswordReset = exports.findUsername = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();
// ─────────────────────────────────────────────────────────────────────────
// 거래처 홈페이지(taebaekfood-web) 계정 찾기 — 미인증 사용자가 호출.
// 이름+연락처(또는 +아이디) 역검색은 개인정보라 클라이언트에 users 조회를
// 열어줄 수 없으므로, 서버에서 본인 확인만 수행하고 최소 정보만 회신한다.
// 호출형(onCall) 함수는 실제 호출 시에만 과금되며 평소 비용은 0이다.
// ─────────────────────────────────────────────────────────────────────────
const REGION = 'asia-northeast3';
// 아이디 찾기: 이름 + 연락처가 일치하는 계정의 username 반환
exports.findUsername = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a, _b, _c, _d, _e;
    const name = String((_b = (_a = request.data) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : '').trim();
    const phone = String((_d = (_c = request.data) === null || _c === void 0 ? void 0 : _c.phone) !== null && _d !== void 0 ? _d : '').trim();
    if (!name || !phone) {
        throw new https_1.HttpsError('invalid-argument', '이름과 연락처를 입력해주세요.');
    }
    const snap = await db
        .collection('users')
        .where('name', '==', name)
        .where('phone', '==', phone)
        .limit(1)
        .get();
    if (snap.empty)
        return { username: null };
    return { username: (_e = snap.docs[0].data().username) !== null && _e !== void 0 ? _e : null };
});
// 비밀번호 재설정: 아이디 + 이름 + 연락처로 본인 확인 후, 재설정 메일 발송용 이메일 회신
// (클라이언트가 회신받은 이메일로 sendPasswordResetEmail 호출 — 3요소 검증 통과 후에만 노출)
exports.requestPasswordReset = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a, _b, _c, _d, _e, _f;
    const username = String((_b = (_a = request.data) === null || _a === void 0 ? void 0 : _a.username) !== null && _b !== void 0 ? _b : '').trim();
    const name = String((_d = (_c = request.data) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : '').trim();
    const phone = String((_f = (_e = request.data) === null || _e === void 0 ? void 0 : _e.phone) !== null && _f !== void 0 ? _f : '').trim();
    if (!username || !name || !phone) {
        throw new https_1.HttpsError('invalid-argument', '아이디·이름·연락처를 모두 입력해주세요.');
    }
    const snap = await db
        .collection('users')
        .where('username', '==', username)
        .where('name', '==', name)
        .where('phone', '==', phone)
        .limit(1)
        .get();
    if (snap.empty) {
        throw new https_1.HttpsError('not-found', '입력하신 정보와 일치하는 계정이 없습니다.');
    }
    const email = snap.docs[0].data().email;
    if (!email) {
        throw new https_1.HttpsError('failed-precondition', '해당 계정에 등록된 이메일이 없습니다.');
    }
    return { email };
});
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