// 단위가 '박스'인데 서브타입만 '낱개' 로 찍힌 품목을 '박스' 로 고친다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// **동작에는 영향이 없다** — 개입수는 BOM 에서 오고, 박스 판정은 `isBox`·`unit` 이 한다
// (`subtype === '낱개'` 를 보고 갈라지는 코드는 없다. 2026-09-04 확인).
// 화면에서 **갈래로 거를 때만** 빠진다 — 제품별원장 분류 필터에서 박스로 걸러도 안 나온다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-box-subtype-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8')) as { id: string; name: string; before: string }[];
  for (const p of prev) {
    await updateDoc(doc(db, 'items', p.id), { subtype: p.before });
    console.log(`✅ ${p.name} subtype → ${p.before} — 되돌림`);
  }
  process.exit(0);
}

const snap = await getDocs(collection(db, 'items'));
const 대상 = snap.docs
  .map(d => ({ id: d.id, ...(d.data() as any) }))
  .filter(r => !r.archived && String(r.unit ?? '') === '박스' && String(r.subtype ?? '') === '낱개');

if (대상.length === 0) { console.log('고칠 것이 없다.'); process.exit(0); }

console.log(`단위=박스 · 서브타입=낱개 : ${대상.length}건`);
for (const r of 대상) console.log(`  ${r.name}  (규격 ${r.spec ?? '-'})  낱개 → 박스`);

if (!APPLY) { console.log('\n--dry (기본). 적용하려면 --apply'); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify(대상.map(r => ({ id: r.id, name: r.name, before: r.subtype })), null, 2), 'utf8');
for (const r of 대상) await updateDoc(doc(db, 'items', r.id), { subtype: '박스' });
console.log(`\n✅ ${대상.length}건 고침. 되돌리려면 --undo`);
process.exit(0);
