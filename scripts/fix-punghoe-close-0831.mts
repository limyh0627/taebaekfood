// 풍회 8월말 재고 마감 — 깨분 0, 깨분참기름 30캔. 그리고 8월 스냅샷을 그 값으로 다시 쓴다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 사장님 지시: "풍회 8월말 재고에 깨분 0으로 바꾸고 깨분참기름 30캔해서 재고 마감해줘",
//              "8월 말로 스냅샷 남겨놔 태백 풍회 분리하고".
//
// 스냅샷 id가 회사별로 갈린다(invSnapDocId) — 태백 `inv-snap-2026-08`,
// 풍회 `inv-snap-punghoe-2026-08`. 태백 것은 안 건드린다.
//
// 로트도 같이 비운다. 재고만 0으로 두고 로트를 남기면 다음 사용에서 로트가 깎이며
// 재고가 음수로 간다 — 원장·로트가 갈리는 그 병이다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { invSnapDocId } from '../src/shared/types';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-punghoe-close-0831-backup.json';
const YM = '2026-08';
const SNAP_ID = invSnapDocId('punghoe', YM);

/** 마감 값 — [품목id, 마감수량] */
const CLOSE: [string, number][] = [
  ['p-1782788554239', 0],              // 깨분 (벌크 kg)
  ['wip-깨분참기름-캔-punghoe', 30],     // 깨분참기름/16.5kg (캔)
  ['p-1779251176421-punghoe', 0],      // 참깨 — 이미 0이지만 스냅샷에 같이 담는다
];

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8')) as { items: any[]; snap: any | null };
  for (const it of prev.items) { const { id, ...rest } = it; await setDoc(doc(db, 'items', id), rest); }
  if (prev.snap) { const { id, ...rest } = prev.snap; await setDoc(doc(db, 'inventorySnapshots', id), rest); }
  else await deleteDoc(doc(db, 'inventorySnapshots', SNAP_ID));
  console.log(`✅ 품목 ${prev.items.length}건 · 스냅샷 복원`);
  process.exit(0);
}

const [items, snaps] = await Promise.all([load('items'), load('inventorySnapshots')]);
const co = (x: any) => x?.companyId ?? 'taebaek';
const backup: any[] = [];
const writes: { id: string; data: any }[] = [];
const snapItems: { itemId: string; name: string; category?: string; spec?: string; qty: number; value: number }[] = [];

console.log(`── 풍회 ${YM} 마감 ──`);
for (const [id, qty] of CLOSE) {
  const it = items.find((x: any) => x.id === id);
  if (!it) { console.error(`✖ 품목을 못 찾았다: ${id}`); process.exit(1); }
  if (co(it) !== 'punghoe') { console.error(`✖ ${it.name}은 풍회 품목이 아니다(${co(it)}).`); process.exit(1); }
  const cost = Number(it.cost ?? 0);
  const value = Math.round(qty * cost);
  const lots = (it.lots ?? []) as any[];
  //  재고가 0이면 로트도 비운다 — 안 그러면 다음 사용에서 로트만 깎여 재고가 음수로 간다
  const nextLots = qty === 0
    ? lots.map(l => ({ ...l, kgRemaining: 0, status: 'depleted' }))
    : lots;
  console.log(`   ${String(it.name).padEnd(18)} ${String(it.stock ?? 0).padStart(8)} → ${String(qty).padStart(6)} ${it.unit ?? ''}` +
    `   원가 ${cost.toLocaleString()}  평가 ${value.toLocaleString()}` +
    (lots.length ? `   로트 ${lots.length}개${qty === 0 ? ' → 비움' : ' (그대로)'}` : ''));
  backup.push(it);
  const { id: _id, ...rest } = it;
  writes.push({ id, data: { ...rest, stock: qty, ...(lots.length ? { lots: nextLots } : {}) } });
  snapItems.push({
    itemId: id, name: it.name, spec: String(it.spec ?? ''),
    ...(it.category ? { category: it.category } : {}),
    qty, value,
  });
}

const total = snapItems.reduce((a, x) => a + x.value, 0);
const oldSnap = snaps.find((s: any) => s.id === SNAP_ID) ?? null;
console.log(`\n── 스냅샷 ${SNAP_ID} ──`);
console.log(`   전: ${oldSnap ? `${Number(oldSnap.value).toLocaleString()}원 · 품목 ${(oldSnap.items ?? []).length}개` : '없음'}`);
console.log(`   후: ${total.toLocaleString()}원 · 품목 ${snapItems.length}개`);
for (const x of snapItems) console.log(`      ${String(x.name).padEnd(18)} ${String(x.qty).padStart(6)}  ${x.value.toLocaleString().padStart(12)}`);
const tb = snaps.find((s: any) => s.id === invSnapDocId('taebaek', YM));
console.log(`\n   태백 ${YM} 스냅샷은 안 건드린다: ${tb ? `${Number(tb.value).toLocaleString()}원 · 품목 ${(tb.items ?? []).length}개` : '없음'}`);

if (!APPLY) { console.log('\n(--dry) 적용하려면 --apply'); process.exit(0); }
writeFileSync(BACKUP, JSON.stringify({ items: backup, snap: oldSnap }, null, 2), 'utf8');
for (const w of writes) await setDoc(doc(db, 'items', w.id), w.data);
await setDoc(doc(db, 'inventorySnapshots', SNAP_ID), {
  id: SNAP_ID, companyId: 'punghoe', yearMonth: YM,
  value: total, recordedAt: new Date().toISOString(), items: snapItems,
});
console.log(`\n✅ 품목 ${writes.length}건 · 스냅샷 ${total.toLocaleString()}원`);
console.log('   되돌리기: npx tsx scripts/fix-punghoe-close-0831.mts --undo');
process.exit(0);
