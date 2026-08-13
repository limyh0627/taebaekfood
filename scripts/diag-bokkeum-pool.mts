// [읽기 전용] 볶음참깨 벌크 풀(raw-볶음참깨) 로트·수불부 진단 — 왜 −7140kg인가.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [items, ledger] = await Promise.all([load('items'), load('rawMaterialLedger')]);

const holder = items.find((i: any) => i.id === 'raw-볶음참깨');
console.log('════ raw-볶음참깨 로트 상세 ════');
console.log(`stock=${holder.stock}`);
for (const l of (holder.lots ?? [])) {
  console.log(`  · 로트 ${l.lotNo ?? l.id}  거래처=${l.supplierName ?? ''}  입고=${l.qtyIn ?? ''}(${l.kgIn ?? ''}kg)  잔량=${l.kgRemaining}kg  status=${l.status}  입고일=${l.receivedDate ?? ''}`);
}

console.log('\n════ 볶음참깨 수불부(rawMaterialLedger) 집계 ════');
const bl = ledger.filter((e: any) => e.material === '볶음참깨');
let totIn = 0, totUsed = 0;
for (const e of bl) { totIn += e.received ?? 0; totUsed += e.used ?? 0; }
console.log(`기록 ${bl.length}건  총입고=${Math.round(totIn * 10) / 10}kg  총사용=${Math.round(totUsed * 10) / 10}kg  차=${Math.round((totIn - totUsed) * 10) / 10}kg`);
console.log('\n최근 사용 기록 상위 12건(사용량순):');
bl.filter((e: any) => (e.used ?? 0) > 0).sort((a: any, b: any) => (b.used ?? 0) - (a.used ?? 0)).slice(0, 12)
  .forEach((e: any) => console.log(`  ${e.date}  사용 ${e.used}kg  type=${e.type ?? ''}  note="${(e.note ?? '').slice(0, 50)}"  ${e.orderId ?? ''}`));
console.log('\n입고 기록(received>0):');
bl.filter((e: any) => (e.received ?? 0) > 0).sort((a: any, b: any) => (a.date ?? '').localeCompare(b.date ?? ''))
  .forEach((e: any) => console.log(`  ${e.date}  입고 ${e.received}kg  type=${e.type ?? ''}  note="${(e.note ?? '').slice(0, 40)}"`));
process.exit(0);
