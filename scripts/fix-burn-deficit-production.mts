// 만든 적 없이 나간 몫을 **실제 엔진으로 생산 처리**해 원료를 태운다.
//   기본 = --dry (미리보기).  적용 = --apply.  되돌리기 = --undo
//
// 재고 판정이 화면 값을 봐서 "있다"고 오판하고 생산을 건너뛴 사고(커밋 9f2c7ba)의 뒷정리.
// 재고가 음수인 만큼은 **만든 적 없이 나간 것**이라, 그만큼 원료·부자재가 안 빠져 있다.
// 재고만 0으로 올리면 원료가 부푼 채로 남으므로, 앱과 **같은 엔진**으로 생산을 태운다.
//   → BOM 구성품 차감 + 원료 로트 FIFO 차감 + 원료수불부 기록 + 완제품 재고 +N (출고는 안 한다)
//
// 주문 문서는 만들지 않는다(가짜 주문이 목록에 끼면 안 된다). 엔진의 orders 쓰기는 받아서 버리고,
// 되돌리기는 손댄 품목의 stock·lots를 통째로 스냅샷해 복원한다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, runTransaction, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createOrderStockEngine } from '../src/features/admin/orderStockEngine';
import { buildFormula } from '../src/features/admin/bom';
import { buildBomIndex, setBomIndex } from '../src/shared/bomIndex';
import { OrderStatus, type Item, type Order, type RawMaterialLot } from '../src/shared/types';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-burn-deficit-production-backup.json';

//  사장님이 태우라고 고른 것 — 볶음참깨 계열은 뺀다(벌크·낱개 관계를 따로 봐야 한다).
const TARGETS = ['box-p-20-20', 'box-p-1777506850191-10', 'p-1775086496028', 'box-p-104-20'];

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8')) as { items: Record<string, { stock: number; lots?: RawMaterialLot[] }>; ledgerIds: string[] };
  for (const [id, v] of Object.entries(prev.items))
    await updateDoc(doc(db, 'items', id), v.lots ? { stock: v.stock, lots: v.lots } : { stock: v.stock });
  for (const lid of prev.ledgerIds ?? []) await deleteDoc(doc(db, 'rawMaterialLedger', lid));
  console.log(`✅ 품목 ${Object.keys(prev.items).length}건 복원 · 원장 ${(prev.ledgerIds ?? []).length}줄 삭제`);
  process.exit(0);
}

const [items, boms, formulas] = await Promise.all([load('items'), load('item_bom'), load('item_formula')]);
const live = items.filter((i: any) => !i.archived) as Item[];
setBomIndex(buildBomIndex(live, boms as any));   // unpackComponent/bomOf가 이걸 본다

