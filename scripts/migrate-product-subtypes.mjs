/**
 * 완제품 하위 분류 정리 — 낱개 / 선물세트 / 배송
 *
 *   category='product'  (하위 없음)  → subtype='낱개'
 *   category='giftset'              → category='product', subtype='선물세트'
 *   category='shipping'             → category='product', subtype='배송'
 *   itemTaxonomy에 완제품 하위 분류 3개 등록 + giftset/shipping 카테고리 숨김
 *
 * 기본 dry-run. --apply 로 반영, --undo 로 되돌림(백업 파일 필요).
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, addDoc } from 'firebase/firestore';
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
const BACKUP = path.join(HERE, 'migrate-product-subtypes-backup.json');
const apply = process.argv.includes('--apply');
const undo = process.argv.includes('--undo');

const load = async (c) => (await getDocs(collection(db, c))).docs.map(d => ({ _id: d.id, ...d.data() }));

if (undo) {
  const bak = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
  let ok = 0, gone = 0;
  for (const b of bak.items) {
    try {
      await updateDoc(doc(db, 'items', b.id), { category: b.category, subtype: b.subtype ?? '' });
      ok++;
    } catch (e) {
      // 그 사이 지워진 품목은 건너뛴다 — 복원할 대상이 없다
      if (e?.code === 'not-found') { console.log(`  - ${b.name} 없음(삭제됨) — 건너뜀`); gone++; }
      else throw e;
    }
  }
  console.log(`\n복원 ${ok}건${gone ? `, 건너뜀 ${gone}건` : ''}`);
  console.log('\n※ itemTaxonomy에 추가된 하위 분류는 분류 관리 화면에서 직접 지우세요.');
  process.exit(0);
}

const items = (await load('items')).filter(i => !i.archived);
const taxo = await load('itemTaxonomy');

const plan = [];
for (const i of items) {
  if (i.category === 'product' && !i.subtype) plan.push({ i, category: 'product', subtype: '낱개' });
  else if (i.category === 'giftset') plan.push({ i, category: 'product', subtype: '선물세트' });
  else if (i.category === 'shipping') plan.push({ i, category: 'product', subtype: '배송' });
}

const label = (p) => `${p.i.품목 ?? ''} / ${p.i.name}`;
console.log(`${apply ? '[반영]' : '[DRY RUN — 반영하려면 --apply]'}\n`);

for (const grp of ['낱개', '선물세트', '배송']) {
  const l = plan.filter(p => p.subtype === grp);
  console.log(`■ ${grp} — ${l.length}개`);
  if (grp === '낱개') l.slice(0, 5).forEach(p => console.log(`    · ${label(p)}`));
  else l.forEach(p => console.log(`    · [${p.i.category}] ${label(p)}  재고 ${p.i.stock ?? 0}`));
  if (grp === '낱개' && l.length > 5) console.log(`    … 외 ${l.length - 5}개`);
  console.log('');
}

// 카테고리가 바뀌는 것만 따로 — 엔진 동작이 달라진다
const catChanged = plan.filter(p => p.i.category !== p.category);
console.log(`※ 카테고리가 바뀌는 품목 ${catChanged.length}개 — 재고 엔진 동작이 달라집니다.`);
console.log(`   (giftset/shipping은 지금 출고해도 재고가 안 깎이는데, product가 되면 깎입니다)`);
const withFormulaKey = catChanged.filter(p => p.i.품목);
console.log(`   이 중 품목키가 있어 원료식이 걸리는 것 ${withFormulaKey.length}개:`);
withFormulaKey.forEach(p => {
  const bomProducts = (p.i.submaterials ?? []).filter(s => s.category === 'product');
  console.log(`     · ${label(p)}  (품목키 ${p.i.품목}, spec ${p.i.spec ?? '-'})`
    + (bomProducts.length ? `  ⚠ BOM에 완제품 ${bomProducts.length}개 — 원료 이중차감 위험` : ''));
});

if (!apply) { console.log('\n반영하려면: node scripts/migrate-product-subtypes.mjs --apply'); process.exit(0); }

// ── 반영 ──
const backup = { at: new Date().toISOString(), items: plan.map(p => ({ id: p.i._id, name: p.i.name, category: p.i.category, subtype: p.i.subtype ?? '' })) };
fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2));
console.log(`\n백업: ${BACKUP}`);

for (const p of plan) {
  await updateDoc(doc(db, 'items', p.i._id), { category: p.category, subtype: p.subtype });
}
console.log(`품목 ${plan.length}건 반영`);

// 하위 분류 등록 (이미 있으면 건너뜀)
const has = (parent, lbl) => taxo.some(t => t.kind === 'subtype' && t.parent === parent && t.label === lbl);
let order = 0;
for (const lbl of ['낱개', '선물세트', '배송']) {
  if (has('product', lbl)) { order++; continue; }
  await addDoc(collection(db, 'itemTaxonomy'), { kind: 'subtype', parent: 'product', label: lbl, order: order++ });
  console.log(`  + 완제품 하위 분류 '${lbl}'`);
}
// 비어버린 카테고리 숨김
for (const key of ['giftset', 'shipping']) {
  const row = taxo.find(t => t.kind === 'category' && t.key === key);
  if (row) await updateDoc(doc(db, 'itemTaxonomy', row._id), { hidden: true });
  else await addDoc(collection(db, 'itemTaxonomy'), { kind: 'category', key, label: key === 'giftset' ? '선물세트' : '배송', hidden: true, order: 90 });
  console.log(`  + '${key}' 카테고리 숨김`);
}
console.log('\n완료. 되돌리려면: node scripts/migrate-product-subtypes.mjs --undo');
process.exit(0);
