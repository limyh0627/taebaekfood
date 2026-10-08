import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, doc, getDoc, getDocs, collection, query, where, setDoc, updateDoc, deleteDoc, type Firestore } from 'firebase/firestore';
import { initializeApp as initAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getAuth as adminAuth } from 'firebase-admin/auth';
import { getFirestore as adminFirestore, FieldValue } from 'firebase-admin/firestore';

describe.skipIf(process.env.MANUAL_AUDIT_RULES_TEST !== 'true')('금융 서버 감사 실제 Auth·Rules 경계', () => {
  const projectId = 'demo-manual-audit-policy', prefix = `manual-audit-${randomUUID()}`;
  const legacyId = `${prefix}-regular`, repairId = `${prefix}-repair`, newId = `${prefix}-new`;
  const audits = ['manualSettlementOperations', 'partnerPaymentOperations', 'manualSettlementBatchOperations', 'loanMovementOperations', 'returnOperations', 'voucherMutationOperations', 'companyTransferOperations', 'oemReceiptOperations'];
  const paths = [...[legacyId, repairId].map(id => `manualSettlementOperations/${id}`),
    ...audits.slice(1).map(name => `${name}/${legacyId}`)];
  let admin: ReturnType<typeof initAdmin>, database: ReturnType<typeof adminFirestore>, env: RulesTestEnvironment;
  let own: Firestore, foreign: Firestore, staff: Firestore, guest: Firestore;
  const apps: FirebaseApp[] = [], users: string[] = [];
  beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8082' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('격리 Auth·Firestore 경계가 다릅니다.');
    admin = initAdmin({ projectId }, prefix); database = adminFirestore(admin);
    for (const path of paths) {
      await database.doc(path).create({ companyId: 'taebaek', partnerId: `${prefix}-partner`, kind: path.endsWith(repairId) ? 'orphanSettlementRepair' : 'manual', action: 'delete', marker: '원문' });
    }
    async function client(label: string, companyId?: string, isAdmin = false) {
      const app = initializeApp({ projectId, apiKey: 'local-emulator-only' }, `${prefix}-${label}`); apps.push(app);
      const store = getFirestore(app); connectFirestoreEmulator(store, '127.0.0.1', 8082);
      const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      if (companyId) {
        const uid = `${prefix}-${label}-uid`, employeeId = `${prefix}-${label}-employee`, email = `${uid}@example.invalid`, password = `${randomUUID()}Aa1!`;
        await adminAuth(admin).createUser({ uid, email, password }); users.push(uid);
        await adminAuth(admin).setCustomUserClaims(uid, { companyId, employeeId, isAdmin });
        await signInWithEmailAndPassword(auth, email, password);
        expect(auth.currentUser!.uid).not.toBe(employeeId);
        expect((await auth.currentUser!.getIdTokenResult(true)).claims).toMatchObject({ companyId, employeeId, isAdmin });
      }
      return store;
    }
    own = await client('own', 'taebaek', true); foreign = await client('foreign', 'punghoe', true);
    staff = await client('staff', 'taebaek'); guest = await client('guest');
    const candidate = readFileSync('firestore.rules', 'utf8');
    const baselinePath = process.env.MANUAL_AUDIT_BASELINE_RULES;
    if (baselinePath) {
      const baseline = readFileSync(baselinePath, 'utf8');
      env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8082, rules: baseline } });
      try {
        for (const path of paths) {
          expect((await getDoc(doc(staff, path))).exists()).toBe(true);
          await updateDoc(doc(staff, path), { baselineEmployeeWrite: true });
          expect((await database.doc(path).get()).get('baselineEmployeeWrite')).toBe(true);
        }
        console.info(`기준 규칙: 실제 직원이 금융 감사 ${audits.length}컬렉션 읽기·수정에 성공했습니다.`);
      } finally {
        for (const path of paths) await database.doc(path).update({ baselineEmployeeWrite: FieldValue.delete() });
        await env.cleanup();
      }
    }
    env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8082, rules: candidate } });
  }, 90_000);
  afterAll(async () => {
    if (database) for (const path of [...paths, ...audits.map(name => `${name}/${newId}`)]) {
      if (!path.includes(prefix)) throw new Error('정리 범위가 다릅니다.');
      await database.doc(path).delete(); expect((await database.doc(path).get()).exists).toBe(false);
    }
    if (admin) for (const uid of users) { await adminAuth(admin).deleteUser(uid); await expect(adminAuth(admin).getUser(uid)).rejects.toMatchObject({ code: 'auth/user-not-found' }); }
    for (const app of apps) await deleteApp(app);
    if (env) await env.cleanup(); if (admin) await deleteAdmin(admin);
  }, 90_000);
  it('같은 회사 관리자만 기존 명령과 보상 감사 단건·회사 목록을 읽는다', async () => {
    for (const path of paths) expect((await getDoc(doc(own, path))).get('marker')).toBe('원문');
    for (const name of audits) {
      expect((await getDocs(query(collection(own, name), where('companyId', '==', 'taebaek')))).size).toBe(name === 'manualSettlementOperations' ? 2 : 1);
      await expect(getDocs(collection(own, name))).rejects.toMatchObject({ code: 'permission-denied' });
    }
    for (const reader of [foreign, staff, guest]) {
      for (const path of paths) await expect(getDoc(doc(reader, path))).rejects.toMatchObject({ code: 'permission-denied' });
      for (const name of audits) await expect(getDocs(query(collection(reader, name), where('companyId', '==', 'taebaek')))).rejects.toMatchObject({ code: 'permission-denied' });
    }
  }, 60_000);
  it('관리자·직원·타회사·미인증 클라이언트 생성/수정/삭제를 모두 거절하고 원문을 보존한다', async () => {
    const before = await Promise.all(paths.map(async path => (await database.doc(path).get()).data()));
    for (const writer of [own, foreign, staff, guest]) {
      for (const name of audits) await expect(setDoc(doc(writer, `${name}/${newId}`), { companyId: 'taebaek', kind: 'orphanSettlementRepair' })).rejects.toMatchObject({ code: 'permission-denied' });
      for (const path of paths) {
        await expect(updateDoc(doc(writer, path), { marker: '위조' })).rejects.toMatchObject({ code: 'permission-denied' });
        await expect(deleteDoc(doc(writer, path))).rejects.toMatchObject({ code: 'permission-denied' });
      }
    }
    expect(await Promise.all(paths.map(async path => (await database.doc(path).get()).data()))).toEqual(before);
    for (const name of audits) expect((await database.doc(`${name}/${newId}`).get()).exists).toBe(false);
  }, 60_000);
});
