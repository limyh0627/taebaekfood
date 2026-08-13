// [읽기 전용] 새봄·모란·반석 주문의 볶음참깨 라인 + 기록차감 스냅샷 상세.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { isBoxStockItem, stockUnits, unpackComponent } from '../src/shared/orderUnits';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [items, orders] = await Promise.all([load('items'), load('orders')]);
const byId = new Map(items.map((i: any) => [i.id, i]));

for (const oid of ['ORD-1786430165162', 'ORD-1786507262755', 'ORD-1786326423201']) {
  const o = orders.find((x: any) => x.id === oid);
  if (!o) { console.log(`\n${oid}: 없음`); continue; }
  console.log(`\n════ ${oid}  ${o.partnerName}  status=${o.status}  producedAt=${o.producedAt ? 'O' : 'X'} ════`);
  for (const it of (o.items ?? [])) {
    const p = byId.get(it.itemId);
    const uc = p ? unpackComponent(p) : null;
    console.log(`  · ${p?.name ?? it.itemId} [${it.itemId}]  qty=${it.quantity} boxUnit=${it.isBoxUnit ?? false} boxQ=${it.boxQuantity ?? '-'}`);
    if (p) console.log(`      품목="${p.품목 ?? ''}" spec="${p.spec}" procure="${p.procureType ?? ''}" isBoxStock=${isBoxStockItem(p)} 개입=${uc?.count ?? '-'} → stockUnits=${stockUnits(it, p)}`);
  }
  console.log(`  rawConsumedLots(볶음참깨):`, (o.rawConsumedLots ?? []).filter((c: any) => c.material === '볶음참깨').map((c: any) => `${c.kg}kg from ${c.supplierName}(${c.lotId ?? 'nolot'})`).join(' | ') || '(없음)');
}
process.exit(0);
