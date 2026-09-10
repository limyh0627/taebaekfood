// 풍회 깨분 — 원장은 2,000kg 인데 로트·재고가 0 이던 것을 2,000 으로 맞춘다.
//   기본 = --dry (미리보기, 쓰기 없음).  실제 적용 = --apply.
//   적용 전 값은 scripts/fix-punghoe-kkaebun-2000-backup.json 에 통째로 남긴다.
//
// 무슨 일이 있었나 (2026-09-09 조사):
//   원장 두 줄뿐이다.
//     8-12  카프코 입고 10,000
//     8-22  재고실사 — targetKg 2000 (used 8,000 으로 적힘)
//   원장 잔량은 실사 앵커가 잡아 **2,000**. 그런데 로트는 10,000 이 통째로 빠져 **0**,
//   `items.stock` 도 0 이다. 실사가 원장에는 "2,000 으로 맞춤"으로 들어갔는데
//   로트에는 그만큼이 아니라 전량이 빠진 것이다.
//
//   → 사장님 판단(2026-09-09): "일단 2000으로 맞춰놔".
//     그 카프코 로트의 잔량을 2,000 으로 되살리고 stock 도 2,000 으로 맞춘다.
//     원장은 **손대지 않는다** — 이미 2,000 이 맞다.
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const ITEM_ID = 'p-1782788554239';        // 풍회 깨분 (companyId: punghoe)
const LOT_ID = 'lot-깨분-1786516535923-uyga';  // 카프코 8-12 입고 10,000
const TARGET_KG = 2000;
const BACKUP = 'scripts/fix-punghoe-kkaebun-2000-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

const ref = doc(db, 'items', ITEM_ID);
const snap = await getDoc(ref);
if (!snap.exists()) throw new Error(`품목을 찾을 수 없다: ${ITEM_ID}`);
const data = snap.data() as any;

if (data.companyId !== 'punghoe') throw new Error(`풍회 품목이 아니다: companyId=${data.companyId}`);
if (!String(data.name ?? '').includes('깨분')) throw new Error(`깨분이 아니다: ${data.name}`);

const oldLots = Array.isArray(data.lots) ? data.lots : [];
const oldSum = oldLots.reduce((s: number, l: any) => s + Number(l.kgRemaining ?? 0), 0);

console.log(`품목  ${data.name}  (${ITEM_ID})`);
console.log(`현재  stock=${data.stock}  로트 ${oldLots.length}개 합 ${oldSum}kg`);
for (const l of oldLots) {
  console.log(`      · ${l.lotNo ?? l.id}  ${l.supplierName}  kgIn=${l.kgIn} 잔량=${l.kgRemaining}  ${l.status}`);
}

const target = oldLots.find((l: any) => l.id === LOT_ID);
if (!target) throw new Error(`되살릴 로트를 찾을 수 없다: ${LOT_ID}`);

const newLots = oldLots.map((l: any) => (l.id === LOT_ID
  ? { ...l, kgRemaining: TARGET_KG, status: 'active' }
  : l));
const newSum = newLots.reduce((s: number, l: any) => s + Number(l.kgRemaining ?? 0), 0);

console.log(`\n변경 후  stock=${TARGET_KG}  로트 합 ${newSum}kg`);
console.log(`      · ${target.lotNo ?? target.id} 잔량 ${target.kgRemaining} → ${TARGET_KG} (depleted → active)`);
console.log(`\n원장(rawMaterialLedger)은 건드리지 않는다 — 이미 2,000 으로 맞다.`);

if (!APPLY) {
  console.log('\n미리보기만 했다. 실제로 바꾸려면 --apply 를 붙여라.\n');
  process.exit(0);
}

writeFileSync(BACKUP, JSON.stringify({
  적은때: new Date().toISOString(),
  설명: '풍회 깨분 로트 2000 맞춤 — 적용 전 원본',
  itemId: ITEM_ID,
  before: { stock: data.stock ?? 0, lots: oldLots },
}, null, 2), 'utf8');
console.log(`백업 → ${BACKUP}`);

await updateDoc(ref, { lots: newLots, stock: TARGET_KG });
console.log('\n✅ 적용 완료.\n');
process.exit(0);
