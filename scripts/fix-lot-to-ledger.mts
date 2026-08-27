// 로트 잔량을 원장 잔량에 맞춘다 — 원료명을 받는다.
//   미리보기  npx tsx scripts/fix-lot-to-ledger.mts 볶음들깨
//   적용      … 볶음들깨 --apply
//   되돌리기  … 볶음들깨 --undo
//
// 왜 원장 기준인가: 누락 통로가 **로트 쪽**에 있다. AdminApp(압착)·ItemList(수불부 손입력)
// 둘 다 원장을 먼저 쓰고 로트 실패는 catch로 삼켰다. 원장 줄은 id가 고정이라(rm-auto-{주문}-{원료})
// 덮어써질 뿐 사라지지 않는다. 그래서 덜 누락된 쪽이 원장이다.
//
// 앱의 실사(ItemList.commitStockEdit)와 **같은 방식**이다:
//   ① 로트를 목표값으로 맞추고(모자라면 '원장맞춤' 로트를 얹어 이월 음수를 상계)
//   ② 원장에 targetKg 앵커 줄을 남긴다 → 이후 잔량이 이 값부터 다시 세어져 표류가 끊긴다
//
// ⚠ lotsAreTotal 원료(볶음참깨 등)는 로트=통합·stock=벌크만이라 축이 다르다. stock은 안 건드린다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { withCarryOverLot, buildReceiveLot, settleCarryOver, nextLotNo, deductFromLots } from '../src/shared/lotUtils';
import { ledgerBalanceKg } from '../src/shared/rawLedgerBalance';
import { lotRemainingKg } from '../src/shared/ledgerLotCheck';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const UNDO = args.includes('--undo');
const MATERIAL = args.find(a => !a.startsWith('--'));
if (!MATERIAL) { console.error('원료명을 주세요.  예: npx tsx scripts/fix-lot-to-ledger.mts 볶음들깨'); process.exit(1); }
const slug = MATERIAL.replace(/\s/g, '_');
const BACKUP = `scripts/fix-lot-to-ledger-${slug}-backup.json`;
const ANCHOR_ID = `rm-anchor-${slug}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error(`백업이 없다: ${BACKUP}`); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8'));
  await updateDoc(doc(db, 'items', prev.itemId), { lots: prev.lots, stock: prev.stock });
  await deleteDoc(doc(db, 'rawMaterialLedger', prev.anchorId));
  console.log(`✅ ${MATERIAL} 로트·재고 복원 · 앵커 줄 삭제`);
  process.exit(0);
}

const [items, led] = await Promise.all([load('items'), load('rawMaterialLedger')]);
const h = items.find((i: any) => i.name === MATERIAL && !i.archived);
if (!h) { console.error(`${MATERIAL}을(를) 못 찾았다.`); process.exit(1); }
const rows = led.filter((e: any) => String(e.material) === MATERIAL);
if (!rows.length) { console.error(`${MATERIAL} 원장 줄이 없다 — 맞출 근거가 없다.`); process.exit(1); }

const target = Math.round(ledgerBalanceKg(rows as any, h.density ?? 1) * 1000) / 1000;
const before = lotRemainingKg(h.lots);
const adjust = Math.round((target - before) * 1000) / 1000;
const date = new Date().toISOString().slice(0, 10);

let next = withCarryOverLot([...(h.lots ?? [])], Number(h.stock ?? 0), MATERIAL);
if (adjust > 0.001) {
  const lot = buildReceiveLot({ material: MATERIAL, supplierName: '원장맞춤', qtyIn: 0, kgIn: adjust, receivedDate: date });
  next = settleCarryOver([...next, { ...lot, lotNo: nextLotNo(next, date) }]);
} else if (adjust < -0.001) {
  next = deductFromLots(next, -adjust).lots;
}
const after = lotRemainingKg(next);

console.log(`\n═══ ${MATERIAL} — ${APPLY ? '🔴 적용(--apply)' : '🟢 미리보기(dry)'} ═══\n`);
if (h.lotsAreTotal) console.log(`   ⚠ lotsAreTotal 원료 — 로트=통합(벌크+낱개+박스), stock=벌크만. stock은 안 건드린다.\n`);
console.log(`   원장 잔량 ${target}kg   ← 맞출 목표`);
console.log(`   로트 잔량 ${before}kg → ${after}kg   (${adjust > 0 ? '+' : ''}${adjust}kg)\n`);
for (const l of next.filter((l: any) => Number(l.kgRemaining ?? 0) !== 0))
  console.log(`      ${String(l.lotNo ?? l.id).padEnd(30)} ${String(l.supplierName ?? '').padEnd(20)} ${l.kgRemaining}kg`);
console.log(`\n   원장 앵커 줄 ${date} targetKg=${target} (id=${ANCHOR_ID})`);
console.log(`\n되돌리기: npx tsx scripts/fix-lot-to-ledger.mts ${MATERIAL} --undo`);
if (!APPLY) { console.log(`\n적용: npx tsx scripts/fix-lot-to-ledger.mts ${MATERIAL} --apply`); process.exit(0); }
if (Math.abs(adjust) < 0.001) { console.log('\n이미 맞다 — 바꿀 게 없다.'); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify({ itemId: h.id, lots: h.lots ?? [], stock: Number(h.stock ?? 0), anchorId: ANCHOR_ID }, null, 1), 'utf8');
await updateDoc(doc(db, 'items', h.id), {
  lots: JSON.parse(JSON.stringify(next)),
  ...(h.lotsAreTotal ? {} : { stock: after }),
});
await setDoc(doc(db, 'rawMaterialLedger', ANCHOR_ID), {
  id: ANCHOR_ID, material: MATERIAL, date, received: 0, used: 0, targetKg: target,
  note: `로트-원장 대조 정정 (로트 ${before}kg → 원장 ${target}kg)`,
  type: 'correction', unit: 'kg', createdAt: new Date().toISOString(),
});
console.log(`\n✅ 로트 ${after}kg · 앵커 ${target}kg · 백업 ${BACKUP}`);
process.exit(0);
