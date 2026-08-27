// 미지급 급여 지급 전표 템플릿을 만든다.
//   기본 = --dry (미리보기, 쓰기 없음).  실제 적용 = --apply.  되돌리기 = --undo
//
//   (차) 263 미지급급여 / (대) 통장
//
// 급여는 말일에 이미 발생으로 잡혀 있다 — 비용(515)은 그때 섰고 갚을 돈이 263에 남았다.
// 지급은 그 263을 터는 것이라 **비용 계정을 다시 세우면 안 된다.**
// 옛 '급여' 템플릿(mode=급여, 출금)은 515를 차변에 세우는 현금주의용이라 여기 쓰면 비용이 두 번 잡힌다.
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const COL = 'fixedCostTemplates';

//  전표 템플릿은 정기 생성 대상이 아니다(kind='voucher', autoIssue 없음).
const TEMPLATE = {
  id: 'fct-salary-payout',
  kind: 'voucher',
  category: '기타',
  active: false,
  hidden: false,
  amount: 0,
  name: '급여 지급(미지급)',
  group: '급여·상환',
  dir: '출금',            // 통장에서 실지급액이 나간다
  mode: '일반',
  accountCode: '263',     // 미지급급여를 턴다
  itemName: '급여 지급',
  note: '전달 발생분 상계 — 비용은 이미 잡혔다',
};

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

console.log(`\n═══ ${UNDO ? '↩ 되돌리기(--undo)' : APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

if (UNDO) {
  await deleteDoc(doc(db, COL, TEMPLATE.id));
  console.log(`✅ ${TEMPLATE.id} 삭제`);
  process.exit(0);
}

const cur = await getDoc(doc(db, COL, TEMPLATE.id));
console.log(`── ${TEMPLATE.name}  [${TEMPLATE.id}] ${cur.exists() ? '★이미 있음 — 덮어씀' : '신규'}`);
console.log(`     갈래=${TEMPLATE.dir}  계정=${TEMPLATE.accountCode} 미지급급여  묶음=${TEMPLATE.group}`);
console.log(`     분개: (차) 263 미지급급여 / (대) 통장`);
console.log('\n되돌리기: npx tsx scripts/fix-tpl-salary-payout.mts --undo');

if (!APPLY) { console.log(`\n적용하려면: npx tsx scripts/fix-tpl-salary-payout.mts --apply`); process.exit(0); }

await setDoc(doc(db, COL, TEMPLATE.id), TEMPLATE);
console.log(`\n✅ 저장`);
process.exit(0);
