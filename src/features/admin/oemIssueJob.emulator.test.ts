import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import { issueOemBatchJob } from './oemIssueJob';
import { applyOemFeeStatement } from './oemFeeStatement';
import { applyOemReceiptInventory } from './oemReceiptInventory';
import { executeRawInventoryCommand } from '../../shared/services/rawInventoryService';
import { inventoryDocId, operationDocId } from '../../shared/rawInventoryCore';
import type { IssuedStatement } from '../../shared/types';

const emulatorReady = async () => {
  try { return (await fetch('http://127.0.0.1:8082/', { signal: AbortSignal.timeout(1500) })).status < 500; }
  catch { return false; }
};
const ready = await emulatorReady();
let env: RulesTestEnvironment;

describe.skipIf(!ready)('OEM 작업 실제 Firestore 에뮬레이터', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-oem-job-test', firestore: {
      rules: readFileSync('firestore.rules', 'utf-8'), host: '127.0.0.1', port: 8082,
    } });
    await env.clearFirestore();
  }, 20_000);
  afterAll(async () => { await env?.cleanup(); });

  it('두 번째 원료 실패 후 같은 작업을 재개해 첫 원료를 한 번만 차감하고 카드를 확정한다', async () => {
    const db = env.authenticatedContext('u-admin', { employeeId: 'admin', companyId: 'taebaek', isAdmin: true }).firestore() as unknown as Firestore;
    await env.withSecurityRulesDisabled(async ctx => {
      const seedDb = ctx.firestore();
      await setDoc(doc(seedDb, 'items', 'oem-raw-a'), { id: 'oem-raw-a', companyId: 'taebaek', name: 'OEM 원료 A', rawMaterialName: 'OEM 원료 A', subtype: '벌크', unit: 'kg', stock: 0, lots: [] });
      // 원료 B만 품목 사본과 원장이 어긋난 상태로 시작시켜 두 번째 단계에서 멈추게 한다.
      await setDoc(doc(seedDb, 'items', 'oem-raw-b'), { id: 'oem-raw-b', companyId: 'taebaek', name: 'OEM 원료 B', rawMaterialName: 'OEM 원료 B', subtype: '벌크', unit: 'kg', stock: 1, lots: [] });
    });
    const receive = async (rawItemId: string, material: string) => executeRawInventoryCommand({
      operationId: `seed-${rawItemId}`, companyId: 'taebaek', rawItemId, materialSnapshot: material,
      effectiveAt: '2026-09-24T09:00:00+09:00', source: { type: 'manual', id: `seed-${rawItemId}` },
      kind: 'receive', kg: 100, lot: { supplierName: '시험' },
    }, { db });
    expect((await receive('oem-raw-a', 'OEM 원료 A')).status).toBe('applied');
    const input = {
      jobId: 'oem-emulator-1', companyId: 'taebaek' as const, partnerId: 'factory-a', partnerName: '시험 공장',
      sent: [{ rawItemId: 'oem-raw-a', material: 'OEM 원료 A', kg: 20 }, { rawItemId: 'oem-raw-b', material: 'OEM 원료 B', kg: 10 }],
      date: '2026-09-24',
    };
    await expect(issueOemBatchJob(db, input)).rejects.toThrow('부분 완료');
    expect((await getDoc(doc(db, 'purchaseOrders', input.jobId))).data()).toMatchObject({ status: 'pending', oemIssueStatus: 'failed' });
    expect((await getDoc(doc(db, 'items', 'oem-raw-a'))).data()?.stock).toBe(80);
    expect((await getDoc(doc(db, 'rawMaterialLedger', operationDocId('oem-issue:oem-emulator-1:oem-raw-a')))).exists()).toBe(true);
    expect((await getDoc(doc(db, 'rawInventories', inventoryDocId('taebaek', 'oem-raw-a')))).exists()).toBe(true);

    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'items', 'oem-raw-b'), { id: 'oem-raw-b', companyId: 'taebaek', name: 'OEM 원료 B', rawMaterialName: 'OEM 원료 B', subtype: '벌크', unit: 'kg', stock: 0, lots: [] });
    });
    expect((await receive('oem-raw-b', 'OEM 원료 B')).status).toBe('applied');
    expect(await issueOemBatchJob(db, input)).toEqual({ poId: input.jobId });
    expect((await getDoc(doc(db, 'purchaseOrders', input.jobId))).data()).toMatchObject({ status: 'invoiced', oemIssueStatus: 'complete' });
    expect((await getDoc(doc(db, 'items', 'oem-raw-a'))).data()?.stock).toBe(80);
    expect((await getDoc(doc(db, 'items', 'oem-raw-b'))).data()?.stock).toBe(90);
    expect(await issueOemBatchJob(db, input)).toEqual({ poId: input.jobId });
    expect((await getDoc(doc(db, 'items', 'oem-raw-a'))).data()?.stock).toBe(80);
    await expect(issueOemBatchJob(db, { ...input, sent: [{ ...input.sent[0]!, kg: 1 }] })).rejects.toThrow('내용이 다릅니다');
  }, 20_000);

  it('가공비 전표와 PO 링크를 한 번만 저장하고, 옛 미연결 전표는 새로 발행하지 않는다', async () => {
    const db = env.authenticatedContext('u-admin', { employeeId: 'admin', companyId: 'taebaek', isAdmin: true }).firestore() as unknown as Firestore;
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'purchaseOrders', 'oem-fee-emulator-1'), { id: 'oem-fee-emulator-1', companyId: 'taebaek', poType: 'oem', status: 'received', partnerName: '시험 공장' });
      await setDoc(doc(ctx.firestore(), 'purchaseOrders', 'oem-fee-emulator-old'), { id: 'oem-fee-emulator-old', companyId: 'taebaek', poType: 'oem', status: 'received', partnerName: '시험 공장' });
      await setDoc(doc(ctx.firestore(), 'issuedStatements', 'stmt-old-random'), { id: 'stmt-old-random', companyId: 'taebaek', type: '매입', orderId: 'oem-fee-emulator-old' });
    });
    const statement: IssuedStatement = {
      id: 'OEMFEE-oem-fee-emulator-1', companyId: 'taebaek', issuedAt: '2026-09-24T09:00:00+09:00', tradeDate: '2026-09-24',
      type: '매입', partnerId: 'factory-a', partnerName: '시험 공장', orderId: 'oem-fee-emulator-1', docNo: '가공260924-001',
      totalSupply: 1000, totalTax: 100, totalAmount: 1100, items: [],
    };
    const input = { companyId: 'taebaek' as const, poId: 'oem-fee-emulator-1', perKg: 500, statement };
    expect(await applyOemFeeStatement(db, input)).toBe(statement.id);
    expect((await getDoc(doc(db, 'purchaseOrders', input.poId))).data()?.linkedStatementId).toBe(statement.id);
    expect((await getDoc(doc(db, 'issuedStatements', statement.id))).data()?.totalAmount).toBe(1100);
    expect(await applyOemFeeStatement(db, input)).toBe(statement.id);
    await expect(applyOemFeeStatement(db, { ...input, poId: 'oem-fee-emulator-old', statement: { ...statement, id: 'OEMFEE-oem-fee-emulator-old', orderId: 'oem-fee-emulator-old' } })).rejects.toThrow('기존 가공비 전표');
    expect((await getDoc(doc(db, 'issuedStatements', 'OEMFEE-oem-fee-emulator-old'))).exists()).toBe(false);
  }, 20_000);

  it('회사 다른 원료 출고와 완제품 입고를 실제 규칙·거래 경계에서 거절한다', async () => {
    const taebaekDb = env.authenticatedContext('u-admin', { employeeId: 'admin', companyId: 'taebaek', isAdmin: true }).firestore() as unknown as Firestore;
    await env.withSecurityRulesDisabled(async ctx => {
      const seedDb = ctx.firestore();
      await setDoc(doc(seedDb, 'items', 'oem-cross-raw'), { id: 'oem-cross-raw', companyId: 'punghoe', name: '같은 이름 참깨', subtype: '벌크', unit: 'kg', stock: 0, lots: [] });
      await setDoc(doc(seedDb, 'items', 'oem-cross-product'), { id: 'oem-cross-product', companyId: 'punghoe', name: '풍회 완제품', stock: 0, lots: [] });
      await setDoc(doc(seedDb, 'purchaseOrders', 'oem-cross-receipt'), { id: 'oem-cross-receipt', companyId: 'taebaek', poType: 'oem', status: 'invoiced' });
    });
    await expect(issueOemBatchJob(taebaekDb, {
      jobId: 'oem-cross-issue', companyId: 'taebaek', partnerId: 'factory-a', partnerName: '시험 공장',
      sent: [{ rawItemId: 'oem-cross-raw', material: '같은 이름 참깨', kg: 1 }], date: '2026-09-24',
    })).rejects.toThrow('부분 완료');
    await env.withSecurityRulesDisabled(async ctx => {
      expect((await getDoc(doc(ctx.firestore(), 'items', 'oem-cross-raw'))).data()?.stock).toBe(0);
      expect((await getDoc(doc(ctx.firestore(), 'rawMaterialLedger', operationDocId('oem-issue:oem-cross-issue:oem-cross-raw')))).exists()).toBe(false);
    });
    await expect(applyOemReceiptInventory(taebaekDb, {
      companyId: 'taebaek', poId: 'oem-cross-receipt', operationId: 'oem-receive:oem-cross-receipt', date: '2026-09-24',
      items: [{ itemId: 'oem-cross-product', qty: 1 }], poPatch: { status: 'received' },
      feeRequest: { id: 'OEMFEE-oem-cross-receipt', companyId: 'taebaek', itemId: 'oem-cross-receipt', itemName: '가공비', originalQuantity: 1, type: 'oem_fee', reason: '시험', status: 'pending', requestedAt: '2026-09-24T00:00:00Z', oemPoId: 'oem-cross-receipt' },
    })).rejects.toThrow();
    expect((await getDoc(doc(taebaekDb, 'purchaseOrders', 'oem-cross-receipt'))).data()?.status).toBe('invoiced');
    await env.withSecurityRulesDisabled(async ctx => {
      expect((await getDoc(doc(ctx.firestore(), 'adjustmentRequests', 'OEMFEE-oem-cross-receipt'))).exists()).toBe(false);
    });
  }, 20_000);
});
