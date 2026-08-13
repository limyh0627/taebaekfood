// 볶음참깨 벌크 풀(raw-볶음참깨) 실사 앵커 + 새봄푸드 stale 차감 정정.
//   기본 = --dry (미리보기, 쓰기 없음).  실제 적용 = --apply.
//   되돌리기 참고: 적용 전 값은 아래 미리보기/DB-CHANGELOG에 남김.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, setDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const APPLY = process.argv.includes('--apply');
const ANCHOR_KG = 10;          // 실사: 벌크 0.5개(=20kg×0.5) ≈ 10kg
const SAEBOM_CORRECT_KG = 180; // 새봄 9개 × 20kg
const DATE = '2026-08-12';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [items, orders, ledger] = await Promise.all([load('items'), load('orders'), load('rawMaterialLedger')]);

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

// ── 1) raw-볶음참깨 실사 앵커 ──
const holder = items.find((i: any) => i.id === 'raw-볶음참깨');
const oldLots = Array.isArray(holder.lots) ? holder.lots : [];
const oldSum = oldLots.reduce((s: number, l: any) => s + (l.kgRemaining ?? 0), 0);
// 실제 입고 이력 로트(잔량>0 or 실물)만 유지하려 했으나, 260811-01은 이미 depleted(0). 깔끔히 단일 실사 로트로.
const anchorLot = {
  id: `lot-실사-${Date.now()}`, lotNo: `${DATE.replace(/-/g, '').slice(2)}-실사`,
  material: '볶음참깨', supplierName: '실사(청정벌크)', qtyIn: 0, kgIn: ANCHOR_KG,
  kgRemaining: ANCHOR_KG, receivedDate: DATE, status: 'active', createdAt: new Date().toISOString(),
};
const newLots = [anchorLot];
console.log(`[1] raw-볶음참깨 실사 앵커`);
console.log(`    현재: stock=${holder.stock}, 로트 ${oldLots.length}개 합 ${Math.round(oldSum * 10) / 10}kg`);
oldLots.forEach((l: any) => console.log(`         - ${l.lotNo ?? l.id} 잔량 ${l.kgRemaining}kg (${l.status})`));
console.log(`    변경 후: stock=${ANCHOR_KG}, 로트 1개(실사 ${ANCHOR_KG}kg)`);

// ── 2) 새봄 스냅샷 + 수불부 정정 ──
const saebomId = 'ORD-1786430165162';
const saebom = orders.find((o: any) => o.id === saebomId);
const oldSnap = (saebom?.rawConsumedLots ?? []);
const newSnap = oldSnap.map((c: any) => c.material === '볶음참깨' ? { material: '볶음참깨', supplierName: '실사보정', kg: SAEBOM_CORRECT_KG } : c);
console.log(`\n[2] 새봄푸드 ${saebomId} rawConsumedLots(볶음참깨)`);
console.log(`    현재: ${oldSnap.filter((c: any) => c.material === '볶음참깨').map((c: any) => `${c.kg}kg`).join(',')}`);
console.log(`    변경 후: ${SAEBOM_CORRECT_KG}kg`);

const ledgerId = `rm-auto-${saebomId}-볶음참깨`;
const ledEntry = ledger.find((e: any) => e.id === ledgerId);
console.log(`\n[3] 수불부 ${ledgerId}`);
console.log(`    현재: used=${ledEntry?.used}kg`);
console.log(`    변경 후: used=${SAEBOM_CORRECT_KG}kg`);

if (!APPLY) {
  console.log(`\n※ 미리보기만 함. 실제 적용하려면:  npx tsx scripts/fix-bokkeum-bulk-anchor.mts --apply`);
  process.exit(0);
}

// ── 적용 ──
await updateDoc(doc(db, 'items', 'raw-볶음참깨'), { lots: newLots, stock: ANCHOR_KG });
console.log(`\n✅ raw-볶음참깨 → stock=${ANCHOR_KG}, 실사 로트 1개`);
if (saebom) { await updateDoc(doc(db, 'orders', saebomId), { rawConsumedLots: newSnap }); console.log(`✅ 새봄 스냅샷 → ${SAEBOM_CORRECT_KG}kg`); }
if (ledEntry) { await setDoc(doc(db, 'rawMaterialLedger', ledgerId), { used: SAEBOM_CORRECT_KG }, { merge: true }); console.log(`✅ 수불부 → used=${SAEBOM_CORRECT_KG}kg`); }
console.log(`\n완료. DB-CHANGELOG.md에 기록 필요.`);
process.exit(0);
