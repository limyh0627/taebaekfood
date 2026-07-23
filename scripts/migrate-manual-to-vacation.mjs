// manualAdjustment(구 수동 휴가) → '휴가' 신청 기록 이관 상태 확인 / 되돌리기
//   --undo : 생성된 휴가기록 삭제 + manualAdjustment 복원(백업 JSON 필요)
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const app = initializeApp({
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
});
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKUP = path.join(HERE, 'migrate-manual-to-vacation-backup.json');
const undo = process.argv.includes('--undo');

const load = async (c) => (await getDocs(collection(db, c))).docs.map(d => ({ _id: d.id, ...d.data() }));

if (undo) {
  const bak = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
  for (const e of bak.employees) {
    await updateDoc(doc(db, 'employees', e.id), { manualAdjustment: e.manualAdjustment });
    console.log(`  ✓ ${e.name} manualAdjustment ${e.manualAdjustment} 복원`);
  }
  for (const id of bak.createdLeaveIds) {
    await deleteDoc(doc(db, 'leaveRequests', id));
    console.log(`  ✓ ${id} 삭제`);
  }
  process.exit(0);
}

// 상태 확인 + 백업 생성(이관은 이미 반영됨)
const employees = await load('employees');
const leaves = await load('leaveRequests');
const legacy = leaves.filter(r => String(r.id ?? r._id).startsWith('leave-legacy-vac-'));

console.log(`manualAdjustment 남은 직원: ${employees.filter(e => (e.manualAdjustment || 0) > 0).length}명`);
console.log(`이관된 '휴가' 기록: ${legacy.length}건\n`);
for (const r of legacy.sort((a, b) => String(a.employeeName).localeCompare(String(b.employeeName)))) {
  console.log(`  ${String(r.employeeName).padEnd(10)} ${r.startDate}  ${String(r.type)}  ${r.daysUsed}일  ${r.status}`);
}

// 되돌리기용 백업 (경로 문제로 최초 실행 때 못 남겼던 것)
if (!fs.existsSync(BACKUP) && legacy.length > 0) {
  const bak = {
    at: new Date().toISOString(),
    note: 'manualAdjustment → 휴가 기록 이관 (2026-07-23). undo 시 아래 값으로 복원',
    employees: legacy.map(r => ({ id: r.employeeId, name: r.employeeName, manualAdjustment: r.daysUsed })),
    createdLeaveIds: legacy.map(r => r.id ?? r._id),
  };
  fs.writeFileSync(BACKUP, JSON.stringify(bak, null, 2));
  console.log(`\n백업 생성: ${BACKUP}`);
}
process.exit(0);
