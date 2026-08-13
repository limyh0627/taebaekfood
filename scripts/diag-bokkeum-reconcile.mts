// [읽기 전용] 볶음참깨 벌크 풀(raw-볶음참깨) −7140kg 전면 재구성.
//  1) 현재 로트 상태
//  2) 로트를 실제로 깎은 주문들(rawConsumedLots에 볶음참깨) — 기록된 차감 vs 현재 주문이 요구하는 차감 비교(stale 색출)
//  3) 로트를 채운 입고(가공입고/수동입고)가 로트로 들어왔는지
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { buildFormula } from '../src/features/admin/bom';
import { toKg } from '../src/constants/formula';
import { stockUnits } from '../src/shared/orderUnits';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [items, orders, ledger] = await Promise.all([load('items'), load('orders'), load('rawMaterialLedger')]);
const byId = new Map(items.map((i: any) => [i.id, i]));
const bf = (key: string) => buildFormula(key, [] as any, items as any); // PRODUCT_FORMULA 폴백만 필요(볶음참깨=시골향볶음참깨)

const holder = items.find((i: any) => i.id === 'raw-볶음참깨');
console.log('════ 1) 현재 raw-볶음참깨 로트 ════');
let lotSum = 0;
for (const l of (holder.lots ?? [])) { lotSum += l.kgRemaining ?? 0; console.log(`  · ${l.lotNo ?? l.id} 거래처=${l.supplierName} 입고kg=${l.kgIn ?? 0} 잔량=${l.kgRemaining}kg status=${l.status}`); }
console.log(`  로트잔량합 = ${Math.round(lotSum * 10) / 10}kg  (stock필드=${holder.stock})`);

// 어떤 완제품이 볶음참깨 벌크 풀을 깎는가(임가공 제외)
const bulkConsumeKg = (p: any, it: any): number => {
  if (!p || p.procureType === '임가공') return 0;
  let kg = 0;
  for (const f of bf(p.품목 || p.name)) if (f.raw === '볶음참깨') kg += toKg(p.spec || '', '볶음참깨', stockUnits(it, p)) * f.ratio;
  return Math.round(kg * 1000) / 1000;
};

console.log('\n════ 2) 로트를 깎은 주문: 기록된 차감(rawConsumedLots) vs 현재 주문 요구량 ════');
let recordedSum = 0, currentSum = 0;
const rows: any[] = [];
for (const o of orders) {
  const consumed = (o.rawConsumedLots ?? []).filter((c: any) => c.material === '볶음참깨');
  const recKg = consumed.reduce((s: number, c: any) => s + (c.kg ?? 0), 0);
  const curKg = (o.items ?? []).reduce((s: number, it: any) => s + bulkConsumeKg(byId.get(it.itemId), it), 0);
  if (recKg === 0 && curKg === 0) continue;
  recordedSum += recKg; currentSum += curKg;
  rows.push({ id: o.id, partner: o.partnerName, status: o.status, recKg: Math.round(recKg * 10) / 10, curKg: Math.round(curKg * 10) / 10, diff: Math.round((recKg - curKg) * 10) / 10 });
}
rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
console.log('주문ID / 거래처 / 상태 / 기록차감 / 현재요구 / 차이(기록−현재)');
for (const r of rows) console.log(`  ${r.diff !== 0 ? '⚠️' : '  '} ${r.id}  ${r.partner}  ${r.status}  기록 ${r.recKg}kg  현재 ${r.curKg}kg  차 ${r.diff}kg`);
console.log(`\n  합계: 로트에서 실제 깎임(기록) ${Math.round(recordedSum * 10) / 10}kg  /  현재 주문이 요구하는 량 ${Math.round(currentSum * 10) / 10}kg  /  과다차감 ${Math.round((recordedSum - currentSum) * 10) / 10}kg`);

console.log('\n════ 3) 입고가 로트로 들어왔나 ════');
const recv = ledger.filter((e: any) => e.material === '볶음참깨' && (e.received ?? 0) > 0);
const recvSum = recv.reduce((s: number, e: any) => s + (e.received ?? 0), 0);
for (const e of recv) console.log(`  수불부 입고 ${e.date}  ${e.received}kg  type=${e.type}  "${(e.note ?? '').slice(0, 40)}"`);
const lotInSum = (holder.lots ?? []).reduce((s: number, l: any) => s + (l.kgIn ?? 0), 0);
console.log(`  수불부 총입고 ${Math.round(recvSum)}kg  vs  로트로 들어온 kg합 ${Math.round(lotInSum)}kg  → 로트 미반영 입고 ${Math.round(recvSum - lotInSum)}kg`);

console.log('\n════ 요약 ════');
console.log(`  로트 이론값 = 로트입고 ${Math.round(lotInSum)}kg − 실제깎임 ${Math.round(recordedSum * 10) / 10}kg = ${Math.round((lotInSum - recordedSum) * 10) / 10}kg`);
console.log(`  현재 로트잔량 = ${Math.round(lotSum * 10) / 10}kg`);
console.log(`  과다차감(stale 등) 정정 시 회복 = +${Math.round((recordedSum - currentSum) * 10) / 10}kg`);
console.log(`  가공입고 로트미반영 정정 시 회복 = +${Math.round(recvSum - lotInSum)}kg`);
process.exit(0);
