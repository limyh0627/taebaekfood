/**
 * 박스 품목 생성 (B안) — 품목 × 개입수로 박스 품목을 만들고, 겉박스는 거래처 연결에 남긴다.
 *
 *   박스 품목 = 낱개 × 개입수  (BOM: 낱개 ×N + 겉박스 ×1, 품목키 없음 → 원료 안 탐)
 *   단가       = 낱개 단가 × 개입수 (저장 안 함, 계산)
 *   거래처 연결 = partner_item(out)(박스품목, 거래처)  ← 어느 거래처에 뜰지만. 겉박스는 BOM에.
 *   겉박스     = 품목당 하나(다수파 + 확정 오버라이드). 생산 때 개당 1개 차감.
 *
 * 출처는 shipping_rule의 (item, partner, qty_per_box, box_item_id).
 * 이미 박스 품목이 물린 낱개(볶음참깨)는 건너뛴다.
 * 기본 dry-run. --apply 반영, --undo 되돌리기(백업 필요).
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKUP = path.join(HERE, 'gen-box-products-backup.json');
const apply = process.argv.includes('--apply');
const undo = process.argv.includes('--undo');
const load = async c => (await getDocs(collection(db, c))).docs.map(d => ({ _id: d.id, ...d.data() }));

if (undo) {
  const bak = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
  for (const id of bak.itemIds) { try { await deleteDoc(doc(db, 'items', id)); } catch {} }
  for (const id of bak.piIds) { try { await deleteDoc(doc(db, 'partner_item', id)); } catch {} }
  console.log(`삭제: 박스품목 ${bak.itemIds.length}, 연결 ${bak.piIds.length}`);
  process.exit(0);
}

const items = (await load('items')).filter(i => !i.archived);
const byId = new Map(items.map(i => [i._id, i]));
const rules = await load('shipping_rule');
const partners = await load('partners');
const pn = id => partners.find(p => p._id === id)?.name ?? id;
const hasBox = it => (it.submaterials ?? []).some(s => byId.get(s.id)?.category === 'product' && (s.stock ?? 1) > 1);

// 겉박스 확정 오버라이드 — 사용자가 정한 것(같은 개입수에 박스 여러개였던 것)
//   key: `${낱개품목명}|${개입수}` → 겉박스 품목명
const BOX_OVERRIDE = {
  '시골향 들깨가루(중간)/1kg|10': '6호박스',
  '시골향 탈피들깨가루/1kg|20': '2호박스',
  '볶음검정참깨/1kg|20': '2호박스',
  '시골향 참기름/병/특/350ml|20': '5호박스',
  '시골향 들깨가루(중간)/1kg|20': '1호박스',
  '시골향 참기름/분/1800ml|12': '2호박스',
  '시골향 참기름/골드A/1750ml|10': '4호박스',
  '시골향 참기름/특A/1800ml|10': '3호박스',
  '시골향 참기름/A/1750ml|10': '4호박스',
};
const boxItemByName = (name) => items.find(i => i.name === name && (i.category === 'submaterial' || i.category === 'box') && (i.subtype === '박스' || i.category === 'box'));

// (품목 × 개입수) → 거래처들 + 겉박스 표(다수결)
const grp = {};
for (const r of rules) {
  const q = r.qty_per_box; if (!q || q <= 1) continue;
  const it = byId.get(r.item_id); if (!it || it.category !== 'product' || hasBox(it)) continue;
  const k = `${r.item_id}|${q}`;
  const g = (grp[k] ??= { loose: it, q, partners: new Set(), boxVotes: {} });
  if (r.partner_id) g.partners.add(r.partner_id);
  if (r.box_item_id) g.boxVotes[r.box_item_id] = (g.boxVotes[r.box_item_id] ?? 0) + 1;
}

const boxDocs = []; const piDocs = []; const noBox = [];
for (const { loose, q, partners: pset, boxVotes } of Object.values(grp)) {
  const boxId = `box-${loose._id}-${q}`;
  // 겉박스: 오버라이드 우선 → 없으면 다수결
  const ovName = BOX_OVERRIDE[`${loose.name}|${q}`];
  let boxItem = ovName ? boxItemByName(ovName) : null;
  if (!boxItem) {
    const topId = Object.entries(boxVotes).sort((a, b) => b[1] - a[1])[0]?.[0];
    boxItem = topId ? byId.get(topId) : null;
  }
  if (!boxItem) noBox.push(`${loose.품목 ?? ''}/${loose.name} ${q}개입`);
  const bom = [{ id: loose._id, name: loose.name, category: 'product', stock: q, unit: loose.unit ?? '개', ...(loose.spec ? { spec: loose.spec } : {}) }];
  if (boxItem) bom.push({ id: boxItem._id, name: boxItem.name, category: boxItem.category === 'box' ? 'box' : 'submaterial', subtype: '박스', stock: 1, unit: boxItem.unit ?? '개' });
  boxDocs.push({
    id: boxId, category: 'product', subtype: loose.subtype ?? '', subtype2: '박스',
    품목: '', name: `${loose.name} (${q}개입)`, spec: loose.spec ?? '', unit: '박스', stock: 0, minStock: 0,
    submaterials: bom, createdAt: new Date().toISOString(),
  });
  for (const pid of pset) piDocs.push({ id: `${boxId}_${pid}_out`, itemId: boxId, partnerId: pid, Direction: 'out' });
}
if (noBox.length) { console.log(`⚠ 겉박스 못 정한 박스품목 ${noBox.length}개:`); noBox.forEach(n => console.log(`   ${n}`)); console.log(''); }

console.log(`${apply ? '[반영]' : '[DRY RUN — 반영하려면 --apply]'}`);
console.log(`박스 품목 ${boxDocs.length}개, 거래처 연결 ${piDocs.length}건\n`);
console.log('샘플 10개:');
for (const b of boxDocs.slice(0, 10)) {
  const conns = piDocs.filter(p => p.itemId === b.id).length;
  const box = (b.submaterials.find(s => s.subtype === '박스')?.name) ?? '겉박스없음';
  console.log(`  ${b.name}  BOM: 낱개×${b.submaterials[0].stock} + ${box}×1  · 연결 ${conns}곳`);
}

if (!apply) { console.log('\n반영: node scripts/gen-box-products.mjs --apply'); process.exit(0); }

fs.writeFileSync(BACKUP, JSON.stringify({ itemIds: boxDocs.map(b => b.id), piIds: piDocs.map(p => p.id) }, null, 2));
for (const b of boxDocs) await setDoc(doc(db, 'items', b.id), b);
for (const p of piDocs) await setDoc(doc(db, 'partner_item', p.id), p);
console.log(`\n반영 완료. 백업: ${BACKUP}\n되돌리기: node scripts/gen-box-products.mjs --undo`);
process.exit(0);
