import {randomUUID} from 'node:crypto';
import {createEmulatorTestPolicy,cleanupOwnedResources} from '../../test/emulatorTestPolicy';
let initializeTestEnvironment:typeof import('@firebase/rules-unit-testing').initializeTestEnvironment;
let doc:typeof import('firebase/firestore').doc;
let getDoc:typeof import('firebase/firestore').getDoc;
let setDoc:typeof import('firebase/firestore').setDoc;
let applyOemReceiptInventory:typeof import('./oemReceiptInventory').applyOemReceiptInventory;
const policy=createEmulatorTestPolicy(process.env,'oemReceiptInventory',randomUUID);
async function loadRuntime(){
  policy.assertCurrentEnvironment(process.env);policy.assertOwned(policy.projectId);
  ({initializeTestEnvironment}=await import('@firebase/rules-unit-testing'));
  ({doc,getDoc,setDoc}=await import('firebase/firestore'));
  ({applyOemReceiptInventory}=await import('./oemReceiptInventory'));
  policy.assertCurrentEnvironment(process.env);
}
async function clearOwned(){
  policy.assertCurrentEnvironment(process.env);policy.assertOwned(env.projectId);
  await env.clearFirestore();
}
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type {RulesTestEnvironment} from '@firebase/rules-unit-testing';
import type {Firestore} from 'firebase/firestore';
import type {OemReceiptInventoryInput} from './oemReceiptInventory';

let env: RulesTestEnvironment;

const input = (poId: string): OemReceiptInventoryInput => ({
  companyId: 'taebaek', poId, operationId: `oem-receive:${poId}`, date: '2026-09-24',
  items: [{ itemId: `${poId}-product`, qty: 5 }],
  poPatch: { status: 'received', oemReceivedKg: 5 },
  feeRequest: {
    id: `OEMFEE-${poId}`, companyId: 'taebaek', itemId: poId, itemName: '가공비',
    originalQuantity: 5, requestedQuantity: 5, type: 'oem_fee', unit: 'kg', oemPoId: poId,
    reason: '가공비 전표 발행 필요', status: 'pending', requestedAt: '2026-09-24T00:00:00Z',
  },
});

describe.skipIf(!policy.enabled)('OEM 가공입고 실제 Firestore 규칙', () => {
  beforeAll(async () => {
 await loadRuntime();
    env = await initializeTestEnvironment({ projectId:policy.projectId, firestore: {
      rules: readFileSync('firestore.rules', 'utf-8'), host:policy.host, port:policy.port,
    } });
    policy.assertCurrentEnvironment(process.env);policy.assertOwned(env.projectId);
    await clearOwned();
  }, 20_000);
  afterAll(async () => {await cleanupOwnedResources([async()=>{if(env)await clearOwned();},()=>env?.cleanup()]);});

  const adminDb = () => env.authenticatedContext('u-admin', {
    employeeId: 'admin', companyId: 'taebaek', isAdmin: true,
  }).firestore() as unknown as Firestore;

  const seed = async (poId: string, itemCompany: 'taebaek' | 'punghoe' = 'taebaek') => {
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'purchaseOrders', poId), { id: poId, companyId: 'taebaek', poType: 'oem', status: 'invoiced' });
      await setDoc(doc(db, 'items', `${poId}-product`), { id: `${poId}-product`, companyId: itemCompany, stock: 10, lots: [] });
    });
  };

  it('없는 확인 요청의 get 권한에 걸리지 않고 입고·요청을 함께 저장한다', async () => {
    const poId = 'oem-receipt-success';
    await seed(poId);
    const db = adminDb();
    expect(await applyOemReceiptInventory(db, input(poId))).toBe('applied');
    expect((await getDoc(doc(db, 'items', `${poId}-product`))).data()?.stock).toBe(15);
    expect((await getDoc(doc(db, 'purchaseOrders', poId))).data()).toMatchObject({ status: 'received', oemReceiptOperationId: `oem-receive:${poId}` });
    expect((await getDoc(doc(db, 'adjustmentRequests', `OEMFEE-${poId}`))).data()).toMatchObject({ companyId: 'taebaek', type: 'oem_fee' });

    expect(await applyOemReceiptInventory(db, input(poId))).toBe('duplicate');
    expect((await getDoc(doc(db, 'items', `${poId}-product`))).data()?.stock).toBe(15);
  }, 20_000);

  it('기존 동일 ID 확인 요청을 덮어쓰지 않고 입고도 취소한다', async () => {
    const poId = 'oem-receipt-existing-fee';
    await seed(poId);
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'adjustmentRequests', `OEMFEE-${poId}`), {
        ...input(poId).feeRequest, reason: '이미 등록된 요청',
      });
    });
    const db = adminDb();
    await expect(applyOemReceiptInventory(db, input(poId))).rejects.toThrow('이미 있습니다');
    expect((await getDoc(doc(db, 'adjustmentRequests', `OEMFEE-${poId}`))).data()?.reason).toBe('이미 등록된 요청');
    expect((await getDoc(doc(db, 'items', `${poId}-product`))).data()?.stock).toBe(10);
    expect((await getDoc(doc(db, 'purchaseOrders', poId))).data()?.status).toBe('invoiced');
  }, 20_000);

  it('두 화면의 동시 재시도에서도 재고와 확인 요청은 한 번만 반영한다', async () => {
    const poId = 'oem-receipt-concurrent';
    await seed(poId);
    const db = adminDb();
    const results = await Promise.all([
      applyOemReceiptInventory(db, input(poId)),
      applyOemReceiptInventory(db, input(poId)),
    ]);
    expect(results.sort()).toEqual(['applied', 'duplicate']);
    expect((await getDoc(doc(db, 'items', `${poId}-product`))).data()?.stock).toBe(15);
    expect((await getDoc(doc(db, 'adjustmentRequests', `OEMFEE-${poId}`))).exists()).toBe(true);
  }, 20_000);

  it('다른 회사 품목과 잘못된 확인 요청 회사값을 거절한다', async () => {
    const poId = 'oem-receipt-other-company';
    await seed(poId, 'punghoe');
    const db = adminDb();
    await expect(applyOemReceiptInventory(db, input(poId))).rejects.toThrow();
    await env.withSecurityRulesDisabled(async ctx => {
      expect((await getDoc(doc(ctx.firestore(), 'items', `${poId}-product`))).data()?.stock).toBe(10);
      expect((await getDoc(doc(ctx.firestore(), 'adjustmentRequests', `OEMFEE-${poId}`))).exists()).toBe(false);
    });
    expect((await getDoc(doc(db, 'purchaseOrders', poId))).data()?.status).toBe('invoiced');

    const validPoId = 'oem-receipt-wrong-fee-company';
    await seed(validPoId);
    await expect(applyOemReceiptInventory(db, {
      ...input(validPoId), feeRequest: { ...input(validPoId).feeRequest, companyId: 'punghoe' },
    })).rejects.toThrow('회사나 배치');
    expect((await getDoc(doc(db, 'items', `${validPoId}-product`))).data()?.stock).toBe(10);
  }, 20_000);
});
