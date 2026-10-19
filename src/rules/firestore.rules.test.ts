import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { initializeApp as initAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getAuth as adminAuth } from 'firebase-admin/auth';
import { getFirestore as adminFirestore } from 'firebase-admin/firestore';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, query, where, runTransaction, writeBatch, getFirestore, connectFirestoreEmulator } from 'firebase/firestore';

/**
 * **회사별·메뉴별 권한을 규칙이 실제로 막는가.**
 *
 * 2026-09-16 코덱스 인수인계 · 사장님: "회사별 권한과 메뉴별 권한을 Firestore 규칙에서
 * 실제로 강제할 것. **화면 메뉴 숨김만으로 끝내면 안 된다.**"
 *
 * 화면에서 숨기는 것은 권한이 아니다 — 브라우저 콘솔에서 질의 한 줄이면 다 읽힌다.
 * 그래서 **규칙이 막는지**를 여기서 확인한다. 네 주체로 본다:
 *
 *     미로그인       아무것도 못 한다
 *     태백 직원      태백 현장 자료만. 풍회도, 돈·인사도 못 본다
 *     풍회 직원      풍회 현장 자료만
 *     태백 관리자     태백 것만 — **돈·인사까지. 그래도 풍회는 못 본다**
 *     풍회 관리자     풍회 것만
 *
 * **회사 경계는 관리자도 못 넘는다**(사장님) — 운영 계정이 회사마다 따로 있다
 * (`admin`·`admin-punghoe`). `isAdmin` 은 메뉴만 가른다.
 *
 * 시험 대상은 실제 배포 파일인 `firestore.rules`다.
 *
 * **에뮬레이터가 있어야 돈다.** `npm run emulators:local` 을 켜고 돌린다.
 * 안 켜져 있으면 이 파일은 통째로 건너뛴다(`describe.skipIf`) — 다른 시험까지 막지 않는다.
 */

