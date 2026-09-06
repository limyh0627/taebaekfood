// 원가를 **공급가액 기준**으로 되돌린다 — 과세로 사 오는 종단 품목의 cost ÷ 1.1.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// **왜** (2026-09-06 사장님: "아예 면세로만 원가 보는게 fm 아니야?",
//        "공급가액이랑 비교해서 마진 내는게 맞잖아")
//
// 원가는 공급가액으로 본다. 과세 매입에 낸 부가세는 매출세액에서 공제받으므로 비용이
// 아니고, 면세 매입은 부가세를 애초에 안 낸다. 어느 쪽이든 원가 = 공급가액이다.
//
// 그런데 매입 단가는 이 앱에서 **부가세 포함**으로 적힌다(shared/lineAmount). 그 값을
// 그대로 cost 에 넣어 와서 과세 품목 원가가 10% 부풀어 있었다.
//
// **잰 값** — 과세 종단 품목 60개 중 전표와 맞춰볼 수 있는 26개가 **전부 전표 단가와 같았고**
// (=부가세 포함), 공급가액으로 넣은 것은 **0개**였다. 나머지도 같은 방식으로 본다.
//
// **손대지 않는 것**
//   · 면세로 산 것 (참깨·검정참깨·깻묵·들깨·탈피들깨가루) — 낸 부가세가 없다
//   · BOM 이나 원료식이 있는 것 (반제품·완제품) — 롤업이라 원료값을 고치면 저절로 따라온다
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-cost-supply-basis-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8')) as { id: string; name: string; cost: number }[];
  for (const p of prev) await updateDoc(doc(db, 'items', p.id), { cost: p.cost });
  console.log(`되돌렸다 — 원가 ${prev.length}개 복구`);
  process.exit(0);
}

const items = (await getDocs(collection(db, 'items'))).docs.map(d => ({ id: d.id, ...(d.data() as any) }));
const boms = (await getDocs(collection(db, 'item_bom'))).docs.map(d => d.data() as any);
const formulas = (await getDocs(collection(db, 'item_formula'))).docs.map(d => d.data() as any);

const bomParents = new Set(boms.map(b => b.parent_id ?? b.parentId));
const fKeys = new Set(formulas.map(f => f.parent_key));
const 서류명 = (i: any) => String(i.품목 ?? '').trim() || String(i.name ?? '');
const 기본 = (n: string) => String(n ?? '').split('/')[0].trim();

//  사 오는 종단 품목 = 구성도 원료식도 없는 것. 그 cost 가 곧 매입 단가다.
const 종단 = items.filter(i =>
  Number(i.cost) > 0 && !bomParents.has(i.id)
  && !fKeys.has(서류명(i)) && !fKeys.has(기본(i.name)));
const 고칠것 = 종단.filter(i => i.taxType !== '면세');

console.log(`사 오는 종단 품목 ${종단.length} / 그중 과세로 산 것 ${고칠것.length}`);
const 합 = 고칠것.reduce((a, i) => a + Number(i.cost), 0);
console.log(`합계 ${Math.round(합).toLocaleString()} → ${Math.round(합 / 1.1).toLocaleString()}  (−${Math.round(합 - 합 / 1.1).toLocaleString()})\n`);
for (const i of [...고칠것].sort((a, b) => Number(b.cost) - Number(a.cost)).slice(0, 12))
  console.log(`  ${String(i.type).padEnd(12)} ${String(i.name).padEnd(28)} ${Number(i.cost).toLocaleString().padStart(9)} → ${Math.round(Number(i.cost) / 1.1).toLocaleString().padStart(9)}`);
if (고칠것.length > 12) console.log(`  … 그 밖 ${고칠것.length - 12}개`);

if (!APPLY) { console.log('\n--dry (기본). 적용하려면 --apply'); process.exit(0); }

//  **두 번 돌리면 두 번 나눈다.** 실제로 그랬다(2026-09-06) — 안전장치를 붙이려다
//  스크립트를 다시 돌려서 원가가 10% 더 깎였고, --undo 로 되돌렸다.
//  되돌릴 수 있게만 만들었지 여러 번 돌려도 되게 만들지 않았다. 백업이 있으면 막는다.
if (existsSync(BACKUP)) {
  console.error(`\n이미 한 번 적용했다(${BACKUP}). 두 번 나누면 원가가 또 10% 깎인다.`);
  console.error('다시 하려면 먼저 --undo 로 되돌려라.');
  process.exit(1);
}

writeFileSync(BACKUP, JSON.stringify(고칠것.map(i => ({ id: i.id, name: i.name, cost: Number(i.cost) })), null, 2), 'utf8');
for (const i of 고칠것) await updateDoc(doc(db, 'items', i.id), { cost: Math.round(Number(i.cost) / 1.1) });
console.log(`\n✅ 원가 ${고칠것.length}개를 공급가액 기준으로 바꿨다. 되돌리려면 --undo`);
process.exit(0);
