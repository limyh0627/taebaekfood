import { createHash } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { verifyPassword } from './passwordHash';

const REGION = 'asia-northeast3';
const MAX_FAILURES = 5;
const WINDOW_MS = 10 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const 회사 = new Set(['taebaek', 'punghoe']);

type Attempt = { failures?: number; windowStartedAt?: number; blockedUntil?: number };

function loginKey(username: string, ip: string): string {
  return createHash('sha256').update(`${username}\n${ip}`).digest('hex');
}

function fail(): never {
  throw new HttpsError('unauthenticated', '아이디 또는 비밀번호가 일치하지 않습니다.');
}

export const employeeLogin = onCall({ region: REGION }, async request => {
  const username = String(request.data?.username ?? '').trim().toLowerCase();
  const password = String(request.data?.password ?? '');
  if (!username || !password || username.length > 80 || password.length > 200) fail();

  const db = admin.firestore();
  const attemptRef = db.collection('authLoginAttempts').doc(loginKey(username, request.rawRequest.ip ?? 'unknown'));
  const now = Date.now();
  const attempt = (await attemptRef.get()).data() as Attempt | undefined;
  if ((attempt?.blockedUntil ?? 0) > now) {
    throw new HttpsError('resource-exhausted', '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.');
  }

  const snap = await db.collection('employees').where('usernameNormalized', '==', username).limit(2).get();
  const employeeDoc = snap.size === 1 ? snap.docs[0] : null;
  const employee = employeeDoc?.data();
  const homeCompany = String(employee?.companyId ?? 'taebaek');
  const valid = !!employeeDoc
    && employee?.status !== 'out'
    && 회사.has(homeCompany)
    && typeof employee?.passwordHash === 'string'
    && verifyPassword(password, employee.passwordHash);

  if (!valid) {
    await db.runTransaction(async transaction => {
      const latest = (await transaction.get(attemptRef)).data() as Attempt | undefined;
      const windowStartedAt = (latest?.windowStartedAt ?? 0) > now - WINDOW_MS ? latest!.windowStartedAt! : now;
      const failures = windowStartedAt === latest?.windowStartedAt ? (latest?.failures ?? 0) + 1 : 1;
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
  const authUid = String(employee.authUid ?? '');
  if (!authUid) throw new HttpsError('failed-precondition', '계정 보안 이관이 필요합니다. 관리자에게 문의해 주세요.');
  const claims = {
    employeeId: employeeDoc.id,
    companyId: homeCompany,
    isAdmin: employee.adminAccess === true,
  };
  try {
    await admin.auth().getUser(authUid);
  } catch (error: any) {
    if (error?.code !== 'auth/user-not-found') throw error;
    await admin.auth().createUser({
      uid: authUid,
      displayName: String(employee.name ?? ''),
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
      name: String(employee.name ?? ''),
      username: String(employee.username ?? ''),
      position: String(employee.position ?? ''),
      department: String(employee.department ?? ''),
      joinDate: String(employee.joinDate ?? ''),
      status: employee.status ?? 'working',
      adminAccess: employee.adminAccess === true,
    },
  };
});
