import {randomUUID} from 'node:crypto';

import {createEmulatorTestPolicy,cleanupOwnedResources,type EmulatorTestPolicy} from '../test/emulatorTestPolicy';
let initializeTestEnvironment: typeof import('@firebase/rules-unit-testing').initializeTestEnvironment;
let assertFails: typeof import('@firebase/rules-unit-testing').assertFails;
let assertSucceeds: typeof import('@firebase/rules-unit-testing').assertSucceeds;
let collection: typeof import('firebase/firestore').collection;
let deleteDoc: typeof import('firebase/firestore').deleteDoc;
let doc: typeof import('firebase/firestore').doc;
let getDoc: typeof import('firebase/firestore').getDoc;
let getDocs: typeof import('firebase/firestore').getDocs;
let query: typeof import('firebase/firestore').query;
let setDoc: typeof import('firebase/firestore').setDoc;
let updateDoc: typeof import('firebase/firestore').updateDoc;
let where: typeof import('firebase/firestore').where;
async function loadRuntime(policy:EmulatorTestPolicy){
  policy.assertCurrentEnvironment(process.env); policy.assertOwned(policy.projectId);
  ({ initializeTestEnvironment, assertFails, assertSucceeds } = await import('@firebase/rules-unit-testing'));
  ({ collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } = await import('firebase/firestore'));
  policy.assertCurrentEnvironment(process.env);
}
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';


const policy=createEmulatorTestPolicy(process.env,'purchase-rules',randomUUID);
let env: RulesTestEnvironment;
const context = (admin: boolean, companyId = 'taebaek') => env.authenticatedContext(`${companyId}-${admin}`, { employeeId: 'e', companyId, isAdmin: admin }).firestore();
const catalog = { id: 'u', companyId: 'taebaek', itemId: 'raw', partnerId: 'partner', purchaseUnit: '자루', unitKg: 22.5, isDefault: false, active: true, createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z' };
describe.skipIf(!policy.enabled)('매입 단위 등록표 실제 보안 규칙', () => {
  beforeAll(async () => {
    await loadRuntime(policy);
    const {host,port,projectId}=policy;
    env = await initializeTestEnvironment({ projectId, firestore: { host, port, rules: readFileSync('firestore.rules', 'utf8') } });
  });
  afterAll(async () => { await cleanupOwnedResources([async()=>{if(env){policy.assertCurrentEnvironment(process.env);policy.assertOwned(env.projectId);await env.clearFirestore();}},()=>env?.cleanup()]); });
  beforeEach(async () => {
    policy.assertCurrentEnvironment(process.env);policy.assertOwned(env.projectId);
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'items/raw'), { companyId: 'taebaek', subtype: '벌크' });
      await setDoc(doc(db, 'items/other'), { companyId: 'punghoe', subtype: '벌크' });
      await setDoc(doc(db, 'items/product'), { companyId: 'taebaek', subtype: '병' });
      await setDoc(doc(db, 'partners/partner'), { companyId: 'taebaek' });
      await setDoc(doc(db, 'partners/foreign'), { companyId: 'punghoe' });
      await setDoc(doc(db, 'item_purchase_unit/u'), catalog);
    });
  });
  it('같은 회사 직원은 조회·선택하지만 등록·수정·삭제는 관리자만 한다', async () => {
    const staff = context(false), admin = context(true);
    await assertSucceeds(getDoc(doc(staff, 'item_purchase_unit/u')));
    await assertSucceeds(getDocs(query(collection(staff, 'item_purchase_unit'), where('companyId', '==', 'taebaek'))));
    await assertFails(setDoc(doc(staff, 'item_purchase_unit/new'), { ...catalog, id: 'new' }));
    await assertFails(updateDoc(doc(staff, 'item_purchase_unit/u'), { unitKg: 25 }));
    await assertFails(deleteDoc(doc(staff, 'item_purchase_unit/u')));
    await assertSucceeds(setDoc(doc(admin, 'item_purchase_unit/new'), { ...catalog, id: 'new' }));
    await assertSucceeds(updateDoc(doc(admin, 'item_purchase_unit/u'), { unitKg: 25 }));
    await assertSucceeds(deleteDoc(doc(admin, 'item_purchase_unit/new')));
  });
  it('관리자도 다른 회사 등록표를 읽거나 자기 회사로 탈취할 수 없다', async () => {
    const foreign = context(true, 'punghoe');
    await assertFails(getDoc(doc(foreign, 'item_purchase_unit/u')));
    await assertFails(updateDoc(doc(foreign, 'item_purchase_unit/u'), { companyId: 'punghoe', itemId: 'other' }));
    await assertFails(deleteDoc(doc(foreign, 'item_purchase_unit/u')));
    await assertFails(getDocs(collection(context(true), 'item_purchase_unit')));
  });
  it('품목·거래처 회사 및 실제 원료 홀더를 검증한다', async () => {
    const db = context(true);
    for (const patch of [{ itemId: 'other' }, { itemId: 'product' }, { itemId: 'missing' }, { partnerId: 'foreign' }, { partnerId: 'missing' }]) {
      await assertFails(setDoc(doc(db, 'item_purchase_unit/new'), { ...catalog, id: 'new', ...patch }));
    }
    for (const flag of ['phantom', 'archived']) {
      await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'items/raw'), { [flag]: true }));
      await assertFails(setDoc(doc(db, 'item_purchase_unit/new'), { ...catalog, id: 'new' }));
      await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'items/raw'), { [flag]: false }));
    }
    const { partnerId, ...globalUnit } = catalog;
    await assertSucceeds(setDoc(doc(db, 'item_purchase_unit/new'), { ...globalUnit, id: 'new' }));
  });
  it('문서 열쇠·회사·품목·생성일은 수정 불가이며 잘못된 등록값도 거절한다', async () => {
    const db = context(true);
    for (const patch of [{ id: 'other' }, { companyId: 'punghoe' }, { itemId: 'product' }, { createdAt: 'changed' }, { unitKg: 0 }, { unitKg: -1 }, { unitKg: Infinity }, { unitKg: NaN }, { isDefault: 'yes' }, { active: 1 }, { purchaseUnit: '' }, { extra: true }]) {
      await assertFails(updateDoc(doc(db, 'item_purchase_unit/u'), patch));
    }
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'item_purchase_unit/u')));
  });
});
