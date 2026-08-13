// 박스 품목 음수 재고 정정 — 물리적으로 불가능한 음수를 0으로 앵커.
//   기본 = dry(미리보기, 쓰기 없음).  실제 적용 = --apply.  되돌리기 = --undo (백업 JSON 사용).
//
// 대상(진단 diag-stock-anomalies.mts):
//   · box-p-165-20            시골향 들기름/병/특/350ml (20개입)  stock −1
//   · box-p-1774944582929-10  들기름/알이네/1800ml (10개입)       stock −2
// 원인: 두 품목 모두 "출고완료 주문은 있는데 박스 재고를 채운 기록이 없음".
//   박스를 낱개에서 즉석 포장해 내보내면서 박스 재고만 −로 흐른 것. 값 정정은 대증요법이라
//   같은 배선이 남아 있으면 다시 음수가 된다(DB-CHANGELOG에 기록).
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import fs from 'fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BK = 'scripts/fix-negative-box-stock-backup.json';
const TARGETS: Record<string, number> = {
  'box-p-165-20': 0,
  'box-p-1774944582929-10': 0,
};

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const items = await load('items');

if (UNDO) {
  if (!fs.existsSync(BK)) { console.log(`백업 없음: ${BK}`); process.exit(1); }
  const bak = JSON.parse(fs.readFileSync(BK, 'utf8'));
  for (const b of bak.items) { await updateDoc(doc(db, 'items', b.id), { stock: b.stock }); console.log(`복원 ${b.name} → stock=${b.stock}`); }
  console.log(`\n복원 ${bak.items.length}건 완료.`); process.exit(0);
}

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

const plan: any[] = [];
for (const [id, target] of Object.entries(TARGETS)) {
  const p = items.find((i: any) => i.id === id);
  if (!p) { console.log(`⚠ 품목 없음: ${id}`); continue; }
  console.log(`${p.name}\n   id=${id}  stock ${p.stock} → ${target}`);
  if (p.stock === target) { console.log(`   (이미 ${target} — 건너뜀)`); continue; }
  if ((p.stock ?? 0) > 0) { console.log(`   ⚠ 현재 재고가 양수(${p.stock}) — 진단 시점과 다름. 안전을 위해 건너뜀.`); continue; }
  plan.push({ id, name: p.name, stock: p.stock ?? 0, target });
}

if (plan.length === 0) { console.log('\n적용할 변경 없음.'); process.exit(0); }

if (!APPLY) {
  console.log(`\n적용 대상 ${plan.length}건.`);
  console.log(`※ 미리보기만 함. 실제 적용:  npx tsx scripts/fix-negative-box-stock.mts --apply`);
  process.exit(0);
}

fs.writeFileSync(BK, JSON.stringify({ at: new Date().toISOString(), items: plan.map(p => ({ id: p.id, name: p.name, stock: p.stock })) }, null, 2), 'utf8');
console.log(`\n백업 저장: ${BK}`);
for (const p of plan) { await updateDoc(doc(db, 'items', p.id), { stock: p.target }); console.log(`✅ ${p.name}  ${p.stock} → ${p.target}`); }
console.log(`\n완료 ${plan.length}건. 되돌리기: npx tsx scripts/fix-negative-box-stock.mts --undo`);
process.exit(0);
