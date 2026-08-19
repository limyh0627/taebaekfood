"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dailyAutoVoucher = exports.monthlyInventorySnapshot = exports.requestPasswordReset = exports.findUsername = void 0;
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
// ─────────────────────────────────────────────────────────────────────────
// 정기 전표 자동 발행 — 매일 07:00 KST(= 22:00 UTC 전날) 실행.
//
// 템플릿에 발행일(issueDay)을 정해 두면 그날 전표가 저절로 생긴다. 앱을 안 켜도 된다.
//   합침  출금 자금전표 하나          (차) 비용 / (대) 보통예금
//   분리  매입전표로 채무만 세운다     (차) 비용 / (대) 외상매입금 → 지불은 사람이 따로
//
// **금액이 정해진 것만** 나간다(amount > 0). 매달 다른 전기세를 자동으로 만들면
// 틀린 숫자가 장부에 남는다 — 그런 건 템플릿만 두고 손으로 발행한다.
//
// 규칙은 앱과 같아야 해서 src/shared/autoVoucher.ts와 같은 판정을 여기 옮겨 적었다.
// (functions는 별도 빌드라 앱 소스를 import 못 한다. 고칠 땐 양쪽을 같이 고쳐야 한다.)
// ─────────────────────────────────────────────────────────────────────────
exports.dailyAutoVoucher = (0, scheduler_1.onSchedule)({ schedule: '0 22 * * *', timeZone: 'UTC', region: REGION }, async () => {
    var _a, _b, _c, _d;
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const y = kst.getUTCFullYear();
    const m = kst.getUTCMonth() + 1;
    const d = kst.getUTCDate();
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    const today = `${ym}-${String(d).padStart(2, '0')}`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const tplSnap = await db.collection('fixedCostTemplates').get();
    let created = 0;
    for (const doc of tplSnap.docs) {
        const t = doc.data();
        const id = doc.id;
        if (!t.autoIssue || !t.accountCode)
            continue;
        if (!(Number(t.amount) > 0))
            continue;
        if (t.startYm && ym < t.startYm)
            continue;
        if (t.endYm && ym > t.endYm)
            continue;
        const day = Math.min(Math.max(Number((_a = t.issueDay) !== null && _a !== void 0 ? _a : 1), 1), lastDay);
        if (`${ym}-${String(day).padStart(2, '0')}` !== today)
            continue;
        // 갈래 하나로 정한다 — 출금·입금은 자금전표, 줄돈·받을돈·대체는 전표
        const dir = (_b = t.dir) !== null && _b !== void 0 ? _b : (t.postMode === '분리' ? '줄돈' : '출금');
        const isCash = dir === '출금' || dir === '입금';
        // 비현금 갈래는 거래처가 있어야 자동으로 낼 수 있다 —
        // 거래처가 있으면 매입전표(상대변 251이 자동), 없으면 차·대를 직접 세워야 해서 손으로만.
        if (!isCash && !t.partnerId) {
            console.warn(`[autoVoucher] ${t.name}: 거래처 없는 대체는 자동 발행 안 함`);
            continue;
        }
        const key = `AUTO-${id}-${ym}`;
        const amount = Number(t.amount);
        if (!isCash) {
            const ref = db.collection('issuedStatements').doc(key);
            if ((await ref.get()).exists)
                continue;
            const exempt = !!t.taxExempt;
            const supply = exempt ? amount : Math.round(amount / 1.1);
            const tax = exempt ? 0 : amount - supply;
            // 문서번호는 그 달 발행 건수 + 1 — 사람이 끊은 것과 형식을 맞춘다
            const monthCount = (await db.collection('issuedStatements').where('tradeDate', '>=', `${ym}-01`).where('tradeDate', '<=', `${ym}-31`).get()).size;
            await ref.set({
                id: key,
                issuedAt: new Date().toISOString(),
                tradeDate: today,
                type: dir === '받을돈' ? '매출' : (t.partnerId ? '매입' : '비용'),
                partnerId: t.partnerId,
                partnerName: (_c = t.partnerName) !== null && _c !== void 0 ? _c : '',
                orderId: key,
                docNo: `${ym}-${String(monthCount + 1).padStart(4, '0')}`,
                totalSupply: supply,
                totalTax: tax,
                totalAmount: amount,
                items: [{
                        name: t.name, spec: '', qty: 1, price: amount,
                        supply, tax, total: amount,
                        isTaxExempt: exempt,
                        accountCode: t.accountCode,
                    }],
            });
        }
        else {
            const ref = db.collection('cashEntries').doc(key);
            if ((await ref.get()).exists)
                continue;
            await ref.set(Object.assign(Object.assign({ id: key, date: today, cashAccountId: '', dir,
                amount, accountCode: t.accountCode }, (t.partnerId ? { partnerId: t.partnerId, partnerName: (_d = t.partnerName) !== null && _d !== void 0 ? _d : '' } : {})), { note: `정기 · ${t.name}${t.partnerName ? ` · ${t.partnerName}` : ''}`, createdAt: new Date().toISOString() }));
        }
        created++;
        console.log(`[autoVoucher] ${today} ${t.name} ${amount}원 (${dir})`);
    }
    console.log(`[autoVoucher] ${today} — ${created}건 발행`);
});
//# sourceMappingURL=index.js.map