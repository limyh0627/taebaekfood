// 규격을 낱개 기준으로 맞춘다 — 고춧가루는 '1kg * 20' → '1kg', 벌크는 규격을 '벌크'로.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// `spec`은 **낱개 하나의 용량**이다. 거기 개입수('* 20')가 박혀 있으면 코드가 그걸 박스로 읽어
// 수량 환산이 어긋난다. 개입수는 `boxSize`가 쥔다 — 옮겨 담고 규격에서는 뺀다.
//
// 벌크(자루째 kg/L로 세는 것)는 낱개 용량이라는 게 없다. 빈칸으로 두면 화면마다 '—'가 떠서
// 규격을 안 적은 것인지 없는 것인지 안 갈린다. **'벌크'라고 적어 둔다.**
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, deleteField } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-spec-loose-bulk-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev: Record<string, { spec: string; boxSize?: number }> = JSON.parse(readFileSync(BACKUP, 'utf8'));
  for (const [id, v] of Object.entries(prev)) await updateDoc(doc(db, 'items', id), v as never);
  console.log(`✅ ${Object.keys(prev).length}건 되돌림`);
  process.exit(0);
}

const items = (await getDocs(collection(db, 'items'))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const live = items.filter((i: any) => !i.archived);
const plan: { i: any; patch: Record<string, unknown>; why: string }[] = [];

//  ① 낱개인데 규격에 개입수가 박힌 것 — 향미유처럼 개입수를 아예 안 남긴다.
//     낱개는 개입수가 뜻이 없다. 박스가 필요하면 박스 품목이 따로 있고 그쪽이 제 규격('1kg * 20')을 쥔다.
//     박스·선물세트는 그 개입수가 제 규격이라 건드리지 않는다.
for (const i of live) {
  if (i.subtype === '박스' || i.subtype === '선물세트') continue;
  const m = String(i.spec ?? '').match(/^\s*(.+?)\s*[*x×]\s*(\d+)\s*$/);
  if (!m) continue;
  const patch: Record<string, unknown> = { spec: m[1] };
  if (i.boxSize) patch.boxSize = deleteField();             // 낱개엔 개입수를 안 남긴다
  plan.push({ i, patch, why: `개입수 ${m[2]}를 뺀다 — 낱개다` });
}

//  ② 벌크 — 규격 자리에 '벌크'
for (const i of live) {
  if (i.subtype !== '벌크') continue;
  if (String(i.spec ?? '').trim() === '벌크') continue;
  if (String(i.spec ?? '').trim()) continue;                 // 뭔가 적혀 있으면 안 건드린다
  plan.push({ i, patch: { spec: '벌크' }, why: '벌크는 낱개 용량이 없다' });
}

console.log(`\n═══ ${APPLY ? '🔴 적용(--apply)' : '🟢 미리보기(dry)'} ═══\n`);
for (const p of plan)
  console.log(`   ${String(p.i.name).padEnd(24)} [${String(p.i.spec ?? '').padEnd(10)}] → [${String(p.patch.spec).padEnd(8)}]${p.patch.boxSize ? ' boxSize 뺌' : ''}  ${String(p.i.subtype || '(없음)').padEnd(7)} ${p.why}`);
console.log(`\n   총 ${plan.length}건`);
console.log(`되돌리기: npx tsx scripts/fix-spec-loose-bulk.mts --undo`);
if (!APPLY) { console.log(`\n적용: npx tsx scripts/fix-spec-loose-bulk.mts --apply`); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify(Object.fromEntries(plan.map(p => [p.i.id, { spec: p.i.spec ?? '', ...(p.i.boxSize ? { boxSize: p.i.boxSize } : {}) }])), null, 1), 'utf8');
for (const p of plan) await updateDoc(doc(db, 'items', p.i.id), p.patch);
console.log(`\n✅ ${plan.length}건 · 백업 ${BACKUP}`);
process.exit(0);
