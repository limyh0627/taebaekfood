// 수입들기름 단가를 말통값 → L당으로 바로잡고, 딸린 원가를 다시 굴린다.
//   기본 = --dry (미리보기, 쓰기 없음).  실제 적용 = --apply.  되돌리기 = --undo
//
// 수입들기름은 **16.5kg 말통 단위로 189,200원**에 산다(현대농업 매입전표). 그 말통 값이
// items.cost에 그대로 들어갔는데 품목 단위는 **L**이다. 그래서 L당 189,200원이 됐다 —
// 17.9배다. 이게 혼자 재고액을 뒤집었다:
//   · 수입들기름 재고 -512.848L × 189,200 = **-97,030,842원** (총액 115,744,806원 안에서)
//   · 들기름 = 수입들기름×0.8 + 통들깨들기름×0.2 → 154,928/L
//   · 시골향들기름 350ml 50,318원/병, 1750ml 250,982원/병 … 완제품까지 통째로 10~20배
//
// 바른 값: 189,200원 ÷ (16.5kg ÷ 0.924kg/L) = 189,200 × 0.924 ÷ 16.5 = **10,595.2원/L**
//
// 적용 전 전 품목 원가를 fix-suip-deulgireum-unit-backup.json에 통째로 남긴다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { buildFormula, formulaRowsOf } from '../src/features/admin/bom';
import { buildCostFn } from '../src/shared/bomCost';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-suip-deulgireum-unit-backup.json';
const 말통값 = 189200, 말통kg = 16.5;

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업 파일이 없다 — 되돌릴 수 없다.'); process.exit(1); }
  const prev: Record<string, number | null> = JSON.parse(readFileSync(BACKUP, 'utf8'));
  let n = 0;
  for (const [id, c] of Object.entries(prev)) { await updateDoc(doc(db, 'items', id), { cost: c ?? 0 }); n++; }
  console.log(`✅ ${n}건 원가 되돌림`);
  process.exit(0);
}

const [items, boms, formulas] = await Promise.all([load('items'), load('item_bom'), load('item_formula')]);
const live = items.filter((i: any) => !i.archived);
const 수입 = live.find((i: any) => i.name === '수입들기름');
if (!수입) { console.error('수입들기름을 못 찾았다.'); process.exit(1); }
if (수입.unit !== 'L' || !수입.density) { console.error(`단위/밀도가 예상과 다르다: ${수입.unit}/${수입.density}`); process.exit(1); }

const 새단가 = Math.round(말통값 * 수입.density / 말통kg * 100) / 100;   // 원/L
console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);
console.log(`수입들기름  ${Number(수입.cost).toLocaleString()}/L → ${새단가.toLocaleString()}/L`);
console.log(`   ${말통값.toLocaleString()}원 ÷ (${말통kg}kg ÷ ${수입.density}kg/L = ${(말통kg / 수입.density).toFixed(3)}L)\n`);

//  고친 값을 넣은 채로 전체를 다시 굴린다 — 들기름·완제품이 다 여기서 파생된다.
const patched = live.map((i: any) => (i.id === 수입.id ? { ...i, cost: 새단가 } : i));
const cost = buildCostFn({
  allItems: patched as any, itemBoms: boms as any,
  formulaOf: (k: string) => buildFormula(k, formulas as any, patched as any),
  formulaRowsOf: (k: string) => formulaRowsOf(k, formulas as any),
});

//  0이 나오는 건 안 쓴다 — 구성이 비어 원가를 못 낸 품목까지 0으로 덮으면 손해다.
const plan = patched
  .map((i: any) => ({ i, now: Number(live.find((o: any) => o.id === i.id)?.cost ?? 0), next: i.id === 수입.id ? 새단가 : cost(i) }))
  .filter((r: any) => r.next > 0 && Math.abs(r.next - r.now) > 0.5);

const f = (n: number) => Math.round(n).toLocaleString();
for (const r of plan.sort((a: any, b: any) => Math.abs(b.next - b.now) - Math.abs(a.next - a.now)).slice(0, 25))
  console.log(`   ${String(r.i.name + ' ' + (r.i.spec ?? '')).padEnd(38)} ${f(r.now).padStart(9)} → ${f(r.next).padStart(9)}`);
if (plan.length > 25) console.log(`   … 외 ${plan.length - 25}건`);

//  재고액 총액이 어떻게 바뀌는지 — 사장님이 보는 숫자가 이것이다.
const 총액 = (pick: (i: any) => number) => patched
  .filter((p: any) => (p.companyId ?? 'taebaek') === 'taebaek')
  .reduce((a: number, p: any) => a + Math.round((p.stock ?? 0) * pick(p)), 0);
const before = 총액((p: any) => Number(live.find((o: any) => o.id === p.id)?.cost ?? 0));
const after = 총액((p: any) => (p.id === 수입.id ? 새단가 : cost(p)));
console.log(`\n재고총액  ${f(before)}원 → ${f(after)}원`);
console.log(`\n총 ${plan.length}건 변경 예정`);
console.log(`되돌리기: npx tsx scripts/fix-suip-deulgireum-unit.mts --undo  (백업 ${BACKUP})`);

if (!APPLY) { console.log(`\n적용하려면: npx tsx scripts/fix-suip-deulgireum-unit.mts --apply`); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify(Object.fromEntries(live.map((i: any) => [i.id, i.cost ?? null])), null, 1), 'utf8');
for (const r of plan) await updateDoc(doc(db, 'items', r.i.id), { cost: Math.round(r.next * 100) / 100 });
console.log(`\n✅ ${plan.length}건 원가 갱신 · 백업 ${BACKUP}`);
process.exit(0);
