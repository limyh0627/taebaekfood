// 9월 스냅샷의 태백 깻묵을 3톤으로.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// ⚠ 스냅샷만 고친다. items.stock 과 로트는 아직 3kg이라, 재고관리에서 스냅샷을 다시 찍으면
//   3으로 되돌아간다. 실물이 3톤이면 재고·로트도 같이 맞춰야 한다(별도 지시 대기).
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-kkaetmuk-sep-backup.json';
const SNAP_ID = 'inv-snap-2026-09';
const ITEM_ID = 'p-1782788799105';
const KG = 3_000;

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const { id, ...rest } = JSON.parse(readFileSync(BACKUP, 'utf8'));
  await setDoc(doc(db, 'inventorySnapshots', id), rest);
  console.log('✅ 복원'); process.exit(0);
}

const [snaps, items] = await Promise.all([load('inventorySnapshots'), load('items')]);
const snap = snaps.find((s: any) => s.id === SNAP_ID);
if (!snap) { console.error(`✖ 스냅샷이 없다: ${SNAP_ID}`); process.exit(1); }
const it = items.find((x: any) => x.id === ITEM_ID);
const cost = Number(it?.cost ?? 0);
const value = Math.round(KG * cost);

const before = (snap.items ?? []).find((r: any) => r.itemId === ITEM_ID);
const rows = (snap.items ?? []).map((r: any) => (r.itemId === ITEM_ID ? { ...r, qty: KG, value } : r));
if (!before) rows.push({ itemId: ITEM_ID, name: '깻묵', category: String(it?.category ?? '원료'), qty: KG, value });
const nextValue = rows.reduce((a: number, r: any) => a + Number(r.value ?? 0), 0);

console.log(`── ${SNAP_ID} (${snap.yearMonth}) ──`);
console.log(`   깻묵 ${before ? `${before.qty}kg ${Number(before.value).toLocaleString()}원` : '없음'} → ${KG.toLocaleString()}kg × ${cost.toLocaleString()}원 = ${value.toLocaleString()}원`);
console.log(`   총액 ${Number(snap.value ?? 0).toLocaleString()} → ${nextValue.toLocaleString()}`);
console.log(`\n⚠ items.stock 은 아직 ${it?.stock}${it?.unit ?? ''} 이고 로트도 그대로다.`);
console.log(`   재고관리에서 스냅샷을 다시 찍으면 ${it?.stock}으로 되돌아간다.`);

if (!APPLY) { console.log('\n(--dry) 적용하려면 --apply'); process.exit(0); }
writeFileSync(BACKUP, JSON.stringify(snap, null, 2), 'utf8');
const { id: _s, ...rest } = snap;
await setDoc(doc(db, 'inventorySnapshots', SNAP_ID), { ...rest, items: rows, value: nextValue, recordedAt: new Date().toISOString() });
console.log('\n✅ 적용.  되돌리기: npx tsx scripts/fix-kkaetmuk-sep.mts --undo');
process.exit(0);