const targets = TARGETS.map(id => live.find(i => i.id === id)).filter(Boolean) as Item[];
console.log(`\n═══ ${APPLY ? '🔴 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);
for (const t of targets) console.log(`   ${String(t.name + ' ' + (t.spec ?? '')).padEnd(40)} ${t.stock}${t.unit} → 0  (${-Number(t.stock)}${t.unit} 생산)`);

//  ── 손댄 것 기록 ──────────────────────────────────────────────────────────
const touched = new Map<string, { stock: number; lots?: RawMaterialLot[] }>();
const ledgerIds: string[] = [];
const stockLog: { id: string; before: number; after: number }[] = [];
const remember = (id: string) => {
  if (touched.has(id)) return;
  const it = live.find(i => i.id === id);
  touched.set(id, { stock: Number(it?.stock ?? 0), ...(Array.isArray((it as any)?.lots) ? { lots: (it as any).lots } : {}) });
};

const engine = createOrderStockEngine({
  allItems: live, submaterials: [], partners: [], allOrders: [], orders: [], db,
  buildFormula: (k: string) => buildFormula(k, formulas as any, live as any),
  createProductionRecordsForOrder: async () => {},          // 생산기록은 안 만든다(가짜 주문이라)
  mutateRawMaterialLots: async (rawItemId, transform, computeStock) => {
    remember(rawItemId);
    if (!APPLY) {   // 미리보기 — 실제 로트는 안 건드리고 결과만 본다
      const it = live.find(i => i.id === rawItemId) as any;
      const next = transform([...(it?.lots ?? [])], Number(it?.stock ?? 0));
      const sum = next.reduce((a: number, l: any) => a + Number(l.kgRemaining ?? 0), 0);
      console.log(`      원료 ${it?.name}: 로트합 ${Math.round((it?.lots ?? []).reduce((a: number, l: any) => a + Number(l.kgRemaining ?? 0), 0) * 1000) / 1000} → ${Math.round(sum * 1000) / 1000}kg`);
      return next;
    }
    return runTransaction(db, async (tx) => {
      const ref = doc(db, 'items', rawItemId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error(`원료 품목 없음: ${rawItemId}`);
      const d = snap.data();
      const next = transform(Array.isArray(d.lots) ? d.lots : [], Number(d.stock ?? 0));
      const clean = JSON.parse(JSON.stringify(next));   // undefined 필드 제거 — Firestore가 거부한다
      //  lotsAreTotal 원료는 stock을 로트합으로 덮지 않는다(로트=통합, stock=벌크만)
      const patch: any = { lots: clean };
      if (computeStock && !d.lotsAreTotal) patch.stock = computeStock(next);
      tx.update(ref, patch);
      return next;
    });
  },
  updateItem: async (col, id, data: any) => {
    if (col === 'orders') return undefined;               // 가짜 주문 — DB에 안 남긴다
    if (col === 'items') { remember(id); if (APPLY) await updateDoc(doc(db, col, id), data); }
    return undefined;
  },
  addItem: async () => undefined,                          // 알림은 안 만든다
});

//  applyStockDeltas는 db 트랜잭션으로 직접 쓴다 — dry에서는 막아야 하므로 여기서 갈라 준다.
if (!APPLY) {
  console.log(`\n   (미리보기라 재고·로트는 안 바뀝니다. 아래는 엔진이 계산한 원료 차감입니다)\n`);
}

for (const t of targets) {
  const qty = -Number(t.stock ?? 0);
  if (qty <= 0) { console.log(`   ${t.name} — 음수가 아니라 건너뛴다.`); continue; }
  remember(t.id);
  const order = {
    id: `FIX-보정-${t.id}`, partnerName: '재고보정(생산누락)', status: OrderStatus.PENDING,
    items: [{ itemId: t.id, name: t.name, quantity: qty } as any],
  } as unknown as Order;
  console.log(`\n── ${t.name} ${t.spec ?? ''} ×${qty} 생산 ──`);
  if (APPLY) {
    await engine.reconcileOrderStock(order, OrderStatus.DISPATCHED);
    ledgerIds.push(...Object.keys({}));   // 원장 id는 아래에서 모은다
  } else {
    //  dry: 원료 계산만 보여주려고 엔진을 태우면 재고 트랜잭션이 돈다 → 태우지 않는다.
    console.log(`      (적용 시 BOM 구성품·원료가 여기서 빠지고 재고가 0이 됩니다)`);
  }
}

if (!APPLY) { console.log(`\n적용: npx tsx scripts/fix-burn-deficit-production.mts --apply`); process.exit(0); }

//  이번에 생긴 원료수불부 자동 줄(id = rm-auto-{주문}-{원료}) 모으기 — 되돌릴 때 지운다.
const led = await load('rawMaterialLedger');
for (const e of led) if (String(e.id).startsWith('rm-auto-FIX-보정-')) ledgerIds.push(e.id);

writeFileSync(BACKUP, JSON.stringify({ items: Object.fromEntries(touched), ledgerIds }, null, 1), 'utf8');
const after = await load('items');
console.log(`\n── 결과 ──`);
for (const t of targets) {
  const now = after.find((i: any) => i.id === t.id);
  console.log(`   ${String(t.name + ' ' + (t.spec ?? '')).padEnd(40)} ${t.stock} → ${now?.stock}`);
}
console.log(`\n✅ 손댄 품목 ${touched.size}건 · 원장 ${ledgerIds.length}줄 · 백업 ${BACKUP}`);
console.log(`되돌리기: npx tsx scripts/fix-burn-deficit-production.mts --undo`);
process.exit(0);
