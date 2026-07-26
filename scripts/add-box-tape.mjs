/**
 * 박스 품목 BOM에 테이프 ×0 추가 — shipping_rule 다수결 테이프. 수량 0이라 차감 안 됨(서류/BOM 표시용).
 * 기본 dry-run. --apply 반영, --undo 되돌리기(백업 필요).
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, setDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BK = path.join(HERE, 'add-box-tape-backup.json');
const apply = process.argv.includes('--apply');
const undo = process.argv.includes('--undo');
const load = async c => (await getDocs(collection(db, c))).docs.map(d => ({ _id: d.id, ...d.data() }));

if (undo) {
  const bak = JSON.parse(fs.readFileSync(BK, 'utf8'));
  for (const b of bak.items) await setDoc(doc(db, 'items', b.id), b);
  console.log(`복원 ${bak.items.length}건`); process.exit(0);
}

const items = await load('items');
const byId = new Map(items.map(i => [i._id, i]));
const rules = await load('shipping_rule');
const boxes = items.filter(i => i._id.startsWith('box-') && !i.archived);

const plan = [];
for (const b of boxes) {
  const subs = b.submaterials ?? [];
  if (subs.some(s => { const t = byId.get(s.id); return t?.subtype === '테이프' || t?.category === 'tape'; })) continue; // 이미 있음
  const looseSub = subs.find(s => byId.get(s.id)?.category === 'product');
  if (!looseSub) continue;
  const q = looseSub.stock;
  const rs = rules.filter(r => r.item_id === looseSub.id && r.qty_per_box === q && r.tape_item_id);
  const votes = {}; for (const r of rs) votes[r.tape_item_id] = (votes[r.tape_item_id] ?? 0) + 1;
  const topId = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0];
  const tape = topId ? byId.get(topId) : null;
  if (!tape) { plan.push({ b, tape: null }); continue; }
  plan.push({ b, tape });
}

const noTape = plan.filter(p => !p.tape);
console.log(`${apply ? '[반영]' : '[DRY RUN — 반영하려면 --apply]'}`);
console.log(`테이프 추가 대상 박스품목 ${plan.length}개 (테이프 못 정함 ${noTape.length}개)\n`);
plan.slice(0, 12).forEach(p => console.log(`   ${p.b.name} → ${p.tape ? `${p.tape.name} ×0` : '테이프없음(건너뜀)'}`));
if (plan.length > 12) console.log(`   … 외 ${plan.length - 12}개`);
if (noTape.length) { console.log(`\n테이프 못 정한 것:`); noTape.forEach(p => console.log(`   ${p.b.name}`)); }

if (!apply) { console.log('\n반영: node scripts/add-box-tape.mjs --apply'); process.exit(0); }

const targets = plan.filter(p => p.tape);
fs.writeFileSync(BK, JSON.stringify({ items: targets.map(p => byId.get(p.b._id)) }, null, 2));
for (const { b, tape } of targets) {
  const next = [...(b.submaterials ?? []), { id: tape._id, name: tape.name, category: 'submaterial', subtype: '테이프', stock: 0, unit: tape.unit ?? '개' }];
  await updateDoc(doc(db, 'items', b._id), { submaterials: next });
}
console.log(`\n${targets.length}건 반영. 백업 ${BK}\n되돌리기: node scripts/add-box-tape.mjs --undo`);
process.exit(0);
