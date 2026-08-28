// 끊긴 전표–주문 연결을 다시 잇는다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 전표는 있는데 orderId가 비었거나 **지워진 주문**을 가리켜, 그 주문이 영영 '미발행'으로 남았다.
// (주문을 지우면 전표의 orderId는 그대로 남는다 — AdminApp의 삭제는 deleteItem('orders') 한 줄뿐)
// 전표 품목·수량이 주문과 정확히 맞는 것만 잇는다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-relink-statements-backup.json';

//  [전표 docNo, 이을 주문 id, 근거]
//  **품목 이름·낱개수량이 통째로 맞고 후보가 딱 하나인 것만** 넣는다.
//  수량이 다른 건 전표가 맞고 주문이 틀렸을 수 있어(반품·수량정정) 손대지 않는다.
const LINKS: [string, string, string][] = [
  // 1차 (2026-08-28)
  ['260818-02', 'ORD-1787032928186', '일성상회 08-18 — 특A/A 흰정사각 1750ml + 들기름 1750ML 3품목 수량 일치'],
  ['260812-02', 'ORD-1786507369829', '세화식품 08-13 — 들깨가루(중간)/4kg ×1 일치 (옛 orderId ORD-1786492847819는 지워진 주문)'],
  ['260805-01', 'ORD-1785802585888', '글로벌유통 08-05 — 원액 300ml ×100 = 5박스×20 일치 (옛 orderId ORD-1785727415906는 지워진 주문)'],
  // 2차 — 배송완료 주문까지 목록에 올린 뒤 다시 대조해 나온 것
  ['260804-08', 'ORD-1785830191902', '해피유통(포천) 08-04 — 전 품목 낱개수량 일치 (orderId 비어있음)'],
  ['260803-10', 'ORD-1785830730345', '해내음식품 08-03 — 전 품목 낱개수량 일치 (orderId 비어있음)'],
  ['260811-02', 'ORD-1786320336175', '엠에스식품 08-11 — 전 품목 낱개수량 일치 (orderId 비어있음)'],
  ['260803-08', 'ORD-1785830984717', '세화식품 08-03 — 전 품목 낱개수량 일치 (옛 orderId ORD-1785718993679는 지워진 주문)'],
  ['260805-10', 'ORD-1785994168175', '일성상회 08-06 — 특A/1750ml ×40 일치 (옛 orderId ORD-1785912941897은 지워진 주문)'],
  ['260818-09', 'ORD-1787042128510', '김밥담 08-18 — 전 품목 낱개수량 일치 (옛 orderId ORD-1787018171539는 지워진 주문)'],
  // 3차 — 스마트스토어 주문을 뺀 뒤, 전표에 여분 줄(반품·택배비)이 있어도 주문 줄이 다 들어있으면 같은 건으로 봤다
  ['260819-09', 'ORD-1787124911666', '거산농산 08-19 — 5줄 수량 전부 일치(볶음참깨/1kg↔볶음참깨-낱개/1kg 표기차). 전표에 반품 -14 줄만 더 있다 (옛 orderId ORD-1787018230541은 지워진 주문)'],
  ['260811-05', 'ORD-1786431682838', '엄마랑 빈대떡 08-11 — 골드/1800ml ×1 일치, 나머지 두 줄은 벌크 20kg ×1 두 개로 개수 일치(주문 품목이 삭제돼 이름이 안 읽힌다). 전표에 택배비 줄만 더 있다'],
];

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev: Record<string, string> = JSON.parse(readFileSync(BACKUP, 'utf8'));
  for (const [id, oid] of Object.entries(prev)) await updateDoc(doc(db, 'issuedStatements', id), { orderId: oid });
  console.log(`✅ ${Object.keys(prev).length}건 되돌림`); process.exit(0);
}

const [stmts, orders] = await Promise.all([load('issuedStatements'), load('orders')]);
const orderIds = new Set(orders.map((o: any) => o.id));
console.log(`\n═══ ${APPLY ? '🔴 적용(--apply)' : '🟢 미리보기(dry)'} ═══\n`);

const plan: { id: string; before: string; after: string; why: string }[] = [];
for (const [docNo, oid, why] of LINKS) {
  const s = stmts.find((x: any) => x.docNo === docNo);
  if (!s) { console.log(`   ⚠ 전표 ${docNo} 없음 — 건너뜀`); continue; }
  if (!orderIds.has(oid)) { console.log(`   ⚠ 주문 ${oid} 없음 — 건너뜀`); continue; }
  const before = String(s.orderId ?? '');
  if (before === oid) { console.log(`   · ${docNo} 이미 연결됨`); continue; }
  console.log(`   ${docNo}  orderId "${before || '(빈값)'}" → ${oid}`);
  console.log(`      ${why}`);
  plan.push({ id: s.id, before, after: oid, why });
}

//  같은 병 — 지워진 주문을 가리키는 전표가 더 있나
const dead = stmts.filter((s: any) => s.orderId && !orderIds.has(String(s.orderId)) && !LINKS.some(l => l[0] === s.docNo));
console.log(`\n── 지워진 주문을 가리키는 전표 ${dead.length}건 (이번엔 안 건드림) ──`);
for (const s of dead.slice(0, 15)) console.log(`   ${s.tradeDate} ${String(s.partnerName).padEnd(16)} ${s.docNo} → ${s.orderId}`);
if (dead.length > 15) console.log(`   … 외 ${dead.length - 15}건`);

console.log(`\n총 ${plan.length}건 연결 예정`);
console.log(`되돌리기: npx tsx scripts/fix-relink-statements.mts --undo`);
if (!APPLY) { console.log(`\n적용: npx tsx scripts/fix-relink-statements.mts --apply`); process.exit(0); }
if (!plan.length) { console.log('\n바꿀 게 없다.'); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify(Object.fromEntries(plan.map(p => [p.id, p.before])), null, 1), 'utf8');
for (const p of plan) await updateDoc(doc(db, 'issuedStatements', p.id), { orderId: p.after });
console.log(`\n✅ ${plan.length}건 연결 · 백업 ${BACKUP}`);
process.exit(0);
