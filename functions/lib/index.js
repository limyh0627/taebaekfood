"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyChatMessage = exports.notifyNewOrder = exports.dailyAutoVoucher = exports.monthlyInventorySnapshot = exports.requestPasswordReset = exports.findUsername = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
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
    //  이미 있는지는 **회사마다 따로** 본다(아래 루프).
    //  전에는 태백 문서 하나만 보고 통째로 빠져나가서, 태백이 있으면 풍회는 영영 안 생겼다.
    /*
     * **재고 평가는 앱(ProfitAnalysis 재고평가 탭)과 같은 규칙이어야 한다.**
     * 이 값이 `journalizeInventory` 를 타고 매출원가로 흘러가므로,
     * 앱에서 본 숫자와 장부의 숫자가 다르면 어디가 맞는지 아무도 못 가린다.
     * 2026-09-03 에 재 보니 **1,050만원** 갈려 있었다. 규칙 셋 중 둘이 달랐다.
     *
     *   ① 회사    앱은 태백/풍회를 가르는데 여기는 안 갈랐다 → 풍회 재고 566만원이
     *              태백 재고자산에 얹혔다. 실지재고조사법이라 양쪽이 같이 틀어진다.
     *   ② 음수    앱은 넣는데 여기는 `stock > 0` 으로 뺐다 → 483만원. 어긋난 재고를
     *              감추면 장부만 맞아 보이고 창고는 안 맞는다.
     *   ③ 단가    `item.cost` 를 쓴다 — **이건 앱과 같다.** 앱이 BOM 롤업 결과를
     *              `recomputeAllCosts` 로 이 칸에 되써 두기 때문이다(차이 37원).
     *              BOM 롤업을 여기 또 옮겨 적으면 갈릴 자리만 하나 더 는다.
     */
    const itemsSnap = await db.collection('items').get();
    const 회사별 = new Map();
    for (const doc of itemsSnap.docs) {
        const data = doc.data();
        const stock = Number(data.stock) || 0;
        const cost = Number(data.cost) || 0;
        if (!stock || !cost)
            continue;
        //  회사가 안 붙은 옛 품목은 태백 것으로 본다(앱의 companyOf 와 같다)
        const co = (_a = data.companyId) !== null && _a !== void 0 ? _a : 'taebaek';
        회사별.set(co, ((_b = 회사별.get(co)) !== null && _b !== void 0 ? _b : 0) + stock * cost); // 음수도 그대로 더한다
    }
    //  회사를 안 쓰는 곳에서도 태백 스냅샷은 늘 서야 한다
    if (!회사별.has('taebaek'))
        회사별.set('taebaek', 0);
    for (const [co, value] of 회사별) {
        //  문서 id 규칙은 앱의 invSnapDocId 와 같다 — 태백은 옛 문서 이름을 그대로 쓴다
        const id = co === 'taebaek' ? `inv-snap-${yearMonth}` : `inv-snap-${co}-${yearMonth}`;
        const ref = db.collection('inventorySnapshots').doc(id);
        if ((await ref.get()).exists) {
            console.log(`Snapshot ${id} already exists, skipping.`);
            continue;
        }
        await ref.set({ id, yearMonth, value: Math.round(value), companyId: co, recordedAt: new Date().toISOString() });
        console.log(`Inventory snapshot saved: ${id} = ${Math.round(value)}원`);
    }
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
            /*
             * 문서번호 — **그날(YYMMDD) 쓰인 가장 큰 번호 + 1.**  `260901-001`
             *
             * 앱은 2026-08-21(커밋 1a421f5)에 이 규칙으로 바꿨는데 **여기만 안 바꿨다.**
             * 그래서 스케줄러가 만든 정기 전표만 옛 형식(`2026-09-0001`)으로 나온다.
             * 옛 방식은 '그 달 전표 개수 + 1'이라 —
             *   · 전표를 하나 지우면 개수가 줄어 **지워진 번호를 다시 쓴다.**
             *   · 실제로 `2026-08-0216` 이 두 전표에 붙어 있다.
             *
             * 위 주석대로 functions 는 앱 소스를 import 못 한다.
             * `shared/voucherStamp.ts` 의 `nextDocNo` 와 **같은 규칙을 손으로 옮겨 둔 것**이다.
             * 한쪽을 고치면 반드시 다른 쪽도 고쳐야 한다.
             */
            const dayHead = `${today.slice(2).replace(/-/g, '')}-`;
            const daySnap = await db.collection('issuedStatements').where('tradeDate', '==', today).get();
            let maxNo = 0;
            daySnap.forEach(doc => {
                var _a;
                const no = String((_a = doc.data().docNo) !== null && _a !== void 0 ? _a : '');
                if (!no.startsWith(dayHead))
                    return;
                const tail = no.slice(dayHead.length);
                if (/^[0-9]+$/.test(tail))
                    maxNo = Math.max(maxNo, Number(tail));
            });
            await ref.set({
                id: key,
                issuedAt: new Date().toISOString(),
                tradeDate: today,
                type: dir === '받을돈' ? '매출' : (t.partnerId ? '매입' : '비용'),
                partnerId: t.partnerId,
                partnerName: (_c = t.partnerName) !== null && _c !== void 0 ? _c : '',
                orderId: key,
                docNo: `${dayHead}${String(maxNo + 1).padStart(3, '0')}`,
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
// ─────────────────────────────────────────────────────────────────────────
// 새 주문 푸시 알림 — 앱을 완전히 닫아도 온다.
//
// 화면 안의 알림(shared/newOrderAlert)은 앱이 살아 있을 때만 만든다. 최근앱에서
// 밀어 닫으면 코드가 안 돌아 알릴 방법이 없다. 그래서 **서버가 폰으로 직접 민다.**
//
// 규칙은 화면 것과 같게 맞춘다 —
//   · 관리자 앱을 쓰는 사람에게만 (employees.adminAccess)
//   · **넣은 사람 빼고** (내가 넣고 내가 알림받을 일은 없다)
//   · 표(token)가 죽었으면 지운다 — 안 지우면 계속 쌓여 발송이 느려진다
// ─────────────────────────────────────────────────────────────────────────
/**
 * 표(token)를 모아 밀고, **죽은 표는 지운다.**
 *
 * 앱을 지웠거나 기기가 바뀌면 표가 죽는데, 안 지우면 계속 쌓여 발송이 느려진다.
 * 새 주문·오피스톡이 같은 함수를 쓴다 — 한쪽만 고쳐지면 한쪽 알림만 이상해진다.
 */
async function 밀기(받을사람, data, 이름) {
    const 표 = [];
    for (const p of 받을사람)
        for (const t of p.tokens)
            표.push({ token: String(t), empId: p.id });
    if (!표.length)
        return;
    const res = await admin.messaging().sendEachForMulticast({
        tokens: 표.map(x => x.token),
        //  **data 만 보낸다** — notification 을 같이 보내면 폰이 제멋대로 한 번 더 띄워
        //  알림이 두 개로 보인다. 띄우는 건 firebase-messaging-sw.js 가 한다.
        data,
        android: { priority: 'high' },
        webpush: { headers: { Urgency: 'high' } },
    });
    const 죽은표 = {};
    res.responses.forEach((r, i) => {
        var _a, _b, _c;
        const code = (_b = (_a = r.error) === null || _a === void 0 ? void 0 : _a.code) !== null && _b !== void 0 ? _b : '';
        if (r.success || !/registration-token-not-registered|invalid-argument/.test(code))
            return;
        const { empId, token } = 표[i];
        ((_c = 죽은표[empId]) !== null && _c !== void 0 ? _c : (죽은표[empId] = [])).push(token);
    });
    await Promise.all(Object.entries(죽은표).map(([empId, tokens]) => db.collection('employees').doc(empId).update({
        fcmTokens: admin.firestore.FieldValue.arrayRemove(...tokens),
    })));
    console.log(`[${이름}] 보냄 ${res.successCount}/${표.length}, 죽은 표 ${Object.values(죽은표).flat().length}개 지움`);
}
exports.notifyNewOrder = (0, firestore_1.onDocumentCreated)({ region: REGION, document: 'orders/{orderId}' }, async (event) => {
    var _a, _b, _c;
    const order = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    if (!order)
        return;
    if (order.partnerName === '생산기록')
        return; // 주문이 아니다
    //  관리자 앱을 쓰는 사람 = 알림 받을 사람. 사장님 계정(id 'admin')도 포함한다.
    const emps = await db.collection('employees').get();
    const 받을사람 = emps.docs.filter(d => d.id === 'admin' || d.data().adminAccess === true);
    //  넣은 사람은 뺀다. 주문에 누가 넣었는지가 없으면(직원 앱) 아무도 안 뺀다.
    const 넣은사람 = String((_b = order.createdBy) !== null && _b !== void 0 ? _b : '');
    const 받을 = 받을사람
        .filter(d => d.id !== 넣은사람)
        .map(d => { var _a; return ({ id: d.id, tokens: ((_a = d.data().fcmTokens) !== null && _a !== void 0 ? _a : []) }); })
        .filter(x => x.tokens.length);
    /*
     *  **주문마다 따로 쌓인다**(2026-09-09 사장님). 전에는 `tag` 가 다 `'new-order'` 라
     *  뒤에 온 알림이 앞의 것을 **덮어썼다** — 앱을 닫아 둔 사이 3건이 들어와도
     *  폰에는 마지막 1건만 남고, 3건이었다는 것도 알 수 없었다.
     *
     *  주문 하나하나가 따로 처리할 일이라 따로 남아야 한다.
     *  (오피스톡은 그대로 방마다 하나다 — 같은 방 이야기는 묶이는 게 맞다)
     */
    await 밀기(받을, {
        title: '🧾 신규 주문',
        body: `${(_c = order.partnerName) !== null && _c !== void 0 ? _c : '거래처'} 주문이 들어왔습니다.`,
        tag: `new-order:${event.params.orderId}`, view: 'orders',
    }, 'notifyNewOrder');
});
// ─────────────────────────────────────────────────────────────────────────
// 오피스톡 새 메시지 푸시 — 앱을 완전히 닫아도 온다.
//
// 화면 안의 알림(shared/newChatAlert)은 앱이 살아 있을 때만 만든다. 그래서 앱을
// 닫아 두면 말이 와도 몰랐다(2026-09-06 사장님: "오피스톡 알람은 안 오는거 같은데").
//
// 규칙은 화면 것과 같게 —
//   · 그 방 사람들에게만
//   · **보낸 사람은 빼고**
//   · 지운 말은 안 보낸다
// ─────────────────────────────────────────────────────────────────────────
exports.notifyChatMessage = (0, firestore_1.onDocumentCreated)({ region: REGION, document: 'chatMessages/{msgId}' }, async (event) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const msg = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    if (!msg || msg.deletedAt)
        return;
    const roomSnap = await db.collection('chatRooms').doc(String(msg.roomId)).get();
    if (!roomSnap.exists)
        return;
    const room = (_b = roomSnap.data()) !== null && _b !== void 0 ? _b : {};
    const 참여자 = ((_c = room.participantIds) !== null && _c !== void 0 ? _c : []).filter((id) => id !== msg.senderId);
    if (!참여자.length)
        return; // 나와의 대화
    //  방 이름은 **각자 고쳐 둔 게 있으면 그걸** 쓴다(shared/roomName 과 같은 규칙).
    //  사람마다 다르므로 한 번에 못 보내고 사람별로 나눠 보낸다.
    const emps = await Promise.all(참여자.map(id => db.collection('employees').doc(id).get()));
    const 글 = msg.text
        ? String(msg.text)
        : msg.imageUrl ? '사진을 보냈습니다'
            : msg.fileUrl ? '파일을 보냈습니다' : '새 메시지가 도착했습니다.';
    for (const d of emps) {
        if (!d.exists)
            continue;
        const tokens = (_e = (_d = d.data()) === null || _d === void 0 ? void 0 : _d.fcmTokens) !== null && _e !== void 0 ? _e : [];
        if (!tokens.length)
            continue;
        const 내이름 = ((_g = (_f = room.nameBy) === null || _f === void 0 ? void 0 : _f[d.id]) === null || _g === void 0 ? void 0 : _g.trim()) || ((_h = room.name) === null || _h === void 0 ? void 0 : _h.trim()) || msg.senderName || '오피스톡';
        await 밀기([{ id: d.id, tokens }], {
            title: `💬 ${내이름}`,
            body: 글.length > 80 ? `${글.slice(0, 80)}…` : 글,
            tag: String(msg.roomId), view: 'officetalk',
        }, 'notifyChatMessage');
    }
});
//# sourceMappingURL=index.js.map