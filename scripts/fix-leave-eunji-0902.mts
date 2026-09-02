/**
 * 박은지 2026-09-02 연차 한 건 삭제 — 잘못 들어간 것(사장님 확인, 2026-09-02).
 *
 * 사용일수는 직원 문서에 저장돼 있지 않다. `getApprovedLeaveDays` 가 **승인된 신청을
 * 그때그때 더해서** 낸다(shared/leave.ts). 그래서 이 줄을 지우면 사용이 1일 줄고
 * 잔여가 1일 늘어난다 — 따로 손댈 칸이 없다.
 *
 *   --dry (기본)  무엇을 지울지만 보여준다
 *   --apply       지운다. 지우기 전에 원본을 backup json 으로 남긴다
 *   --undo        backup json 으로 되돌린다
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TARGET = 'lv-rry4ztnki';
const BACKUP = fileURLToPath(new URL('./fix-leave-eunji-0902-backup.json', import.meta.url));
const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--undo') ? 'undo' : 'dry';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (mode === 'undo') {
  if (!existsSync(BACKUP)) { console.log('되돌릴 backup 이 없다:', BACKUP); process.exit(1); }
  const saved = JSON.parse(readFileSync(BACKUP, 'utf8'));
  await setDoc(doc(db, 'leaveRequests', saved.id), saved.data);
  console.log('되돌렸다:', saved.id);
  process.exit(0);
}

const snap = await getDoc(doc(db, 'leaveRequests', TARGET));
if (!snap.exists()) { console.log('이미 없다:', TARGET); process.exit(0); }
const data = snap.data() as any;

console.log(`[${mode}] 지울 것`);
console.log(`  ${TARGET}  ${data.startDate}~${data.endDate}  ${data.type}  ${data.status}  ${data.daysUsed}일`);
console.log(`  사원 ${data.employeeName ?? data.employeeId}`);

if (mode === 'dry') { console.log('\n--apply 를 붙여야 실제로 지운다.'); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify({ id: TARGET, data }, null, 2), 'utf8');
await deleteDoc(doc(db, 'leaveRequests', TARGET));
console.log('\n지웠다. backup:', BACKUP);
console.log('되돌리려면  npx tsx scripts/fix-leave-eunji-0902.mts --undo');
process.exit(0);
