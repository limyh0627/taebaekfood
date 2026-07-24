/**
 * 품목 분류 3단 이관 — 타입 > 서브타입 > 카테고리
 *
 *   item.category  = 타입      (product/goods/wip/raw/submaterial) — 엔진 분기 키
 *   item.subtype2  = 서브타입   (낱개/배송/선물세트) — 신설, 선택
 *   item.subtype   = 카테고리   (참기름/들기름/참깨/들깨/고춧가루/라벨/용기/박스/마개/테이프/향미유/케이스)
 *
 * 기본 dry-run. --apply 반영, --undo 되돌리기(백업 필요).
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, addDoc, deleteDoc } from 'firebase/firestore';
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
const BACKUP = path.join(HERE, 'migrate-taxonomy-3level-backup.json');
const apply = process.argv.includes('--apply');
const undo = process.argv.includes('--undo');
const load = async (c) => (await getDocs(collection(db, c))).docs.map(d => ({ _id: d.id, ...d.data() }));

if (undo) {
  const bak = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
  let ok = 0, gone = 0;
  for (const b of bak.items) {
    try { await updateDoc(doc(db, 'items', b.id), { category: b.category, subtype: b.subtype ?? '', subtype2: '' }); ok++; }
    catch (e) { if (e?.code === 'not-found') { console.log(`  - ${b.name} 없음 — 건너뜀`); gone++; } else throw e; }
  }
  for (const id of (bak.taxonomyAdded ?? [])) {
    try { await deleteDoc(doc(db, 'itemTaxonomy', id)); } catch {}
  }
  console.log(`복원 ${ok}건${gone ? `, 건너뜀 ${gone}건` : ''}`);
  process.exit(0);
}

const items = (await load('items')).filter(i => !i.archived);
const taxo = await load('itemTaxonomy');
const nameOf = p => `${p.품목 ?? ''} ${p.name ?? ''}`;

// ── 애매한 것 수동 지정 ──
const MANUAL = {
  // 선물세트 케이스 — 실물 박스(재고 240/250/150). 완제품이 아니라 부자재.
  'GS-01': { type: 'submaterial', sub: '', cat: '케이스' },
  'GS-02': { type: 'submaterial', sub: '', cat: '케이스' },
  'GS-03': { type: 'submaterial', sub: '', cat: '케이스' },
};
const RAW_CAT = { '깨분': '참깨', '깻묵': '참깨' };   // 참깨 계열 부산물

const catOf = (p) => {
  if (p.subtype) return p.subtype;                       // 부자재는 이미 있음
  if (RAW_CAT[p.name]) return RAW_CAT[p.name];
  const s = nameOf(p);
  if (/참기름/.test(s)) return '참기름';
  if (/들기름/.test(s)) return '들기름';
  if (/참깨|검정참|검정깨/.test(s)) return '참깨';
  if (/들깨/.test(s)) return '들깨';
  if (/고춧가루|고추가루/.test(s)) return '고춧가루';
  return '';
};
const plan = [];
for (const p of items) {
  const m = MANUAL[p._id];
  const type = m?.type ?? (p.category === 'giftset' || p.category === '선물세트' ? 'product'
    : p.category === 'shipping' ? 'product' : p.category);
  const sub = m ? m.sub : (p.category === 'giftset' || p.category === '선물세트' ? '선물세트'
    : p.category === 'shipping' ? '배송' : p.category === 'product' ? '낱개' : '');
  const cat = m?.cat ?? catOf(p);
  if (p.category === type && (p.subtype ?? '') === cat && !sub) continue;   // 바뀔 게 없음
  plan.push({ p, type, sub, cat });
}

console.log(`${apply ? '[반영]' : '[DRY RUN — 반영하려면 --apply]'}`);
console.log(`품목 ${items.length}개 중 ${plan.length}건 변경\n`);
const t = {};
for (const x of plan) t[`${x.type} | ${x.sub || '-'} | ${x.cat || '-'}`] = (t[`${x.type} | ${x.sub || '-'} | ${x.cat || '-'}`] ?? 0) + 1;
console.log('타입 | 서브타입 | 카테고리');
for (const [k, n] of Object.entries(t).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);

const moved = plan.filter(x => x.p.category !== x.type);
console.log(`\n타입이 바뀌는 것 ${moved.length}건:`);
moved.forEach(x => console.log(`   ${x.p.category} → ${x.type}  |  ${x.p.품목 ?? ''} / ${x.p.name}  (재고 ${x.p.stock ?? 0})`));
const noCat = plan.filter(x => !x.cat);
console.log(`\n카테고리 비는 것 ${noCat.length}건:`);
noCat.forEach(x => console.log(`   [${x.type}] ${x.p.품목 ?? ''} / ${x.p.name}`));

if (!apply) { console.log('\n반영: node scripts/migrate-taxonomy-3level.mjs --apply'); process.exit(0); }

const backup = { at: new Date().toISOString(), taxonomyAdded: [], items: plan.map(x => ({ id: x.p._id, name: x.p.name, category: x.p.category, subtype: x.p.subtype ?? '' })) };

for (const x of plan) {
  await updateDoc(doc(db, 'items', x.p._id), { category: x.type, subtype: x.cat, subtype2: x.sub });
}
console.log(`품목 ${plan.length}건 반영`);

// itemTaxonomy — 카테고리(구 subtype 자리)와 서브타입 목록 등록
const SUBS = { product: ['낱개', '배송', '선물세트'] };
const CATS = {
  product: ['참기름', '들기름', '참깨', '들깨', '고춧가루'],
  goods: ['향미유', '고춧가루'],
  wip: ['참기름', '들기름', '참깨', '들깨'],
  raw: ['참기름', '들기름', '참깨', '들깨'],
  submaterial: ['용기', '마개', '박스', '라벨', '테이프', '케이스'],
};
const has = (kind, parent, label) => taxo.some(r => r.kind === kind && r.parent === parent && r.label === label);
for (const [parent, list] of Object.entries(SUBS)) {
  let o = 0;
  for (const label of list) {
    if (has('subtype', parent, label)) { o++; continue; }
    const ref = await addDoc(collection(db, 'itemTaxonomy'), { kind: 'subtype', parent, label, order: o++ });
    backup.taxonomyAdded.push(ref.id);
    console.log(`  + 서브타입 ${parent} → ${label}`);
  }
}
for (const [parent, list] of Object.entries(CATS)) {
  let o = 0;
  for (const label of list) {
    if (has('category', parent, label)) { o++; continue; }
    const ref = await addDoc(collection(db, 'itemTaxonomy'), { kind: 'category', parent, label, order: o++ });
    backup.taxonomyAdded.push(ref.id);
    console.log(`  + 카테고리 ${parent} → ${label}`);
  }
}
// 비는 타입 숨김
for (const key of ['giftset', 'shipping']) {
  const row = taxo.find(r => r.kind === 'category' && r.key === key && !r.parent);
  if (row) await updateDoc(doc(db, 'itemTaxonomy', row._id), { hidden: true });
}
fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2));
console.log(`\n백업: ${BACKUP}\n되돌리기: node scripts/migrate-taxonomy-3level.mjs --undo`);
process.exit(0);
