// 수율 방향 정정 후 원가 전면 재계산.
//   기본 = --dry (미리보기, 쓰기 없음).  실제 적용 = --apply.  되돌리기 = --undo
//
// 두 가지가 겹쳐 있었다:
//   ① 원가 롤업이 수율을 **곱했다**. 37%는 "들깨 1kg에서 기름 0.37kg"이라 기름 1kg엔
//      들깨 1/0.37 = 2.7kg이 든다. 곱하면 원가가 7배 작아진다.
//   ② 제조 반제품은 저장 cost가 있으면 그걸 그대로 썼다. 원료값이 올라도 안 따라와서
//      통들깨들기름이 들깨 5,795원 시절 값(15,663)을 들고 있었다(실제 6,700원).
// 이제 원료식이 있는 반제품은 언제나 굴린다. 그 결과를 items.cost에 캐시로 써 둔다.
//
// 적용 전 값은 fix-recost-yield-backup.json에 통째로 남긴다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { buildFormula, formulaRowsOf } from '../src/features/admin/bom';
import { buildCostFn } from '../src/shared/bomCost';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-recost-yield-backup.json';

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
const cost = buildCostFn({
  allItems: live as any, itemBoms: boms as any,
  formulaOf: (k: string) => buildFormula(k, formulas as any, live as any),
  formulaRowsOf: (k: string) => formulaRowsOf(k, formulas as any),
});

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

//  0이 나오는 건 안 쓴다 — 구성이 비어 원가를 못 낸 품목까지 0으로 덮으면 손해다(앱의 recomputeAllCosts와 같은 규칙).
const plan = live
  .map((i: any) => ({ i, now: Number(i.cost ?? 0), next: cost(i) }))
  .filter(r => r.next > 0 && Math.abs(r.next - r.now) > 0.5);

const f = (n: number) => Math.round(n).toLocaleString();
const byType = new Map<string, typeof plan>();
for (const r of plan) {
  const k = String(r.i.type);
  const arr = byType.get(k);
  if (arr) arr.push(r); else byType.set(k, [r]);
}
for (const [t, arr] of [...byType.entries()].sort()) {
  console.log(`── ${t}  ${arr.length}건`);
  for (const r of arr.sort((a, b) => Math.abs(b.next - b.now) - Math.abs(a.next - a.now)).slice(0, 12))
    console.log(`     ${String(r.i.name).padEnd(30)} ${f(r.now).padStart(9)} → ${f(r.next).padStart(9)}  (${r.now > 0 ? ((r.next - r.now) / r.now * 100).toFixed(1) + '%' : '신규'})`);
  if (arr.length > 12) console.log(`     … 외 ${arr.length - 12}건`);
}
console.log(`\n총 ${plan.length}건 변경 예정 (미보관 ${live.length}건 중)`);
console.log(`되돌리기: npx tsx scripts/fix-recost-yield.mts --undo  (백업 ${BACKUP})`);

if (!APPLY) { console.log(`\n적용하려면: npx tsx scripts/fix-recost-yield.mts --apply`); process.exit(0); }

// 되돌릴 수 있게 **전 품목** 현재 원가를 통째로 남긴다(계획에 없던 것도)
writeFileSync(BACKUP, JSON.stringify(Object.fromEntries(live.map((i: any) => [i.id, i.cost ?? null])), null, 1), 'utf8');
for (const r of plan) await updateDoc(doc(db, 'items', r.i.id), { cost: Math.round(r.next * 100) / 100 });
console.log(`\n✅ ${plan.length}건 원가 갱신 · 백업 ${BACKUP}`);
process.exit(0);
