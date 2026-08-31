// 적금(사업자 명의)을 끊을 계정을 만든다 — 106 정기적금 · 136 선납세금.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 적금 납입은 **비용이 아니라 자산**이다. 통장에서 적금으로 자리만 옮기는 것이라
// 비용으로 끊으면 이익이 그만큼 깎여 보인다.
//   납입   (차) 106 정기적금 / (대) 103 보통예금
//   만기   (차) 103 보통예금 / (대) 106 정기적금 + 901 이자수익
//   원천징수(15.4%)를 떼고 들어오면 그 몫이 136 선납세금 — 종합소득세에서 기납부세액으로 뺀다.
//
// isCash 는 false 다. 적금은 현금성이 아니다 — true 로 두면 현금흐름표가 적금을 현금으로 세고,
// 보유자금에도 잡혀 "쓸 수 있는 돈"이 부풀어 보인다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-add-savings-accounts-backup.json';

const NEW = [
  { id: 'ac-106', code: '106', name: '정기적금',  type: '자산', normalBalance: 'debit', isCash: false, groupId: 'ag-asset' },
  { id: 'ac-136', code: '136', name: '선납세금',  type: '자산', normalBalance: 'debit', isCash: false, groupId: 'ag-asset' },
];

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8')) as { created: string[] };
  for (const id of prev.created) await deleteDoc(doc(db, 'accountCodes', id));
  console.log(`✅ ${prev.created.length}개 삭제 — 되돌림`);
  process.exit(0);
}

const codes = (await getDocs(collection(db, 'accountCodes'))).docs.map(d => ({ __id: d.id, ...d.data() } as any));
const have = new Set(codes.map((c: any) => String(c.code)));

const todo = NEW.filter(n => !have.has(n.code));
const skip = NEW.filter(n => have.has(n.code));

for (const s of skip) console.log(`· ${s.code} ${s.name} — 이미 있다. 건너뛴다`);
if (todo.length === 0) { console.log('만들 게 없다.'); process.exit(0); }

console.log('\n만들 계정:');
for (const n of todo) console.log(`  ${n.code}  ${n.name.padEnd(8)} ${n.type}  ${n.normalBalance}  현금성:${n.isCash}  ${n.groupId}`);

if (!APPLY) { console.log('\n(--dry) 적용하려면 --apply'); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify({ created: todo.map(n => n.id), at: new Date().toISOString() }, null, 2), 'utf8');
for (const n of todo) await setDoc(doc(db, 'accountCodes', n.id), n);
console.log(`\n✅ ${todo.length}개 만들었다.  되돌리기: npx tsx scripts/fix-add-savings-accounts.mts --undo`);
process.exit(0);
