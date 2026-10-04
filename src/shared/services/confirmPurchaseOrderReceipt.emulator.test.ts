import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
vi.mock('../firebase', () => ({ db: null, auth: { currentUser: null }, authReady: Promise.resolve() }));
const { confirmUnitPurchaseOrderReceiptWithDb } = await import('./firebaseService');

const ready = await fetch('http://127.0.0.1:8082/', { signal: AbortSignal.timeout(1500) }).then(r => r.status < 500).catch(() => false);
let env: RulesTestEnvironment;
const company = 'taebaek' as const;

describe.skipIf(!ready)('발주 입고확정 원자성 (Firestore Emulator)', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-po-atomic-receipt', firestore: {
      rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8082,
    } });
    await env.clearFirestore();
  }, 20_000);
  afterAll(async () => { await env?.cleanup(); });

  const userDb = () => env.authenticatedContext('po-admin', { employeeId: 'admin', companyId: company, isAdmin: true }).firestore() as unknown as Firestore;
  const seed = async (id: string, lines: { itemId: string; quantity: number }[], options: { missing?: string; foreign?: string; raw?: string; goods?: string } = {}) => {
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, 'purchaseOrders', id), { companyId: company, status: 'invoiced', partnerName: '검수 거래처',
        items: lines.map(line => ({ ...line, name: line.itemId, unit: '개' })), itemId: '', itemName: '', quantity: 0, createdAt: '2026-10-04' });
      for (const line of lines) {
        if (line.itemId === options.missing) continue;
        await setDoc(doc(db, 'items', line.itemId), { companyId: line.itemId === options.foreign ? 'punghoe' : company,
          name: line.itemId, type: line.itemId === options.raw ? 'raw' : line.itemId === options.goods ? 'goods' : 'submaterial', unit: line.itemId === options.raw ? 'kg' : '개', stock: 10 });
      }
    });
  };
  const state = async (id: string, itemIds: string[]) => {
    const db = userDb();
    const po = (await getDoc(doc(db, 'purchaseOrders', id))).data();
    const stocks = await Promise.all(itemIds.map(async itemId => (await getDoc(doc(db, 'items', itemId))).data()?.stock));
    return { status: po?.status, stocks };
  };

  it('두 품목의 재고·입고 기록·발주 상태를 함께 확정하고 재시도는 중복하지 않는다', async () => {
    const id = 'po-atomic-success';
    await seed(id, [{ itemId: 'sub-a', quantity: 3 }, { itemId: 'sub-b', quantity: 4 }]);
    const db = userDb();
    expect(await confirmUnitPurchaseOrderReceiptWithDb(db, company, id, '검수자')).toBe(true);
    expect(await state(id, ['sub-a', 'sub-b'])).toEqual({ status: 'received', stocks: [13, 14] });
    expect((await getDoc(doc(db, 'itemReceipts', `rcv-po-${id}-sub-a`))).data()).toMatchObject({ quantity: 3, poId: id, companyId: company });
    expect(await confirmUnitPurchaseOrderReceiptWithDb(db, company, id, '검수자')).toBe(false);
    expect(await state(id, ['sub-a', 'sub-b'])).toEqual({ status: 'received', stocks: [13, 14] });
  }, 20_000);

  it('두 번째 품목이 없으면 첫 번째 재고도 발주 상태도 바꾸지 않는다', async () => {
    const id = 'po-atomic-missing';
    await seed(id, [{ itemId: 'sub-c', quantity: 3 }, { itemId: 'missing', quantity: 4 }], { missing: 'missing' });
    await expect(confirmUnitPurchaseOrderReceiptWithDb(userDb(), company, id)).rejects.toThrow();
    expect(await state(id, ['sub-c'])).toEqual({ status: 'invoiced', stocks: [10] });
    expect((await getDoc(doc(userDb(), 'itemReceipts', `rcv-po-${id}-sub-c`))).exists()).toBe(false);
  }, 20_000);

  it('동시 클릭과 과거 부분 입고 기록을 구별한다', async () => {
    const concurrent = 'po-atomic-concurrent';
    await seed(concurrent, [{ itemId: 'sub-concurrent', quantity: 2 }]);
    expect((await Promise.all([
      confirmUnitPurchaseOrderReceiptWithDb(userDb(), company, concurrent),
      confirmUnitPurchaseOrderReceiptWithDb(userDb(), company, concurrent),
    ])).sort()).toEqual([false, true]);
    expect(await state(concurrent, ['sub-concurrent'])).toEqual({ status: 'received', stocks: [12] });

    const legacy = 'po-atomic-legacy';
    await seed(legacy, [{ itemId: 'sub-legacy', quantity: 2 }]);
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'itemReceipts', 'old-partial-receipt'), {
        companyId: company, poId: legacy, itemId: 'sub-legacy', quantity: 2, date: '2026-10-03', partnerName: '검수 거래처', createdAt: '2026-10-03',
      });
    });
    await expect(confirmUnitPurchaseOrderReceiptWithDb(userDb(), company, legacy)).rejects.toThrow('이미 입고 기록');
    expect(await state(legacy, ['sub-legacy'])).toEqual({ status: 'invoiced', stocks: [10] });
  }, 20_000);

  it('상품(goods)도 일반 재고·입고 기록으로 확정한다', async () => {
    const id = 'po-atomic-goods';
    await seed(id, [{ itemId: 'goods-oil', quantity: 5 }], { goods: 'goods-oil' });
    expect(await confirmUnitPurchaseOrderReceiptWithDb(userDb(), company, id)).toBe(true);
    expect(await state(id, ['goods-oil'])).toEqual({ status: 'received', stocks: [15] });
    expect((await getDoc(doc(userDb(), 'itemReceipts', `rcv-po-${id}-goods-oil`))).data()?.quantity).toBe(5);
  }, 20_000);

  it('회사 혼합 또는 원료 로트 품목을 안전하게 거절한다', async () => {
    const foreign = 'po-atomic-foreign';
    await seed(foreign, [{ itemId: 'sub-d', quantity: 2 }, { itemId: 'foreign', quantity: 2 }], { foreign: 'foreign' });
    await expect(confirmUnitPurchaseOrderReceiptWithDb(userDb(), company, foreign)).rejects.toThrow();
    expect(await state(foreign, ['sub-d'])).toEqual({ status: 'invoiced', stocks: [10] });
    const raw = 'po-atomic-raw';
    await seed(raw, [{ itemId: 'sub-e', quantity: 2 }, { itemId: 'raw', quantity: 2 }], { raw: 'raw' });
    await expect(confirmUnitPurchaseOrderReceiptWithDb(userDb(), company, raw)).rejects.toThrow('로트');
    expect(await state(raw, ['sub-e', 'raw'])).toEqual({ status: 'invoiced', stocks: [10, 10] });
  }, 20_000);
});
