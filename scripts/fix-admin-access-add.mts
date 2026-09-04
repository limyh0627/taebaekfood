// 관리자 앱 접근을 여러 명에게 준다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 이은경 상무 때는 사람마다 스크립트를 짰는데(fix-admin-access-eunkyung.mts) 그럴 일이 아니다.
// 문을 여는 건 직원 기록의 `adminAccess` 칸 하나뿐이고, 판정은
// [adminAccess.ts](../src/shared/adminAccess.ts) 의 canEnterAdmin 만 한다.
// **다음에 또 줄 사람이 생기면 아래 ID 목록만 갈아 끼우면 된다.**
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc, deleteField } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-admin-access-add-backup.json';

/** 이총제 팀장 · 황준호 대리 (2026-09-03 사장님) */
const IDS = ['e3', 'e6'];

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8')) as { id: string; name: string; before: boolean | null }[];
  for (const p of prev) {
    await updateDoc(doc(db, 'employees', p.id), { adminAccess: p.before === null ? deleteField() : p.before });
    console.log(`✅ ${p.name} adminAccess → ${p.before === null ? '(없음)' : p.before} — 되돌림`);
  }
  process.exit(0);
}

const 백업: { id: string; name: string; before: boolean | null }[] = [];
for (const id of IDS) {
  const snap = await getDoc(doc(db, 'employees', id));
  if (!snap.exists()) { console.error(`직원 ${id} 이 없다.`); process.exit(1); }
  const cur = snap.data() as any;
  console.log(`${cur.name} ${cur.position} (${cur.department}) · 계정 ${cur.username}`);
  console.log(`  adminAccess: ${cur.adminAccess ?? '(없음)'} → true`);
  백업.push({ id, name: cur.name, before: cur.adminAccess ?? null });
}

if (!APPLY) { console.log('\n--dry (기본). 적용하려면 --apply'); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify(백업, null, 2), 'utf8');
for (const b of 백업) await updateDoc(doc(db, 'employees', b.id), { adminAccess: true });
console.log(`\n✅ ${백업.length}명 관리자 앱 접근 허용. 되돌리려면 --undo`);
process.exit(0);
