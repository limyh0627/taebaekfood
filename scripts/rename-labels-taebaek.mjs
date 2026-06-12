/**
 * 라벨 품목명 "태백" → "시골향" 일괄 변경
 *  - items: 라벨(category 'label' 또는 subtype '라벨') 중 이름에 "태백" 포함 → 치환
 *  - issuedStatements: 미입고 매입전표의 품목명도 같이 변경 (입고확인 매칭 유지)
 *  - purchaseOrders: 미입고 발주카드의 itemName/items[].name 변경
 *  - 거래처 연동(partner_item)·BOM·포장설정은 ID 기반이라 변경 불필요 (자동 반영)
 *
 * 사용법:
 *   node scripts/rename-labels-taebaek.mjs          # 드라이런
 *   node scripts/rename-labels-taebaek.mjs --apply  # 실제 적용
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

const [itemsSnap, stmtSnap, poSnap] = await Promise.all([
  getDocs(collection(db, 'items')),
  getDocs(collection(db, 'issuedStatements')),
  getDocs(collection(db, 'purchaseOrders')),
]);

const isLabel = (x) => x.category === 'label' || x.subtype === '라벨';

// ── 1. 라벨 변경 계획 ─────────────────────────────────────────────
const renames = []; // { id, oldName, newName }
for (const d of itemsSnap.docs) {
  const x = d.data();
  if (!isLabel(x)) continue;
  if (!x.name.includes('태백')) continue;
  renames.push({ id: d.id, oldName: x.name, newName: x.name.replaceAll('태백', '시골향') });
}

console.log(`═══ 라벨명 변경 계획: ${renames.length}건 ═══`);
for (const r of renames) console.log(`  ${r.oldName}  →  ${r.newName}`);

const byOldName = new Map();
for (const r of renames) {
  if (!byOldName.has(r.oldName)) byOldName.set(r.oldName, []);
  byOldName.get(r.oldName).push(r);
}
const byId = new Map(renames.map(r => [r.id, r]));

// ── 2. 미입고 매입전표 품목명 변경 ────────────────────────────────
const stmtUpdates = [];
const stmtAmbiguous = [];
for (const d of stmtSnap.docs) {
  const s = d.data();
  if (s.type !== '매입' || s.receivedAt) continue;
  const changed = [];
  const newItems = (s.items ?? []).map(line => {
    const candidates = byOldName.get(line.name);
    if (!candidates) return line;
    if (candidates.length > 1) {
      stmtAmbiguous.push({ docNo: s.docNo, name: line.name });
      return line;
    }
    changed.push({ old: line.name, new: candidates[0].newName });
    return { ...line, name: candidates[0].newName };
  });
  if (changed.length > 0) stmtUpdates.push({ id: d.id, docNo: s.docNo, partnerName: s.partnerName, items: newItems, changed });
}

console.log(`\n═══ 미입고 매입전표 품목명 변경: ${stmtUpdates.length}건 ═══`);
for (const u of stmtUpdates) {
  console.log(`  전표 ${u.docNo} (${u.partnerName}):`);
  for (const c of u.changed) console.log(`    ${c.old} → ${c.new}`);
}
if (stmtAmbiguous.length > 0) {
  console.log(`\n⚠ 동명 라벨이 여러 개라 자동 매칭 불가 (${stmtAmbiguous.length}건):`);
  for (const a of stmtAmbiguous) console.log(`  전표 ${a.docNo}: "${a.name}"`);
}

// ── 3. 미입고 발주카드 변경 (itemId 기준) ─────────────────────────
const poUpdates = [];
for (const d of poSnap.docs) {
  const po = d.data();
  if (po.status === 'received') continue;
  const fields = {};
  const desc = [];
  const r = byId.get(po.itemId);
  if (r && po.itemName === r.oldName) {
    fields.itemName = r.newName;
    desc.push(`${r.oldName} → ${r.newName}`);
  }
  if (Array.isArray(po.items) && po.items.length > 0) {
    let touched = false;
    const newLines = po.items.map(line => {
      const lr = byId.get(line.itemId);
      if (lr && line.name === lr.oldName) {
        touched = true;
        desc.push(`${lr.oldName} → ${lr.newName}`);
        return { ...line, name: lr.newName };
      }
      return line;
    });
    if (touched) fields.items = newLines;
  }
  if (Object.keys(fields).length > 0) poUpdates.push({ id: d.id, fields, desc, status: po.status });
}

console.log(`\n═══ 미입고 발주카드 변경: ${poUpdates.length}건 ═══`);
for (const u of poUpdates) console.log(`  PO ${u.id} [${u.status}]: ${u.desc.join(', ')}`);

// ── 적용 ──────────────────────────────────────────────────────────
if (!APPLY) {
  console.log('\n(드라이런 — 실제 변경 없음. 적용하려면 --apply 옵션을 붙이세요)');
  process.exit(0);
}

console.log('\n═══ 적용 시작 ═══');
const ops = [
  ...renames.map(r => ({ ref: doc(db, 'items', r.id), data: { name: r.newName } })),
  ...stmtUpdates.map(u => ({ ref: doc(db, 'issuedStatements', u.id), data: { items: u.items } })),
  ...poUpdates.map(u => ({ ref: doc(db, 'purchaseOrders', u.id), data: u.fields })),
];
for (let i = 0; i < ops.length; i += 400) {
  const batch = writeBatch(db);
  for (const op of ops.slice(i, i + 400)) batch.update(op.ref, op.data);
  await batch.commit();
  console.log(`  ${Math.min(i + 400, ops.length)}/${ops.length} 커밋 완료`);
}
console.log(`✅ 완료: 라벨 ${renames.length}건, 전표 ${stmtUpdates.length}건, 발주카드 ${poUpdates.length}건 변경`);
process.exit(0);