const documentRulesPort = Number((process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8082').split(':')[1]);
const 에뮬있나 = async () => {
  try {
    const r = await fetch(`http://127.0.0.1:${documentRulesPort}/`, { signal: AbortSignal.timeout(1500) });
    return r.status < 500;
  } catch { return false; }
};

const 켜짐 = await 에뮬있나();
let env: RulesTestEnvironment;
const ownRulesProject = 'demo-rules-' + randomUUID().slice(0,8);
let ownRulesAdmin: ReturnType<typeof initAdmin>;
async function clearOwnRulesFixtures() {
  if (!ownRulesAdmin) return;
  const database = adminFirestore(ownRulesAdmin);
  for (const collection of await database.listCollections()) for (const row of (await collection.get()).docs) await database.recursiveDelete(row.ref);
}

//  주체 넷 — claim 모양은 `functions/src/employeeLogin.ts` 가 발급하는 것 그대로다.
const 태백직원 = () => env.authenticatedContext('u-taebaek', { employeeId: 'e1', companyId: 'taebaek', isAdmin: false }).firestore();
const 풍회직원 = () => env.authenticatedContext('u-punghoe', { employeeId: 'e9', companyId: 'punghoe', isAdmin: false }).firestore();
const 관리자 = () => env.authenticatedContext('u-admin', { employeeId: 'admin', companyId: 'taebaek', isAdmin: true }).firestore();
const 풍회관리자 = () => env.authenticatedContext('u-admin-ph', { employeeId: 'admin-punghoe', companyId: 'punghoe', isAdmin: true }).firestore();
const 미로그인 = () => env.unauthenticatedContext().firestore();
//  익명 로그인 — Firebase 계정은 있지만 `employeeId` claim 이 없다. 예전에 이걸로 다 열렸다.
const 익명 = () => env.authenticatedContext('anon', {}).firestore();

describe.skipIf(!켜짐)('회사별·메뉴별 권한 (Firestore 규칙)', () => {
  it.skipIf(process.env.CASH_WRITE_RULES_AUTH_TEST !== 'true')('현금·전표·기초 감사 서버 저장: 실제 로그인·양사 조회·직접 쓰기 거절·원문 보존', async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8082' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('격리 에뮬레이터 주소를 확인하세요.');
    const prefix = `cash-rules-${randomUUID()}`;
    const admin = initAdmin({ projectId: 'demo-taebaekfood-local' }, prefix);
    const database = adminFirestore(admin), users: string[] = [], apps: FirebaseApp[] = [], paths: string[] = [];
    try {
      const clients = [];
      for (const companyId of ['taebaek', 'punghoe'] as const) {
        const uid = `${prefix}-${companyId}`, employeeId = `${uid}-employee`, email = `${uid}@example.invalid`, password = `${randomUUID()}Aa1!`;
        await adminAuth(admin).createUser({ uid, email, password }); users.push(uid);
        await adminAuth(admin).setCustomUserClaims(uid, { employeeId, companyId, isAdmin: true });
        const app = initializeApp({ projectId: 'demo-taebaekfood-local', apiKey: 'local-emulator-only' }, uid); apps.push(app);
        const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
        const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8082);
        await signInWithEmailAndPassword(auth, email, password);
        expect(auth.currentUser!.uid).not.toBe(employeeId);
        expect((await auth.currentUser!.getIdTokenResult(true)).claims).toMatchObject({ employeeId, companyId, isAdmin: true });
        clients.push({ db, companyId });
        const path = `cashEntries/${prefix}-${companyId}-read`; paths.push(path);
        await database.doc(path).create({ companyId, amount: 10 });
        for (const name of ['issuedStatements', 'financialOpeningOperations']) {
          const auditPath = `${name}/${prefix}-${companyId}-read`; paths.push(auditPath);
          await database.doc(auditPath).create({ companyId, amount: 10 });
        }
      }
      // 실제 직원 로그인도 UID와 employeeId가 다르다. 관리자와 동일 회사 조회만 허용한다.
      const returnClients = clients.map(client => ({ ...client, isAdmin: true, hasClaim: true }));
      for (const companyId of ['taebaek', 'punghoe', 'no-claim'] as const) {
        const uid = `${prefix}-${companyId}-staff`, employeeId = `${uid}-employee`, email = `${uid}@example.invalid`, password = `${randomUUID()}Aa1!`;
        await adminAuth(admin).createUser({ uid, email, password }); users.push(uid);
        if (companyId !== 'no-claim') await adminAuth(admin).setCustomUserClaims(uid, { employeeId, companyId, isAdmin: false });
        const app = initializeApp({ projectId: 'demo-taebaekfood-local', apiKey: 'local-emulator-only' }, uid); apps.push(app);
        const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
        const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8082);
        await signInWithEmailAndPassword(auth, email, password);
        expect(auth.currentUser!.uid).not.toBe(employeeId);
        const claims = (await auth.currentUser!.getIdTokenResult(true)).claims;
        if (companyId === 'no-claim') expect(claims.employeeId).toBeUndefined();
        else expect(claims).toMatchObject({ employeeId, companyId, isAdmin: false });
        returnClients.push({ db, companyId: companyId === 'no-claim' ? 'taebaek' : companyId, isAdmin: false, hasClaim: companyId !== 'no-claim' });
      }
      for (const companyId of ['taebaek', 'punghoe']) {
        for (const name of ['returnRequests', 'returnSubmissionOperations', 'taxIssueRecords', 'taxIssueOperations']) {
          const path = `${name}/${prefix}-${companyId}-read`; paths.push(path);
          await database.doc(path).create({ companyId, status: name === 'returnRequests' ? 'pending' : 'accepted', amount: 10 });
        }
      }
      for (const { db, companyId, isAdmin, hasClaim } of returnClients) {
        const other = companyId === 'taebaek' ? 'punghoe' : 'taebaek';
        for (const name of ['returnRequests', 'returnSubmissionOperations', 'taxIssueRecords', 'taxIssueOperations']) {
          const path = `${name}/${prefix}-${companyId}-read`, newPath = `${path}-new`;
          if (!paths.includes(newPath)) paths.push(newPath);
          const original = (await database.doc(path).get()).data()!;
          const canRead = hasClaim && (name === 'returnRequests' || isAdmin);
          if (canRead) {
            await assertSucceeds(getDoc(doc(db, path)));
            await assertSucceeds(getDocs(query(collection(db, name), where('companyId', '==', companyId))));
          } else {
            await assertFails(getDoc(doc(db, path)));
            await assertFails(getDocs(query(collection(db, name), where('companyId', '==', companyId))));
          }
          await assertFails(getDoc(doc(db, `${name}/${prefix}-${other}-read`)));
          await assertFails(getDocs(query(collection(db, name), where('companyId', '==', other))));
          await assertFails(getDocs(collection(db, name)));
          await assertFails(setDoc(doc(db, newPath), original));
          await assertFails(setDoc(doc(db, path), { ...original, amount: 20 }));
          await assertFails(updateDoc(doc(db, path), { amount: 20 }));
          await assertFails(deleteDoc(doc(db, path)));
          // 읽기 가능한 주체도 두 문서 원자 변경을 시작할 수 없다.
          await assertFails(runTransaction(db, async tx => {
            if (canRead) await tx.get(doc(db, path));
            tx.update(doc(db, path), { amount: 30 });
            tx.set(doc(db, newPath), original);
          }));
          const batch = writeBatch(db);
          batch.delete(doc(db, path)); batch.set(doc(db, newPath), original);
          await assertFails(batch.commit());
          expect((await database.doc(path).get()).data()).toEqual(original);
          expect((await database.doc(newPath).get()).exists).toBe(false);
        }
      }
      for (const { db, companyId } of clients) {
        const other = companyId === 'taebaek' ? 'punghoe' : 'taebaek';
        const taxPath = `taxIssueRecords/${prefix}-${companyId}-read`;
        const statementPath = `issuedStatements/${prefix}-${companyId}-read`;
        const taxBefore = (await database.doc(taxPath).get()).data();
        const statementBefore = (await database.doc(statementPath).get()).data();
        // 옛 완료 저장의 기록+원전표 merge를 함께 시도해도 일부 저장이 없어야 한다.
        await assertFails(runTransaction(db, async tx => {
          await tx.get(doc(db, taxPath)); await tx.get(doc(db, statementPath));
          tx.set(doc(db, taxPath), { issuedAt: '2026-10-09T12:00:00Z' }, { merge: true });
          tx.set(doc(db, statementPath), { taxIssuedAt: '2026-10-09T12:00:00Z' }, { merge: true });
        }));
        expect((await database.doc(taxPath).get()).data()).toEqual(taxBefore);
        expect((await database.doc(statementPath).get()).data()).toEqual(statementBefore);
        await assertSucceeds(getDoc(doc(db, `cashEntries/${prefix}-${companyId}-read`)));
        await assertSucceeds(getDocs(query(collection(db, 'cashEntries'), where('companyId', '==', companyId))));
        await assertFails(getDoc(doc(db, `cashEntries/${prefix}-${other}-read`)));
        await assertFails(getDocs(query(collection(db, 'cashEntries'), where('companyId', '==', other))));
        await assertFails(getDocs(collection(db, 'cashEntries')));
        for (const name of ['issuedStatements', 'financialOpeningOperations']) {
          const path = `${name}/${prefix}-${companyId}-read`, newPath = `${path}-new`;
          paths.push(newPath);
          await assertSucceeds(getDoc(doc(db, path)));
          await assertSucceeds(getDocs(query(collection(db, name), where('companyId', '==', companyId))));
          await assertFails(getDoc(doc(db, `${name}/${prefix}-${other}-read`)));
          await assertFails(getDocs(query(collection(db, name), where('companyId', '==', other))));
          await assertFails(getDocs(collection(db, name)));
          await assertFails(setDoc(doc(db, newPath), { companyId, amount: 20 }));
          await assertFails(setDoc(doc(db, path), { companyId, amount: 20 }));
          await assertFails(updateDoc(doc(db, path), { amount: 20 }));
          await assertFails(deleteDoc(doc(db, path)));
          expect((await database.doc(path).get()).data()).toEqual({ companyId, amount: 10 });
          expect((await database.doc(newPath).get()).exists).toBe(false);
        }
        const variants = [ {}, ...['108', '251', '253'].map(accountCode => ({ accountCode })),
          { loanId: `${prefix}-loan` }, { payrollId: `${prefix}-payroll` }, { transferOperationId: `${prefix}-transfer` } ];
        for (const [index, fields] of variants.entries()) {
          const original = { companyId, dir: '출금', amount: 100, date: '2026-10-09', ...fields };
          const path = `cashEntries/${prefix}-${companyId}-${index}`; paths.push(path);
          // 서버 Admin SDK 생산은 성공하고, 같은 문서의 클라이언트 변경은 거절되어야 한다.
          await database.doc(path).create(original);
          const newPath = `${path}-new`; paths.push(newPath);
          await assertFails(setDoc(doc(db, newPath), original));
          await assertFails(setDoc(doc(db, path), { ...original, amount: 200 }));
          await assertFails(updateDoc(doc(db, path), { amount: 200 }));
          await assertFails(deleteDoc(doc(db, path)));
          expect((await database.doc(path).get()).data()).toEqual(original);
          expect((await database.doc(newPath).get()).exists).toBe(false);
        }
      }
    } finally {
      for (const path of paths) {
        if (!path.includes(prefix)) throw new Error('자기 문서가 아닌 정리 경로입니다.');
        await database.doc(path).delete(); expect((await database.doc(path).get()).exists).toBe(false);
      }
      for (const uid of users) await adminAuth(admin).deleteUser(uid);
      for (const app of apps) await deleteApp(app);
      await deleteAdmin(admin);
    }
  }, 90_000);
  describe('OEM 취소 가공비 부재 단건 조회', () => {
    it('양사 관리자만 없는 OEM 가공비 요청을 단건 조회한다', async () => {
      for (const db of [관리자(), 풍회관리자()]) await assertSucceeds(getDoc(doc(db, 'adjustmentRequests', 'OEMFEE-cancel-missing')));
      for (const db of [태백직원(), 풍회직원(), 미로그인()]) await assertFails(getDoc(doc(db, 'adjustmentRequests', 'OEMFEE-cancel-missing')));
      await assertFails(getDoc(doc(관리자(), 'adjustmentRequests', 'ordinary-cancel-missing')));
    });
    it('기존 가공비의 회사 경계와 회사 조건 없는 목록 거절은 유지한다', async () => {
      await env.withSecurityRulesDisabled(async ctx => {
        await setDoc(doc(ctx.firestore(), 'adjustmentRequests', 'OEMFEE-cancel-existing'), { companyId: 'taebaek', status: 'pending', requestedBy: 'e1' });
      });
      await assertSucceeds(getDoc(doc(관리자(), 'adjustmentRequests', 'OEMFEE-cancel-existing')));
      await assertSucceeds(getDoc(doc(태백직원(), 'adjustmentRequests', 'OEMFEE-cancel-existing')));
      await assertFails(getDoc(doc(풍회관리자(), 'adjustmentRequests', 'OEMFEE-cancel-existing')));
      await assertFails(getDocs(collection(관리자(), 'adjustmentRequests')));
      await assertSucceeds(getDocs(query(collection(관리자(), 'adjustmentRequests'), where('companyId', '==', 'taebaek'))));
    });
  });
  describe('서버 공통 전환 설정 단건 조회', () => {
    const gate = (db: any) => doc(db, 'appMeta', 'releaseCutover');
    beforeEach(async () => {
      await env.withSecurityRulesDisabled(async ctx => {
        await setDoc(gate(ctx.firestore()), { status: 'active', releaseId: 'release-test' });
        await setDoc(doc(ctx.firestore(), 'appMeta', 'workOrderReset_taebaek'), { companyId: 'taebaek', date: '2026-10-07' });
      });
    });
    it('양사 관리자는 회사 없는 전환 설정을 단건으로 읽는다', async () => {
      await assertSucceeds(getDoc(gate(관리자())));
      await assertSucceeds(getDoc(gate(풍회관리자())));
    });
    it('직원·미로그인·회사 없는 관리자는 읽지 못한다', async () => {
      await assertFails(getDoc(gate(태백직원())));
      await assertFails(getDoc(gate(풍회직원())));
      await assertFails(getDoc(gate(미로그인())));
      const invalid = env.authenticatedContext('invalid-admin', { employeeId: 'admin', isAdmin: true }).firestore();
      await assertFails(getDoc(gate(invalid)));
    });
    it('관리자도 전환 설정 목록·수정·삭제를 할 수 없다', async () => {
      await assertFails(getDocs(collection(관리자(), 'appMeta')));
      await assertFails(updateDoc(gate(관리자()), { status: 'paused' }));
      await assertFails(deleteDoc(gate(관리자())));
    });
    it('회사값이 붙어도 포괄 규칙으로 전환 설정을 쓰거나 직원이 읽지 못한다', async () => {
      await env.withSecurityRulesDisabled(ctx => setDoc(gate(ctx.firestore()), { companyId: 'taebaek', status: 'active' }));
      await assertSucceeds(getDoc(gate(관리자())));
      await assertFails(getDoc(gate(태백직원())));
      await assertFails(getDocs(query(collection(관리자(), 'appMeta'), where('companyId', '==', 'taebaek'))));
      await assertFails(setDoc(gate(관리자()), { companyId: 'taebaek', status: 'paused' }));
      await assertFails(updateDoc(gate(관리자()), { status: 'paused' }));
      await assertFails(deleteDoc(gate(관리자())));
    });
    it('없는 전환 설정도 앱에서 생성하지 못한다', async () => {
      await env.withSecurityRulesDisabled(ctx => deleteDoc(gate(ctx.firestore())));
      await assertFails(setDoc(gate(관리자()), { companyId: 'taebaek', status: 'active' }));
      await assertFails(setDoc(gate(태백직원()), { companyId: 'taebaek', status: 'active' }));
    });
    it('다른 회사별 appMeta의 기존 읽기·쓰기 경계를 유지한다', async () => {
      const own = doc(태백직원(), 'appMeta', 'workOrderReset_taebaek');
      await assertSucceeds(getDoc(own));
      await assertSucceeds(updateDoc(own, { date: '2026-10-08' }));
      await assertFails(getDoc(doc(풍회관리자(), 'appMeta', 'workOrderReset_taebaek')));
    });
  });
  it('공지는 직원이 읽되 관리자만 작성·고정·삭제한다', async () => {
    const target = (db: any) => doc(db, 'notices', 'notice-test');
    await assertSucceeds(setDoc(target(관리자()), { companyId: 'taebaek', title: '공지' }));
    await assertSucceeds(getDoc(target(태백직원())));
    await assertFails(updateDoc(target(태백직원()), { pinned: true }));
    await assertFails(deleteDoc(target(태백직원())));
    await assertFails(getDoc(target(풍회관리자())));
    await assertSucceeds(updateDoc(target(관리자()), { pinned: true }));
    await assertSucceeds(deleteDoc(target(관리자())));
  });
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: ownRulesProject,
      firestore: { rules: readFileSync('firestore.rules', 'utf-8'), host: '127.0.0.1', port: documentRulesPort },
    });
  });
  afterAll(async () => { await clearOwnRulesFixtures(); await env?.cleanup(); if(ownRulesAdmin) await deleteAdmin(ownRulesAdmin); });

  beforeEach(async () => {
    if(!ownRulesAdmin) ownRulesAdmin = initAdmin({projectId:ownRulesProject},ownRulesProject);
    await clearOwnRulesFixtures();
    //  규칙을 끄고 밑자료를 깐다 — 시험하려는 건 **읽고 쓰는 쪽**이지 심는 쪽이 아니다.
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'orders', 'o-taebaek'), { companyId: 'taebaek', partnerName: '수카페' });
      await setDoc(doc(db, 'orders', 'o-punghoe'), { companyId: 'punghoe', partnerName: '풍회거래처' });
      await setDoc(doc(db, 'orders', 'o-없음'), { partnerName: '회사없는옛주문' });
      await setDoc(doc(db, 'items', 'i-taebaek'), { companyId: 'taebaek', name: '참기름' });
      await setDoc(doc(db, 'cashEntries', 'c-taebaek'), { companyId: 'taebaek', amount: 1000 });
      await setDoc(doc(db, 'issuedStatements', 's-taebaek'), { companyId: 'taebaek', totalAmount: 5000 });
      await setDoc(doc(db, 'openingBalances', 'main'), { companyId: 'taebaek', date: '2026-07-31', amounts: { 103: 10000000 } });
      await setDoc(doc(db, 'openingBalances', 'main-punghoe'), { companyId: 'punghoe', date: '2026-07-31', amounts: { 103: 20000000 } });
      await setDoc(doc(db, 'employees', 'e1'), { companyId: 'taebaek', name: '이지영', fcmTokens: [] });
      await setDoc(doc(db, 'employees', 'e2'), { companyId: 'taebaek', name: '같은 회사 직원' });
      await setDoc(doc(db, 'employees', 'e9'), { companyId: 'punghoe', name: '우용', fcmTokens: [] });
      await setDoc(doc(db, 'leaveRequests', 'lv-e1'), { companyId: 'taebaek', employeeId: 'e1', status: 'pending' });
      await setDoc(doc(db, 'leaveRequests', 'lv-e9'), { companyId: 'punghoe', employeeId: 'e9', status: 'pending' });
      await setDoc(doc(db, 'adjustmentRequests', 'adj-1'), { companyId: 'taebaek', itemId: 'i-taebaek', qty: 5, requestedBy: 'e1', status: 'pending' });
      //  오피스톡 — 방과 메시지, 알림
      await setDoc(doc(db, 'chatRooms', 'room-taebaek'), { companyId: 'taebaek', participantIds: ['e1'], participantCompanies: { e1: 'taebaek' } });
      await setDoc(doc(db, 'chatRooms', 'room-punghoe'), { companyId: 'punghoe', participantIds: ['e9'], participantCompanies: { e9: 'punghoe' } });
      await setDoc(doc(db, 'chatMessages', 'msg-1'), { companyId: 'taebaek', roomId: 'room-taebaek', senderId: 'e1' });
      await setDoc(doc(db, 'notifications', 'n-1'), { companyId: 'taebaek', targetId: 'e1', title: '개인 알림', readBy: [] });
      //  문서함 — 실제 컬렉션 이름이다(`fileCabinet` 이 아니다)
      await setDoc(doc(db, 'fileCabinetDocs', 'fc-1'), { companyId: 'taebaek', fileName: '원료수불부.xlsx' });
      await setDoc(doc(db, 'fileCabinetCategories', 'fcc-1'), { companyId: 'taebaek', name: '서류관리' });
      await setDoc(doc(db, 'fileCabinetSubCategories', 'fcs-1'), { companyId: 'taebaek', name: '원료수불부' });
    });
  });

  describe('생산작업일지 전용 회사·버전 경계', () => {
    const id = 'taebaek__production-work__2026-09-22';
    const header = (revision = 1) => ({
      id, companyId: 'taebaek', documentDate: '2026-09-22', templateVersion: 1, revision,
      rowCount: 1, createdAt: '2026-09-27T00:00:00Z', updatedAt: '2026-09-27T00:00:00Z',
      createdBy: 'u-taebaek', updatedBy: 'u-taebaek', specialNotes: '',
      preparedByName: '', reviewedByName: '', approvedByName: '',
    });
    const line = (suffix = 'a', revision = 1) => ({
      id: id + '__' + suffix, documentId: id, companyId: 'taebaek', documentRevision: revision,
      batchKey: 'batch', sortOrder: 0, sourceState: 'active', source: { kind: 'manual' },
      manualFields: {}, sourceSnapshot: {}, productionQty: 1000, rawUsedKg: 276,
    });
    const seed = async () => {
      const db = 태백직원();
      const batch = writeBatch(db);
      batch.set(doc(db, 'productionWorkDocuments', id), header());
      batch.set(doc(db, 'productionWorkDocumentLines', id + '__a'), line());
      await assertSucceeds(batch.commit());
    };
    it('동회사 일반 직원이 헤더와 행을 함께 저장하고 타회사는 읽거나 쓸 수 없다', async () => {
      await seed();
      await assertSucceeds(getDocs(query(collection(태백직원(), 'productionWorkDocuments'), where('companyId', '==', 'taebaek'))));
      await assertFails(getDoc(doc(풍회직원(), 'productionWorkDocuments', id)));
      await assertFails(updateDoc(doc(풍회관리자(), 'productionWorkDocuments', id), { revision: 2 }));
      await assertFails(setDoc(doc(익명(), 'productionWorkDocuments', id), header(2)));
    });
    it('헤더 버전 없이 행 수정·삭제하거나 오래된 버전으로 덮어쓰지 못한다', async () => {
      await seed();
      await assertFails(updateDoc(doc(태백직원(), 'productionWorkDocumentLines', id + '__a'), { productionQty: 2000 }));
      await assertFails(deleteDoc(doc(태백직원(), 'productionWorkDocumentLines', id + '__a')));
      await assertFails(setDoc(doc(태백직원(), 'productionWorkDocuments', id), header(1)));
    });
    it('행 교체를 원자 처리하고 실패한 교체는 기존 문서를 유지한다', async () => {
      await seed();
      const db = 태백직원();
      const invalid = writeBatch(db);
      invalid.set(doc(db, 'productionWorkDocuments', id), header(2));
      invalid.delete(doc(db, 'productionWorkDocumentLines', id + '__a'));
      invalid.set(doc(db, 'productionWorkDocumentLines', id + '__b'), { ...line('b', 2), companyId: 'punghoe' });
      await assertFails(invalid.commit());
      expect((await getDoc(doc(db, 'productionWorkDocuments', id))).data()?.revision).toBe(1);
      expect((await getDoc(doc(db, 'productionWorkDocumentLines', id + '__a'))).exists()).toBe(true);
      const valid = writeBatch(db);
      valid.set(doc(db, 'productionWorkDocuments', id), header(2));
      valid.delete(doc(db, 'productionWorkDocumentLines', id + '__a'));
      valid.set(doc(db, 'productionWorkDocumentLines', id + '__b'), line('b', 2));
      await assertSucceeds(valid.commit());
      expect((await getDoc(doc(db, 'productionWorkDocumentLines', id + '__a'))).exists()).toBe(false);
      expect((await getDoc(doc(db, 'productionWorkDocumentLines', id + '__b'))).data()?.documentRevision).toBe(2);
    });
  });


  describe('미로그인·익명은 아무것도 못 한다', () => {
    it('미로그인은 못 읽는다', async () => {
      await assertFails(getDoc(doc(미로그인(), 'orders', 'o-taebaek')));
    });

    it('**익명 계정도 못 읽는다** — 예전엔 이걸로 다 열렸다', async () => {
      //  2026-09-16 규칙 강화 전에는 `request.auth != null` 만 봐서 익명이 통과했다.
      await assertFails(getDoc(doc(익명(), 'orders', 'o-taebaek')));
      await assertFails(setDoc(doc(익명(), 'orders', 'o-새것'), { companyId: 'taebaek' }));
    });
  });

  describe('회사 경계', () => {
    it('원자화 명령이 같은 회사의 아직 없는 작업 문서를 확인할 수 있다', async () => {
      const snap = await assertSucceeds(getDoc(doc(태백직원(), 'rawMaterialLedger', 'op-아직없음')));
      expect(snap.exists()).toBe(false);
    });

    it('로그인하지 않은 사용자는 없는 작업 문서도 확인할 수 없다', async () => {
      await assertFails(getDoc(doc(미로그인(), 'rawMaterialLedger', 'op-아직없음')));
    });

    it('태백 직원은 태백 것을 읽는다', async () => {
      await assertSucceeds(getDoc(doc(태백직원(), 'orders', 'o-taebaek')));
    });

    it('**태백 직원은 풍회 것을 못 읽는다**', async () => {
      await assertFails(getDoc(doc(태백직원(), 'orders', 'o-punghoe')));
    });

    it('**풍회 직원은 태백 것을 못 읽는다**', async () => {
      await assertFails(getDoc(doc(풍회직원(), 'orders', 'o-taebaek')));
      await assertFails(getDoc(doc(풍회직원(), 'items', 'i-taebaek')));
    });

    it('풍회 직원은 풍회 것을 읽는다', async () => {
      await assertSucceeds(getDoc(doc(풍회직원(), 'orders', 'o-punghoe')));
    });

    it('**남의 회사 것을 내 회사로 바꿔 가져올 수 없다**', async () => {
      //  쓸 때 들어오는 값만 보면, 풍회 문서를 태백으로 덮어써 제 것으로 만들 수 있다.
      await assertFails(updateDoc(doc(태백직원(), 'orders', 'o-punghoe'), { companyId: 'taebaek' }));
    });

    it('**내 회사 것을 남의 회사로 넘길 수 없다**', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'orders', 'o-taebaek'), { companyId: 'punghoe' }));
    });

    it('태백 관리자는 태백 것을 읽는다', async () => {
      await assertSucceeds(getDoc(doc(관리자(), 'orders', 'o-taebaek')));
    });

    it('**태백 관리자도 풍회 것은 못 읽는다** — 회사 경계는 관리자도 못 넘는다', async () => {
      //  회사를 바꾸려면 그 회사 계정(`admin-punghoe`)으로 로그인한다.
      await assertFails(getDoc(doc(관리자(), 'orders', 'o-punghoe')));
    });

    it('풍회 관리자는 풍회 것을 읽는다', async () => {
      await assertSucceeds(getDoc(doc(풍회관리자(), 'orders', 'o-punghoe')));
      await assertFails(getDoc(doc(풍회관리자(), 'orders', 'o-taebaek')));
    });
  });

  describe('회사가 안 적힌 문서는 아무도 못 본다', () => {
    it('직원도 관리자도 못 읽는다 — 조용히 새느니 막는다', async () => {
      await assertFails(getDoc(doc(태백직원(), 'orders', 'o-없음')));
      await assertFails(getDoc(doc(관리자(), 'orders', 'o-없음')));
    });

    it('**회사를 안 붙이고는 못 만든다**', async () => {
      await assertFails(setDoc(doc(태백직원(), 'orders', 'o-새것'), { partnerName: '회사없음' }));
      await assertSucceeds(setDoc(doc(태백직원(), 'orders', 'o-새것2'), { companyId: 'taebaek', partnerName: '있음', inventoryWriterProtocolVersion:1,inventoryWriteRevision:1 }));
    });
  });

  describe('메뉴 경계 — 돈·인사는 관리자만', () => {
    it('생산판매일지는 관리자만 자기 회사값을 붙여 저장한다', async () => {
      await assertFails(setDoc(doc(태백직원(), 'productionSalesLogs', 'psl-직원'), { companyId: 'taebaek', date: '2026-09-17' }));
      await assertFails(setDoc(doc(관리자(), 'productionSalesLogs', 'psl-회사없음'), { date: '2026-09-17' }));
      await assertFails(setDoc(doc(관리자(), 'productionSalesLogs', 'psl-풍회'), { companyId: 'punghoe', date: '2026-09-17' }));
      await assertSucceeds(setDoc(doc(관리자(), 'productionSalesLogs', 'psl-태백'), { companyId: 'taebaek', date: '2026-09-17' }));
    });

    it('**일반 직원은 자금원장을 못 읽는다**', async () => {
      await assertFails(getDoc(doc(태백직원(), 'cashEntries', 'c-taebaek')));
    });

    it('**일반 직원은 전표를 못 읽는다**', async () => {
      await assertFails(getDoc(doc(태백직원(), 'issuedStatements', 's-taebaek')));
    });

    it('일반 직원은 전표를 못 만든다', async () => {
      await assertFails(setDoc(doc(태백직원(), 'issuedStatements', 's-새것'), { companyId: 'taebaek', totalAmount: 1 }));
    });

    it('관리자는 자금·전표를 읽고 전표 직접 저장은 하지 못한다', async () => {
      await assertSucceeds(getDoc(doc(관리자(), 'cashEntries', 'c-taebaek')));
      await assertSucceeds(getDoc(doc(관리자(), 'issuedStatements', 's-taebaek')));
      await assertFails(setDoc(doc(관리자(), 'issuedStatements', 's-새것'), { companyId: 'taebaek', totalAmount: 1 }));
    });

    it('대출 계약은 자기 회사 관리자만 읽고 쓴다', async () => {
      const id = 'loan-rule-test';
      await assertFails(setDoc(doc(태백직원(), 'loanContracts', id), { companyId: 'taebaek', name: '운전자금' }));
      await assertFails(setDoc(doc(관리자(), 'loanContracts', id), { companyId: 'punghoe', name: '운전자금' }));
      await assertSucceeds(setDoc(doc(관리자(), 'loanContracts', id), { companyId: 'taebaek', name: '운전자금' }));
      await assertFails(getDoc(doc(태백직원(), 'loanContracts', id)));
      await assertSucceeds(getDoc(doc(관리자(), 'loanContracts', id)));
      await assertFails(getDoc(doc(풍회관리자(), 'loanContracts', id)));
    });

    it('**태백 관리자는 풍회 전표를 못 만든다**', async () => {
      await assertFails(setDoc(doc(관리자(), 'issuedStatements', 's-풍회'), { companyId: 'punghoe', totalAmount: 1 }));
    });

    it('풍회 관리자도 전표 직접 저장은 하지 못한다', async () => {
      await assertFails(setDoc(doc(풍회관리자(), 'issuedStatements', 's-풍회'), { companyId: 'punghoe', totalAmount: 1 }));
    });

    it('현장 자료(주문·품목)는 일반 직원도 쓴다', async () => {
      await assertSucceeds(setDoc(doc(태백직원(), 'items', 'i-새것'), { companyId: 'taebaek', name: '들기름',inventoryWriterProtocolVersion:1,inventoryWriteRevision:1 }));
    });
  });

  describe('기초잔액 — 관리자 전용·회사 조건 질의', () => {
    it('일반 직원은 자기 회사 기초잔액도 읽지 못한다', async () => {
      await assertFails(getDoc(doc(태백직원(), 'openingBalances', 'main')));
      await assertFails(getDocs(query(collection(태백직원(), 'openingBalances'), where('companyId', '==', 'taebaek'))));
    });

    it('관리자는 자기 회사 한 건을 읽지만 다른 회사 것은 못 읽는다', async () => {
      await assertSucceeds(getDoc(doc(관리자(), 'openingBalances', 'main')));
      await assertFails(getDoc(doc(관리자(), 'openingBalances', 'main-punghoe')));
      await assertSucceeds(getDoc(doc(풍회관리자(), 'openingBalances', 'main-punghoe')));
      await assertFails(getDoc(doc(풍회관리자(), 'openingBalances', 'main')));
    });

    it('관리자도 회사 조건 없는 목록 조회는 막고 자기 회사 조건만 허용한다', async () => {
      await assertFails(getDocs(collection(관리자(), 'openingBalances')));
      await assertSucceeds(getDocs(query(collection(관리자(), 'openingBalances'), where('companyId', '==', 'taebaek'))));
      await assertFails(getDocs(query(collection(관리자(), 'openingBalances'), where('companyId', '==', 'punghoe'))));
      await assertSucceeds(getDocs(query(collection(풍회관리자(), 'openingBalances'), where('companyId', '==', 'punghoe'))));
      await assertFails(getDocs(query(collection(풍회관리자(), 'openingBalances'), where('companyId', '==', 'taebaek'))));
    });

    it('회사값 없는 기초잔액과 다른 회사 기초잔액을 만들지 못한다', async () => {
      await assertFails(setDoc(doc(관리자(), 'openingBalances', 'missing-company'), { date: '2026-07-31', amounts: {} }));
      await assertFails(setDoc(doc(관리자(), 'openingBalances', 'wrong-company'), { companyId: 'punghoe', date: '2026-07-31', amounts: {} }));
      await assertSucceeds(setDoc(doc(관리자(), 'openingBalances', 'own-company'), { companyId: 'taebaek', date: '2026-07-31', amounts: {} }));
    });

    it('기존 기초잔액의 회사값을 바꾸거나 지우지 못한다', async () => {
      const ref = doc(관리자(), 'openingBalances', 'main');
      await assertFails(updateDoc(ref, { companyId: 'punghoe' }));
      await assertFails(updateDoc(ref, { companyId: null }));
      await assertSucceeds(updateDoc(ref, { amounts: { 103: 11000000 } }));
    });
  });

  describe('재고 수량 음수 방지', () => {
    it('품목과 원료 상태를 음수로 만들거나 음수로 바꾸는 쓰기를 거절한다', async () => {
      const db = 태백직원();
      const item = doc(db, 'items', 'i-수량');
      const raw = doc(db, 'rawInventories', 'taebaek__i-수량');
      await assertFails(setDoc(item, { companyId: 'taebaek', stock: -1 }));
      await assertFails(setDoc(raw, { companyId: 'taebaek', stockKg: -1 }));
      await assertSucceeds(setDoc(item, { companyId: 'taebaek', stock: 2,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1 }));
      await assertSucceeds(setDoc(raw, { companyId: 'taebaek', stockKg: 2,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1 }));
      await assertFails(updateDoc(item, { stock: -0.001,inventoryWriterProtocolVersion:1,inventoryWriteRevision:2 }));
      await assertFails(updateDoc(raw, { stockKg: -0.001,inventoryWriterProtocolVersion:1,inventoryWriteRevision:2 }));
      await assertFails(updateDoc(item, { stock: '음수 아님' }));
      await assertSucceeds(updateDoc(item, { stock: 0,inventoryWriterProtocolVersion:1,inventoryWriteRevision:2 }));
      await assertSucceeds(updateDoc(raw, { stockKg: 0,inventoryWriterProtocolVersion:1,inventoryWriteRevision:2 }));
    });

    it('기존 음수 재고는 0 쪽 회복과 다른 필드 수정을 허용하고 악화는 거절한다', async () => {
      await env.withSecurityRulesDisabled(async ctx => {
        const db = ctx.firestore();
        await setDoc(doc(db, 'items', 'i-옛음수'), { companyId: 'taebaek', stock: -5, name: '옛 품목' });
        await setDoc(doc(db, 'rawInventories', 'taebaek__i-옛음수'), { companyId: 'taebaek', stockKg: -5, materialSnapshot: '옛 원료' });
      });
      const db = 태백직원();
      const item = doc(db, 'items', 'i-옛음수');
      const raw = doc(db, 'rawInventories', 'taebaek__i-옛음수');
      await assertSucceeds(updateDoc(item, { name: '이름 수정' }));
      await assertSucceeds(updateDoc(raw, { materialSnapshot: '표시 수정',inventoryWriterProtocolVersion:1,inventoryWriteRevision:1 }));
      await assertSucceeds(updateDoc(item, { stock: -4,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1 }));
      await assertSucceeds(updateDoc(raw, { stockKg: -4,inventoryWriterProtocolVersion:1,inventoryWriteRevision:2 }));
      await assertSucceeds(updateDoc(item, { stock: -4,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1 }));
      await assertSucceeds(updateDoc(raw, { stockKg: -4,inventoryWriterProtocolVersion:1,inventoryWriteRevision:3 }));
      await assertFails(updateDoc(item, { stock: -4.001 }));
      await assertFails(updateDoc(raw, { stockKg: -4.001,inventoryWriterProtocolVersion:1,inventoryWriteRevision:4 }));
      await assertSucceeds(updateDoc(item, { stock: 0,inventoryWriterProtocolVersion:1,inventoryWriteRevision:2 }));
      await assertSucceeds(updateDoc(raw, { stockKg: 0,inventoryWriterProtocolVersion:1,inventoryWriteRevision:4 }));
    });

    it('배치의 한 수량이 음수면 다른 쓰기도 함께 반영되지 않는다', async () => {
      const db = 태백직원();
      const batch = writeBatch(db);
      batch.update(doc(db, 'items', 'i-taebaek'), { stock: -1 });
      batch.set(doc(db, 'orders', 'o-배치'), { companyId: 'taebaek', partnerName: '시험' });
      await assertFails(batch.commit());
      expect((await getDoc(doc(db, 'orders', 'o-배치'))).exists()).toBe(false);
    });
  });

  it('OEM 발주 작업과 입고 확인 요청을 회사값이 있는 원자 쓰기로 허용한다', async () => {
    const db = 관리자();
    await assertSucceeds(runTransaction(db, async tx => {
      const itemRef = doc(db, 'items', 'i-taebaek');
      await tx.get(itemRef);
      tx.set(doc(db, 'purchaseOrders', 'oem-job-1'), { companyId: 'taebaek', poType: 'oem', status: 'pending', oemIssueStatus: 'processing' });
      tx.set(doc(db, 'rawInventoryJobs', 'oem-issue-oem-job-1'), { companyId: 'taebaek', status: 'complete',inventoryWriterProtocolVersion:1,inventoryWriteRevision:1 });
      tx.set(doc(db, 'rawMaterialLedger', 'oem-ledger-1'), { companyId: 'taebaek', operationId: 'oem-issue:oem-job-1:raw-1',inventoryWriterProtocolVersion:1,inventoryWriteRevision:1 });
      tx.set(doc(db, 'adjustmentRequests', 'OEMFEE-oem-job-1'), { companyId: 'taebaek', type: 'oem_fee', oemPoId: 'oem-job-1', status: 'pending' });
      tx.update(itemRef, { companyId: 'taebaek', stock: 1,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1 });
    }));
    expect((await getDoc(doc(db, 'adjustmentRequests', 'OEMFEE-oem-job-1'))).exists()).toBe(true);
    await assertFails(setDoc(doc(풍회관리자(), 'adjustmentRequests', 'OEMFEE-oem-job-2'), { companyId: 'taebaek', type: 'oem_fee' }));
  });

  it('직접 전표 발행 거래를 거절하고 연관 기록도 일부 저장하지 않는다', async () => {
    const db = env.authenticatedContext('u-eunkyung', {
      employeeId: 'admin-taebaek-eunkyung', companyId: 'taebaek', isAdmin: true,
    }).firestore();
    const statementRef = doc(db, 'issuedStatements', 's-transaction');
    await assertFails(runTransaction(db, async tx => {
      expect((await tx.get(statementRef)).exists()).toBe(false);
      tx.set(statementRef, { companyId: 'taebaek', operationId: 'issue-s-transaction', totalAmount: 5000 });
      tx.set(doc(db, 'orders', 'o-taebaek'), { companyId: 'taebaek', invoicePrinted: true }, { merge: true });
      tx.set(doc(db, 'items', 'i-taebaek'), { companyId: 'taebaek', cost: 100 }, { merge: true });
      tx.set(doc(db, 'itemCostHistory', 's-transaction_i-taebaek_0'), { companyId: 'taebaek', itemId: 'i-taebaek', beforeCost: 0, afterCost: 100 });
      tx.set(doc(db, 'purchaseOrders', 'po-transaction'), { companyId: 'taebaek', linkedStatementId: 's-transaction', status: 'invoiced' });
    }));
    expect((await getDoc(statementRef)).exists()).toBe(false);
    expect((await getDoc(doc(db, 'purchaseOrders', 'po-transaction'))).exists()).toBe(false);
    expect((await getDoc(doc(db, 'itemCostHistory', 's-transaction_i-taebaek_0'))).exists()).toBe(false);
  });

  describe('companyId 누락 쓰기 — 컬렉션 갈래별 차단', () => {
    it('현장 자료·관리자 자료·직원 전용 규칙 모두 회사값 없는 생성을 막는다', async () => {
      await assertFails(setDoc(doc(태백직원(), 'items', 'i-회사없음'), { name: '회사없는품목' }));
      await assertFails(setDoc(doc(관리자(), 'cashEntries', 'c-회사없음'), { amount: 1000 }));
      await assertFails(setDoc(doc(관리자(), 'employees', 'e-회사없음'), { name: '회사없는직원' }));
      await assertFails(setDoc(doc(태백직원(), 'leaveRequests', 'lv-회사없음'), { employeeId: 'e1', status: 'pending' }));
      await assertFails(setDoc(doc(태백직원(), 'adjustmentRequests', 'adj-회사없음'), { itemId: 'i-taebaek', requestedBy: 'e1', status: 'pending' }));
      await assertFails(setDoc(doc(태백직원(), 'chatRooms', 'room-회사없음'), { participantIds: ['e1'], participantCompanies: { e1: 'taebaek' } }));
      await assertFails(setDoc(doc(태백직원(), 'chatMessages', 'msg-회사없음'), { roomId: 'room-taebaek', senderId: 'e1' }));
      await assertFails(setDoc(doc(태백직원(), 'notifications', 'n-회사없음'), { targetId: 'e1' }));
    });
  });

  describe('직원 문서', () => {
    it('같은 회사 직원은 서로 읽는다', async () => {
      await assertSucceeds(getDoc(doc(태백직원(), 'employees', 'e1')));
    });

    it('**다른 회사 직원은 못 읽는다**', async () => {
      await assertFails(getDoc(doc(태백직원(), 'employees', 'e9')));
    });

    it('본인은 **푸시 표만** 고친다', async () => {
      await assertSucceeds(updateDoc(doc(태백직원(), 'employees', 'e1'), { fcmTokens: ['t1'] }));
    });

    it('**본인이 자기를 관리자로 못 올린다**', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'employees', 'e1'), { adminAccess: true }));
    });

    it('**남의 푸시 표도 못 고친다**', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'employees', 'e9'), { fcmTokens: ['t1'] }));
    });

    it('직원을 만들거나 지우는 건 관리자만', async () => {
      await assertFails(setDoc(doc(태백직원(), 'employees', 'e-새것'), { companyId: 'taebaek', name: '새사람' }));
      await assertSucceeds(setDoc(doc(관리자(), 'employees', 'e-새것'), { companyId: 'taebaek', name: '새사람' }));
    });
  });

  describe('연차 — 본인이 내고 관리자가 결재한다', () => {
    it('본인 이름으로만 낸다', async () => {
      await assertSucceeds(setDoc(doc(태백직원(), 'leaveRequests', 'lv-새것'), { companyId: 'taebaek', employeeId: 'e1', status: 'pending' }));
    });

    it('**남의 이름으로 못 낸다**', async () => {
      await assertFails(setDoc(doc(태백직원(), 'leaveRequests', 'lv-남'), { companyId: 'taebaek', employeeId: 'e2', status: 'pending' }));
    });

    it('직원은 신청 생성으로 승인·결재·수동 미차감을 우회하지 못한다', async () => {
      for (const status of ['approved', 'rejected', 'cancelled'])
        await assertFails(setDoc(doc(태백직원(), 'leaveRequests', 'lv-forged-' + status), { companyId: 'taebaek', employeeId: 'e1', status }));
      for (const field of ['approvedBy', 'approvedAt', 'rejectedBy', 'cancelledAt', 'cancelledBy', 'cancelReason', 'modifyRequest', 'deductsLeave'])
        await assertFails(setDoc(doc(태백직원(), 'leaveRequests', 'lv-field-' + field), { companyId: 'taebaek', employeeId: 'e1', status: 'pending', [field]: false }));
    });

    it('관리자 단체휴가는 같은 회사의 실직원 모두에게 승인 상태로 생성한다', async () => {
      for (const employeeId of ['e1', 'e2'])
        await assertSucceeds(setDoc(doc(관리자(), 'leaveRequests', 'lv-vac-' + Math.random()), { companyId: 'taebaek', employeeId, status: 'approved', deductsLeave: false }));
      await assertSucceeds(setDoc(doc(관리자(), 'leaveRequests', 'lv-admin-pending'), { companyId: 'taebaek', employeeId: 'e1', status: 'pending' }));
      for (const employeeId of ['e9', 'missing'])
        await assertFails(setDoc(doc(관리자(), 'leaveRequests', 'lv-bad-target-' + employeeId), { companyId: 'taebaek', employeeId, status: 'approved' }));
      await assertFails(setDoc(doc(관리자(), 'leaveRequests', 'lv-bad-company'), { companyId: 'punghoe', employeeId: 'e9', status: 'approved' }));
    });

    it('**본인이 자기 연차를 승인 못 한다**', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'leaveRequests', 'lv-e1'), { status: 'approved' }));
    });

    it('관리자는 승인한다', async () => {
      await assertFails(updateDoc(doc(관리자(), 'leaveRequests', 'lv-e1'), { status: 'approved', companyId: 'taebaek' }));
    });

    it('다른 회사 연차는 못 본다', async () => {
      await assertFails(getDoc(doc(태백직원(), 'leaveRequests', 'lv-e9')));
    });
  });

  describe('재고 조정 요청 — 직원이 올리고 관리자가 처리한다', () => {
    it('직원이 올린다', async () => {
      await assertSucceeds(setDoc(doc(태백직원(), 'adjustmentRequests', 'adj-새것'), { companyId: 'taebaek', itemId: 'i-taebaek', status: 'pending' }));
    });

    it('**직원이 스스로 승인 못 한다**', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'adjustmentRequests', 'adj-1'), { status: 'approved' }));
    });

    it('관리자가 처리한다', async () => {
      await assertSucceeds(updateDoc(doc(관리자(), 'adjustmentRequests', 'adj-1'), { status: 'approved', companyId: 'taebaek' }));
    });
  });

  describe('문서함 — 실제 컬렉션 이름으로 잠근다', () => {
    //  2026-09-16 코덱스 검수 3번: 규칙이 `fileCabinet` 을 잠갔는데 실제 이름은 셋이다.
    //  이름이 틀리면 포괄 규칙으로 떨어져 **일반 직원에게 열린다.**
    it('**일반 직원은 문서함을 못 읽는다**', async () => {
      await assertFails(getDoc(doc(태백직원(), 'fileCabinetDocs', 'fc-1')));
      await assertFails(getDoc(doc(태백직원(), 'fileCabinetCategories', 'fcc-1')));
      await assertFails(getDoc(doc(태백직원(), 'fileCabinetSubCategories', 'fcs-1')));
    });

    it('관리자는 문서함을 읽되 메타데이터 직접 쓰기는 서버 명령으로 제한한다', async () => {
      await assertSucceeds(getDoc(doc(관리자(), 'fileCabinetDocs', 'fc-1')));
      await assertFails(setDoc(doc(관리자(), 'fileCabinetDocs', 'fc-2'), { companyId: 'taebaek', fileName: 'x.xlsx' }));
      await assertFails(updateDoc(doc(관리자(), 'fileCabinetDocs', 'fc-1'), {note:'직접 변경'}));
      await assertFails(deleteDoc(doc(관리자(), 'fileCabinetDocs', 'fc-1')));
      for(const collection of ['fileCabinetCategories','fileCabinetSubCategories']){
        await assertFails(setDoc(doc(관리자(),collection,'direct'),{companyId:'taebaek',name:'직접등록'}));
        const id=collection==='fileCabinetCategories'?'fcc-1':'fcs-1';
        await assertSucceeds(getDoc(doc(관리자(),collection,id)));
        await assertFails(getDoc(doc(풍회관리자(),collection,id)));
        await assertFails(updateDoc(doc(관리자(),collection,id),{name:'직접수정'}));
        await assertFails(deleteDoc(doc(관리자(),collection,id)));
      }
      for(const name of ['documentMetadataOperations','documentUploadReservations','documentStoragePaths','documentCategoryOperations','documentCategoryFences']) {
        await assertFails(setDoc(doc(관리자(),name,'client'),{companyId:'taebaek'}));
        await assertFails(getDoc(doc(관리자(),name,'client')));
      }
    });
  });

  describe('연차 — 본인이 고칠 수 있는 칸을 못 박는다', () => {
    //  2026-09-16 코덱스 검수 4번: `status` 만 보면 본인이 **남의 것으로 바꾸거나**
    //  회사를 옮기거나 날짜·일수를 마음대로 고칠 수 있다.
    it('**본인이 신청자를 남으로 못 바꾼다**', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'leaveRequests', 'lv-e1'), { employeeId: 'e2' }));
    });

    it('**본인이 회사를 못 옮긴다**', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'leaveRequests', 'lv-e1'), { companyId: 'punghoe' }));
    });

    it('본인은 날짜·사유만 고친다', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'leaveRequests', 'lv-e1'), { startDate: '2026-10-01', reason: '개인' }));
    });

    it('**본인이 결재 칸을 못 건드린다**', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'leaveRequests', 'lv-e1'), { approvedBy: 'e1' }));
    });
  });

  describe('재고 조정 요청 — 직원이 고칠 수 있는 칸을 못 박는다', () => {
    it('**직원이 요청자를 못 바꾼다**', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'adjustmentRequests', 'adj-1'), { requestedBy: 'e2' }));
    });

    it('**직원이 회사를 못 옮긴다**', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'adjustmentRequests', 'adj-1'), { companyId: 'punghoe' }));
    });

    it('직원은 수량·사유만 고친다', async () => {
      await assertSucceeds(updateDoc(doc(태백직원(), 'adjustmentRequests', 'adj-1'), { qty: 9, reason: '파손' }));
    });

    it('**직원이 처리 칸을 못 건드린다**', async () => {
      await assertFails(updateDoc(doc(태백직원(), 'adjustmentRequests', 'adj-1'), { processedBy: 'e1' }));
    });
  });

  describe('오피스톡 — 메시지 회사는 방 회사여야 한다', () => {
    //  2026-09-16 코덱스 검수 5번: 회사 검사만으로는 **태백 방에 태백 메시지를 넣되
    //  방이 풍회인 경우**를 못 막는다. 방을 직접 읽어 견준다.
    it('같은 회사 방에 메시지를 넣는다', async () => {
      await assertSucceeds(setDoc(doc(태백직원(), 'chatMessages', 'msg-2'), { companyId: 'taebaek', roomId: 'room-taebaek', senderId: 'e1' }));
    });

    it('**방 회사와 다른 메시지는 막는다**', async () => {
      //  풍회 방에 태백 메시지를 넣으려는 시도 — 회사 검사만 있으면 통과해 버린다.
      await assertFails(setDoc(doc(태백직원(), 'chatMessages', 'msg-3'), { companyId: 'taebaek', roomId: 'room-punghoe', senderId: 'e1' }));
    });

    it('**없는 방에는 못 넣는다**', async () => {
      await assertFails(setDoc(doc(태백직원(), 'chatMessages', 'msg-4'), { companyId: 'taebaek', roomId: 'room-없음', senderId: 'e1' }));
    });

    it('같은 회사 사람끼리 방을 만든다', async () => {
      await assertSucceeds(setDoc(doc(태백직원(), 'chatRooms', 'room-새것2'), { companyId: 'taebaek', participantIds: ['e1'], participantCompanies: { e1: 'taebaek' } }));
    });

    it('기존 방에 같은 회사 멤버를 초대한다', async () => {
      await assertSucceeds(updateDoc(doc(태백직원(), 'chatRooms', 'room-taebaek'), {
        companyId: 'taebaek',
        participantIds: ['e1', 'e2'],
        participantCompanies: { e1: 'taebaek', e2: 'taebaek' },
      }));
    });

    it('**다른 회사 참여자 회사값이나 누락된 회사값을 쓰지 못한다**', async () => {
      await assertFails(setDoc(doc(태백직원(), 'chatRooms', 'room-섞임'), { companyId: 'taebaek', participantIds: ['e1', 'e9'], participantCompanies: { e1: 'taebaek', e9: 'punghoe' } }));
      await assertFails(setDoc(doc(태백직원(), 'chatRooms', 'room-누락'), { companyId: 'taebaek', participantIds: ['e1'] }));
    });

    it('**남의 회사 방은 만들지도 못한다**', async () => {
      await assertFails(setDoc(doc(태백직원(), 'chatRooms', 'room-풍회'), { companyId: 'punghoe', participantIds: ['e9'], participantCompanies: { e9: 'punghoe' } }));
    });
  });

  describe('알림 — 수신자 회사가 알림 회사여야 한다', () => {
    it('같은 회사 직원에게 보낸다', async () => {
      await assertSucceeds(setDoc(doc(태백직원(), 'notifications', 'n-2'), { companyId: 'taebaek', targetId: 'e1' }));
    });

    it('**다른 회사 직원에게 못 보낸다**', async () => {
      await assertFails(setDoc(doc(태백직원(), 'notifications', 'n-3'), { companyId: 'taebaek', targetId: 'e9' }));
    });

    it('**없는 직원에게 못 보낸다**', async () => {
      await assertFails(setDoc(doc(태백직원(), 'notifications', 'n-4'), { companyId: 'taebaek', targetId: 'e-없음' }));
    });

    it('targetId가 없으면 같은 회사 전체 알림으로 만든다', async () => {
      await assertSucceeds(setDoc(doc(태백직원(), 'notifications', 'n-방송'), {
        companyId: 'taebaek', title: '신규 주문', body: '주문이 등록되었습니다.', readBy: [],
      }));
    });

    it('확인 상태만 바꿀 수 있고 본문·수신자·회사는 못 바꾼다', async () => {
      const ref = doc(태백직원(), 'notifications', 'n-1');
      await assertSucceeds(updateDoc(ref, { readBy: ['e1'] }));
      await assertSucceeds(updateDoc(ref, { dismissedBy: ['e1'] }));
      await assertFails(updateDoc(ref, { title: '바꾼 알림' }));
      await assertFails(updateDoc(ref, { targetId: 'e9' }));
      await assertFails(updateDoc(ref, { companyId: 'punghoe' }));
    });
  });

  describe('목록 질의 — 규칙은 필터가 아니다', () => {
    it('**회사 조건 없이 훑으면 막힌다** — 앱이 조건을 붙여야 하는 까닭', async () => {
      await assertFails(getDocs(collection(태백직원(), 'orders')));
    });

    it('내 회사 조건을 붙이면 통한다', async () => {
      await assertSucceeds(getDocs(query(collection(태백직원(), 'orders'), where('companyId', '==', 'taebaek'))));
    });

    it('**남의 회사 조건을 붙이면 막힌다**', async () => {
      await assertFails(getDocs(query(collection(태백직원(), 'orders'), where('companyId', '==', 'punghoe'))));
    });

    it('**관리자도 자기 회사 조건이라야 훑는다**', async () => {
      await assertSucceeds(getDocs(query(collection(관리자(), 'orders'), where('companyId', '==', 'taebaek'))));
      await assertFails(getDocs(query(collection(관리자(), 'orders'), where('companyId', '==', 'punghoe'))));
    });
  });

  describe('대출 전용 저장 전환', () => {
    for (const companyId of ['taebaek', 'punghoe']) {
      const own = () => companyId === 'taebaek' ? 관리자() : 풍회관리자();
      for (const state of ['absent', 'disabled', 'active']) {
        it(`${companyId} ${state}: 전환 설정과 무관하게 현금 직접 쓰기를 막는다`, async () => {
          await env.withSecurityRulesDisabled(async ctx => {
            const store = ctx.firestore();
            if (state !== 'absent') await setDoc(doc(store, 'appMeta', `loanMovementCutover_${companyId}`), { companyId, enabled: state === 'active' });
            await setDoc(doc(store, 'cashEntries', 'loan-existing'), { companyId, loanId: 'loan-a', amount: 100 });
            await setDoc(doc(store, 'cashEntries', 'general-existing'), { companyId, amount: 100 });
          });
          const db = own();
          const check = assertFails;
          await check(setDoc(doc(db, 'cashEntries', 'loan-new'), { companyId, loanId: 'loan-a', amount: 100 }));
          await check(updateDoc(doc(db, 'cashEntries', 'loan-existing'), { amount: 200 }));
          await check(updateDoc(doc(db, 'cashEntries', 'loan-existing'), { loanId: '' }));
          await check(updateDoc(doc(db, 'cashEntries', 'general-existing'), { loanId: 'loan-a' }));
          await check(deleteDoc(doc(db, 'cashEntries', 'loan-existing')));
          await assertFails(setDoc(doc(db, 'cashEntries', 'general-new'), { companyId, amount: 100 }));
          await assertFails(updateDoc(doc(db, 'cashEntries', 'general-existing'), { amount: 200 }));
          await assertFails(deleteDoc(doc(db, 'cashEntries', 'general-existing')));
          await assertSucceeds(setDoc(doc(db, 'loanContracts', 'opening-contract'), { companyId, openingPrincipal: 100 }));
          await assertSucceeds(updateDoc(doc(db, 'loanContracts', 'opening-contract'), { movementRevision: 1, principalBalance: 200 }));
          await assertFails(setDoc(doc(db, 'cashEntries', 'foreign-cash'), { companyId: companyId === 'taebaek' ? 'punghoe' : 'taebaek', loanId: 'loan-a' }));
        });
      }
      it(`${companyId}: 관리자가 전환 설정을 생성·변조·삭제하지 못한다`, async () => {
        const gate = doc(own(), 'appMeta', `loanMovementCutover_${companyId}`);
        await assertSucceeds(getDoc(gate));
        await assertFails(setDoc(gate, { companyId, enabled: true }));
        await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'appMeta', `loanMovementCutover_${companyId}`), { companyId, enabled: true }));
        await assertFails(updateDoc(gate, { enabled: false }));
        await assertFails(deleteDoc(gate));
      });
    }
  });

  describe('급여 원자 발행 전환', () => {
    for (const companyId of ['taebaek', 'punghoe']) {
      const own = () => companyId === 'taebaek' ? 관리자() : 풍회관리자();
      for (const state of ['absent', 'active']) {
        it(`${companyId} ${state}: 전환 후에는 급여대장 직접 쓰기만 거절한다`, async () => {
          await env.withSecurityRulesDisabled(async ctx => {
            const store = ctx.firestore();
            if (state === 'active') await setDoc(doc(store, 'appMeta', `payrollIssueCutover_${companyId}`), { companyId, firstYearMonth: '2026-10' });
            await setDoc(doc(store, 'payrolls', 'legacy-payroll'), { companyId, yearMonth: '2026-09', lines: [] });
          });
          const db = own();
          const check = state === 'active' ? assertFails : assertSucceeds;
          await assertSucceeds(getDoc(doc(db, 'payrolls', 'legacy-payroll')));
          await check(setDoc(doc(db, 'payrolls', 'new-payroll'), { companyId, yearMonth: '2026-10', lines: [] }));
          await check(updateDoc(doc(db, 'payrolls', 'legacy-payroll'), { note: '직접 변경' }));
          await check(deleteDoc(doc(db, 'payrolls', 'legacy-payroll')));
          await assertFails(setDoc(doc(db, 'cashEntries', 'general-cash'), { companyId, amount: 100 }));
        });
      }
      it(`${companyId}: 급여 전환 설정은 관리자도 직접 생성·변조·삭제하지 못한다`, async () => {
        const gate = doc(own(), 'appMeta', `payrollIssueCutover_${companyId}`);
        await assertSucceeds(getDoc(gate));
        await assertFails(setDoc(gate, { companyId, firstYearMonth: '2026-10' }));
        await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'appMeta', `payrollIssueCutover_${companyId}`), { companyId, firstYearMonth: '2026-10' }));
        await assertFails(updateDoc(gate, { firstYearMonth: '2026-07' }));
        await assertFails(deleteDoc(gate));
        await assertFails(getDoc(doc(companyId === 'taebaek' ? 풍회관리자() : 관리자(), 'appMeta', `payrollIssueCutover_${companyId}`)));
      });
    }
  });

  describe('지우기', () => {
    it('**남의 회사 것을 못 지운다**', async () => {
      await assertFails(deleteDoc(doc(태백직원(), 'orders', 'o-punghoe')));
    });

    it('내 회사 주문도 현재 claim 완료 audit 없이는 직접 지우지 못한다', async () => {
      await assertFails(deleteDoc(doc(태백직원(), 'orders', 'o-taebaek')));
    });
  });
});


