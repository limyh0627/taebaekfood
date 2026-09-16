"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.employeeLogin = void 0;
const node_crypto_1 = require("node:crypto");
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const passwordHash_1 = require("./passwordHash");
const REGION = 'asia-northeast3';
const MAX_FAILURES = 5;
const WINDOW_MS = 10 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const 회사 = new Set(['taebaek', 'punghoe']);
function loginKey(username, ip) {
    return (0, node_crypto_1.createHash)('sha256').update(`${username}\n${ip}`).digest('hex');
}
function fail() {
    throw new https_1.HttpsError('unauthenticated', '아이디 또는 비밀번호가 일치하지 않습니다.');
}
exports.employeeLogin = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u;
    const username = String((_b = (_a = request.data) === null || _a === void 0 ? void 0 : _a.username) !== null && _b !== void 0 ? _b : '').trim().toLowerCase();
    const password = String((_d = (_c = request.data) === null || _c === void 0 ? void 0 : _c.password) !== null && _d !== void 0 ? _d : '');
    const app = String((_f = (_e = request.data) === null || _e === void 0 ? void 0 : _e.app) !== null && _f !== void 0 ? _f : '');
    const requestedCompany = String((_h = (_g = request.data) === null || _g === void 0 ? void 0 : _g.companyId) !== null && _h !== void 0 ? _h : '');
    if (!username || !password || username.length > 80 || password.length > 200)
        fail();
    if (app !== 'admin' && app !== 'staff')
        fail();
    if (app === 'admin' && !회사.has(requestedCompany))
        fail();
    const db = admin.firestore();
    const attemptRef = db.collection('authLoginAttempts').doc(loginKey(username, (_j = request.rawRequest.ip) !== null && _j !== void 0 ? _j : 'unknown'));
    const now = Date.now();
    const attempt = (await attemptRef.get()).data();
    if (((_k = attempt === null || attempt === void 0 ? void 0 : attempt.blockedUntil) !== null && _k !== void 0 ? _k : 0) > now) {
        throw new https_1.HttpsError('resource-exhausted', '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.');
    }
    let employeeQuery = db.collection('employees')
        .where('usernameNormalized', '==', username);
    // 관리자 화면의 회사 선택은 장식이 아니다. 같은 아이디가 양사에 있어도 선택한 회사 한 곳만 찾는다.
    if (app === 'admin')
        employeeQuery = employeeQuery.where('companyId', '==', requestedCompany);
    const snap = await employeeQuery.limit(2).get();
    const employeeDoc = snap.size === 1 ? snap.docs[0] : null;
    const employee = employeeDoc === null || employeeDoc === void 0 ? void 0 : employeeDoc.data();
    const homeCompany = String((_l = employee === null || employee === void 0 ? void 0 : employee.companyId) !== null && _l !== void 0 ? _l : 'taebaek');
    const valid = !!employeeDoc
        && (employee === null || employee === void 0 ? void 0 : employee.status) !== 'out'
        && 회사.has(homeCompany)
        && (app !== 'admin' || (homeCompany === requestedCompany && (employee === null || employee === void 0 ? void 0 : employee.adminAccess) === true))
        && typeof (employee === null || employee === void 0 ? void 0 : employee.passwordHash) === 'string'
        && (0, passwordHash_1.verifyPassword)(password, employee.passwordHash);
    if (!valid) {
        await db.runTransaction(async (transaction) => {
            var _a, _b;
            const latest = (await transaction.get(attemptRef)).data();
            const windowStartedAt = ((_a = latest === null || latest === void 0 ? void 0 : latest.windowStartedAt) !== null && _a !== void 0 ? _a : 0) > now - WINDOW_MS ? latest.windowStartedAt : now;
            const failures = windowStartedAt === (latest === null || latest === void 0 ? void 0 : latest.windowStartedAt) ? ((_b = latest === null || latest === void 0 ? void 0 : latest.failures) !== null && _b !== void 0 ? _b : 0) + 1 : 1;
            transaction.set(attemptRef, {
                failures,
                windowStartedAt,
                blockedUntil: failures >= MAX_FAILURES ? now + BLOCK_MS : 0,
                expiresAt: admin.firestore.Timestamp.fromMillis(now + 24 * 60 * 60 * 1000),
            });
        });
        fail();
    }
    await attemptRef.delete().catch(() => undefined);
    const authUid = String((_m = employee.authUid) !== null && _m !== void 0 ? _m : '');
    if (!authUid)
        throw new https_1.HttpsError('failed-precondition', '계정 보안 이관이 필요합니다. 관리자에게 문의해 주세요.');
    const claims = {
        employeeId: employeeDoc.id,
        companyId: homeCompany,
        isAdmin: employee.adminAccess === true,
    };
    try {
        await admin.auth().getUser(authUid);
    }
    catch (error) {
        if ((error === null || error === void 0 ? void 0 : error.code) !== 'auth/user-not-found')
            throw error;
        await admin.auth().createUser({
            uid: authUid,
            displayName: String((_o = employee.name) !== null && _o !== void 0 ? _o : ''),
            disabled: employee.status === 'out',
        });
    }
    await admin.auth().setCustomUserClaims(authUid, claims);
    const customToken = await admin.auth().createCustomToken(authUid, claims);
    return {
        customToken,
        employee: {
            id: employeeDoc.id,
            companyId: homeCompany,
            name: String((_p = employee.name) !== null && _p !== void 0 ? _p : ''),
            username: String((_q = employee.username) !== null && _q !== void 0 ? _q : ''),
            position: String((_r = employee.position) !== null && _r !== void 0 ? _r : ''),
            department: String((_s = employee.department) !== null && _s !== void 0 ? _s : ''),
            joinDate: String((_t = employee.joinDate) !== null && _t !== void 0 ? _t : ''),
            status: (_u = employee.status) !== null && _u !== void 0 ? _u : 'working',
            adminAccess: employee.adminAccess === true,
        },
    };
});
//# sourceMappingURL=employeeLogin.js.map