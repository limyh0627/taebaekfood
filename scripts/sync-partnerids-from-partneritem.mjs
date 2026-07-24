/**
 * partner_item(out)에 있는 거래처 연결을 items.partnerIds에 합친다(추가만, 삭제 없음).
 * 주문 화면이 partnerIds로 노출을 판단하는데, 박스 품목 등 일부가 partner_item에만 있고
 * partnerIds엔 안 옮겨져 있어 안 뜨던 것을 맞춘다.
 * 기본 dry-run. --apply 반영, --undo 되돌리기(백업 필요).
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKUP = path.join(HERE, 'sync-partnerids-backup.json');
const apply = process.argv.includes('--apply');
const undo = process.argv.includes('--undo');
const load = async c => (await getDocs(collection(db, c))).docs.map(d => ({ _id: d.id, ...d.data() }));

if (undo) {
  const bak = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
  for (const b of bak.items) { try { await updateDoc(doc(db, 'items', b.id), { partnerIds: b.partnerIds }); } catch {} }
  console.log(`복원 ${bak.items.length}건`);
  process.exit(0);
}

const allItems = (await load('items')).filter(i => !i.archived);
const pitem = await load('partner_item');
const partners = await load('partners');
const pn = id => partners.find(p => p._id === id)?.name ?? id;

// --all 없으면 박스 변형 품목만 (BOM에 완제품 구성품 count>1이 하나) — 지금 필요한 범위
const onlyBox = !process.argv.includes('--all');
const byId = new Map(allItems.map(i => [i._id, i]));
const isBoxVariant = (p) => {
  const comps = (p.submaterials ?? []).filter(s => byId.get(s.id)?.category === 'product');
  return comps.length === 1 && (comps[0].stock ?? 1) > 1;
};
const items = onlyBox ? allItems.filter(isBoxVariant) : allItems;
console.log(onlyBox ? '(박스 변형 품목만 — 전체는 --all)\n' : '(전체 품목)\n');

// 품목별 partner_item(out) 거래처 집합
const outBy = {};
for (const r of pitem) {
  if (r.Direction !== 'out') continue;
  const iid = r.Item_ID ?? r.itemId, pid = r.Partner_ID ?? r.partnerId;
  if (!iid || !pid) continue;
  (outBy[iid] ??= new Set()).add(pid);
}

const plan = [];
for (const it of items) {
  const cur = new Set(it.partnerIds ?? []);
  const want = outBy[it._id];
  if (!want) continue;
  const add = [...want].filter(p => !cur.has(p));
  if (add.length) plan.push({ it, add, next: [...new Set([...cur, ...want])] });
}

console.log(`${apply ? '[반영]' : '[DRY RUN — 반영하려면 --apply]'}`);
console.log(`연결이 빠진 품목 ${plan.length}개\n`);
plan.sort((a, b) => b.add.length - a.add.length);
for (const p of plan.slice(0, 25)) {
  console.log(`  ${p.it.품목 ?? ''}/${p.it.name}  +${p.add.length}곳  (${p.add.slice(0, 3).map(pn).join(', ')}${p.add.length > 3 ? '…' : ''})`);
}
if (plan.length > 25) console.log(`  … 외 ${plan.length - 25}개`);
console.log(`\n총 추가 연결 ${plan.reduce((s, p) => s + p.add.length, 0)}건`);

if (!apply) { console.log('\n반영: node scripts/sync-partnerids-from-partneritem.mjs --apply'); process.exit(0); }

const backup = { at: new Date().toISOString(), items: plan.map(p => ({ id: p.it._id, partnerIds: p.it.partnerIds ?? [] })) };
fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2));
for (const p of plan) await updateDoc(doc(db, 'items', p.it._id), { partnerIds: p.next });
console.log(`\n${plan.length}건 반영. 백업: ${BACKUP}\n되돌리기: node scripts/sync-partnerids-from-partneritem.mjs --undo`);
process.exit(0);
