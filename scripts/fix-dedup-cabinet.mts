// 문서함 대분류·중분류 중복 정리 — 같은 이름이 여럿이면 가장 오래된 하나만 남긴다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 왜 생겼나: 시드 효과가 addItem을 부르고 목록은 구독으로 늦게 따라오는데,
// 그 사이 효과가 또 돌아 "아직 없네" 하고 또 만들었다. '서류관리'가 셋이 됐다.
// 코드 쪽은 ref로 막았다(DocumentManager.seedTried).
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-dedup-cabinet-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8')) as { col: string; doc: any }[];
  for (const { col, doc: d } of prev) { const { id, ...rest } = d; await setDoc(doc2(col, id), rest); }
  console.log(`✅ ${prev.length}건 복원`); process.exit(0);
}
function doc2(col: string, id: string) { return doc(db, col, id); }

const [cats, subs, docs] = await Promise.all(
  ['fileCabinetCategories', 'fileCabinetSubCategories', 'fileCabinetDocs'].map(load));

const kill: { col: string; doc: any }[] = [];
const group = <T extends { id: string }>(rows: T[], keyOf: (r: T) => string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) (m.get(keyOf(r)) ?? m.set(keyOf(r), []).get(keyOf(r))!).push(r);
  return m;
};
//  가장 오래된 것(createdAt, 없으면 id)을 남긴다 — 파일이 붙어 있다면 먼저 만든 쪽일 가능성이 크다
const oldestFirst = (a: any, b: any) =>
  String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || String(a.id).localeCompare(String(b.id));

console.log('── 대분류 ──');
for (const [name, rows] of group(cats, (c: any) => String(c.name))) {
  if (rows.length < 2) continue;
  const [keep, ...dup] = [...rows].sort(oldestFirst);
  console.log(`  "${name}" ${rows.length}개 → 남길 ${keep.id} · 지울 ${dup.map((d: any) => d.id).join(', ')}`);
  for (const d of dup) kill.push({ col: 'fileCabinetCategories', doc: d });
}
console.log('── 중분류 ──');
for (const [key, rows] of group(subs, (s: any) => `${s.category}|${s.name}`)) {
  if (rows.length < 2) continue;
  const [keep, ...dup] = [...rows].sort(oldestFirst);
  console.log(`  "${key}" ${rows.length}개 → 남길 ${keep.id} · 지울 ${dup.map((d: any) => d.id).join(', ')}`);
  for (const d of dup) kill.push({ col: 'fileCabinetSubCategories', doc: d });
}

//  이름으로만 묶이므로 문서는 안 잃는다 — 그래도 한 번 확인한다
const catNames = new Set(cats.map((c: any) => String(c.name)));
const orphan = docs.filter((d: any) => !catNames.has(String(d.category)));
if (orphan.length) console.log(`\n⚠ 대분류가 없는 파일 ${orphan.length}건 — 이 작업과 무관하지만 알아 두세요`);

if (!kill.length) { console.log('\n중복 없음.'); process.exit(0); }
console.log(`\n지울 것 ${kill.length}건 (파일은 이름으로 묶이므로 안 사라진다)`);
if (!APPLY) { console.log('(--dry) 적용하려면 --apply'); process.exit(0); }
writeFileSync(BACKUP, JSON.stringify(kill, null, 2), 'utf8');
for (const { col, doc: d } of kill) await deleteDoc(doc2(col, d.id));
console.log(`✅ ${kill.length}건 삭제.  되돌리기: npx tsx scripts/fix-dedup-cabinet.mts --undo`);
process.exit(0);
