// 참기름/병/특/알찬/350ml(낱개) — 작업완료분 900개가 재고에 반영 안 된 것 정정.
//   기본 = dry(미리보기, 쓰기 없음).  실제 적용 = --apply.  되돌리기 = --undo (백업 JSON).
//
// 근거(진단 diag-stock-anomalies.mts):
//   · 품목 p-1784787834504  stock=0
//   · 이 품목을 참조하는 주문은 ORD-1786405645013(해피유통(쿠팡)) 단 1건뿐 — 다른 데서 차감된 게 아님
//   · 그 주문은 2026-08-11 작업완료(DISPATCHED)·미출고. 설계상 작업완료 시 완제품 재고 +900이 돼야 함
//   · 사용자 확인: 900병을 실제로 생산해 창고에 보유 중(A안)
//   → stock=900 으로 앵커. 재고 현황의 '재고'(작업완료 제외) = 900 − 900 = 0 으로 정합.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import fs from 'fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BK = 'scripts/fix-alchan350-dispatched-stock-backup.json';
const ITEM_ID = 'p-1784787834504';
const ORDER_ID = 'ORD-1786405645013';
const TARGET = 900;

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!fs.existsSync(BK)) { console.log(`백업 없음: ${BK}`); process.exit(1); }
  const bak = JSON.parse(fs.readFileSync(BK, 'utf8'));
  await updateDoc(doc(db, 'items', bak.id), { stock: bak.stock });
  console.log(`복원 ${bak.name} → stock=${bak.stock}`); process.exit(0);
}

const [items, orders] = await Promise.all([load('items'), load('orders')]);
const p = items.find((i: any) => i.id === ITEM_ID);
const o = orders.find((x: any) => x.id === ORDER_ID);

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);
if (!p) { console.log(`⚠ 품목 없음: ${ITEM_ID}`); process.exit(1); }

// 적용 시점 재확인 — 진단 이후 상황이 바뀌었으면 멈춘다(덮어쓰기 사고 방지)
const line = (o?.items ?? []).find((it: any) => it.itemId === ITEM_ID);
const refs = orders.filter((x: any) => (x.items ?? []).some((it: any) => it.itemId === ITEM_ID));
console.log(`품목: ${p.name}  (id=${ITEM_ID})`);
console.log(`   현재 stock = ${p.stock}`);
console.log(`주문: ${ORDER_ID}  ${o?.partnerName ?? '-'}`);
console.log(`   qty=${line?.quantity ?? '-'}  status=${o?.status ?? '-'}  producedAt=${(o?.producedAt ?? '-').toString().slice(0, 19)}  shippedOut=${o?.shippedOut ?? false}`);
console.log(`   이 품목을 참조하는 주문 수 = ${refs.length}`);

const guards: string[] = [];
if ((p.stock ?? 0) !== 0) guards.push(`현재 stock이 0이 아님(${p.stock}) — 이미 손댄 흔적`);
if (!o) guards.push(`주문 ${ORDER_ID} 없음`);
if (line?.quantity !== TARGET) guards.push(`주문 수량이 ${TARGET}이 아님(${line?.quantity})`);
if (o && (!o.producedAt || o.shippedOut)) guards.push(`주문이 더 이상 '작업완료·미출고' 상태가 아님`);
if (refs.length !== 1) guards.push(`참조 주문이 1건이 아님(${refs.length}) — 다른 차감 경로 생김`);

if (guards.length) {
  console.log(`\n⛔ 안전장치 걸림 — 적용하지 않습니다:`);
  guards.forEach(g => console.log(`   · ${g}`));
  console.log(`\n진단부터 다시 하세요: npx tsx scripts/diag-stock-anomalies.mts`);
  process.exit(1);
}

console.log(`\n변경: stock ${p.stock} → ${TARGET}`);
console.log(`      결과 재고 현황 '재고'(작업완료 제외) = ${TARGET} − 900 = 0`);

if (!APPLY) {
  console.log(`\n※ 미리보기만 함. 실제 적용:  npx tsx scripts/fix-alchan350-dispatched-stock.mts --apply`);
  process.exit(0);
}

fs.writeFileSync(BK, JSON.stringify({ at: new Date().toISOString(), id: ITEM_ID, name: p.name, stock: p.stock ?? 0 }, null, 2), 'utf8');
console.log(`\n백업 저장: ${BK}`);
await updateDoc(doc(db, 'items', ITEM_ID), { stock: TARGET });
console.log(`✅ ${p.name}  ${p.stock} → ${TARGET}`);
console.log(`\n되돌리기: npx tsx scripts/fix-alchan350-dispatched-stock.mts --undo`);
process.exit(0);
