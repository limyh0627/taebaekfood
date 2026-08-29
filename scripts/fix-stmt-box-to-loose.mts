// 전표 줄 이름에 박힌 '(N개입)'을 걷어내고 낱개 품목 이름·규격으로 맞춘다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 전표는 **낱개 품목으로만** 들어가야 한다. 그런데 몇 줄이 박스 표기('(20개입)')를 이름에 달고
// 있었다. 수량·단가·금액은 확인해 보니 **전부 낱개 기준이 맞다** — 예를 들어
//   들깨가루(중간)/거산/1kg (20개입)  단가 7,500 × 300 = 2,250,000  → 1kg 낱개 단가 그대로다
//   볶음참깨/1kg (10개입)            단가 5,800 × 50  =   290,000  → 1kg 낱개 단가 그대로다
// 그러니 **이름과 규격만** 고친다. 금액에는 손대지 않는다(고치면 매출이 바뀐다).
//
// 가공비 줄('… - 가공비 - 과세')은 그대로 둔다 — 품목이 아니라 **어느 박스 규격을 가공했는지**를
// 적은 것이라 개입수가 뜻을 갖는다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-stmt-box-to-loose-backup.json';
const RE = /\s*\(\d+\s*개입\)/;

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev: Record<string, unknown[]> = JSON.parse(readFileSync(BACKUP, 'utf8'));
  for (const [id, its] of Object.entries(prev)) await updateDoc(doc(db, 'issuedStatements', id), { items: its });
  console.log(`✅ 전표 ${Object.keys(prev).length}건 되돌림`);
  process.exit(0);
}

const [stmts, items] = await Promise.all([load('issuedStatements'), load('items')]);
const norm = (x: string) => String(x ?? '').replace(/\s/g, '');
const live = items.filter((i: any) => !i.archived);
/**
 * 이름 표기가 달라 자동으로 못 잇는 것 — 손으로 이어 준다.
 * '1.75ML'과 '1750ML'은 같은 1750ml인데 글자가 달라 안 맞는다(단가 25,000×20으로 낱개 확인).
 */
const ALIAS: Record<string, string> = {
  '시골향들기름/1.75ML': '시골향들기름/1750ML',
};
/** 이름에서 개입수를 뗀 뒤 그에 맞는 **낱개** 품목을 찾는다 */
const looseFor = (raw: string) =>
  ((base: string) =>
  live.find((i: any) => i.subtype === '낱개' && norm(i.name) === norm(base))
  //  '볶음참깨/1kg'처럼 그 이름이 박스에만 붙은 경우 — 낱개는 '-낱개'가 끼어 있다
  ?? live.find((i: any) => i.subtype === '낱개' && norm(i.name) === norm(base).replace('/', '-낱개/'))
  ?? live.find((i: any) => i.subtype === '낱개' && norm(i.name).replace('-낱개', '') === norm(base))
  )(ALIAS[norm(raw)] ?? raw);

console.log(`\n═══ ${APPLY ? '🔴 적용(--apply)' : '🟢 미리보기(dry)'} ═══\n`);
const plan: { id: string; before: any[]; after: any[] }[] = [];
const skipped: string[] = [];
for (const s of stmts.sort((a: any, b: any) => String(a.tradeDate).localeCompare(String(b.tradeDate)))) {
  const its = s.items ?? [];
  if (!its.some((li: any) => RE.test(String(li.name)))) continue;
  let touched = false;
  const after = its.map((li: any) => {
    if (!RE.test(String(li.name))) return li;
    if (String(li.name).includes('가공비')) { skipped.push(`${s.docNo} ${li.name}`); return li; }
    const base = String(li.name).replace(RE, '').trim();
    const loose = looseFor(base);
    if (!loose) { skipped.push(`${s.docNo} ${li.name} — 낱개 품목을 못 찾음`); return li; }
    touched = true;
    console.log(`   ${s.tradeDate} ${String(s.docNo).padEnd(14)} ${String(s.partnerName).padEnd(12)}`);
    console.log(`      ${li.name} [${li.spec}]  →  ${loose.name} [${loose.spec ?? ''}]   (수량 ${li.qty} · 단가 ${li.price} · 합 ${li.total} 그대로)`);
    return { ...li, name: loose.name, spec: loose.spec ?? li.spec };
  });
  if (touched) plan.push({ id: s.id, before: its, after });
}
console.log(`\n   전표 ${plan.length}건 · 손 안 댄 줄 ${skipped.length}건`);
for (const k of skipped) console.log(`      · ${k}`);
console.log(`\n되돌리기: npx tsx scripts/fix-stmt-box-to-loose.mts --undo`);
if (!APPLY) { console.log(`\n적용: npx tsx scripts/fix-stmt-box-to-loose.mts --apply`); process.exit(0); }
if (!plan.length) { console.log('\n바꿀 게 없다.'); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify(Object.fromEntries(plan.map(p => [p.id, p.before])), null, 1), 'utf8');
for (const p of plan) await updateDoc(doc(db, 'issuedStatements', p.id), { items: p.after });
console.log(`\n✅ 전표 ${plan.length}건 · 백업 ${BACKUP}`);
process.exit(0);
