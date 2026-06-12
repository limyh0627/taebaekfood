/**
 * 품목명 변경 후 전체 정합성 감사 + 잔여 스냅샷 동기화
 *
 * 검사:
 *  A. 미입고 매입전표 라인 → items 이름 매칭 (입고확인 동작 검증)
 *  B. 미입고 발주카드 itemId/이름 정합성
 *  C. 미출고 주문 items[].itemId 유효성 + 이름 스냅샷 불일치
 *  D. 거래처 purchaseItems 스냅샷 불일치
 *  E. 이름 중복 품목 (입고확인 오매칭 위험)
 *  F. submaterials/BOM 잔여 불일치
 *
 * 동기화(--apply):
 *  - 미출고 주문 items[].name → 현재 품목명
 *  - 거래처 purchaseItems[].name → 현재 품목명
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const APPLY = process.argv.includes('--apply');

const firebaseConfig = {
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);
await signInAnonymously(auth);

const [itemsSnap, stmtSnap, poSnap, ordersSnap, partnersSnap, bomSnap] = await Promise.all([
  getDocs(collection(db, 'items')),
  getDocs(collection(db, 'issuedStatements')),
  getDocs(collection(db, 'purchaseOrders')),
  getDocs(collection(db, 'orders')),
  getDocs(collection(db, 'partners')),
  getDocs(collection(db, 'item_bom')),
]);

const itemMap = new Map(itemsSnap.docs.map(d => [d.id, d.data()]));
const nameCount = new Map();
for (const x of itemMap.values()) nameCount.set(x.name, (nameCount.get(x.name) ?? 0) + 1);

let problems = 0;

// ── A. 미입고 매입전표 ─────────────────────────────────────────────
console.log('═══ A. 미입고 매입전표 라인 ↔ items 이름 매칭 ═══');
for (const d of stmtSnap.docs) {
  const s = d.data();
  if (s.type !== '매입' || s.receivedAt) continue;
  for (const line of s.items ?? []) {
    const cnt = nameCount.get(line.name) ?? 0;
    if (cnt === 0) { problems++; console.log(`  ✗ 전표 ${s.docNo} (${s.partnerName}): "${line.name}" — 일치 품목 없음 (입고확인 시 재고반영 안 됨)`); }
    else if (cnt > 1) console.log(`  ⚠ 전표 ${s.docNo}: "${line.name}" — 동명 품목 ${cnt}개 (첫 번째에 반영됨)`);
  }
}
console.log('  (이상 없으면 출력 없음)');

// ── B. 미입고 발주카드 ────────────────────────────────────────────
console.log('\n═══ B. 미입고 발주카드 정합성 ═══');
for (const d of poSnap.docs) {
  const po = d.data();
  if (po.status === 'received') continue;
  const lines = (po.items && po.items.length > 0)
    ? po.items.map(l => ({ id: l.itemId, name: l.name }))
    : [{ id: po.itemId, name: po.itemName }];
  for (const l of lines) {
    const it = l.id ? itemMap.get(l.id) : null;
    if (l.id && !it) { problems++; console.log(`  ✗ PO ${d.id} [${po.status}]: itemId ${l.id} 품목 없음`); }
    else if (it && it.name !== l.name) console.log(`  ⚠ PO ${d.id} [${po.status}]: 이름 스냅샷 "${l.name}" ≠ 현재 "${it.name}"`);
  }
}
console.log('  (이상 없으면 출력 없음)');

// ── C. 미출고 주문 ────────────────────────────────────────────────
console.log('\n═══ C. 미출고 주문 품목 정합성 ═══');
const orderUpdates = [];
for (const d of ordersSnap.docs) {
  const o = d.data();
  if (o.deliveredAt) continue; // 출고 완료 주문은 기록 보존
  let touched = false;
  const changed = [];
  const newItems = (o.items ?? []).map(oi => {
    const it = oi.itemId ? itemMap.get(oi.itemId) : null;
    if (oi.itemId && !it) { problems++; console.log(`  ✗ 주문 ${d.id} (${o.partnerName}): itemId ${oi.itemId} 품목 없음 — 출고 차감 실패함`); return oi; }
    if (it && it.name !== oi.name) { touched = true; changed.push(`${oi.name} → ${it.name}`); return { ...oi, name: it.name }; }
    return oi;
  });
  if (touched) orderUpdates.push({ id: d.id, partnerName: o.partnerName, items: newItems, changed });
}
console.log(`  이름 스냅샷 갱신 대상 주문: ${orderUpdates.length}건`);
for (const u of orderUpdates) console.log(`    주문 ${u.id} (${u.partnerName}): ${u.changed.join(' | ')}`);

// ── D. 거래처 purchaseItems ───────────────────────────────────────
console.log('\n═══ D. 거래처 purchaseItems 스냅샷 ═══');
const partnerUpdates = [];
for (const d of partnersSnap.docs) {
  const p = d.data();
  if (!Array.isArray(p.purchaseItems) || p.purchaseItems.length === 0) continue;
  let touched = false;
  const changed = [];
  const newPis = p.purchaseItems.map(pi => {
    const it = pi.id ? itemMap.get(pi.id) : null;
    if (!it) {
      if (!pi.id || !(nameCount.get(pi.name) > 0)) console.log(`  ⚠ 거래처 ${p.name}: purchaseItems "${pi.name}" (id: ${pi.id ?? '없음'}) — 현재 품목과 못 찾음`);
      return pi;
    }
    if (it.name !== pi.name) { touched = true; changed.push(`${pi.name} → ${it.name}`); return { ...pi, name: it.name }; }
    return pi;
  });
  if (touched) partnerUpdates.push({ id: d.id, name: p.name, purchaseItems: newPis, changed });
}
console.log(`  이름 스냅샷 갱신 대상 거래처: ${partnerUpdates.length}건`);
for (const u of partnerUpdates) console.log(`    ${u.name}: ${u.changed.join(' | ')}`);

// ── E. 이름 중복 품목 ─────────────────────────────────────────────
console.log('\n═══ E. 이름 완전 중복 품목 (입고확인 오매칭 위험) ═══');
for (const [name, cnt] of [...nameCount.entries()].filter(([, c]) => c > 1).sort()) {
  const ids = [...itemMap.entries()].filter(([, x]) => x.name === name).map(([id]) => id);
  console.log(`  "${name}" × ${cnt}  (${ids.join(', ')})`);
}

// ── F. submaterials / BOM 잔여 불일치 ─────────────────────────────
console.log('\n═══ F. submaterials/BOM 잔여 이름 불일치 ═══');
let fCount = 0;
for (const [id, x] of itemMap) {
  for (const s of x.submaterials ?? []) {
    const cur = itemMap.get(s.id);
    if (cur && cur.name !== s.name) { fCount++; console.log(`  ⚠ ${x.name} (${id}): 구성품 "${s.name}" ≠ 현재 "${cur.name}"`); }
  }
}
for (const d of bomSnap.docs) {
  const b = d.data();
  if (!itemMap.get(b.parent_id)) { fCount++; console.log(`  ⚠ BOM ${d.id}: parent ${b.parent_id} 품목 없음`); }
  if (!itemMap.get(b.child_id)) { fCount++; console.log(`  ⚠ BOM ${d.id}: child ${b.child_id} 품목 없음`); }
}
console.log(`  불일치/고아 참조: ${fCount}건`);

console.log(`\n치명 문제(✗): ${problems}건`);

if (!APPLY) {
  console.log('\n(드라이런 — C/D 스냅샷 동기화를 적용하려면 --apply)');
  process.exit(0);
}

console.log('\n═══ C/D 스냅샷 동기화 적용 ═══');
const ops = [
  ...orderUpdates.map(u => ({ ref: doc(db, 'orders', u.id), data: { items: u.items } })),
  ...partnerUpdates.map(u => ({ ref: doc(db, 'partners', u.id), data: { purchaseItems: u.purchaseItems } })),
];
for (let i = 0; i < ops.length; i += 400) {
  const batch = writeBatch(db);
  for (const op of ops.slice(i, i + 400)) batch.update(op.ref, op.data);
  await batch.commit();
}
console.log(`✅ 주문 ${orderUpdates.length}건, 거래처 ${partnerUpdates.length}건 동기화 완료`);
process.exit(0);
