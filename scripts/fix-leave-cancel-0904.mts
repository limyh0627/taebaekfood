/**
 * 이지영(실장) 2026-09-04 연차 취소 — 안 쉬기로 했다(사장님, 2026-09-03).
 *
 * **화면에 승인된 연차를 취소하는 길이 없다.** 그래서 지운다.
 * 사용일수는 저장된 값이 아니라 승인된 신청에서 세므로(`getApprovedLeaveDays`),
 * 이 줄을 지우면 '예정'에서 1일이 빠지고 잔여가 1일 는다 — 따로 손댈 칸이 없다.
 * (아직 안 온 날이라 '사용'이 아니라 '예정'에 잡혀 있었다.)
 *
 *   --dry (기본) / --apply / --undo
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TARGET = 'lv-4ikuei2h1';
const BACKUP = fileURLToPath(new URL('./fix-leave-cancel-0904-backup.json', import.meta.url));
const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--undo') ? 'undo' : 'dry';
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (mode === 'undo') {
  if (!existsSync(BACKUP)) { console.log('되돌릴 backup 이 없다.'); process.exit(1); }
  const s = JSON.parse(readFileSync(BACKUP, 'utf8'));
  await setDoc(doc(db, 'leaveRequests', s.id), s.data);
  console.log('되돌렸다:', s.id); process.exit(0);
}

const snap = await getDoc(doc(db, 'leaveRequests', TARGET));
if (!snap.exists()) { console.log('이미 없다:', TARGET); process.exit(0); }
const data = snap.data() as any;
console.log(`[${mode}] 지울 것`);
console.log(`  ${TARGET}  ${data.startDate}~${data.endDate}  ${data.employeeName}  ${data.type}  ${data.status}  ${data.daysUsed}일`);
if (mode === 'dry') { console.log('\n--apply 를 붙여야 실제로 지운다.'); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify({ id: TARGET, data }, null, 2), 'utf8');
await deleteDoc(doc(db, 'leaveRequests', TARGET));
console.log('\n지웠다. backup:', BACKUP);
console.log('되돌리려면  npx tsx scripts/fix-leave-cancel-0904.mts --undo');
process.exit(0);
