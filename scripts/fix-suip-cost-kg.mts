// 수입들기름 원가를 원/kg으로 정정한다(밀도를 잘못 더 나눴다).
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 재고·로트·BOM 수량은 **전부 kg**이다(lotStockInUnit = lotKgRemaining, BOM 수량도 kg).
// 품목 unit이 'L'인 건 화면 표시용이다. 그러니 원가도 원/kg이라야 한다.
//   틀린 값 189,200 × 0.924 ÷ 16.5 = 10,595.2   ← 밀도를 괜히 더 나눴다
//   맞는 값 189,200 ÷ 16.5kg      = 11,467.27  ← 2026-08 스냅샷에 찍혀 있던 값
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { buildFormula, formulaRowsOf } from '../src/features/admin/bom';
import { buildCostFn } from '../src/shared/bomCost';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-suip-cost-kg-backup.json';
const 새단가 = Math.round(189200 / 16.5 * 100) / 100;   // 11467.27 원/kg

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev: Record<string, number | null> = JSON.parse(readFileSync(BACKUP, 'utf8'));
  for (const [id, c] of Object.entries(prev)) await updateDoc(doc(db, 'items', id), { cost: c ?? 0 });
  console.log(`✅ ${Object.keys(prev).length}건 되돌림`); process.exit(0);
}

const [items, boms, formulas] = await Promise.all([load('items'), load('item_bom'), load('item_formula')]);
const live = items.filter((i: any) => !i.archived);
const 수입 = live.find((i: any) => i.name === '수입들기름');
console.log(`\n═══ ${APPLY ? '🔴 적용(--apply)' : '🟢 미리보기(dry)'} ═══\n`);
console.log(`수입들기름  ${Number(수입.cost).toLocaleString()} → ${새단가.toLocaleString()} 원/kg   (189,200 ÷ 16.5kg)\n`);

const patched = live.map((i: any) => (i.id === 수입.id ? { ...i, cost: 새단가 } : i));
const cost = buildCostFn({
  allItems: patched as any, itemBoms: boms as any,
  formulaOf: (k: string) => buildFormula(k, formulas as any, patched as any),
  formulaRowsOf: (k: string) => formulaRowsOf(k, formulas as any),
});
const plan = patched
  .map((i: any) => ({ i, now: Number(live.find((o: any) => o.id === i.id)?.cost ?? 0), next: i.id === 수입.id ? 새단가 : cost(i) }))
  .filter((r: any) => r.next > 0 && Math.abs(r.next - r.now) > 0.5);
const f = (n: number) => Math.round(n).toLocaleString();
for (const r of plan.sort((a: any, b: any) => Math.abs(b.next - b.now) - Math.abs(a.next - a.now)).slice(0, 12))
  console.log(`   ${String(r.i.name + ' ' + (r.i.spec ?? '')).padEnd(38)} ${f(r.now).padStart(9)} → ${f(r.next).padStart(9)}`);
if (plan.length > 12) console.log(`   … 외 ${plan.length - 12}건`);
console.log(`\n총 ${plan.length}건`);
if (!APPLY) { console.log(`\n적용: npx tsx scripts/fix-suip-cost-kg.mts --apply`); process.exit(0); }
writeFileSync(BACKUP, JSON.stringify(Object.fromEntries(live.map((i: any) => [i.id, i.cost ?? null])), null, 1), 'utf8');
for (const r of plan) await updateDoc(doc(db, 'items', r.i.id), { cost: Math.round(r.next * 100) / 100 });
console.log(`\n✅ ${plan.length}건 갱신 · 백업 ${BACKUP}`);
process.exit(0);
