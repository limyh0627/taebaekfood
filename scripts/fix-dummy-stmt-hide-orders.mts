// 전표를 안 끊기로 한 주문을 미발행 목록에서 뺀다 — **더미 전표 한 장에 물려서.**
//   미리보기  npx tsx scripts/fix-dummy-stmt-hide-orders.mts
//   적용      … --apply       되돌리기  … --undo
//
// 판정 기준은 오직 하나다: **그 주문을 가리키는 전표가 있느냐**(TradeStatement.isVouchered).
// 그러니 숨길 주문에 새 플래그를 다는 게 아니라, 더미 전표 한 장의 orderId에 묶어 놓는다.
// voucherOrderIds가 orderId를 콤마로 갈라 담으므로 한 장에 여러 주문을 물릴 수 있다.
//
// 금액 0 · 품목 없음이라 매출·분개에는 아무 영향이 없다. 되돌리려면 이 문서 하나만 지우면 된다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const DOC_ID = 'stmt-hide-20260828';

//  사장님이 목록에서 콕 집어 뺀 주문들 (납품 08-24까지 + 유원식품(시흥))
const TARGETS: [string, string][] = [
  ['ORD-1785994142963', '일성상회 납품 08-10'],
  ['ORD-1786001299618', '대성농산 납품 08-10'],
  ['ORD-1786327189070', '에덴식당재료마트 납품 08-13'],
  ['ORD-1786062348224', '해피유통(쿠팡) 납품 08-14'],
  ['ORD-1786507262755', '모란식품 납품 08-17'],
  ['ORD-1786510380611', '대왕푸드 납품 08-17'],
  ['ORD-1786674416669', '으뜸건어물 납품 08-17'],
  ['ORD-1787018811386', '대왕푸드 납품 08-21'],
  ['ORD-1787192433189', '해피유통(포천) 납품 08-24'],
  ['ORD-1787729963250', '유원식품(시흥) 배송 08-26'],
];

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (UNDO) { await deleteDoc(doc(db, 'issuedStatements', DOC_ID)); console.log('✅ 더미 전표 삭제 — 그 주문들이 다시 미발행에 뜬다'); process.exit(0); }

const orders = (await getDocs(collection(db, 'orders'))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const byId = new Map(orders.map((o: any) => [o.id, o]));
console.log(`\n═══ ${APPLY ? '🔴 적용(--apply)' : '🟢 미리보기(dry)'} ═══\n`);
const ok: string[] = [];
for (const [id, why] of TARGETS) {
  const o = byId.get(id);
  if (!o) { console.log(`   ⚠ ${id} — 주문 없음(이미 삭제?), 건너뜀`); continue; }
  console.log(`   ${String(o.partnerName).padEnd(18)} ${why}`);
  ok.push(id);
}
console.log(`\n   더미 전표 ${DOC_ID} 한 장에 ${ok.length}건을 물린다 (금액 0 · 품목 없음)`);
console.log(`   되돌리기: npx tsx scripts/fix-dummy-stmt-hide-orders.mts --undo  (문서 하나만 지운다)`);
if (!APPLY) { console.log(`\n적용: npx tsx scripts/fix-dummy-stmt-hide-orders.mts --apply`); process.exit(0); }

await setDoc(doc(db, 'issuedStatements', DOC_ID), {
  id: DOC_ID,
  companyId: 'taebaek',
  issuedAt: new Date().toISOString(),
  tradeDate: new Date().toISOString().slice(0, 10),
  type: '매출',
  partnerId: '',
  partnerName: '(미발행 정리 — 전표 안 끊음)',
  orderId: ok.join(','),          // 콤마로 여러 주문 — voucherOrderIds가 갈라 담는다
  docNo: '정리-20260828',
  totalSupply: 0, totalTax: 0, totalAmount: 0,
  items: [],
});
console.log(`\n✅ ${ok.length}건 물림`);
process.exit(0);
