// 7월말 스냅샷에 깻묵을 넣는다 — 태백 1.5톤 · 풍회 6톤.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 태백 깻묵은 단위가 '개'로 잘못 박혀 있다 — 로트는 kg으로 돌고 있고(kgIn 3 / kgRemaining 3)
// 톤으로 세는 물건이라 kg이 맞다. 단위만 고친다(수량·원가는 안 건드린다).
//
// 원가는 **품목이 들고 있는 값**을 쓴다 — 태백 380원/kg, 풍회 300원/kg.
// 사장님이 300은 풍회 것으로 말씀하셔서 태백엔 안 밀어 넣는다. 태백도 300이면 말씀 주세요.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { invSnapDocId, type CompanyId } from '../src/shared/types';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-kkaetmuk-july-backup.json';
const YM = '2026-07';

/** [회사, 품목id, kg] */
const JOBS: [CompanyId, string, number][] = [
  ['taebaek', 'p-1782788799105', 1_500],
  ['punghoe', 'raw-깻묵-punghoe', 6_000],
];

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8'));
  for (const s of prev.snaps) { const { id, ...rest } = s; await setDoc(doc(db, 'inventorySnapshots', id), rest); }
  for (const i of prev.items) { const { id, ...rest } = i; await setDoc(doc(db, 'items', id), rest); }
  console.log('✅ 되돌림'); process.exit(0);
}

const [items, snaps] = await Promise.all([load('items'), load('inventorySnapshots')]);
const backSnaps: any[] = [], backItems: any[] = [];
const wSnaps: { id: string; data: any }[] = [], wItems: { id: string; data: any }[] = [];

for (const [co, itemId, kg] of JOBS) {
  const it = items.find((x: any) => x.id === itemId);
  if (!it) { console.error(`✖ 품목이 없다: ${itemId}`); process.exit(1); }
  const cost = Number(it.cost ?? 0);
  const value = Math.round(kg * cost);
  const snapId = invSnapDocId(co, YM);
  const snap = snaps.find((s: any) => s.id === snapId);
  if (!snap) { console.error(`✖ 스냅샷이 없다: ${snapId}`); process.exit(1); }

  console.log(`\n── ${co} ${YM} (${snapId}) ──`);
  //  단위가 '개'면 kg으로 — 로트가 이미 kg이라 표기만 어긋나 있다
  if (String(it.unit) !== 'kg') {
    console.log(`   품목 단위 ${it.unit} → kg  (로트는 이미 kg으로 돈다)`);
    backItems.push(it);
    const { id, ...rest } = it;
    wItems.push({ id, data: { ...rest, unit: 'kg' } });
  }
  const rows = (snap.items ?? []).filter((r: any) => r.itemId !== itemId);
  const before = (snap.items ?? []).find((r: any) => r.itemId === itemId);
  const nextRows = [...rows, {
    itemId, name: '깻묵',
    category: String(it.category ?? '원료'),
    ...(it.spec ? { spec: String(it.spec) } : {}),
    qty: kg, value,
  }];
  const nextValue = nextRows.reduce((a: number, r: any) => a + Number(r.value ?? 0), 0);
  console.log(`   깻묵 ${before ? `${before.qty} → ` : ''}${kg.toLocaleString()}kg × ${cost.toLocaleString()}원 = ${value.toLocaleString()}원`);
  console.log(`   스냅샷 총액 ${Number(snap.value ?? 0).toLocaleString()} → ${nextValue.toLocaleString()}   (품목 ${(snap.items ?? []).length} → ${nextRows.length})`);
  backSnaps.push(snap);
  const { id: _s, ...rest } = snap;
  wSnaps.push({ id: snapId, data: { ...rest, items: nextRows, value: nextValue, recordedAt: new Date().toISOString() } });
}

console.log('\n⚠ 7월말 기말재고는 8월 기초재고다 — 손익분석 매출원가가 그만큼 움직인다.');
if (!APPLY) { console.log('\n(--dry) 적용하려면 --apply'); process.exit(0); }
writeFileSync(BACKUP, JSON.stringify({ snaps: backSnaps, items: backItems }, null, 2), 'utf8');
for (const w of wItems) await setDoc(doc(db, 'items', w.id), w.data);
for (const w of wSnaps) await setDoc(doc(db, 'inventorySnapshots', w.id), w.data);
console.log('\n✅ 적용.  되돌리기: npx tsx scripts/fix-kkaetmuk-july.mts --undo');
process.exit(0);
