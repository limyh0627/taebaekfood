// 외주가공비(540) 계정과목 신설 — OEM 가공비 매입전표용. 제조원가(ag-cogs).
// dry-run 기본, --apply 반영, --undo 삭제
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const app = initializeApp({
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
});
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const apply = process.argv.includes('--apply');
const undo = process.argv.includes('--undo');
const DOC_ID = 'ac-540';

const codes = (await getDocs(collection(db, 'accountCodes'))).docs.map(d => ({ _id: d.id, ...d.data() }));
const exists = codes.find(c => c.code === '540');

if (undo) {
  if (!exists) { console.log('540 없음 — 할 일 없음'); process.exit(0); }
  if (apply) { await deleteDoc(doc(db, 'accountCodes', exists._id)); console.log(`✓ 삭제: ${exists.code} ${exists.name}`); }
  else console.log(`[DRY] 삭제 대상: ${exists.code} ${exists.name} (${exists._id})`);
  process.exit(0);
}

if (exists) {
  console.log(`이미 있음: ${exists.code} ${exists.name} (groupId=${exists.groupId ?? '-'})`);
  process.exit(0);
}

const data = {
  id: '540', code: '540', name: '외주가공비',
  groupId: 'ag-cogs',   // 총매출원가 — 임가공은 제조원가
  note: 'OEM 임가공 가공비. 과세(세금계산서 수취). oemEngine이 이 코드로 매입전표 생성',
};
console.log(apply ? '[반영]' : '[DRY RUN — 반영하려면 --apply]');
console.log(`  540 외주가공비 → ag-cogs(총매출원가) 신설`);
if (apply) {
  await setDoc(doc(db, 'accountCodes', DOC_ID), data);
  const after = (await getDocs(collection(db, 'accountCodes'))).docs.map(d => d.data()).find(c => c.code === '540');
  console.log(`  ✓ 생성 확인: ${after?.code} ${after?.name} groupId=${after?.groupId}`);
}
process.exit(0);
