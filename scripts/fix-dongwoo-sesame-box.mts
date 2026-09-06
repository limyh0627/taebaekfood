// 동우 볶음참깨 — 20개입으로 잘못 잡힌 연결과 주문을 10개입으로 바로잡는다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// **무엇이 잘못됐나** (2026-09-06 사장님이 짚음: "동우는 10개입이 아닌가")
// 거래처–품목 연결이 두 군데 산다 — 옛 방식 `items.partnerIds` 와 지금 쓰는 `partner_item`.
// 동우는 그 둘이 **완전히 어긋나** 있었다.
//     옛 방식   20개입에만 동우가 있다
//     지금 방식 10개입만 등록돼 있다
// 주문 화면은 둘 중 하나만 있어도 띄우므로 **10개입과 20개입이 둘 다** 떴고,
// 9/1 주문이 20개입으로 들어갔다(그래서 단가도 0이었다 — 20개입은 단가가 없다).
// 그 바람에 **20개입 재고에서 5박스가 빠졌다.**
//
// 온 앱을 훑어보니 이렇게 완전히 어긋난 건 **이 한 건뿐**이다.
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc, arrayRemove, arrayUnion } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-dongwoo-sesame-box-backup.json';

const 동우 = 'C023';
const B10 = 'p-1785907900413';   // 볶음참깨/1kg  1kg * 10
const B20 = 'p-1785907940315';   // 볶음참깨/1kg  1kg * 20
const 주문 = 'ORD-1788244046888';
const 수량 = 5;

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8'));
  await updateDoc(doc(db, 'items', B20), { partnerIds: arrayUnion(동우), stock: prev.b20Stock });
  await updateDoc(doc(db, 'items', B10), { partnerIds: arrayRemove(동우), stock: prev.b10Stock });
  await updateDoc(doc(db, 'orders', 주문), { items: prev.orderItems });
  console.log('✅ 되돌림');
  process.exit(0);
}

const [b10, b20, ord] = await Promise.all([
  getDoc(doc(db, 'items', B10)), getDoc(doc(db, 'items', B20)), getDoc(doc(db, 'orders', 주문)),
]);
if (!b10.exists() || !b20.exists() || !ord.exists()) { console.error('문서가 없다.'); process.exit(1); }
const o = ord.data() as any;
const 줄 = (o.items ?? []).filter((x: any) => x.itemId === B20);
if (!줄.length) { console.log('이 주문에 20개입 줄이 없다 — 이미 고쳐졌다.'); process.exit(0); }

console.log('① 연결 바로잡기');
console.log(`   20개입 partnerIds 에서 동우 뺀다`);
console.log(`   10개입 partnerIds 에 동우 넣는다 (지금 방식과 맞춘다)`);
console.log('\n② 9/1 주문 5박스를 20개입 → 10개입 으로');
console.log(`   ${o.partnerName} · ${String(o.createdAt).slice(0,10)}`);
console.log('\n③ 재고 되돌리기 — 이미 배송완료라 차감이 끝났다');
console.log(`   20개입  ${b20.data().stock}  →  ${(b20.data().stock ?? 0) + 수량}   (잘못 빠진 ${수량}박스 되돌림)`);
console.log(`   10개입  ${b10.data().stock}  →  ${(b10.data().stock ?? 0) - 수량}   (제자리에서 뺀다)`);

if (!APPLY) { console.log('\n--dry (기본). 적용하려면 --apply'); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify({
  b10Stock: b10.data().stock ?? 0, b20Stock: b20.data().stock ?? 0, orderItems: o.items,
}, null, 2), 'utf8');

await updateDoc(doc(db, 'items', B20), { partnerIds: arrayRemove(동우), stock: (b20.data().stock ?? 0) + 수량 });
await updateDoc(doc(db, 'items', B10), { partnerIds: arrayUnion(동우), stock: (b10.data().stock ?? 0) - 수량 });
await updateDoc(doc(db, 'orders', 주문), {
  items: (o.items ?? []).map((x: any) => x.itemId === B20 ? { ...x, itemId: B10 } : x),
});
console.log('\n✅ 고침. 되돌리려면 --undo');
process.exit(0);
