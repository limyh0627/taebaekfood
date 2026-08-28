// 태영상회 08-27 주문 삭제 — 잘못 들어간 주문(사장님 확인).
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// **그냥 지우면 안 된다.** 앱의 주문 삭제는 deleteItem('orders') 한 줄이라 재고·로트·원장이
// 그대로 남는다. 이 주문은 3박스를 생산 처리했으니 낱개·부자재가 빠져 있다.
// 엔진으로 PENDING까지 되돌린(출고취소 → 생산취소) 뒤에 지운다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, deleteDoc, setDoc, updateDoc, runTransaction } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createOrderStockEngine } from '../src/features/admin/orderStockEngine';
import { buildFormula } from '../src/features/admin/bom';
import { buildBomIndex, setBomIndex } from '../src/shared/bomIndex';
import { OrderStatus, type Item, type Order, type RawMaterialLot } from '../src/shared/types';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-delete-order-taeyoung-backup.json';
const ORDER_ID = 'ORD-1787632838910';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8'));
  await setDoc(doc(db, 'orders', ORDER_ID), prev.order);              // 주문 되살리기
  for (const [id, v] of Object.entries(prev.items as Record<string, any>))
    await updateDoc(doc(db, 'items', id), v.lots ? { stock: v.stock, lots: v.lots } : { stock: v.stock });
  console.log(`✅ 주문 복원 · 품목 ${Object.keys(prev.items).length}건 되돌림`);
  process.exit(0);
}

const [items, boms, formulas, orders] = await Promise.all([load('items'), load('item_bom'), load('item_formula'), load('orders')]);
const live = items.filter((i: any) => !i.archived) as Item[];
setBomIndex(buildBomIndex(live, boms as any));
const order = orders.find((o: any) => o.id === ORDER_ID) as Order | undefined;
if (!order) { console.error('주문이 없다 — 이미 지워졌나?'); process.exit(1); }

const touched = new Map<string, { stock: number; lots?: RawMaterialLot[] }>();
const remember = (id: string) => {
  if (touched.has(id)) return;
  const it = live.find(i => i.id === id);
  touched.set(id, { stock: Number(it?.stock ?? 0), ...(Array.isArray((it as any)?.lots) ? { lots: (it as any).lots } : {}) });
};
//  되돌리기가 건드릴 후보를 미리 담아 둔다(주문 라인 + BOM 하위)
const walk = (id: string, d = 0) => { if (d > 5) return; remember(id); for (const b of boms.filter((b: any) => b.parent_id === id)) walk(b.child_id, d + 1); };
for (const it of order.items) walk(it.itemId);

console.log(`\n═══ ${APPLY ? '🔴 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);
console.log(`   ${order.partnerName} ${String((order as any).deliveredAt ?? '').slice(0, 10)}  ${order.status}`);
for (const it of order.items) {
  const p = live.find(x => x.id === it.itemId);
  console.log(`      ${p?.name} ${p?.spec ?? ''} ×${(it as any).isBoxUnit && (it as any).boxQuantity ? (it as any).boxQuantity : it.quantity}  현재고 ${p?.stock}${p?.unit}`);
}
console.log(`\n   ① 출고취소 → 생산취소 (낱개·부자재 복원)`);
console.log(`   ② 주문 문서 삭제`);
console.log(`\n되돌리기: npx tsx scripts/fix-delete-order-taeyoung.mts --undo`);
if (!APPLY) { console.log(`\n적용: npx tsx scripts/fix-delete-order-taeyoung.mts --apply`); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify({ order, items: Object.fromEntries(touched) }, null, 1), 'utf8');

const engine = createOrderStockEngine({
  allItems: live, submaterials: [], partners: [], allOrders: [order], orders: [order], db,
  buildFormula: (k: string) => buildFormula(k, formulas as any, live as any),
  createProductionRecordsForOrder: async () => {},
  mutateRawMaterialLots: async (rawItemId, transform, computeStock) => runTransaction(db, async (tx) => {
    const ref = doc(db, 'items', rawItemId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`원료 품목 없음: ${rawItemId}`);
    const d = snap.data();
    const next = transform(Array.isArray(d.lots) ? d.lots : [], Number(d.stock ?? 0));
    const patch: any = { lots: JSON.parse(JSON.stringify(next)) };
    if (computeStock && !d.lotsAreTotal) patch.stock = computeStock(next);
    tx.update(ref, patch);
    return next;
  }),
  updateItem: async (col, id, data: any) => { if (col !== 'orders') await updateDoc(doc(db, col, id), data); return undefined; },
  addItem: async () => undefined,
});

await engine.reconcileOrderStock(order, OrderStatus.PENDING);   // 출고취소 → 생산취소
await deleteDoc(doc(db, 'orders', ORDER_ID));

const after = await load('items');
console.log(`\n── 되돌아온 것 ──`);
for (const [id, before] of touched) {
  const now = after.find((i: any) => i.id === id);
  const d = Math.round(((now?.stock ?? 0) - before.stock) * 1000) / 1000;
  if (d) console.log(`   ${String(now?.name + ' ' + (now?.spec ?? '')).padEnd(40)} ${before.stock} → ${now?.stock} (${d > 0 ? '+' : ''}${d})`);
}
console.log(`\n✅ 주문 삭제 · 백업 ${BACKUP}`);
process.exit(0);
