import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getFirestore, setDoc, updateDoc } from 'firebase/firestore';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { createOrderStockEngine } from './orderStockEngine';
import { buildBomIndex } from '../../shared/bomIndex';
import { buildPackIndex } from '../../shared/packIndex';
import { OrderStatus, type Item, type Order } from '../../shared/types';

describe.skipIf(process.env.ORDER_PRODUCTION_EMULATOR_TEST !== 'true')('자체 생산·출고·취소 실제 인증 저장', () => {
  const projectId = 'demo-taebaekfood-local', prefix = 'production-sdk-' + randomUUID();
  let app: ReturnType<typeof initializeApp>, adminApp: ReturnType<typeof initializeAdminApp>;
  let db: ReturnType<typeof getFirestore>, adminDb: ReturnType<typeof getAdminFirestore>, adminAuth: ReturnType<typeof getAdminAuth>;
  const paths = new Set<string>();
  beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8082' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('로컬 에뮬레이터 주소 불일치');
    adminApp = initializeAdminApp({ projectId }, prefix + '-admin'); adminDb = getAdminFirestore(adminApp); adminAuth = getAdminAuth(adminApp);
    const email = prefix + '@example.invalid', password = randomUUID() + 'A1!';
    await adminAuth.createUser({ uid: prefix, email, password });
    await adminAuth.setCustomUserClaims(prefix, { employeeId: prefix, companyId: 'taebaek', isAdmin: true });
    app = initializeApp({ projectId, apiKey: 'local-emulator-only' }, prefix); db = getFirestore(app);
    connectFirestoreEmulator(db, '127.0.0.1', 8082);
    const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    await signInWithEmailAndPassword(auth, email, password);
    expect((await auth.currentUser!.getIdTokenResult(true)).claims).toMatchObject({ companyId: 'taebaek', isAdmin: true });
  }, 90_000);
  afterAll(async () => {
    if (adminDb) {
      for (const orderPath of [...paths].filter(path => path.startsWith('orders/'))) {
        const audits = await adminDb.collection('orderStatusAudits').where('orderId', '==', orderPath.slice(7)).get();
        for (const audit of audits.docs) paths.add(audit.ref.path);
      }
      for (const path of paths) { if (!path.includes(prefix)) throw new Error('정리 범위 불일치'); await adminDb.doc(path).delete(); expect((await adminDb.doc(path).get()).exists).toBe(false); }
    }
    if (adminAuth) { await adminAuth.deleteUser(prefix); await expect(adminAuth.getUser(prefix)).rejects.toMatchObject({ code: 'auth/user-not-found' }); }
    if (app) await deleteApp(app); if (adminApp) await deleteAdminApp(adminApp);
  }, 90_000);
  async function seed(suffix: string, stockProduction = false) {
    const product = { id: prefix + '-' + suffix + '-product', companyId: 'taebaek', name: '합성 완제품', type: 'product', unit: '개', spec: '1kg', stock: stockProduction ? 10 : 0, lots: stockProduction ? [{ id: prefix + '-existing', material: '합성 완제품', supplierName: '합성', qtyIn: 10, qtyRemaining: 10, unitKg: 1, kgIn: 10, kgRemaining: 10, receivedDate: '2026-01-01', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' }] : [] } as unknown as Item;
    const ready = { ...product, id: prefix + '-' + suffix + '-ready', name: '합성 구성 완제품', stock: 20,
      lots: [{ id: prefix + '-component-lot', material: '합성 구성 완제품', supplierName: '합성', qtyIn: 20, qtyRemaining: 20, unitKg: 1, kgIn: 20, kgRemaining: 20, receivedDate: '2026-01-01', status: 'active' as const, createdAt: '2026-01-01T00:00:00.000Z' }] };
    const order = { id: prefix + '-' + suffix, companyId: 'taebaek', ...(stockProduction ? { purpose: 'stock-production' as const } : {}), partnerName: '합성 거래처', status: OrderStatus.PENDING,
      items: [{ lineId: 'line-a', itemId: product.id, name: product.name, quantity: 5, checked: false }] } as Order;
    for (const [collection, data] of [['items', product], ['items', ready], ['orders', order]] as const) {
      paths.add(collection + '/' + data.id); const { id, ...body } = data; await adminDb.doc(collection + '/' + id).create(body);
    }
    const engine = createOrderStockEngine({ db, allItems: [product, ready], submaterials: [], partners: [], allOrders: [order], orders: [order],
      orderUnitInputs: { bom: buildBomIndex([product, ready], [{ parent_id: product.id, child_id: ready.id, quantity: 1 }]), pack: buildPackIndex([]) },
      actorName: '합성 관리자', buildFormula: () => [], createProductionRecordsForOrder: async () => {},
      updateItem: async (collection, id, data) => updateDoc(doc(db, collection, id), data),
      addItem: async (collection, data) => { const id = data.id ?? prefix + '-audit-' + randomUUID(); paths.add(collection + '/' + id); await setDoc(doc(db, collection, id), { ...data, companyId: 'taebaek' }); },
    });
    return { product, ready, order, engine };
  }
  const read = async (path: string) => (await adminDb.doc(path).get()).data()!;
  it('품목 생산과 로트/스냅샷 저장 후 출고0, 취소는5를 복원하고 반복 취소는 더하지 않는다', async () => {
    const { product, ready, order, engine } = await seed('line');
    await engine.changeOrderItemCompletion(order.id, 0, order.items.map(row => ({ ...row, checked: true })), OrderStatus.DISPATCHED);
    const made = await read('items/' + product.id), saved = await read('orders/' + order.id);
    expect(made.stock).toBe(5); expect(made.lots.reduce((sum: number, lot: any) => sum + lot.qtyRemaining, 0)).toBe(5);
    expect(saved.itemInventory['line-a'].production.productProducedLots).toHaveLength(1);
    expect((await read('items/' + ready.id)).stock).toBe(15);
    expect((await read('items/' + ready.id)).lots[0].qtyRemaining).toBe(15);
    expect(saved.inventorySnapshots.production.productConsumedLots[0].qty).toBe(5);
    await engine.changeOrderStatus(order.id, OrderStatus.SHIPPED);
    expect((await read('items/' + product.id)).stock).toBe(0);
    await engine.changeOrderStatus(order.id, OrderStatus.DISPATCHED);
    const returned = await read('items/' + product.id);
    expect(returned.stock).toBe(5); expect(returned.lots.reduce((sum: number, lot: any) => sum + lot.qtyRemaining, 0)).toBe(5);
    await engine.changeOrderStatus(order.id, OrderStatus.DISPATCHED);
    expect((await read('items/' + product.id)).stock).toBe(5);
    const afterCancel = await read('orders/' + order.id);
    await engine.changeOrderItemCompletion(order.id, 0, afterCancel.items.map((row: any) => ({ ...row, checked: false })), OrderStatus.PENDING);
    expect((await read('items/' + product.id)).stock).toBe(0);
    expect((await read('items/' + product.id)).lots[0].qtyRemaining).toBe(0);
    expect((await read('items/' + ready.id)).stock).toBe(20);
    expect((await read('items/' + ready.id)).lots[0].qtyRemaining).toBe(20);
  }, 60_000);
  it('전체 작업완료도 생산 재고·로트·주문 근거를 저장하고 로트 부족 출고는 잠금/재고를 남기지 않는다', async () => {
    const { product, order, engine } = await seed('status');
    await engine.changeOrderStatus(order.id, OrderStatus.DISPATCHED, undefined, { orderPatch: { items: order.items.map(row => ({ ...row, checked: true })) } });
    expect((await read('items/' + product.id)).lots[0].qtyRemaining).toBe(5);
    const saved = await read('orders/' + order.id); expect(saved.inventorySnapshots.production.productProducedLots).toHaveLength(1);
    const original = await read('items/' + product.id); await adminDb.doc('items/' + product.id).update({ lots: original.lots.map((lot: any) => ({ ...lot, qtyRemaining: 1, kgRemaining: 1 })) });
    await expect(engine.changeOrderStatus(order.id, OrderStatus.SHIPPED)).rejects.toThrow('로트 재고가 부족');
    const after = await read('items/' + product.id);
    expect(after.stock).toBe(5); expect(after.lots[0].qtyRemaining).toBe(1);
    expect(after.inventoryReservations).toEqual(original.inventoryReservations);
    expect((await read('orders/' + order.id)).inventoryOperation).toBeNull();
  }, 60_000);
  it('재고 만들기는 기존10개가 있어도5개를 추가생산하고 예약없이 판매가용하며 취소는 원래10개로 복원한다', async () => {
    const { product, ready, order, engine } = await seed('stock-only', true);
    await engine.changeOrderItemCompletion(order.id, 0, order.items.map(row => ({ ...row, checked: true })), OrderStatus.DISPATCHED);
    const made = await read('items/' + product.id);
    expect(made.stock).toBe(15);
    expect(made.lots.reduce((sum: number, lot: any) => sum + lot.qtyRemaining, 0)).toBe(15);
    expect(Object.values(made.inventoryReservations ?? {}).some((row: any) => row.orderId === order.id)).toBe(false);
    expect((await read('items/' + ready.id)).stock).toBe(15);
    await engine.changeOrderStatus(order.id, OrderStatus.DISPATCHED);
    expect((await read('items/' + product.id)).stock).toBe(15);
    await expect(engine.changeOrderStatus(order.id, OrderStatus.SHIPPED)).rejects.toThrow('출고하지 않습니다');
    const saved = await read('orders/' + order.id);
    await engine.changeOrderItemCompletion(order.id, 0, saved.items.map((row: any) => ({ ...row, checked: false })), OrderStatus.PENDING);
    expect((await read('items/' + product.id)).stock).toBe(10);
    expect((await read('items/' + ready.id)).stock).toBe(20);
  }, 60_000);

});
