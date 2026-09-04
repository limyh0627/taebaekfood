// 이은경 상무(emp-1773373867440)에게 관리자 앱 접근 권한을 준다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 전에는 [apps/admin/main.tsx](../apps/admin/main.tsx) 가 `id !== 'admin'` 이면 문을 닫아서
// 사장님 계정만 들어왔다. 이제 직원 기록의 `adminAccess` 칸이 문을 연다
// (판정은 [adminAccess.ts](../src/shared/adminAccess.ts) 의 canEnterAdmin 하나만 한다).
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc, deleteField } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-admin-access-eunkyung-backup.json';
const ID = 'emp-1773373867440';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const ref = doc(db, 'employees', ID);
const snap = await getDoc(ref);
if (!snap.exists()) { console.error(`직원 ${ID} 이 없다.`); process.exit(1); }
const cur = snap.data() as any;

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8')) as { before: boolean | null };
  await updateDoc(ref, { adminAccess: prev.before === null ? deleteField() : prev.before });
  console.log(`✅ ${cur.name} adminAccess → ${prev.before === null ? '(없음)' : prev.before} — 되돌림`);
  process.exit(0);
}

console.log(`대상: ${cur.name} ${cur.position} (${cur.department}) · 계정 ${cur.username}`);
console.log(`지금: adminAccess = ${cur.adminAccess ?? '(없음)'}`);
console.log(`바꿈: adminAccess = true`);

if (!APPLY) { console.log('\n--dry (기본). 적용하려면 --apply'); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify({ id: ID, name: cur.name, before: cur.adminAccess ?? null }, null, 2), 'utf8');
await updateDoc(ref, { adminAccess: true });
console.log(`\n✅ ${cur.name} 관리자 앱 접근 허용. 되돌리려면 --undo`);
process.exit(0);
