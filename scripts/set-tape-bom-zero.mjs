/**
 * BOM에 든 테이프 구성품의 수량을 0으로 — 코드 예외 대신 데이터로 "차감 안 함"을 표현.
 * 기본 dry-run. --apply 반영, --undo 되돌리기(백업 필요).
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const app = initializeApp({
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
});
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKUP = path.join(HERE, 'set-tape-bom-zero-backup.json');
const apply = process.argv.includes('--apply');
const undo = process.argv.includes('--undo');

const items = (await getDocs(collection(db, 'items'))).docs.map(d => ({ _id: d.id, ...d.data() }));
const byId = new Map(items.map(i => [i._id, i]));

if (undo) {
  const bak = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
  for (const b of bak.items) {
    await updateDoc(doc(db, 'items', b.id), { submaterials: b.submaterials });
    console.log(`  ✓ ${b.name} 복원`);
  }
  process.exit(0);
}

const isTape = (s) => {
  const t = byId.get(s.id);
  return (t?.category === 'tape') || (t?.category === 'submaterial' && t?.subtype === '테이프')
      || s.category === 'tape' || s.category === '테이프';
};

const plan = [];
for (const i of items) {
  if (i.archived) continue;
  const subs = i.submaterials ?? [];
  const tapes = subs.filter(s => isTape(s) && (s.stock ?? 1) !== 0);
  if (tapes.length) plan.push({ i, tapes });
}

console.log(`${apply ? '[반영]' : '[DRY RUN — 반영하려면 --apply]'}`);
console.log(`테이프가 BOM에 든 품목 ${plan.length}개\n`);
const counts = {};
for (const p of plan) for (const t of p.tapes) counts[t.name] = (counts[t.name] ?? 0) + 1;
for (const [n, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${n} — ${c}개 품목`);
console.log('\n예시:');
plan.slice(0, 6).forEach(p => console.log(`  · ${p.i.품목 ?? ''} / ${p.i.name} → ${p.tapes.map(t => `${t.name} ${t.stock ?? 1}→0`).join(', ')}`));
if (plan.length > 6) console.log(`  … 외 ${plan.length - 6}개`);

if (!apply) { console.log('\n반영하려면: node scripts/set-tape-bom-zero.mjs --apply'); process.exit(0); }

const backup = { at: new Date().toISOString(), items: plan.map(p => ({ id: p.i._id, name: p.i.name, submaterials: p.i.submaterials })) };
fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2));
console.log(`\n백업: ${BACKUP}`);

for (const p of plan) {
  const next = (p.i.submaterials ?? []).map(s => isTape(s) ? { ...s, stock: 0 } : s);
  await updateDoc(doc(db, 'items', p.i._id), { submaterials: next });
}
console.log(`${plan.length}건 반영. 되돌리려면 --undo`);
process.exit(0);
