import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, where, type Firestore } from 'firebase/firestore';
vi.mock('../firebase', () => ({ db: null, auth: { currentUser: null }, authReady: Promise.resolve() }));
const { confirmUnitPurchaseOrderReceiptWithDb, deletePendingPurchaseOrderWithDb } = await import('./firebaseService');

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

  it('벌크 원료 kg와 반제품 L를 로트·원장·발주 상태까지 원자적으로 확정한다', async () => {
    for (const [id, type, unit, quantity, expectedKg] of [
      ['po-raw-kg', 'raw', 'kg', 1500, 1500],
      ['po-wip-l', 'wip', 'L', 743, 680.588],
    ] as const) {
      await seed(id, [{ itemId: id, quantity }]);
      await env.withSecurityRulesDisabled(async ctx => {
        await setDoc(doc(ctx.firestore(), 'items', id), { type, subtype: '벌크', name: type === 'raw' ? '참깨' : '통깨참기름', unit, stock: 0, lots: [] }, { merge: true });
      });
      expect(await confirmUnitPurchaseOrderReceiptWithDb(userDb(), company, id, '검수자')).toBe(true);
      expect((await getDoc(doc(userDb(), 'purchaseOrders', id))).data()?.status).toBe('received');
      expect((await getDoc(doc(userDb(), 'items', id))).data()?.stock).toBe(expectedKg);
      const ledger = await getDocs(query(collection(userDb(), 'rawMaterialLedger'), where('companyId', '==', company), where('source.id', '==', id)));
      expect(ledger.size).toBe(1);
      expect(await confirmUnitPurchaseOrderReceiptWithDb(userDb(), company, id, '검수자')).toBe(false);
      expect((await getDoc(doc(userDb(), 'items', id))).data()?.stock).toBe(expectedKg);
    }
  }, 30_000);

  it('포장 SKU는 같은 회사 벌크 홀더로 환산하고, 혼합 발주 실패 시 일반 재고도 보존한다', async () => {
    const id = 'po-raw-packaged';
    await seed(id, [{ itemId: 'pack-sesame', quantity: 3 }]);
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'items', 'pack-sesame'), { type: 'raw', subtype: '포장', name: '참깨/20kg', spec: '20kg', unit: '개', stock: 0 }, { merge: true });
      await setDoc(doc(db, 'items', 'holder-sesame'), { companyId: company, type: 'raw', subtype: '벌크', name: '참깨', unit: 'kg', stock: 0, lots: [] });
    });
    const holder = { id: 'holder-sesame', companyId: company, type: 'raw', subtype: '벌크', name: '참깨', unit: 'kg', stock: 0 } as any;
    expect(await confirmUnitPurchaseOrderReceiptWithDb(userDb(), company, id, '검수자', [holder])).toBe(true);
    expect((await getDoc(doc(userDb(), 'items', 'holder-sesame'))).data()?.stock).toBe(60);
    expect((await getDoc(doc(userDb(), 'items', 'pack-sesame'))).data()?.stock).toBe(0);

    const bad = 'po-raw-mixed-failure';
    await seed(bad, [{ itemId: 'sub-mixed', quantity: 2 }, { itemId: 'raw-mixed', quantity: 5 }]);
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'items', 'raw-mixed'), { type: 'raw', subtype: '벌크', name: '참깨', unit: 'kg', stock: 10, lots: [] }, { merge: true });
      await setDoc(doc(ctx.firestore(), 'rawInventories', 'taebaek__raw-mixed'), { companyId: company, rawItemId: 'raw-mixed', stockKg: 0, activeLots: [], recentDepletedLots: [], revision: 0 });
    });
    await expect(confirmUnitPurchaseOrderReceiptWithDb(userDb(), company, bad)).rejects.toThrow();
    expect(await state(bad, ['sub-mixed', 'raw-mixed'])).toEqual({ status: 'invoiced', stocks: [10, 10] });
    expect((await getDoc(doc(userDb(), 'itemReceipts', `rcv-po-${bad}-sub-mixed`))).exists()).toBe(false);
  }, 30_000);

  it('이전 원료 입고 원장이나 변경된 홀더 연결은 재입고·삭제를 막는다', async () => {
    const old = 'po-raw-previous';
    await seed(old, [{ itemId: 'raw-previous', quantity: 2 }]);
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'items', 'raw-previous'), { type: 'raw', subtype: '벌크', name: '참깨', unit: 'kg', stock: 0 }, { merge: true });
      await setDoc(doc(db, 'rawMaterialLedger', 'old-raw-receipt'), { companyId: company, source: { type: 'purchase', id: old }, kind: 'receive', kg: 2 });
    });
    await expect(confirmUnitPurchaseOrderReceiptWithDb(userDb(), company, old)).rejects.toThrow('이미 원료 입고');
    await expect(deletePendingPurchaseOrderWithDb(userDb(), company, old)).rejects.toThrow('이미 원료 입고');
    expect((await getDoc(doc(userDb(), 'purchaseOrders', old))).exists()).toBe(true);

    const stale = 'po-raw-stale-holder';
    await seed(stale, [{ itemId: 'pack-stale', quantity: 2 }]);
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'items', 'pack-stale'), { type: 'raw', subtype: '포장', name: '참깨/20kg', spec: '20kg', unit: '개', stock: 0 }, { merge: true });
      await setDoc(doc(db, 'items', 'holder-stale'), { companyId: company, type: 'raw', subtype: '벌크', name: '들깨', unit: 'kg', stock: 0 });
    });
    await expect(confirmUnitPurchaseOrderReceiptWithDb(userDb(), company, stale, undefined,
      [{ id: 'holder-stale', companyId: company, type: 'raw', subtype: '벌크', name: '참깨' } as any])).rejects.toThrow('홀더 연결이 변경');
    expect((await getDoc(doc(userDb(), 'purchaseOrders', stale))).data()?.status).toBe('invoiced');

    const noSize = 'po-raw-no-package-size';
    await seed(noSize, [{ itemId: 'pack-no-size', quantity: 2 }]);
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'items', 'pack-no-size'), { type: 'raw', subtype: '포장', name: '참깨', spec: '', unit: '개', stock: 0 }, { merge: true });
    });
    await expect(confirmUnitPurchaseOrderReceiptWithDb(userDb(), company, noSize, undefined,
      [{ id: 'holder-sesame', companyId: company, type: 'raw', subtype: '벌크', name: '참깨' } as any])).rejects.toThrow('kg 환산값');
    expect((await getDoc(doc(userDb(), 'purchaseOrders', noSize))).data()?.status).toBe('invoiced');
  }, 30_000);

  it('회사 혼합 또는 원료 홀더가 없는 품목은 안전하게 거절한다', async () => {
    const foreign = 'po-atomic-foreign';
    await seed(foreign, [{ itemId: 'sub-d', quantity: 2 }, { itemId: 'foreign', quantity: 2 }], { foreign: 'foreign' });
    await expect(confirmUnitPurchaseOrderReceiptWithDb(userDb(), company, foreign)).rejects.toThrow();
    expect(await state(foreign, ['sub-d'])).toEqual({ status: 'invoiced', stocks: [10] });
    const raw = 'po-atomic-raw';
    await seed(raw, [{ itemId: 'sub-e', quantity: 2 }, { itemId: 'raw', quantity: 2 }], { raw: 'raw' });
    await expect(confirmUnitPurchaseOrderReceiptWithDb(userDb(), company, raw)).rejects.toThrow('로트');
    expect(await state(raw, ['sub-e', 'raw'])).toEqual({ status: 'invoiced', stocks: [10, 10] });
  }, 20_000);

  it('미입고·미연결 일반 발주만 삭제하고 재고·전표에는 손대지 않는다', async () => {
    const id = 'po-delete-pending';
    await seed(id, [{ itemId: 'sub-delete', quantity: 2 }]);
    await deletePendingPurchaseOrderWithDb(userDb(), company, id);
    expect((await getDoc(doc(userDb(), 'purchaseOrders', id))).exists()).toBe(false);
    expect((await getDoc(doc(userDb(), 'items', 'sub-delete'))).data()?.stock).toBe(10);
    expect((await getDoc(doc(userDb(), 'itemReceipts', `rcv-po-${id}-sub-delete`))).exists()).toBe(false);
  }, 20_000);

  it('전표 연결·입고 완료·원료·기존 입고 근거는 삭제를 막는다', async () => {
    const cases = [
      { id: 'po-delete-linked', patch: { linkedStatementId: 'voucher-1' } },
      { id: 'po-delete-received', patch: { status: 'received' } },
      { id: 'po-delete-oem', patch: { poType: 'oem' } },
    ];
    for (const { id, patch } of cases) {
      await seed(id, [{ itemId: `${id}-item`, quantity: 2 }]);
      await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'purchaseOrders', id), patch, { merge: true }); });
      await expect(deletePendingPurchaseOrderWithDb(userDb(), company, id)).rejects.toThrow();
      expect((await getDoc(doc(userDb(), 'purchaseOrders', id))).exists()).toBe(true);
    }
    const rawId = 'po-delete-raw';
    await seed(rawId, [{ itemId: 'raw-delete', quantity: 2 }], { raw: 'raw-delete' });
    await deletePendingPurchaseOrderWithDb(userDb(), company, rawId);
    expect((await getDoc(doc(userDb(), 'purchaseOrders', rawId))).exists()).toBe(false);
    const receiptId = 'po-delete-receipt';
    await seed(receiptId, [{ itemId: 'sub-delete-receipt', quantity: 2 }]);
    await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'itemReceipts', 'older-receipt'), {
      companyId: company, poId: receiptId, itemId: 'sub-delete-receipt', quantity: 2, date: '2026-10-04', createdAt: '2026-10-04', partnerName: '검수 거래처',
    }); });
    await expect(deletePendingPurchaseOrderWithDb(userDb(), company, receiptId)).rejects.toThrow('이미 입고');
    expect((await getDoc(doc(userDb(), 'purchaseOrders', receiptId))).exists()).toBe(true);
  }, 20_000);
});
