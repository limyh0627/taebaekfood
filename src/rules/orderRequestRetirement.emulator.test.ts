import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';

// 기존 공유 에뮬레이터를 초기화하지 않는다. 명시 실행이면 접속 실패도 검증 실패다.
const enabled = process.env.PRIVATE_RECEIPT_RULES_TEST === 'true';
const names = ['orderRequestRetirementAuthorizations', 'orderRequestRetirements'];
let env: RulesTestEnvironment;
const actors = [
  { uid: 'taebaek-admin', claims: { employeeId: 'admin', companyId: 'taebaek', isAdmin: true } },
  { uid: 'punghoe-admin', claims: { employeeId: 'admin-punghoe', companyId: 'punghoe', isAdmin: true } },
  { uid: 'taebaek-staff', claims: { employeeId: 'e1', companyId: 'taebaek', isAdmin: false } },
  { uid: 'punghoe-staff', claims: { employeeId: 'e2', companyId: 'punghoe', isAdmin: false } },
  { uid: 'no-claims', claims: {} },
  { uid: null, claims: {} },
];

describe.skipIf(!enabled)('주문 요청 폐기 서버 근거: 실제 SDK Rules', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: `demo-retirement-private-${randomUUID()}`,
      firestore: { host: '127.0.0.1', port: 8082, rules: readFileSync('firestore.rules', 'utf8') },
    });
    await env.withSecurityRulesDisabled(async context => {
      for (const name of names) for (const companyId of ['taebaek', 'punghoe']) {
        await setDoc(doc(context.firestore(), name, companyId), { companyId, actorUid: `${companyId}-admin`, status: 'prepared', requestText: '최초 원문' });
        await setDoc(doc(context.firestore(), name, companyId, 'private', 'child'), { companyId, requestText: '하위 원문' });
      }
      await setDoc(doc(context.firestore(), 'items', 'control'), { companyId: 'taebaek', stock: 1 });
    });
  }, 30000);
  afterAll(async () => {
    if (!env) return;
    await env.withSecurityRulesDisabled(async context => {
      for (const name of names) for (const companyId of ['taebaek', 'punghoe']) {
        await deleteDoc(doc(context.firestore(), name, companyId, 'private', 'child'));
        await deleteDoc(doc(context.firestore(), name, companyId));
      }
      await deleteDoc(doc(context.firestore(), 'items', 'control'));
    });
    await env.cleanup();
  });

  for (const actor of actors) it(`${actor.uid ?? '미로그인'}: 양사 단건·목록·하위문서·쓰기 모두 거절`, async () => {
    const db = actor.uid ? env.authenticatedContext(actor.uid, actor.claims).firestore() : env.unauthenticatedContext().firestore();
    for (const name of names) for (const companyId of ['taebaek', 'punghoe']) {
      const ref = doc(db, name, companyId), fresh = doc(db, name, `${companyId}-new`);
      await assertFails(getDoc(ref));
      await assertFails(getDoc(doc(db, name, 'absent')));
      await assertFails(getDocs(collection(db, name)));
      await assertFails(getDocs(query(collection(db, name), where('companyId', '==', companyId))));
      await assertFails(getDoc(doc(db, name, companyId, 'private', 'child')));
      await assertFails(getDocs(collection(db, name, companyId, 'private')));
      await assertFails(setDoc(fresh, { companyId, status: 'rejected' }));
      await assertFails(setDoc(ref, { companyId, status: 'rejected' }));
      await assertFails(updateDoc(ref, { status: 'rejected' }));
      await assertFails(deleteDoc(ref));
      await assertFails(setDoc(doc(db, name, companyId, 'private', 'new'), { companyId }));
      const batch = writeBatch(db); batch.delete(ref); batch.set(fresh, { companyId });
      await assertFails(batch.commit());
    }
  });

  it('관리자·직원 정상 품목 경로는 유지하고 거절된 원문은 불변', async () => {
    for (const actor of actors.slice(0, 4).filter(row => row.claims.companyId === 'taebaek')) {
      const db = env.authenticatedContext(actor.uid!, actor.claims).firestore();
      await assertSucceeds(getDoc(doc(db, 'items', 'control')));
      await assertSucceeds(updateDoc(doc(db, 'items', 'control'), { stock: 2, inventoryWriterProtocolVersion:1, inventoryWriteRevision:1 }));
    }
    await env.withSecurityRulesDisabled(async context => {
      for (const name of names) for (const companyId of ['taebaek', 'punghoe']) {
        expect((await getDoc(doc(context.firestore(), name, companyId))).data()).toEqual({ companyId, actorUid: `${companyId}-admin`, status: 'prepared', requestText: '최초 원문' });
        expect((await getDoc(doc(context.firestore(), name, `${companyId}-new`))).exists()).toBe(false);
      }
    });
  });
});