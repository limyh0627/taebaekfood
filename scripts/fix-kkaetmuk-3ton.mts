// 태백 깻묵을 3톤으로 맞추고, 9월 스냅샷을 8월말 스냅샷에 덮는다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
//   ① 품목 재고 3kg → 3,000kg (로트도 같이 — 원장·로트·재고가 갈리면 안 된다)
//   ② 원장에 실사 앵커 3,000kg — 그 값부터 다시 세어져 표류가 끊긴다
//   ③ 9월 스냅샷(깻묵 3톤 반영본)을 8월말 스냅샷에 덮는다
//      9월 1일에 찍은 게 사실상 8월말 재고다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-kkaetmuk-3ton-backup.json';
const ITEM_ID = 'p-1782788799105';
const KG = 3_000;
const DATE = new Date().toISOString().slice(0, 10);
const ANCHOR_ID = `rm-anchor-깻묵-${DATE.replace(/-/g, '')}`;

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8'));
  { const { id, ...r } = prev.item; await setDoc(doc(db, 'items', id), r); }
  { const { id, ...r } = prev.snap8; await setDoc(doc(db, 'inventorySnapshots', id), r); }
  await deleteDoc(doc(db, 'rawMaterialLedger', ANCHOR_ID));
  console.log('✅ 되돌림'); process.exit(0);
}

const [items, snaps] = await Promise.all([load('items'), load('inventorySnapshots')]);
const it = items.find((x: any) => x.id === ITEM_ID);
if (!it) { console.error('✖ 깻묵 품목이 없다.'); process.exit(1); }
const s9 = snaps.find((x: any) => x.id === 'inv-snap-2026-09');
const s8 = snaps.find((x: any) => x.id === 'inv-snap-2026-08');
if (!s9 || !s8) { console.error('✖ 스냅샷이 없다.'); process.exit(1); }

// ── ① 품목·로트 ──
const lots = (it.lots ?? []) as any[];
console.log('── ① 품목 · 로트 ──');
console.log(`   재고 ${it.stock}${it.unit} → ${KG.toLocaleString()}kg   원가 ${Number(it.cost).toLocaleString()}`);
//  로트가 하나면 그 로트를 목표값으로. 여러 개면 첫 활성 로트에 차액을 얹는다.
const gap = KG - lots.reduce((a, l) => a + Number(l.kgRemaining ?? 0), 0);
const nextLots = lots.length
  ? lots.map((l, i) => (i === 0 ? { ...l, kgRemaining: Number(l.kgRemaining ?? 0) + gap, status: 'active' } : l))
  : [{
      id: `lot-깻묵-${Date.now()}`, supplierName: '실사조정', qtyIn: 0,
      kgIn: KG, kgRemaining: KG, receivedDate: DATE, status: 'active',
      createdAt: new Date().toISOString(), lotNo: `${DATE.slice(2).replace(/-/g, '')}-01`,
    }];
console.log(`   로트 ${lots.length}개  합계 ${lots.reduce((a, l) => a + Number(l.kgRemaining ?? 0), 0)} → ${nextLots.reduce((a, l) => a + Number(l.kgRemaining ?? 0), 0).toLocaleString()}kg  (${gap >= 0 ? '+' : ''}${gap.toLocaleString()})`);

// ── ② 원장 앵커 ──
const anchor = {
  id: ANCHOR_ID, material: '깻묵', unit: 'kg', type: 'correction',
  note: `재고 정정 (3kg → ${KG.toLocaleString()}kg)`,
  targetKg: KG, received: 0, used: 0, date: DATE, createdAt: new Date().toISOString(),
};
console.log(`\n── ② 원장 앵커 ──\n   ${DATE} targetKg=${KG.toLocaleString()} (${ANCHOR_ID})`);

// ── ③ 8월말 스냅샷 ← 9월 ──
console.log('\n── ③ 8월말 스냅샷을 9월 것으로 덮는다 ──');
console.log(`   8월  총액 ${Number(s8.value).toLocaleString()}  품목 ${(s8.items ?? []).length}개`);
console.log(`   9월  총액 ${Number(s9.value).toLocaleString()}  품목 ${(s9.items ?? []).length}개   ← 이걸 덮는다`);

if (!APPLY) { console.log('\n(--dry) 적용하려면 --apply'); process.exit(0); }
writeFileSync(BACKUP, JSON.stringify({ item: it, snap8: s8 }, null, 2), 'utf8');
const { id: _i, ...itRest } = it;
await setDoc(doc(db, 'items', ITEM_ID), { ...itRest, stock: KG, unit: 'kg', lots: nextLots });
await setDoc(doc(db, 'rawMaterialLedger', ANCHOR_ID), anchor);
const { id: _9, recordedAt: _r, ...s9Rest } = s9;
await setDoc(doc(db, 'inventorySnapshots', 'inv-snap-2026-08'), {
  ...s9Rest, yearMonth: '2026-08', recordedAt: new Date().toISOString(),
});
console.log('\n✅ 적용.  되돌리기: npx tsx scripts/fix-kkaetmuk-3ton.mts --undo');
process.exit(0);
