// 깨분참기름 로트를 원장 잔량에 맞춘다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 로트가 -508.183kg이다. 창고에 마이너스가 있을 수는 없으니 **로트가 틀렸다.**
// 원장 262.822kg는 적어도 물리적으로 가능한 값이라 그쪽으로 맞춘다.
//   (원장이 늘 더 맞다는 뜻은 아니다 — 수입들기름은 반대로 원장이 -440으로 틀렸다.
//    근거는 실사뿐이고, 이건 '불가능한 값을 지우는' 조치다.)
//
// 앱의 실사(commitStockEdit)와 **같은 방식**으로 한다:
//   ① 로트를 목표값으로 맞추고(모자라면 '원장맞춤' 로트를 얹고 이월 음수를 상계)
//   ② 원장에 targetKg 앵커 줄을 남긴다 → 이후 표류가 거기서 끊긴다
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { withCarryOverLot, buildReceiveLot, settleCarryOver, nextLotNo, deductFromLots } from '../src/shared/lotUtils';
import { ledgerBalanceKg } from '../src/shared/rawLedgerBalance';
import { lotRemainingKg } from '../src/shared/ledgerLotCheck';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-kkaebun-lot-to-ledger-backup.json';
const MATERIAL = '깨분참기름';
const ANCHOR_ID = `rm-anchor-깨분참기름-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8'));
  await updateDoc(doc(db, 'items', prev.itemId), { lots: prev.lots, stock: prev.stock });
  await deleteDoc(doc(db, 'rawMaterialLedger', ANCHOR_ID));
  console.log('✅ 로트·재고 복원 · 앵커 줄 삭제');
  process.exit(0);
}

const [items, led] = await Promise.all([load('items'), load('rawMaterialLedger')]);
const h = items.find((i: any) => i.name === MATERIAL && !i.archived);
if (!h) { console.error('깨분참기름을 못 찾았다.'); process.exit(1); }
const rows = led.filter((e: any) => String(e.material) === MATERIAL);
const target = Math.round(ledgerBalanceKg(rows as any, h.density ?? 1) * 1000) / 1000;
const before = lotRemainingKg(h.lots);
const adjust = Math.round((target - before) * 1000) / 1000;

//  실사와 같은 손놀림 — 이월 로트를 세우고, 모자라면 얹고, 음수 이월을 상계한다.
const date = new Date().toISOString().slice(0, 10);
let next = withCarryOverLot([...(h.lots ?? [])], Number(h.stock ?? 0), MATERIAL);
if (adjust > 0.001) {
  const lot = buildReceiveLot({ material: MATERIAL, supplierName: '원장맞춤', qtyIn: 0, kgIn: adjust, receivedDate: date });
  next = settleCarryOver([...next, { ...lot, lotNo: nextLotNo(next, date) }]);
} else if (adjust < -0.001) {
  next = deductFromLots(next, -adjust).lots;
}
const after = lotRemainingKg(next);

console.log(`\n═══ ${APPLY ? '🔴 적용(--apply)' : '🟢 미리보기(dry)'} ═══\n`);
console.log(`   원장 잔량   ${target}kg   ← 맞출 목표`);
console.log(`   로트 잔량   ${before}kg → ${after}kg   (${adjust > 0 ? '+' : ''}${adjust}kg)\n`);
console.log(`   로트 구성`);
for (const l of next.filter((l: any) => Number(l.kgRemaining ?? 0) !== 0))
  console.log(`      ${String(l.lotNo ?? l.id).padEnd(30)} ${String(l.supplierName ?? '').padEnd(14)} ${l.kgRemaining}kg`);
console.log(`\n   원장 앵커 줄 추가: ${date} targetKg=${target} (type=correction)`);
console.log(`      → 이후 원장 잔량이 이 값부터 다시 세어져 표류가 끊긴다.`);
console.log(`\n되돌리기: npx tsx scripts/fix-kkaebun-lot-to-ledger.mts --undo`);
if (!APPLY) { console.log(`\n적용: npx tsx scripts/fix-kkaebun-lot-to-ledger.mts --apply`); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify({ itemId: h.id, lots: h.lots ?? [], stock: Number(h.stock ?? 0) }, null, 1), 'utf8');
await updateDoc(doc(db, 'items', h.id), {
  lots: JSON.parse(JSON.stringify(next)),
  ...(h.lotsAreTotal ? {} : { stock: after }),   // lotsAreTotal이면 stock은 벌크만이라 안 건드린다
});
await setDoc(doc(db, 'rawMaterialLedger', ANCHOR_ID), {
  id: ANCHOR_ID, material: MATERIAL, date, received: 0, used: 0, targetKg: target,
  note: `로트-원장 대조 정정 (로트 ${before}kg → 원장 ${target}kg)`,
  type: 'correction', unit: 'kg', createdAt: new Date().toISOString(),
});
console.log(`\n✅ 로트 ${after}kg · 앵커 ${target}kg · 백업 ${BACKUP}`);
process.exit(0);
