// 주문 한 건을 **찾아서 보여만 준다.** 아무것도 안 쓴다.
//   npx tsx scripts/find-order.mts 170002
//   npx tsx scripts/find-order.mts 대왕푸드 2026-09-04
//
// 지우기 전에 **무엇을 지우는지 눈으로 보려고** 만든 것이다(2026-09-16 사장님: "대왕푸드 이
// 주문은 삭제해야하는데"). 주문은 재고·전표·원료수불부가 물려 있어, 번호만 보고 지우면
// 엉뚱한 것을 지운다. 거래처·날짜·품목·상태·전표 연결까지 같이 찍는다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const 찾을말 = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!찾을말.length) { console.error('찾을 말을 준다 — 주문번호 조각이나 거래처 이름·날짜.'); process.exit(1); }

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

const [orders, statements] = await Promise.all([load('orders'), load('issuedStatements')]);

const 글 = (o: any) => [o.id, o.cardNo, o.partnerName, o.deliveryDate, o.createdAt, ...(o.items ?? []).map((i: any) => i.name)]
  .filter(Boolean).join(' ').toLowerCase();

const 걸린것 = orders.filter(o => 찾을말.every(말 => 글(o).includes(말.toLowerCase())));

console.log(`\n주문 ${orders.length}건 중 ${걸린것.length}건이 걸렸다 — "${찾을말.join(' ')}"\n`);
for (const o of 걸린것) {
  //  전표가 걸려 있으면 주문만 지워도 장부에는 남는다 — 그 사실을 같이 보여 준다.
  const 전표 = statements.filter(s => String(s.orderId ?? '').split(/[,\s]+/).includes(o.id));
  console.log(`  id            ${o.id}`);
  console.log(`  주문번호      ${o.cardNo ?? '(없음)'}`);
  console.log(`  거래처        ${o.partnerName ?? '(없음)'}  (${o.partnerId ?? '연결 없음'})`);
  console.log(`  상태          ${o.status}`);
  console.log(`  주문일        ${String(o.createdAt ?? '').slice(0, 10)}`);
  console.log(`  출고예정일    ${String(o.deliveryDate ?? '').slice(0, 10)}`);
  console.log(`  배송완료일    ${String(o.deliveredAt ?? '(없음)').slice(0, 10)}`);
  console.log(`  품목          ${(o.items ?? []).map((i: any) => `${i.name} ${i.quantity}`).join(' · ') || '(없음)'}`);
  //  **재고가 움직였는지**가 지울 때 제일 중요하다.
  console.log(`  생산처리      ${o.producedAt ? `예 (${String(o.producedAt).slice(0, 10)})` : '아니오'}`);
  console.log(`  출고처리      ${o.shippedOut ? '예' : '아니오'}`);
  console.log(`  줄별 재고기록 ${o.itemInventory ? `${Object.keys(o.itemInventory).length}줄` : '없음'}`);
  console.log(`  원료 로트     ${(o.rawConsumedLots ?? []).length}건`);
  console.log(`  걸린 전표     ${전표.length ? 전표.map((s: any) => `${s.docNo}(${s.type} ${s.totalAmount?.toLocaleString?.()})`).join(', ') : '없음'}`);
  console.log('');
}
process.exit(0);
