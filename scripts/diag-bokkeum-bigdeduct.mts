// [읽기 전용] 볶음참깨 대형 차감 주문 2건 정체 파악.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { stockUnits, isBoxStockItem } from '../src/shared/orderUnits';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [items, orders] = await Promise.all([load('items'), load('orders')]);
const byId = new Map(items.map((i: any) => [i.id, i]));

for (const oid of ['ORD-1786430165162', 'ORD-1785830866346', 'ORD-1786492664559']) {
  const o = orders.find((x: any) => x.id === oid);
  if (!o) { console.log(`\n${oid}: 주문 없음`); continue; }
  console.log(`\n════ ${oid}  거래처=${o.partnerName}  status=${o.status}  일자=${(o.deliveryDate || o.createdAt || '').slice(0, 10)} ════`);
  for (const it of (o.items ?? [])) {
    const p = byId.get(it.itemId);
    console.log(`  라인: ${p?.name ?? it.itemId} [${it.itemId}]`);
    console.log(`     quantity=${it.quantity} isBoxUnit=${it.isBoxUnit ?? false} boxQuantity=${it.boxQuantity ?? '-'} unitsPerBox=${it.unitsPerBox ?? '-'}`);
    if (p) console.log(`     품목="${p.품목 ?? ''}" spec="${p.spec}" procureType="${p.procureType ?? ''}" isBoxStock=${isBoxStockItem(p)} → stockUnits=${stockUnits(it, p)}`);
  }
}
process.exit(0);
