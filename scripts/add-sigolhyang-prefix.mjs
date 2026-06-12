/**
 * 시골향 라벨이 붙은 제품의 품목명 앞에 "시골향 " 접두어 추가
 *  - 대상: BOM(item_bom) 라벨 또는 구성품(submaterials) 라벨 이름에 "시골향"이 들어간 제품
 *  - 이미 이름에 "시골향"이 있으면 제외
 *  - 미입고 매입전표/발주카드 품목명도 같이 변경 (입고확인 매칭 유지)
 *
 * 사용법:
 *   node scripts/add-sigolhyang-prefix.mjs          # 드라이런
 *   node scripts/add-sigolhyang-prefix.mjs --apply  # 실제 적용
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

const [itemsSnap, bomSnap, stmtSnap, poSnap] = await Promise.all([
  getDocs(collection(db, 'items')),
  getDocs(collection(db, 'item_bom')),
  getDocs(collection(db, 'issuedStatements')),
  getDocs(collection(db, 'purchaseOrders')),
]);

const itemMap = new Map(itemsSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
const isLabel = (x) => x && (x.category === 'label' || x.subtype === '라벨');

// 제품별 라벨 이름 수집 (BOM + 구성품 스냅샷)
const labelsOf = (item) => {
  const names = [];
  for (const b of bomSnap.docs) {
    const bd = b.data();
    if (bd.parent_id !== item.id) continue;
    const child = itemMap.get(bd.child_id);
    if (isLabel(child)) names.push(child.name);
  }
  for (const s of item.submaterials ?? []) {
    const cat = (s.category ?? '').toString();
    if (cat === '라벨' || cat === 'label') names.push(s.name ?? '');
  }
  return names;
};

// ── 1. 변경 계획 ─────────────────────────────────────────────────
const renames = [];
for (const item of itemMap.values()) {
  if (isLabel(item)) continue;
  if ((item.name ?? '').includes('시골향')) continue;
  const labels = labelsOf(item);
  if (labels.length === 0) continue;
  if (!labels.some(n => (n ?? '').includes('시골향'))) continue;
  renames.push({ id: item.id, oldName: item.name, newName: `시골향 ${item.name}`, labels });
}
renames.sort((a, b) => a.oldName.localeCompare(b.oldName, 'ko'));

console.log(`═══ 시골향 접두어 추가 계획: ${renames.length}건 ═══`);
for (const r of renames) console.log(`  ${r.oldName}  →  ${r.newName}   [라벨: ${[...new Set(r.labels)].join(', ')}]`);

const byOldName = new Map();
for (const r of renames) {
  if (!byOldName.has(r.oldName)) byOldName.set(r.oldName, []);
  byOldName.get(r.oldName).push(r);
}
const byId = new Map(renames.map(r => [r.id, r]));

// ── 2. 미입고 매입전표 ────────────────────────────────────────────
const stmtUpdates = [];
const stmtAmbiguous = [];
for (const d of stmtSnap.docs) {
  const s = d.data();
  if (s.type !== '매입' || s.receivedAt) continue;
  const changed = [];
  const newItems = (s.items ?? []).map(line => {
    const candidates = byOldName.get(line.name);
    if (!candidates) return line;
    let pick = candidates.length === 1 ? candidates[0]
      : candidates.find(c => (itemMap.get(c.id)?.spec ?? '') === (line.spec ?? '').trim()) ?? null;
    if (!pick) { stmtAmbiguous.push({ docNo: s.docNo, name: line.name }); return line; }
    changed.push({ old: line.name, new: pick.newName });
    return { ...line, name: pick.newName };
  });
  if (changed.length > 0) stmtUpdates.push({ id: d.id, docNo: s.docNo, partnerName: s.partnerName, items: newItems, changed });
}

console.log(`\n═══ 미입고 매입전표 변경: ${stmtUpdates.length}건 ═══`);
for (const u of stmtUpdates) {
  console.log(`  전표 ${u.docNo} (${u.partnerName}):`);
  for (const c of u.changed) console.log(`    ${c.old} → ${c.new}`);
}
if (stmtAmbiguous.length > 0) {
  console.log(`\n⚠ 자동 매칭 불가 (${stmtAmbiguous.length}건):`);
  for (const a of stmtAmbiguous) console.log(`  전표 ${a.docNo}: "${a.name}"`);
}

// ── 3. 미입고 발주카드 (itemId 기준) ──────────────────────────────
const poUpdates = [];
for (const d of poSnap.docs) {
  const po = d.data();
  if (po.status === 'received') continue;
  const fields = {};
  const desc = [];
  const r = byId.get(po.itemId);
  if (r && po.itemName === r.oldName) { fields.itemName = r.newName; desc.push(`${r.oldName} → ${r.newName}`); }
  if (Array.isArray(po.items) && po.items.length > 0) {
    let touched = false;
    const newLines = po.items.map(line => {
      const lr = byId.get(line.itemId);
      if (lr && line.name === lr.oldName) { touched = true; desc.push(`${lr.oldName} → ${lr.newName}`); return { ...line, name: lr.newName }; }
      return line;
    });
    if (touched) fields.items = newLines;
  }
  if (Object.keys(fields).length > 0) poUpdates.push({ id: d.id, fields, desc, status: po.status });
}

console.log(`\n═══ 미입고 발주카드 변경: ${poUpdates.length}건 ═══`);
for (const u of poUpdates) console.log(`  PO ${u.id} [${u.status}]: ${u.desc.join(', ')}`);

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
console.log(`✅ 완료: 품목 ${renames.length}건, 전표 ${stmtUpdates.length}건, 발주카드 ${poUpdates.length}건 변경`);
console.log('※ 이후 scripts/sync-submaterial-names.mjs --apply 실행으로 구성품 스냅샷 재동기화 필요');
process.exit(0);
