/**
 * p-102(시골향볶음참깨 1kg) 유령 데이터 → 규격별 후계 품목으로 이전
 *   포장 설정의 박스/입수로 실제 규격 판정:
 *     qty_per_box >= 20  → 볶음참깨-20kg (p-1780625559322)
 *     qty_per_box 10~19  → 볶음참깨-10kg (p-1780625531675)
 *     박스 없음/0/1      → 볶음참깨-낱개/1kg (PLDhkjOgcPIhO1hhReHm)
 *     포장 설정 없는 연결 → 볶음참깨-낱개/1kg (기본)
 *   거래처 연결 + 포장 설정(박스/테이프/입수 그대로) 이전, 기존 설정 있으면 유지
 *
 * p-101(시골향들기름2 1800ml): 비손유통 → 시골향 들기름/1800ml(p-311)
 *   연결은 이미 있음 → 포장 설정만 이전
 * p-103: 남은 정보 없음 → 연결만 정리
 *
 * 사용법: node scripts/migrate-p102-variants.mjs [--apply]
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

const ID_20KG = 'p-1780625559322';      // 볶음참깨-20kg
const ID_10KG = 'p-1780625531675';      // 볶음참깨-10kg
const ID_1KG  = 'PLDhkjOgcPIhO1hhReHm'; // 볶음참깨-낱개/1kg
const ID_DEUL = 'p-311';                // 시골향 들기름/1800ml

const [itemsSnap, srSnap, piSnap, partnersSnap] = await Promise.all([
  getDocs(collection(db, 'items')),
  getDocs(collection(db, 'shipping_rule')),
  getDocs(collection(db, 'partner_item')),
  getDocs(collection(db, 'partners')),
]);
const itemName = new Map(itemsSnap.docs.map(d => [d.id, d.data().name]));
const pname = new Map(partnersSnap.docs.map(d => [d.id, d.data().name]));

// 후계 품목의 기존 연결/설정 (중복 생성 방지)
const hasLink = new Set();
for (const d of piSnap.docs) {
  const x = d.data();
  hasLink.add(`${x.Item_ID ?? x.itemId}|${x.Partner_ID ?? x.partnerId}|${x.Direction ?? 'out'}`);
}
const hasRule = new Set();
for (const d of srSnap.docs) {
  const x = d.data();
  hasRule.add(`${x.item_id}|${x.partner_id ?? ''}`);
}

const newLinks = [];   // { succ, pid }
const newRules = [];   // { succ, pid, box, tape, qty }
const delRules = [];   // docId
const delLinks = [];   // docId
const report = [];

// ── p-102 ────────────────────────────────────────────────────────
const p102Rules = new Map(); // pid → { rule data, docId }
for (const d of srSnap.docs) {
  const r = d.data();
  if (r.item_id === 'p-102') p102Rules.set(r.partner_id ?? '', { r, docId: d.id });
}
const p102Links = piSnap.docs.filter(d => (d.data().Item_ID ?? d.data().itemId) === 'p-102');
const p102Partners = new Set([...p102Rules.keys(), ...p102Links.map(d => d.data().Partner_ID ?? d.data().partnerId)]);
p102Partners.delete('');

const succOf = (qty, hasBox) => {
  if (!hasBox || !qty || qty <= 1) return ID_1KG;
  if (qty >= 20) return ID_20KG;
  return ID_10KG;
};

for (const pid of p102Partners) {
  const entry = p102Rules.get(pid);
  const qty = entry?.r.qty_per_box ?? 0;
  const hasBox = !!(entry?.r.box_item_id);
  const succ = succOf(qty, hasBox);
  const why = entry ? `${entry.r.box_item_id ? itemName.get(entry.r.box_item_id) ?? entry.r.box_item_id : '박스없음'}×${qty}` : '설정없음→낱개';
  report.push(`  ${pname.get(pid) ?? pid}: ${why} → ${itemName.get(succ)}`);

  if (!hasLink.has(`${succ}|${pid}|out`)) {
    newLinks.push({ succ, pid });
    hasLink.add(`${succ}|${pid}|out`);
  }
  if (entry && !hasRule.has(`${succ}|${pid}`)) {
    newRules.push({ succ, pid, box: entry.r.box_item_id ?? '', tape: entry.r.tape_item_id ?? '', qty });
    hasRule.add(`${succ}|${pid}`);
  }
  if (entry) delRules.push(entry.docId);
}
for (const d of p102Links) delLinks.push(d.id);

// ── p-101 (비손유통 → p-311) ─────────────────────────────────────
for (const d of srSnap.docs) {
  const r = d.data();
  if (r.item_id !== 'p-101') continue;
  const pid = r.partner_id ?? '';
  report.push(`  [p-101] ${pname.get(pid) ?? pid}: ${itemName.get(r.box_item_id) ?? r.box_item_id}×${r.qty_per_box} → ${itemName.get(ID_DEUL)} 포장설정 이전`);
  if (!hasRule.has(`${ID_DEUL}|${pid}`)) {
    newRules.push({ succ: ID_DEUL, pid, box: r.box_item_id ?? '', tape: r.tape_item_id ?? '', qty: r.qty_per_box ?? 0 });
    hasRule.add(`${ID_DEUL}|${pid}`);
  }
  if (!hasLink.has(`${ID_DEUL}|${pid}|out`)) { newLinks.push({ succ: ID_DEUL, pid }); hasLink.add(`${ID_DEUL}|${pid}|out`); }
  delRules.push(d.id);
}
for (const d of piSnap.docs) {
  if ((d.data().Item_ID ?? d.data().itemId) === 'p-101') delLinks.push(d.id);
}

// ── p-103 (정보 없음 → 연결만 정리) ──────────────────────────────
for (const d of piSnap.docs) {
  if ((d.data().Item_ID ?? d.data().itemId) === 'p-103') {
    report.push(`  [p-103] ${pname.get(d.data().Partner_ID ?? d.data().partnerId)}: 이어줄 정보 없음 → 연결 정리`);
    delLinks.push(d.id);
  }
}

console.log('═══ 규격 판정 결과 ═══');
for (const l of report) console.log(l);
console.log(`\n새 거래처 연결: ${newLinks.length}건`);
for (const l of newLinks) console.log(`  + ${pname.get(l.pid) ?? l.pid} ↔ ${itemName.get(l.succ)}`);
console.log(`새 포장 설정: ${newRules.length}건`);
for (const r of newRules) console.log(`  + ${pname.get(r.pid) ?? r.pid} ↔ ${itemName.get(r.succ)}: ${r.box ? itemName.get(r.box) : '박스없음'}×${r.qty}, 테이프 ${r.tape ? itemName.get(r.tape) : '없음'}`);
console.log(`기존 설정 있어 이전 생략(유지): ${[...p102Partners].length + 1 - newRules.length}곳 내외`);
console.log(`옛 포장 설정 삭제: ${delRules.length}건 / 유령 연결 삭제: ${delLinks.length}건`);

if (!APPLY) { console.log('\n(드라이런 — 적용하려면 --apply)'); process.exit(0); }

console.log('\n═══ 적용 ═══');
const batchOps = [];
for (const l of newLinks) {
  const id = `${l.succ}_${l.pid}_out`;
  batchOps.push(b => b.set(doc(db, 'partner_item', id), { id, Item_ID: l.succ, Partner_ID: l.pid, Direction: 'out' }));
}
for (const r of newRules) {
  const id = `sr-${r.succ}-${r.pid}`;
  batchOps.push(b => b.set(doc(db, 'shipping_rule', id), { item_id: r.succ, partner_id: r.pid, box_item_id: r.box, tape_item_id: r.tape, qty_per_box: r.qty }));
}
for (const id of delRules) batchOps.push(b => b.delete(doc(db, 'shipping_rule', id)));
for (const id of delLinks) batchOps.push(b => b.delete(doc(db, 'partner_item', id)));

for (let i = 0; i < batchOps.length; i += 200) {
  const batch = writeBatch(db);
  for (const fn of batchOps.slice(i, i + 200)) fn(batch);
  await batch.commit();
  console.log(`  ${Math.min(i + 200, batchOps.length)}/${batchOps.length} 커밋`);
}
console.log(`✅ 연결 +${newLinks.length}, 포장설정 +${newRules.length}, 옛설정 -${delRules.length}, 유령연결 -${delLinks.length}`);
process.exit(0);
