// [읽기 전용·임시] 운영 DB의 음수 완제품 재고가 과거값인지 최근 출고인지 구분한다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { isBulkItem } from '../src/shared/itemTaxonomy';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (name: string) => (await getDocs(collection(db, name))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [items, orders, receipts] = await Promise.all([load('items'), load('orders'), load('itemReceipts')]);
const finished = items.filter((p: any) => !p.archived && !isBulkItem(p)
  && (p.type === 'product' || p.type === 'goods' || p.type === '완제품' || p.type === '향미유' || p.type === '고춧가루'));
const negatives = finished.filter((p: any) => Number(p.stock ?? 0) < 0).sort((a: any, b: any) => Number(a.stock) - Number(b.stock));
console.log(JSON.stringify({ totalFinished: finished.length, negativeCount: negatives.length,
  byModel: Object.fromEntries([...new Set(negatives.map((p: any) => p.procureType === '임가공' ? '임가공' : p.procureType === '완사입' || p.type === 'goods' ? '사입' : '생산'))]
    .map(k => [k, negatives.filter((p: any) => (p.procureType === '임가공' ? '임가공' : p.procureType === '완사입' || p.type === 'goods' ? '사입' : '생산') === k).length])) }));
for (const p of negatives) {
  const related = orders.filter((o: any) => (o.items ?? []).some((l: any) => l.itemId === p.id));
  const shipped = related.filter((o: any) => o.shippedOut);
  const completed = related.filter((o: any) => o.producedAt);
  const recent = [...related].sort((a: any, b: any) => String(b.producedAt ?? b.createdAt ?? '').localeCompare(String(a.producedAt ?? a.createdAt ?? ''))).slice(0, 3)
    .map((o: any) => ({ id: o.id, partner: o.partnerName, status: o.status, createdAt: o.createdAt,
      producedAt: o.producedAt, shippedOut: o.shippedOut,
      qty: (o.items ?? []).filter((l: any) => l.itemId === p.id).reduce((s: number, l: any) => s + Number(l.quantity ?? 0), 0),
      hasNewSnapshot: !!o.itemInventory || !!o.inventorySnapshots }));
  const ownReceipts = receipts.filter((r: any) => r.itemId === p.id).sort((a: any, b: any) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  const activeLots = (p.lots ?? []).filter((l: any) => l.status !== 'depleted');
  console.log(JSON.stringify({ id: p.id, name: p.name, stock: p.stock, unit: p.unit, type: p.type,
    procureType: p.procureType ?? '', subtype: p.subtype ?? '', lotQty: activeLots.reduce((s: number, l: any) => s + Number(l.qtyRemaining ?? 0), 0),
    orderCount: related.length, shippedCount: shipped.length, completedCount: completed.length,
    receiptCount: ownReceipts.length, lastReceipt: ownReceipts[0]?.createdAt, recent }));
}
process.exit(0);
