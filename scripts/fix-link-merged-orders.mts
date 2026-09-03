/**
 * 합쳐 발행한 전표에 그 주문들을 이어 붙인다.
 *
 * 여러 주문을 한 전표로 묶어 발행했는데 전표의 `orderId` 에 하나만 적혀서,
 * 나머지가 계속 **미발행 주문**으로 떴다(2026-09-03 사장님).
 *
 * 목록 판정은 `invoicePrinted` 플래그가 아니라 **전표 실물**이 근거다
 * (`voucherMerge.voucheredOrderIds`). 그러니 전표에 주문 id 를 이어 붙이면
 * 목록에서 사라지고, **서류·재고 기록은 그대로 남는다.**
 * 지우면 8월 원료수불부·생산판매기록부에서 그 출고가 통째로 빠진다.
 *
 * **돈은 안 움직인다** — 전표의 금액·품목·날짜는 그대로고 `orderId` 칸만 는다.
 *
 *   --dry (기본) / --apply / --undo
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

//  전표번호 → 이어 붙일 주문 id 꼬리(카드번호)
const 짝 = [
  { docNo: '260827-07', 꼬리: '105308', 왜: '볶음참깨-낱개/1kg ×30 이 전표 품목과 같다' },
  { docNo: '260831-02', 꼬리: '025970', 왜: '시골향들기름/특/1750ml 2박스 = 전표의 20낱개' },
];
const BACKUP = fileURLToPath(new URL('./fix-link-merged-orders-backup.json', import.meta.url));
const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--undo') ? 'undo' : 'dry';
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const grab = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...(d.data() as any) }));

if (mode === 'undo') {
  if (!existsSync(BACKUP)) { console.log('되돌릴 backup 이 없다.'); process.exit(1); }
  for (const b of JSON.parse(readFileSync(BACKUP, 'utf8'))) await updateDoc(doc(db, 'issuedStatements', b.id), { orderId: b.was });
  console.log('되돌렸다.'); process.exit(0);
}

const orders: any[] = await grab('orders');
const st: any[] = await grab('issuedStatements');
const 할것: { id: string; docNo: string; was: string; to: string; 설명: string }[] = [];

for (const { docNo, 꼬리, 왜 } of 짝) {
  const s = st.find(x => x.docNo === docNo && x.type === '매출');
  const o = orders.find(x => String(x.id).replace(/\D/g, '').endsWith(꼬리));
  if (!s) { console.log(`전표 ${docNo} 못 찾음`); continue; }
  if (!o) { console.log(`주문 #${꼬리} 못 찾음`); continue; }
  const ids = String(s.orderId ?? '').split(/[,\s]+/).filter(Boolean);
  if (ids.includes(o.id)) { console.log(`${docNo} 에 이미 붙어 있다`); continue; }
  할것.push({ id: s.id, docNo, was: String(s.orderId ?? ''), to: [...ids, o.id].join(','),
              설명: `${o.partnerName} #${꼬리} — ${왜}` });
}

console.log(`[${mode}] 이어 붙일 것 ${할것.length}건`);
for (const x of 할것) {
  console.log(`  ${x.docNo}  ${x.설명}`);
  console.log(`     orderId  "${x.was}" → "${x.to}"`);
}
if (!할것.length) { console.log('  할 게 없다.'); process.exit(0); }
if (mode === 'dry') { console.log('\n--apply 를 붙여야 실제로 잇는다.'); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify(할것.map(({ id, was }) => ({ id, was })), null, 2), 'utf8');
for (const x of 할것) await updateDoc(doc(db, 'issuedStatements', x.id), { orderId: x.to });
console.log(`\n${할것.length}건 이었다. backup:`, BACKUP);
console.log('되돌리려면  npx tsx scripts/fix-link-merged-orders.mts --undo');
process.exit(0);
