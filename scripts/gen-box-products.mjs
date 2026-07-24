/**
 * 박스 품목 생성 (B안) — 품목 × 개입수로 박스 품목을 만들고, 겉박스는 거래처 연결에 남긴다.
 *
 *   박스 품목 = 낱개 × 개입수  (BOM: 낱개 ×N, 품목키 없음 → 원료 안 탐)
 *   단가       = 낱개 단가 × 개입수 (저장 안 함, 계산)
 *   거래처 연결 = partner_item(out)(박스품목, 거래처) + boxTypeId(겉박스)  ← 거래처별 유지
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

// (품목 × 개입수) → 거래처별 겉박스
const grp = {};
for (const r of rules) {
  const q = r.qty_per_box; if (!q || q <= 1) continue;
  const it = byId.get(r.item_id); if (!it || it.category !== 'product' || hasBox(it)) continue;
  const k = `${r.item_id}|${q}`;
  (grp[k] ??= { loose: it, q, conns: [] }).conns.push({ pid: r.partner_id, boxId: r.box_item_id });
}

const boxDocs = []; const piDocs = [];
for (const { loose, q, conns } of Object.values(grp)) {
  const boxId = `box-${loose._id}-${q}`;
  boxDocs.push({
    id: boxId, category: 'product', subtype: loose.subtype ?? '', subtype2: '박스',
    품목: '', name: `${loose.name} (${q}개입)`, spec: loose.spec ?? '', unit: '박스', stock: 0, minStock: 0,
    submaterials: [{ id: loose._id, name: loose.name, category: 'product', stock: q, unit: loose.unit ?? '개', ...(loose.spec ? { spec: loose.spec } : {}) }],
    createdAt: new Date().toISOString(),
  });
  // 거래처 연결 — 중복 거래처는 마지막 겉박스로
  const byPartner = {};
  for (const c of conns) if (c.pid) byPartner[c.pid] = c.boxId;
  for (const [pid, boxTypeId] of Object.entries(byPartner)) {
    piDocs.push({ id: `${boxId}_${pid}_out`, itemId: boxId, partnerId: pid, Direction: 'out', ...(boxTypeId ? { boxTypeId } : {}) });
  }
}

console.log(`${apply ? '[반영]' : '[DRY RUN — 반영하려면 --apply]'}`);
console.log(`박스 품목 ${boxDocs.length}개, 거래처 연결 ${piDocs.length}건\n`);
console.log('샘플 8개:');
for (const b of boxDocs.slice(0, 8)) {
  const conns = piDocs.filter(p => p.itemId === b.id);
  const boxes = [...new Set(conns.map(c => byId.get(c.boxTypeId)?.name ?? '-'))];
  console.log(`  ${b.name}  [${b.id}]  연결 ${conns.length}곳  겉박스 ${boxes.join('/')}`);
}

if (!apply) { console.log('\n반영: node scripts/gen-box-products.mjs --apply'); process.exit(0); }

fs.writeFileSync(BACKUP, JSON.stringify({ itemIds: boxDocs.map(b => b.id), piIds: piDocs.map(p => p.id) }, null, 2));
for (const b of boxDocs) await setDoc(doc(db, 'items', b.id), b);
for (const p of piDocs) await setDoc(doc(db, 'partner_item', p.id), p);
console.log(`\n반영 완료. 백업: ${BACKUP}\n되돌리기: node scripts/gen-box-products.mjs --undo`);
process.exit(0);