const leaveReceiptHost = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8182';
describe.skipIf(!leaveReceiptHost)('휴가 명령 영수증 서버 전용 규칙', () => {
 let isolated:RulesTestEnvironment;
 beforeAll(async()=>{isolated=await initializeTestEnvironment({projectId:'demo-leave-rules-'+randomUUID().slice(0,8),firestore:{host:'127.0.0.1',port:8182,rules:readFileSync('firestore.rules','utf8')}});await isolated.withSecurityRulesDisabled(async context=>{await setDoc(doc(context.firestore(),'leaveRequestOperations','receipt'),{companyId:'taebaek',status:'applied'});});});
 afterAll(async()=>{if(!isolated)return;await isolated.withSecurityRulesDisabled(async context=>{await deleteDoc(doc(context.firestore(),'leaveRequestOperations','receipt'));});await isolated.cleanup();});
 it('계정 등록 삭제 영수증은 generic 경로까지 서버 전용이며 기존 관리자 직접 권한은 유지한다',async()=>{
  const manager=isolated.authenticatedContext('account-manager',{employeeId:'account-manager',companyId:'taebaek',isAdmin:true}).firestore();
  const staff=isolated.authenticatedContext('account-staff',{employeeId:'account-staff',companyId:'taebaek',isAdmin:false}).firestore();
  await isolated.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),'accountManagementOperations','proof'),{companyId:'taebaek'}));
  try {
   for(const store of [manager,staff,isolated.unauthenticatedContext().firestore()]) {
    const proof=doc(store,'accountManagementOperations','proof');
    await assertFails(getDoc(proof));await assertFails(getDocs(collection(store,'accountManagementOperations')));
    await assertFails(setDoc(proof,{companyId:'taebaek'}));await assertFails(updateDoc(proof,{status:'applied'}));await assertFails(deleteDoc(proof));
    await assertFails(setDoc(doc(store,'accountManagementOperations','proof','nested','bypass'),{companyId:'taebaek'}));
   }
   const target=doc(manager,'accountCodes','account-rule');
   await assertSucceeds(setDoc(target,{companyId:'taebaek',name:'기존 계정',code:'0'}));
   await assertFails(deleteDoc(doc(staff,'accountCodes','account-rule')));await assertSucceeds(deleteDoc(target));
  } finally {await isolated.withSecurityRulesDisabled(async context=>{await deleteDoc(doc(context.firestore(),'accountManagementOperations','proof'));await deleteDoc(doc(context.firestore(),'accountCodes','account-rule'));});}
 });
 it('견적 영수증만 서버 전용으로 보호하고 기존 견적 관리자 권한은 유지한다',async()=>{
  const manager=isolated.authenticatedContext('quote-manager',{employeeId:'quote-manager',companyId:'taebaek',isAdmin:true}).firestore();
  const staff=isolated.authenticatedContext('quote-staff',{employeeId:'quote-staff',companyId:'taebaek',isAdmin:false}).firestore();
  const foreign=isolated.authenticatedContext('quote-foreign',{employeeId:'quote-foreign',companyId:'punghoe',isAdmin:true}).firestore();
  await isolated.withSecurityRulesDisabled(async context=>{await setDoc(doc(context.firestore(),'quotationOperations','quote-proof'),{companyId:'taebaek'});});
  try{
   for(const store of [manager,staff,foreign,isolated.unauthenticatedContext().firestore()]){
    const receipt=doc(store,'quotationOperations','quote-proof');
    await assertFails(getDoc(receipt));await assertFails(getDocs(collection(store,'quotationOperations')));await assertFails(setDoc(receipt,{companyId:'taebaek'}));await assertFails(updateDoc(receipt,{status:'applied'}));await assertFails(deleteDoc(receipt));await assertFails(setDoc(doc(store,'quotationOperations','quote-proof','nested','bypass'),{companyId:'taebaek'}));
   }
   const quote=doc(manager,'quotations','quote-rule');await assertSucceeds(setDoc(quote,{companyId:'taebaek',name:'기존견적'}));
   await assertSucceeds(updateDoc(quote,{name:'기존수정'}));await assertFails(updateDoc(doc(staff,'quotations','quote-rule'),{name:'직원수정'}));await assertFails(getDoc(doc(foreign,'quotations','quote-rule')));await assertSucceeds(deleteDoc(quote));
  }finally{await isolated.withSecurityRulesDisabled(async context=>{await deleteDoc(doc(context.firestore(),'quotationOperations','quote-proof'));await deleteDoc(doc(context.firestore(),'quotations','quote-rule'));});}
 });
 it('디렉터리 삭제 영수증을 서버 전용으로 보호하고 기존 삭제 권한과 퇴직금 보호를 유지한다',async()=>{
  const staff=isolated.authenticatedContext('directory-staff',{employeeId:'directory-staff',companyId:'taebaek',isAdmin:false}).firestore();
  const manager=isolated.authenticatedContext('directory-manager',{employeeId:'directory-manager',companyId:'taebaek',isAdmin:true}).firestore();
  const foreign=isolated.authenticatedContext('directory-foreign',{employeeId:'directory-foreign',companyId:'punghoe',isAdmin:true}).firestore();
  const paths=[['directoryDeleteOperations','directory-proof'],['partners','directory-partner'],['employees','directory-staff'],['employees','directory-employee'],['employees','directory-protected'],['retirementProfiles','taebaek__directory-protected']];
  await isolated.withSecurityRulesDisabled(async context=>{
   const store=context.firestore();
   for(const [collection,id] of paths)await setDoc(doc(store,collection,id),{companyId:'taebaek',name:'삭제 경계'});
  });
  try{
   for(const store of [staff,manager,foreign,isolated.unauthenticatedContext().firestore()]){
    const receipt=doc(store,'directoryDeleteOperations','directory-proof');
    await assertFails(getDoc(receipt));await assertFails(getDocs(collection(store,'directoryDeleteOperations')));
    await assertFails(setDoc(receipt,{companyId:'taebaek'}));await assertFails(updateDoc(receipt,{status:'applied'}));await assertFails(deleteDoc(receipt));
    await assertFails(setDoc(doc(store,'directoryDeleteOperations','directory-proof','nested','bypass'),{companyId:'taebaek'}));
   }
   await assertFails(deleteDoc(doc(foreign,'partners','directory-partner')));
   await assertSucceeds(deleteDoc(doc(staff,'partners','directory-partner')));
   await assertFails(deleteDoc(doc(staff,'employees','directory-employee')));
   await assertFails(deleteDoc(doc(manager,'employees','directory-protected')));
   await assertSucceeds(deleteDoc(doc(manager,'employees','directory-employee')));
  }finally{
   await isolated.withSecurityRulesDisabled(async context=>{for(const [collection,id]of paths)await deleteDoc(doc(context.firestore(),collection,id));});
  }
 });
 it('거래조건 영수증은 서버 전용이고 기존 같은 회사 직원 연결 쓰기 권한은 유지한다',async()=>{
  const staff=isolated.authenticatedContext('terms-staff',{employeeId:'terms-staff',companyId:'taebaek',isAdmin:false}).firestore();
  const manager=isolated.authenticatedContext('terms-manager',{employeeId:'terms-manager',companyId:'taebaek',isAdmin:true}).firestore();
  const foreign=isolated.authenticatedContext('terms-foreign',{employeeId:'terms-foreign',companyId:'punghoe',isAdmin:true}).firestore();
  const paths=[['partnerItemTermsOperations','terms-proof'],['partner_item','terms-link'],['employees','terms-staff'],['items','terms-item'],['partners','terms-partner']];
  await isolated.withSecurityRulesDisabled(async context=>{const store=context.firestore();await setDoc(doc(store,'partnerItemTermsOperations','terms-proof'),{companyId:'taebaek',status:'applied'});await setDoc(doc(store,'employees','terms-staff'),{companyId:'taebaek',name:'직원'});await setDoc(doc(store,'items','terms-item'),{companyId:'taebaek',name:'품목'});await setDoc(doc(store,'partners','terms-partner'),{companyId:'taebaek',name:'거래처'});});
  try{
   for(const store of [staff,manager,foreign,isolated.unauthenticatedContext().firestore()]){const proof=doc(store,'partnerItemTermsOperations','terms-proof');await assertFails(getDoc(proof));await assertFails(getDocs(collection(store,'partnerItemTermsOperations')));await assertFails(setDoc(proof,{companyId:'taebaek'}));await assertFails(updateDoc(proof,{status:'cancelled'}));await assertFails(deleteDoc(proof));await assertFails(setDoc(doc(store,'partnerItemTermsOperations','terms-proof','nested','bypass'),{companyId:'taebaek'}));}
   await assertSucceeds(setDoc(doc(staff,'partner_item','terms-link'),{companyId:'taebaek',itemId:'terms-item',partnerId:'terms-partner',Direction:'out',price:0,packing:{keep:true}}));await assertSucceeds(updateDoc(doc(staff,'partner_item','terms-link'),{price:12}));await assertFails(updateDoc(doc(foreign,'partner_item','terms-link'),{price:99}));
  }finally{await isolated.withSecurityRulesDisabled(async context=>{for(const [collection,id] of paths)await deleteDoc(doc(context.firestore(),collection,id));});}
 });
 it('직원 편집 영수증만 서버 전용으로 보호하고 기존 직원 관리자·본인 FCM 경로는 유지한다',async()=>{
  const adminStore=isolated.authenticatedContext('employee-rule-admin',{employeeId:'employee-rule-admin',companyId:'taebaek',isAdmin:true}).firestore();
  const staff=isolated.authenticatedContext('employee-rule-staff',{employeeId:'employee-rule-staff',companyId:'taebaek',isAdmin:false}).firestore();
  const foreign=isolated.authenticatedContext('employee-rule-foreign',{employeeId:'employee-rule-foreign',companyId:'punghoe',isAdmin:true}).firestore();
  const paths=[['employeeEditOperations','employee-proof'],['employees','employee-rule-admin'],['employees','employee-rule-staff'],['employees','employee-rule-created']];
  await isolated.withSecurityRulesDisabled(async context=>{const store=context.firestore();await setDoc(doc(store,'employeeEditOperations','employee-proof'),{companyId:'taebaek',status:'applied'});await setDoc(doc(store,'employees','employee-rule-admin'),{companyId:'taebaek',name:'관리자'});await setDoc(doc(store,'employees','employee-rule-staff'),{companyId:'taebaek',name:'직원'});});
  try{
   for(const store of [adminStore,staff,foreign,isolated.unauthenticatedContext().firestore()]){const proof=doc(store,'employeeEditOperations','employee-proof');await assertFails(getDoc(proof));await assertFails(getDocs(collection(store,'employeeEditOperations')));await assertFails(setDoc(proof,{companyId:'taebaek'}));await assertFails(updateDoc(proof,{status:'cancelled'}));await assertFails(deleteDoc(proof));await assertFails(setDoc(doc(store,'employeeEditOperations','employee-proof','nested','bypass'),{companyId:'taebaek'}));}
   await assertSucceeds(setDoc(doc(adminStore,'employees','employee-rule-created'),{companyId:'taebaek',name:'기존 관리자 생성'}));
   await assertSucceeds(updateDoc(doc(adminStore,'employees','employee-rule-created'),{name:'기존 관리자 수정'}));
   await assertSucceeds(updateDoc(doc(staff,'employees','employee-rule-staff'),{fcmTokens:['own-device']}));
   await assertFails(updateDoc(doc(staff,'employees','employee-rule-staff'),{isAdmin:true}));
   await assertFails(updateDoc(doc(foreign,'employees','employee-rule-staff'),{name:'타회사 수정'}));
   await assertSucceeds(deleteDoc(doc(adminStore,'employees','employee-rule-created')));
  }finally{await isolated.withSecurityRulesDisabled(async context=>{for(const [collection,id] of paths)await deleteDoc(doc(context.firestore(),collection,id));});}
 });
 it('품목 편집 영수증은 직원·관리자 모두 읽기와 일반 경로 우회 쓰기를 할 수 없다',async()=>{
  await isolated.withSecurityRulesDisabled(async context=>{await setDoc(doc(context.firestore(),'itemEditorOperations','item-editor-receipt'),{companyId:'taebaek',status:'active'});});
  try{
   for(const claims of [{employeeId:'editor-admin',companyId:'taebaek',isAdmin:true},{employeeId:'editor-staff',companyId:'taebaek',isAdmin:false},{employeeId:'editor-foreign',companyId:'punghoe',isAdmin:true},null]){
    const store=claims?isolated.authenticatedContext('uid-'+claims.employeeId,claims).firestore():isolated.unauthenticatedContext().firestore(),target=doc(store,'itemEditorOperations','item-editor-receipt');
    await assertFails(getDoc(target));await assertFails(getDocs(collection(store,'itemEditorOperations')));await assertFails(setDoc(target,{companyId:'taebaek'}));await assertFails(updateDoc(target,{status:'completed'}));await assertFails(deleteDoc(target));await assertFails(setDoc(doc(store,'itemEditorOperations','item-editor-receipt','nested','bypass'),{companyId:'taebaek'}));
   }
  }finally{await isolated.withSecurityRulesDisabled(async context=>{await deleteDoc(doc(context.firestore(),'itemEditorOperations','item-editor-receipt'));});}
 });
 it('관리자·직원·타회사·미로그인 모두 get/list/create/update/delete와 하위 경로 우회를 막는다',async()=>{for(const claims of [{employeeId:'admin',companyId:'taebaek',isAdmin:true},{employeeId:'e1',companyId:'taebaek',isAdmin:false},{employeeId:'other',companyId:'punghoe',isAdmin:true},null]){const context=claims?isolated.authenticatedContext('uid-'+claims.employeeId,claims):isolated.unauthenticatedContext(),database=context.firestore(),target=doc(database,'leaveRequestOperations','receipt');await assertFails(getDoc(target));await assertFails(getDocs(collection(database,'leaveRequestOperations')));await assertFails(setDoc(doc(database,'leaveRequestOperations','new'),{companyId:'taebaek'}));await assertFails(updateDoc(target,{status:'cancelled'}));await assertFails(deleteDoc(target));await assertFails(setDoc(doc(database,'leaveRequestOperations','receipt','nested','child'),{companyId:'taebaek'}));}});
 it('휴가 직접 상태·원문 수정은 관리자도 거절하고 기존 생성·본인대기삭제 범위는 유지한다',async()=>{
  const staff=isolated.authenticatedContext('mutation-staff',{employeeId:'mutation-e1',companyId:'taebaek',isAdmin:false}).firestore();
  const manager=isolated.authenticatedContext('mutation-admin',{employeeId:'mutation-admin',companyId:'taebaek',isAdmin:true}).firestore();
  const paths=[['employees','mutation-e1'],['leaveRequests','mutation-pending'],['leaveRequests','mutation-approved'],['leaveRequests','mutation-admin-created']];
  await isolated.withSecurityRulesDisabled(async context=>{const store=context.firestore();await setDoc(doc(store,'employees','mutation-e1'),{companyId:'taebaek',name:'직원'});await setDoc(doc(store,'leaveRequests','mutation-approved'),{companyId:'taebaek',employeeId:'mutation-e1',status:'approved'});});
  try {
   await assertSucceeds(setDoc(doc(staff,'leaveRequests','mutation-pending'),{companyId:'taebaek',employeeId:'mutation-e1',status:'pending'}));
   await assertSucceeds(setDoc(doc(manager,'leaveRequests','mutation-admin-created'),{companyId:'taebaek',employeeId:'mutation-e1',status:'approved'}));
   for(const store of [staff,manager])for(const [id,patch] of [['mutation-pending',{status:'approved'}],['mutation-pending',{reason:'원문직접수정'}],['mutation-approved',{status:'cancel_pending'}],['mutation-approved',{modifyRequest:{status:'pending'}}]] as const)await assertFails(updateDoc(doc(store,'leaveRequests',id),patch));
   await assertFails(deleteDoc(doc(staff,'leaveRequests','mutation-approved')));
   await assertSucceeds(deleteDoc(doc(staff,'leaveRequests','mutation-pending')));
  } finally {await isolated.withSecurityRulesDisabled(async context=>{for(const [collection,id] of paths)await deleteDoc(doc(context.firestore(),collection,id));});}
 });
 it('주문 수정 영수증과 새 결정적 감사는 클라이언트 쓰기를 막고 옛 이력 조회·쓰기 정책을 유지한다',async()=>{
  const manager=isolated.authenticatedContext('edit-manager',{employeeId:'edit-admin',companyId:'taebaek',isAdmin:true}).firestore();
  const staff=isolated.authenticatedContext('edit-staff',{employeeId:'edit-staff',companyId:'taebaek',isAdmin:false}).firestore();
  const foreign=isolated.authenticatedContext('edit-foreign',{employeeId:'edit-foreign',companyId:'punghoe',isAdmin:true}).firestore();
  const paths=[['orderEditOperations','rule-receipt'],['orderItemEdits','order-edit-rule-receipt'],['orderItemEdits','old-random'],['orderItemEdits','old-created']];
  await isolated.withSecurityRulesDisabled(async context=>{const store=context.firestore();await setDoc(doc(store,'orderEditOperations','rule-receipt'),{companyId:'taebaek',status:'applied'});for(const id of ['order-edit-rule-receipt','old-random'])await setDoc(doc(store,'orderItemEdits',id),{companyId:'taebaek',orderId:'order',changes:[]});});
  try {
   for(const store of [manager,staff,foreign,isolated.unauthenticatedContext().firestore()]){
    const receipt=doc(store,'orderEditOperations','rule-receipt');
    await assertFails(getDoc(receipt));await assertFails(getDocs(collection(store,'orderEditOperations')));await assertFails(setDoc(receipt,{companyId:'taebaek'}));await assertFails(updateDoc(receipt,{status:'cancelled'}));await assertFails(deleteDoc(receipt));await assertFails(setDoc(doc(store,'orderEditOperations','rule-receipt','nested','bypass'),{companyId:'taebaek'}));
    const audit=doc(store,'orderItemEdits','order-edit-rule-receipt');await assertFails(setDoc(audit,{companyId:'taebaek'}));await assertFails(updateDoc(audit,{changes:['위조']}));await assertFails(deleteDoc(audit));
   }
   await assertSucceeds(getDoc(doc(staff,'orderItemEdits','order-edit-rule-receipt')));await assertSucceeds(getDoc(doc(staff,'orderItemEdits','old-random')));await assertFails(getDoc(doc(foreign,'orderItemEdits','old-random')));
   await assertSucceeds(setDoc(doc(staff,'orderItemEdits','old-created'),{companyId:'taebaek',changes:[]}));await assertSucceeds(updateDoc(doc(staff,'orderItemEdits','old-created'),{changes:['옛정책']}));await assertSucceeds(deleteDoc(doc(staff,'orderItemEdits','old-created')));
  } finally {await isolated.withSecurityRulesDisabled(async context=>{for(const [collection,id] of paths)await deleteDoc(doc(context.firestore(),collection,id));});}
 });
 it('휴가 알림은 없는 고정 ID를 읽고 같은 회사에 생성하며 목록·기존 문서는 회사 경계를 지킨다',async()=>{
  const staff=isolated.authenticatedContext('notice-staff',{employeeId:'notice-e1',companyId:'taebaek',isAdmin:false}).firestore();
  const created=doc(staff,'notifications','leave-fixed'),foreign=doc(staff,'notifications','leave-foreign');
  await isolated.withSecurityRulesDisabled(async context=>{const database=context.firestore();await setDoc(doc(database,'employees','notice-e1'),{companyId:'taebaek',name:'태백직원'});await setDoc(doc(database,'employees','notice-e9'),{companyId:'punghoe',name:'풍회직원'});await setDoc(doc(database,'notifications','leave-foreign'),{companyId:'punghoe',title:'다른 회사 알림'});});
  try {
   expect((await assertSucceeds(getDoc(created))).exists()).toBe(false);
   await assertSucceeds(runTransaction(staff,async transaction=>{const prior=await transaction.get(created);if(!prior.exists())transaction.set(created,{companyId:'taebaek',targetId:'notice-e1',title:'휴가 신청',readBy:[]});}));
   await assertSucceeds(runTransaction(staff,async transaction=>{expect((await transaction.get(created)).get('title')).toBe('휴가 신청');}));
   await assertFails(getDoc(foreign));
   await assertFails(getDocs(collection(staff,'notifications')));
   const own=await assertSucceeds(getDocs(query(collection(staff,'notifications'),where('companyId','==','taebaek'))));expect(own.docs.map(row=>row.id)).toContain('leave-fixed');
   await assertFails(getDocs(query(collection(staff,'notifications'),where('companyId','==','punghoe'))));
   await assertFails(setDoc(doc(staff,'notifications','wrong-company'),{companyId:'punghoe',targetId:'notice-e9'}));
   await assertFails(setDoc(doc(staff,'notifications','wrong-target'),{companyId:'taebaek',targetId:'notice-e9'}));
   await assertFails(getDoc(doc(isolated.unauthenticatedContext().firestore(),'notifications','missing')));
   await assertFails(getDoc(doc(isolated.authenticatedContext('notice-anon',{}).firestore(),'notifications','missing')));
  } finally { await isolated.withSecurityRulesDisabled(async context=>{const database=context.firestore();for(const [collection,id]of [['employees','notice-e1'],['employees','notice-e9'],['notifications','leave-fixed'],['notifications','leave-foreign'],['notifications','wrong-company'],['notifications','wrong-target']])await deleteDoc(doc(database,collection,id));}); }
 },30000);
});
