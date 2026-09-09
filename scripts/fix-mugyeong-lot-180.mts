/**
 * 무경유통 볶음참깨 — 잘못 빠진 **180박스(1,800kg)** 를 로트·재고에 되돌린다.
 *
 * ── 무슨 일이 있었나 ────────────────────────────────────────────────────────
 * 주문 `ORD-1788478345603`(무경유통, 9/7 납품)의 볶음참깨/1kg 은 **20박스**다.
 * 전표 260907-014 도 `볶음참깨-낱개/1kg 200개 × 5,800 = 1,160,000` 으로 맞게 끊겼다
 * (20박스 = 200kg).
 *
 * 그런데 로트에서는 **200박스(2,000kg)** 가 빠졌다. 주문의 완제품로트 스냅샷이 그 증거다 —
 * 이월 4 + 260828-02 41 + 이월 155 = 200. `deductLotsByQty(lots, 200)` 의 자취 그대로다.
 *
 * 출고 시점의 주문 수량이 200이었고(포털이 낱개 수량을 박스 품목에 실었다), 나중에 20으로
 * 고쳐졌다. 그런데 `handleUpdateItems` 가 `items` 만 덮어쓰고 재고·로트는 안 건드려서
 * 로트는 200이 빠진 채로 남았다. 그 구멍은 같은 날 코드로 막았다(shared/orderEditGuard).
 *
 * ── 무엇을 되돌리나 ────────────────────────────────────────────────────────
 * 맞는 차감은 20박스다. FIFO 로 **이월 4 + 260828-02 16**.
 *
 *   260828-02   0 → 25       (41 을 41 다 쓴 게 아니라 16 만 썼어야 한다)
 *   이월(미상)  -158 → -3     (155 를 아예 안 뺐어야 한다)
 *   ──────────────────────────
 *   합계 +180 박스 = +1,800 kg
 *
 * `items.stock` 도 같이 +180 한다. 주문의 스냅샷도 맞는 값(4·16)으로 고쳐,
 * 나중에 이 주문을 되돌릴 때 **안 뺀 180 을 되돌려 주는 유령 복원**이 안 생기게 한다.
 *
 * ⚠ 이월 로트가 0 이 아니라 **-3** 으로 남는다. 그건 이 주문 것이 아니다 —
 *   다른 주문들이 재고 없이 나간 몫이라 여기서 손대지 않는다. 실사로 정리할 일이다.
 *
 *   npx tsx scripts/fix-mugyeong-lot-180.mts            (미리보기, 기본)
 *   npx tsx scripts/fix-mugyeong-lot-180.mts --apply
 *   npx tsx scripts/fix-mugyeong-lot-180.mts --undo
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const BACKUP = 'scripts/fix-mugyeong-lot-180-backup.json';
const ITEM = 'p-1785907900413';                    // 볶음참깨/1kg (1박스 = 10kg)
const ORDER = 'ORD-1788478345603';                 // 무경유통 9/7
const CARRY = 'lot-carry-볶음참깨-1787875330496';   // 이월(미상)
const REAL = 'lot-p-1785907900413-1787875330496-uiij'; // 260828-02 푸미푸드

/** 맞는 차감 — 20박스를 FIFO 로 이월 4 + 260828-02 16 */
const 맞는스냅샷 = [
  { lotId: CARRY, qty: 4 },
  { lotId: REAL, qty: 16 },
];
/** 로트별로 돌려줄 박스 수 */
const 되돌릴것: Record<string, number> = { [CARRY]: 155, [REAL]: 25 };
const 합계박스 = 180;

const mode = process.argv.includes('--apply') ? 'apply'
  : process.argv.includes('--undo') ? 'undo' : 'dry';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const itemRef = doc(db, 'items', ITEM);
const orderRef = doc(db, 'orders', ORDER);
const [is, os] = await Promise.all([getDoc(itemRef), getDoc(orderRef)]);
if (!is.exists()) throw new Error(`품목 ${ITEM} 없음`);
if (!os.exists()) throw new Error(`주문 ${ORDER} 없음`);
const item = is.data() as any;
const order = os.data() as any;

if (mode === 'undo') {
  if (!existsSync(BACKUP)) throw new Error('백업이 없다 — 되돌릴 수 없다');
  const b = JSON.parse(readFileSync(BACKUP, 'utf8'));
  await updateDoc(itemRef, { stock: b.item.stock, lots: b.item.lots });
  await updateDoc(orderRef, { productConsumedLots: b.order.productConsumedLots });
  console.log('되돌렸다.');
  process.exit(0);
}

const lots: any[] = [...(item.lots ?? [])];
const before = { stock: Number(item.stock ?? 0), lots: JSON.parse(JSON.stringify(lots)) };

console.log(`품목 ${item.name}  (1박스 = 10kg)`);
console.log(`  items.stock  ${before.stock} → ${before.stock + 합계박스}\n`);

const next = lots.map(l => {
  const 더할것 = 되돌릴것[l.id];
  if (!더할것) return l;
  const q = Number(l.qtyRemaining ?? 0) + 더할것;
  const kg = Number(l.kgRemaining ?? 0) + 더할것 * Number(l.unitKg ?? 10);
  console.log(`  로트 ${(l.lotNo || '이월(미상)').padEnd(14)} ${String(l.qtyRemaining).padStart(5)}박스 → ${String(q).padStart(5)}박스   (${l.kgRemaining} → ${kg} kg)`);
  //  다시 남은 게 생기면 살아 있는 로트다
  return { ...l, qtyRemaining: q, kgRemaining: kg, status: q > 0 ? 'active' : l.status };
});

const 지금스냅샷 = (order.productConsumedLots ?? []).filter((t: any) => t.itemId === ITEM);
console.log(`\n  주문 스냅샷 ${지금스냅샷.length}줄 (합 ${지금스냅샷.reduce((a: number, t: any) => a + Number(t.qty ?? 0), 0)}박스)`);
console.log(`     → 2줄 (합 20박스) 로 고친다 — 안 그러면 되돌릴 때 유령 복원이 난다`);

if (mode === 'dry') { console.log('\n미리보기다. 실제로 고치려면 --apply'); process.exit(0); }

if (!existsSync(BACKUP)) {
  writeFileSync(BACKUP, JSON.stringify({
    적은날: new Date().toISOString(),
    item: { id: ITEM, stock: before.stock, lots: before.lots },
    order: { id: ORDER, productConsumedLots: order.productConsumedLots ?? [] },
  }, null, 2), 'utf8');
  console.log(`\n백업: ${BACKUP}`);
} else {
  console.log(`\n백업이 이미 있다 — 그대로 둔다(${BACKUP})`);
}

//  다른 품목의 스냅샷은 그대로 두고, 이 품목 줄만 맞는 값으로 바꾼다
const 남길것 = (order.productConsumedLots ?? []).filter((t: any) => t.itemId !== ITEM);
const 새스냅샷 = [
  ...남길것,
  ...맞는스냅샷.map(x => {
    const l = lots.find(y => y.id === x.lotId);
    return { itemId: ITEM, lotId: x.lotId, qty: x.qty,
      ...(l?.lotNo ? { lotNo: l.lotNo } : {}), ...(l?.material ? { material: l.material } : {}),
      ...(l?.receivedDate ? { receivedDate: l.receivedDate } : {}) };
  }),
];

await updateDoc(itemRef, { stock: before.stock + 합계박스, lots: next });
await updateDoc(orderRef, { productConsumedLots: 새스냅샷 });
console.log('고쳤다.');
process.exit(0);
