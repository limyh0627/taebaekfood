// 풍회에 깻묵 품목을 만들고(원가 300원/kg) 8월말 스냅샷에 8톤을 얹는다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 태백 깻묵(p-1782788799105)은 단위가 '개'라 그대로 복사하지 않는다 — 톤으로 세는 물건이라
// kg으로 만든다. 8톤 = 8,000kg × 300원 = 2,400,000원.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { invSnapDocId } from '../src/shared/types';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-punghoe-kkaetmuk-backup.json';

const ITEM_ID = 'raw-깻묵-punghoe';
const COST = 300;
const KG = 8_000;                 // 8톤
const YM = '2026-08';
const SNAP_ID = invSnapDocId('punghoe', YM);

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8'));
  if (prev.snap) { const { id, ...rest } = prev.snap; await setDoc(doc(db, 'inventorySnapshots', id), rest); }
  if (prev.madeItem) await deleteDoc(doc(db, 'items', ITEM_ID));
  console.log('✅ 되돌림');
  process.exit(0);
}

const [items, snaps] = await Promise.all([load('items'), load('inventorySnapshots')]);
const tb = items.find((i: any) => String(i.name) === '깻묵' && (i.companyId ?? 'taebaek') === 'taebaek');
const exist = items.find((i: any) => i.id === ITEM_ID);
const value = KG * COST;

const item = {
  id: ITEM_ID, companyId: 'punghoe',
  name: '깻묵', spec: '벌크',
  type: 'raw', unit: 'kg',
  ...(tb?.category ? { category: tb.category } : {}),
  subtype: '벌크',
  stock: KG, minStock: 0, price: 0, cost: COST,
  taxType: (tb?.taxType ?? '면세') as '과세' | '면세',
  costSource: 'manual',           // 손으로 못 박은 값 — 굴릴 구성이 없다
  image: '',
};

console.log('── 품목 ──');
console.log(exist ? `   이미 있다(${ITEM_ID}) — 재고·원가만 맞춘다` : `   새로 만든다: ${ITEM_ID}`);
console.log(`   깻묵 / 벌크 / raw / kg / 원가 ${COST.toLocaleString()} / 재고 ${KG.toLocaleString()}kg`);
console.log(`   (태백 깻묵: ${tb ? `${tb.id} 단위 ${tb.unit} 원가 ${tb.cost}` : '없음'})`);

const snap = snaps.find((s: any) => s.id === SNAP_ID);
if (!snap) { console.error(`✖ 스냅샷이 없다: ${SNAP_ID}`); process.exit(1); }
const rows = (snap.items ?? []).filter((r: any) => r.itemId !== ITEM_ID);
const nextRows = [...rows, { itemId: ITEM_ID, name: '깻묵', category: item.category ?? '참깨', spec: '벌크', qty: KG, value }];
const nextValue = nextRows.reduce((a: number, r: any) => a + Number(r.value ?? 0), 0);

console.log(`\n── ${YM} 풍회 스냅샷 ──`);
for (const r of nextRows)
  console.log(`   ${String(r.name).padEnd(18)} ${String(r.spec ?? '').padEnd(8)} ${String(r.qty).padStart(8)}  ${Number(r.value).toLocaleString().padStart(12)}${r.itemId === ITEM_ID ? '   ← 새로 얹음' : ''}`);
console.log(`   총액 ${Number(snap.value ?? 0).toLocaleString()} → ${nextValue.toLocaleString()}`);

if (!APPLY) { console.log('\n(--dry) 적용하려면 --apply'); process.exit(0); }
writeFileSync(BACKUP, JSON.stringify({ snap, madeItem: !exist }, null, 2), 'utf8');
await setDoc(doc(db, 'items', ITEM_ID), exist ? { ...exist, ...item } : item);
const { id: _s, ...snapRest } = snap;
await setDoc(doc(db, 'inventorySnapshots', SNAP_ID), { ...snapRest, items: nextRows, value: nextValue, recordedAt: new Date().toISOString() });
console.log('\n✅ 적용.  되돌리기: npx tsx scripts/fix-punghoe-kkaetmuk.mts --undo');
process.exit(0);
