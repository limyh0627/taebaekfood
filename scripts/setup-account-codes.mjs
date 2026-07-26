/**
 * 계정과목 복식부기 세팅 — 기존 30개에 type/normalBalance 부여 + 누락 계정 신설.
 * 기존 필드(code/name/groupId/noncash)는 보존. 되돌리기 --undo(백업 필요).
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BK = path.join(HERE, 'setup-account-codes-backup.json');
const undo = process.argv.includes('--undo');

// groupId → 5분류
const GROUP_TYPE = {
  'ag-asset': '자산', 'ag-liability': '부채', 'ag-equity': '자본',
  'ag-revenue': '수익', 'ag-other-income': '수익',
  'ag-cogs': '비용', 'ag-admin': '비용', 'ag-sgna': '비용', 'ag-other-expense': '비용',
};
const normalOf = (type) => (type === '자산' || type === '비용') ? 'debit' : 'credit';
// 반대성격(contra) 예외 — 코드별 normalBalance 오버라이드
const CONTRA = { '338': 'debit', '203': 'credit' }; // 인출금(자본 차감), 감가상각누계액(자산 차감)
const CASH = new Set(['101', '103']);

const cur = (await getDocs(collection(db, 'accountCodes'))).docs.map(d => ({ _id: d.id, ...d.data() }));

if (undo) {
  const bak = JSON.parse(fs.readFileSync(BK, 'utf8'));
  for (const id of bak.added) await deleteDoc(doc(db, 'accountCodes', id));
  for (const a of bak.before) await setDoc(doc(db, 'accountCodes', a._id), a);
  console.log(`복원: 추가분 ${bak.added.length} 삭제, 기존 ${bak.before.length} 되돌림`); process.exit(0);
}

// 신설 계정
const NEW = [
  { code: '101', name: '현금',            groupId: 'ag-asset' },
  { code: '103', name: '보통예금',        groupId: 'ag-asset' },
  { code: '108', name: '외상매출금',      groupId: 'ag-asset' },
  { code: '135', name: '부가세대급금',    groupId: 'ag-asset' },
  { code: '203', name: '감가상각누계액',  groupId: 'ag-asset' },
  { code: '251', name: '외상매입금',      groupId: 'ag-liability' },
  { code: '254', name: '예수금',          groupId: 'ag-liability' },
  { code: '255', name: '부가세예수금',    groupId: 'ag-liability' },
  { code: '295', name: '퇴직급여충당부채', groupId: 'ag-liability' },
  { code: '501', name: '상품매입',        groupId: 'ag-cogs' },
];
const existingCodes = new Set(cur.map(a => String(a.code)));

const enrich = (a) => {
  const type = GROUP_TYPE[a.groupId] ?? '비용';
  const normalBalance = CONTRA[String(a.code)] ?? normalOf(type);
  return { ...a, type, normalBalance, ...(CASH.has(String(a.code)) ? { isCash: true } : {}) };
};

const backup = { at: new Date().toISOString(), before: cur, added: [] };
// 기존 갱신
for (const a of cur) {
  const { _id, ...rest } = enrich(a);
  await setDoc(doc(db, 'accountCodes', a._id), rest);
}
console.log(`기존 ${cur.length}개 갱신 (type/normalBalance)`);
// 신설
let added = 0;
for (const n of NEW) {
  if (existingCodes.has(n.code)) { console.log(`  - ${n.code} ${n.name} 이미 있음, 갱신만`); continue; }
  const rec = enrich({ id: n.code, code: n.code, name: n.name, groupId: n.groupId });
  delete rec._id;
  await setDoc(doc(db, 'accountCodes', n.code), rec);
  backup.added.push(n.code); added++;
  console.log(`  + ${n.code} ${n.name} [${rec.type}/${rec.normalBalance}${rec.isCash ? '/현금' : ''}]`);
}
fs.writeFileSync(BK, JSON.stringify(backup, null, 2));
console.log(`\n신설 ${added}개 · 백업 ${BK}\n되돌리기: node scripts/setup-account-codes.mjs --undo`);
process.exit(0);
