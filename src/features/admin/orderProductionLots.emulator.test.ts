import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getFirestore, setDoc, updateDoc, runTransaction } from 'firebase/firestore';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { createOrderStockEngine } from './orderStockEngine';
import { buildBomIndex } from '../../shared/bomIndex';
import { buildPackIndex } from '../../shared/packIndex';
import { OrderStatus, type Item, type Order } from '../../shared/types';
import {protectInventoryWriterPatch,protectItemInventoryPatch} from '../../shared/inventoryWriterProtocol';
import { inventoryDocId, operationDocId } from '../../shared/rawInventoryCore';

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
        for (const collection of ['rawMaterialLedger', 'rawInventoryJobs']) {
          const rows = await adminDb.collection(collection).where('source.id', '==', orderPath.slice(7)).get();
          for (const row of rows.docs) {
            paths.add(row.ref.path);
            if (collection === 'rawMaterialLedger' && row.data().kind === 'consume') paths.add('rawInventoryReversalGuards/' + operationDocId(row.data().operationId));
          }
        }
      }
      for (const path of paths) { const body = (await adminDb.doc(path).get()).data(); if (!path.includes(prefix) && !body?.rawItemId?.includes(prefix) && !body?.source?.id?.includes(prefix)) throw new Error('정리 범위 불일치'); await adminDb.doc(path).delete(); expect((await adminDb.doc(path).get()).exists).toBe(false); }
    }
    if (adminAuth) { await adminAuth.deleteUser(prefix); await expect(adminAuth.getUser(prefix)).rejects.toMatchObject({ code: 'auth/user-not-found' }); }
    if (app) await deleteApp(app); if (adminApp) await deleteAdminApp(adminApp);
  }, 90_000);
  async function currentWrite(collection:string,id:string,data:Record<string,any>){await runTransaction(db,async tx=>{const ref=doc(db,collection,id),snap=await tx.get(ref);const next=collection==='items'?protectItemInventoryPatch(snap.data(),data):['orders','rawInventories','rawInventoryJobs','rawMaterialLedger'].includes(collection)?protectInventoryWriterPatch(snap.exists()?snap.data():undefined,data,collection==='orders'?Object.keys(data):undefined):data;tx.update(ref,next);});}
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
      updateItem: async (collection, id, data) => currentWrite(collection,id,data),
      addItem: async (collection, data) => { const id = data.id ?? prefix + '-audit-' + randomUUID(); paths.add(collection + '/' + id); await setDoc(doc(db, collection, id), ['orders','rawInventories','rawInventoryJobs','rawMaterialLedger'].includes(collection)?protectInventoryWriterPatch(undefined,{...data,companyId:'taebaek'}):{...data,companyId:'taebaek'}); },
    });
    return { product, ready, order, engine };
  }
  const read = async (path: string) => (await adminDb.doc(path).get()).data()!;
  async function seedKit(suffix: string, shortage = false) {
    const id = prefix + '-' + suffix;
    const lot = (key: string, quantity: number, day: string) => ({ id: id + '-' + key, material: key, supplierName: '합성', qtyIn: quantity, qtyRemaining: quantity, unitKg: 1, kgIn: quantity, kgRemaining: quantity, receivedDate: day, status: 'active' as const, createdAt: day + 'T00:00:00Z' });
    const item = (key: string, stock: number, lots: ReturnType<typeof lot>[] = [], type = 'product') => ({ id: id + '-' + key, companyId: 'taebaek', name: key, type, unit: '개', spec: '1kg', stock, minStock: 0, lots }) as Item;
    const kit = item('kit', 0), a = item('a', shortage ? 1 : 3, shortage ? [lot('a-old', 1, '2026-01-01')] : [lot('a-old', 1, '2026-01-01'), lot('a-new', 2, '2026-01-02')]);
    const b = item('b', 3, [lot('b-old', 3, '2026-01-01')]), packaging = item('packaging', 5, [], 'submaterial'), bottle = item('bottle', 5, [], 'submaterial');
    const raw = { ...item('raw', 10), name: '합성-' + id, type: 'wip', subtype: '벌크', unit: 'kg', lots: [{ id: id + '-raw-lot', material: '합성-' + id, supplierName: '합성', kgIn: 10, kgRemaining: 10, receivedDate: '2026-01-01', status: 'active', createdAt: '2026-01-01T00:00:00Z' }] } as Item;
    const allItems = [kit, a, b, packaging, bottle, raw];
    const order = { id, companyId: 'taebaek', partnerName: '합성', status: OrderStatus.PENDING, items: [{ lineId: 'kit-line', itemId: kit.id, name: kit.name, quantity: 1, checked: false }] } as Order;
    for (const [collection, data] of [...allItems.map(row => ['items', row] as const), ['orders', order] as const]) {
      paths.add(collection + '/' + data.id); const { id: documentId, ...body } = data; await adminDb.doc(collection + '/' + documentId).create(body);
    }
    const rawPath = 'rawInventories/' + inventoryDocId('taebaek', raw.id); paths.add(rawPath);
    await adminDb.doc(rawPath).create({ companyId: 'taebaek', rawItemId: raw.id, materialSnapshot: raw.name, stockKg: 10, revision: 1, activeLots: raw.lots, recentDepletedLots: [] });
    const edges = [[kit, a, 2], [kit, b, 1], [kit, packaging, 1], [a, raw, 1], [a, bottle, 1]] as const;
    const engine = createOrderStockEngine({ db, allItems, submaterials: [packaging, bottle], partners: [], allOrders: [order], orders: [order], actorName: '합성 관리자',
      orderUnitInputs: { bom: buildBomIndex(allItems, edges.map(([parent, child, quantity]) => ({ parent_id: parent.id, child_id: child.id, quantity }))), pack: buildPackIndex([]) },
      buildFormula: () => [], createProductionRecordsForOrder: async () => {},
      updateItem: async (collection, documentId, data) => currentWrite(collection,documentId,data),
      addItem: async (collection, data) => { const documentId = data.id ?? id + '-audit-' + randomUUID(); paths.add(collection + '/' + documentId); await setDoc(doc(db, collection, documentId), { ...data, companyId: 'taebaek' }); },
    });
    return { kit, a, b, packaging, bottle, raw, rawPath, order, engine };
  }
  it('다종 kit는 A2·B1·포장1을 FIFO로 차감하고 배송은 자식을 다시 차감하지 않으며 취소는 원로트를 복원한다', async () => {
    const f = await seedKit('kit-ready');
    await f.engine.changeOrderItemCompletion(f.order.id, 0, f.order.items.map(row => ({ ...row, checked: true })), OrderStatus.DISPATCHED);
    // Fully consumed old lots are pruned; the consumption snapshot still preserves both FIFO takes.
    expect((await read('items/' + f.a.id)).lots.map((row: { id: string; qtyRemaining: number }) => ({ id: row.id, qtyRemaining: row.qtyRemaining })))
      .toEqual([{ id: f.a.lots![1].id, qtyRemaining: 1 }]);
    expect((await read('items/' + f.b.id)).stock).toBe(2); expect((await read('items/' + f.packaging.id)).stock).toBe(4);
    expect((await read(f.rawPath)).stockKg).toBe(10);
    const made = await read('orders/' + f.order.id);
    expect(made.inventorySnapshots.production.productConsumedLots.map((row: any) => ({ itemId: row.itemId, lotId: row.lotId, qty: row.qty }))).toEqual([
      { itemId: f.a.id, lotId: f.a.lots![0].id, qty: 1 },
      { itemId: f.a.id, lotId: f.a.lots![1].id, qty: 1 },
      { itemId: f.b.id, lotId: f.b.lots![0].id, qty: 1 },
    ]);
    await f.engine.changeOrderStatus(f.order.id, OrderStatus.SHIPPED);
    expect((await read('items/' + f.kit.id)).stock).toBe(0); expect((await read('items/' + f.a.id)).stock).toBe(1); expect((await read('items/' + f.b.id)).stock).toBe(2);
    await f.engine.changeOrderStatus(f.order.id, OrderStatus.DISPATCHED); await f.engine.changeOrderStatus(f.order.id, OrderStatus.DISPATCHED);
    expect((await read('items/' + f.kit.id)).stock).toBe(1);
    const saved = await read('orders/' + f.order.id);
    await f.engine.changeOrderItemCompletion(f.order.id, 0, saved.items.map((row: any) => ({ ...row, checked: false })), OrderStatus.PENDING);
    expect((await read('items/' + f.a.id)).lots.map((row: any) => row.qtyRemaining)).toEqual([1, 2]);
    expect((await read('items/' + f.b.id)).stock).toBe(3); expect((await read('items/' + f.packaging.id)).stock).toBe(5);
    await f.engine.changeOrderStatus(f.order.id, OrderStatus.PENDING); expect((await read('items/' + f.a.id)).stock).toBe(3);
  }, 60_000);
  it('kit의 부족 A1만 재귀 생산하여 원료1kg·병1을 실제 저장하고 취소는 해당 원장과 로트를 복원한다', async () => {
    const f = await seedKit('kit-short', true);
    await f.engine.changeOrderItemCompletion(f.order.id, 0, f.order.items.map(row => ({ ...row, checked: true })), OrderStatus.DISPATCHED);
    expect((await read(f.rawPath)).stockKg).toBe(9); expect((await read('items/' + f.raw.id)).stock).toBe(9);
    expect((await read('items/' + f.bottle.id)).stock).toBe(4); expect((await read('items/' + f.packaging.id)).stock).toBe(4); expect((await read('items/' + f.b.id)).stock).toBe(2);
    const saved = await read('orders/' + f.order.id); expect(saved.itemInventory['kit-line'].autoBuilt).toEqual([{ itemId: f.a.id, qty: 1 }]);
    const movements = await adminDb.collection('rawMaterialLedger').where('source.id', '==', f.order.id).get();
    expect(movements.docs.map(row => row.data().appliedDeltaKg)).toEqual([-1]);
    expect(movements.docs[0].data()).toMatchObject({ companyId: 'taebaek', rawItemId: f.raw.id, kind: 'consume', reportedDeltaKg: -1, balanceAfterKg: 9 });
    await f.engine.changeOrderItemCompletion(f.order.id, 0, saved.items.map((row: any) => ({ ...row, checked: false })), OrderStatus.PENDING);
    expect((await read(f.rawPath)).stockKg).toBe(10); expect((await read('items/' + f.raw.id)).lots[0].kgRemaining).toBe(10); expect((await read('items/' + f.bottle.id)).stock).toBe(5);
    const reversed = await adminDb.collection('rawMaterialLedger').where('source.id', '==', f.order.id).get();
    const reverseRows = reversed.docs.filter(row => row.data().kind === 'reverse');
    expect(reverseRows).toHaveLength(1);
    expect(reverseRows[0].data()).toMatchObject({ companyId: 'taebaek', rawItemId: f.raw.id,
      kind: 'reverse', reversalOf: movements.docs[0].data().operationId,
      source: { id: f.order.id }, reportedDeltaKg: 1, appliedDeltaKg: 1 });
    expect(reversed.docs.reduce((sum, row) => sum + row.data().appliedDeltaKg, 0)).toBe(0);
    await f.engine.changeOrderStatus(f.order.id, OrderStatus.PENDING); expect((await read(f.rawPath)).stockKg).toBe(10);
    const repeated = await adminDb.collection('rawMaterialLedger').where('source.id', '==', f.order.id).get();
    expect(repeated.docs.map(row => row.id).sort()).toEqual(reversed.docs.map(row => row.id).sort());
  }, 60_000);
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
