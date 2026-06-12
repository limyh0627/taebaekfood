/**
 * 품목명에 용량(spec) 추가 마이그레이션
 *  - items: spec이 있고 이름에 용량 표기가 없는 품목 → "이름/용량"으로 변경
 *  - issuedStatements: 미입고 매입전표의 품목명도 같이 변경 (입고확인 매칭 유지)
 *  - purchaseOrders: 미입고 발주카드의 itemName/items[].name 변경 (itemId 기준)
 *
 * 사용법:
 *   node scripts/rename-items-add-spec.mjs          # 드라이런 (변경 목록만 출력)
 *   node scripts/rename-items-add-spec.mjs --apply  # 실제 적용
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

// ItemList.tsx의 hasVolumeInName과 동일한 규칙
const hasVolumeInName = (name) => /\d+(\.\d+)?\s*(ml|kg|l|g)(?![a-z])/i.test(name);

const [itemsSnap, stmtSnap, poSnap] = await Promise.all([
  getDocs(collection(db, 'items')),
  getDocs(collection(db, 'issuedStatements')),
  getDocs(collection(db, 'purchaseOrders')),
]);

// ── 1. 품목 변경 계획 ──────────────────────────────────────────────
const renames = []; // { id, oldName, newName, spec, category }
for (const d of itemsSnap.docs) {
  const x = d.data();
  const spec = (x.spec ?? '').trim();
  if (!spec) continue;
  if (hasVolumeInName(x.name)) continue;
  renames.push({ id: d.id, oldName: x.name, newName: `${x.name}/${spec}`, spec, category: x.category ?? '' });
}

console.log(`═══ 품목명 변경 계획: ${renames.length}건 ═══`);
for (const r of renames) console.log(`  [${r.category}] ${r.oldName}  →  ${r.newName}`);

// 변경 후에도 이름이 겹치는 품목 경고
const newNameCount = new Map();
const allFinalNames = itemsSnap.docs.map(d => {
  const r = renames.find(r => r.id === d.id);
  return { id: d.id, name: r ? r.newName : d.data().name };
});
for (const { name } of allFinalNames) newNameCount.set(name, (newNameCount.get(name) ?? 0) + 1);
const dups = [...newNameCount.entries()].filter(([, n]) => n > 1);
if (dups.length > 0) {
  console.log(`\n⚠ 변경 후에도 이름이 중복되는 품목 (${dups.length}쌍) — 이름+용량이 완전히 같은 별도 품목:`);
  for (const [name, n] of dups) {
    const ids = allFinalNames.filter(f => f.name === name).map(f => f.id).join(', ');
    console.log(`  "${name}" × ${n}  (${ids})`);
  }
}

// 이름 → 변경 후보 목록 (전표 라인 매칭용)
const byOldName = new Map();
for (const r of renames) {
  if (!byOldName.has(r.oldName)) byOldName.set(r.oldName, []);
  byOldName.get(r.oldName).push(r);
}
const byId = new Map(renames.map(r => [r.id, r]));

// ── 2. 미입고 매입전표 품목명 변경 계획 ──────────────────────────
const stmtUpdates = []; // { id, docNo, partnerName, items(새 배열), changed: [{old,new}] }
const stmtAmbiguous = [];
for (const d of stmtSnap.docs) {
  const s = d.data();
  if (s.type !== '매입' || s.receivedAt) continue; // 입고확인 끝난 전표는 기록 보존
  const changed = [];
  const newItems = (s.items ?? []).map(line => {
    const candidates = byOldName.get(line.name);
    if (!candidates) return line;
    let pick = null;
    if (candidates.length === 1) pick = candidates[0];
    else {
      const lineSpec = (line.spec ?? '').trim();
      pick = candidates.find(c => c.spec === lineSpec) ?? null;
      if (!pick) {
        stmtAmbiguous.push({ docNo: s.docNo, name: line.name, lineSpec, candidates: candidates.map(c => c.newName) });
        return line;
      }
    }
    changed.push({ old: line.name, new: pick.newName });
    return { ...line, name: pick.newName, spec: line.spec || pick.spec };
  });
  if (changed.length > 0) stmtUpdates.push({ id: d.id, docNo: s.docNo, partnerName: s.partnerName, items: newItems, changed });
}

console.log(`\n═══ 미입고 매입전표 품목명 변경: ${stmtUpdates.length}건 ═══`);
for (const u of stmtUpdates) {
  console.log(`  전표 ${u.docNo} (${u.partnerName}):`);
  for (const c of u.changed) console.log(`    ${c.old} → ${c.new}`);
}
if (stmtAmbiguous.length > 0) {
  console.log(`\n⚠ 자동 매칭 불가 전표 라인 (${stmtAmbiguous.length}건) — 그대로 두고 수동 확인 필요:`);
  for (const a of stmtAmbiguous) console.log(`  전표 ${a.docNo}: "${a.name}" (spec: ${a.lineSpec || '없음'}) 후보: ${a.candidates.join(' / ')}`);
}

// ── 3. 미입고 발주카드(purchaseOrders) 변경 계획 (itemId 기준) ────
const poUpdates = []; // { id, fields, desc }
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
      const lr = byId.get(line.itemId) ?? (byOldName.get(line.name)?.length === 1 ? byOldName.get(line.name)[0] : null);
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
// Firestore writeBatch는 500개 제한 → 400개씩 나눠 커밋
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
process.exit(0);
