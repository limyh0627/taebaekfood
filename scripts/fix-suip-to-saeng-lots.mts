// 수입들기름 마이너스를 생들기름 로트에서 뺀다 — stock만 옮기고 로트를 안 옮겨 둔 것을 마저 한다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 앞서 fix-suip-to-saeng-stock.mts가 items.stock만 바꿨다. 그런데 원료 재고의 근거는 **로트**다
// (lotStockInUnit = 로트 kg 잔량 합). 로트를 안 옮기면 화면은 그대로 −512.848로 보이고,
// 다음에 로트를 건드리는 처리가 stock을 로트 합으로 덮어써서 되돌아간다.
//
//   수입들기름  이월로트 −512.848kg → 0 (로트 합 0 = stock 0)
//   생들기름    260803-01 2,789.604kg → 2,276.756kg (FIFO, 합 2,526.2 = stock 2,526.2)
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-suip-to-saeng-lots-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8')) as Record<string, { lots: any[]; stock: number }>;
  for (const [id, v] of Object.entries(prev)) await updateDoc(doc(db, 'items', id), { lots: v.lots, stock: v.stock });
  console.log(`✅ ${Object.keys(prev).length}건 되돌림`); process.exit(0);
}

const items = (await getDocs(collection(db, 'items'))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const 수입 = items.find((i: any) => i.name === '수입들기름' && !i.archived);
const 생 = items.find((i: any) => i.name === '생들기름' && !i.archived);
const kg = (lots: any[]) => Math.round(lots.reduce((a, l) => a + Number(l.kgRemaining ?? 0), 0) * 1000) / 1000;

const 수입로트 = [...(수입.lots ?? [])];
const 부족 = kg(수입로트);
if (부족 >= 0) { console.log(`수입들기름 로트 합이 ${부족}kg — 옮길 게 없다.`); process.exit(0); }
const 옮길양 = -부족;

//  마이너스를 안고 있는 이월 로트를 0으로 만든다(잔량 0 = 소진).
const 수입새로트 = 수입로트.map((l: any) =>
  Number(l.kgRemaining ?? 0) < 0 ? { ...l, kgRemaining: 0, status: 'depleted' } : l);

//  생들기름은 FIFO — 받은 날짜 순으로 앞에서 깎는다.
const 생로트 = [...(생.lots ?? [])].sort((a: any, b: any) => String(a.receivedDate ?? '').localeCompare(String(b.receivedDate ?? '')));
let 남은 = 옮길양;
const 생새로트 = 생로트.map((l: any) => {
  const rem = Number(l.kgRemaining ?? 0);
  if (남은 <= 0 || rem <= 0) return l;
  const take = Math.min(rem, 남은);
  남은 = Math.round((남은 - take) * 1000) / 1000;
  const next = Math.round((rem - take) * 1000) / 1000;
  return { ...l, kgRemaining: next, ...(next === 0 ? { status: 'depleted' } : {}) };
});

const f = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });
console.log(`\n═══ ${APPLY ? '🔴 적용(--apply)' : '🟢 미리보기(dry)'} ═══\n   옮길 양 ${f(옮길양)}kg\n`);
console.log(`   수입들기름 로트 합 ${f(부족)} → ${f(kg(수입새로트))}   stock ${수입.stock} → ${kg(수입새로트)}`);
for (const l of 수입새로트) console.log(`      ${String(l.lotNo ?? l.id).padEnd(28)} 잔량 ${f(Number(l.kgRemaining ?? 0)).padStart(11)}`);
console.log(`\n   생들기름 로트 합 ${f(kg(생로트))} → ${f(kg(생새로트))}   stock ${생.stock} → ${kg(생새로트)}`);
for (const l of 생새로트) console.log(`      ${String(l.lotNo ?? l.id).padEnd(28)} 잔량 ${f(Number(l.kgRemaining ?? 0)).padStart(11)}`);
if (남은 > 0) console.log(`\n   ⚠ 생들기름 로트가 모자라 ${f(남은)}kg을 못 뺐다.`);
console.log(`\n되돌리기: npx tsx scripts/fix-suip-to-saeng-lots.mts --undo`);
if (!APPLY) { console.log(`\n적용: npx tsx scripts/fix-suip-to-saeng-lots.mts --apply`); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify({
  [수입.id]: { lots: 수입.lots ?? [], stock: Number(수입.stock ?? 0) },
  [생.id]: { lots: 생.lots ?? [], stock: Number(생.stock ?? 0) },
}, null, 1), 'utf8');
await updateDoc(doc(db, 'items', 수입.id), { lots: 수입새로트, stock: kg(수입새로트) });
await updateDoc(doc(db, 'items', 생.id), { lots: 생새로트, stock: kg(생새로트) });
console.log(`\n✅ 로트 이동 완료 · 백업 ${BACKUP}`);
process.exit(0);
