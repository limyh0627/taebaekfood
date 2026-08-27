// 옛 '급여' 템플릿(현금주의)을 숨긴다.
//   기본 = --dry (미리보기, 쓰기 없음).  실제 적용 = --apply.  되돌리기 = --undo
//
// fct-builtin-salary는 mode='급여'라 515 급여를 차변에 세우는 **현금주의**용이다.
// 급여를 말일 발생으로 잡는 지금 방식에선 지급 때 이걸 쓰면 비용이 두 번 잡힌다.
// 기본 템플릿이라 지울 수는 없고 숨기기만 된다(builtin 표식).
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const ID = 'fct-builtin-salary';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const ref = doc(db, 'fixedCostTemplates', ID);
const snap = await getDoc(ref);
if (!snap.exists()) { console.error(`${ID} 없음 — 중단`); process.exit(1); }
const cur = snap.data() as { name?: string; mode?: string; dir?: string; hidden?: boolean };

console.log(`\n═══ ${UNDO ? '↩ 되돌리기(--undo)' : APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);
console.log(`  ${cur.name}  [${ID}]  mode=${cur.mode} dir=${cur.dir}`);
console.log(`  hidden ${cur.hidden ?? false} → ${UNDO ? false : true}`);
console.log('\n되돌리기: npx tsx scripts/fix-tpl-hide-old-salary.mts --undo');

if (!APPLY && !UNDO) { console.log(`\n적용하려면: npx tsx scripts/fix-tpl-hide-old-salary.mts --apply`); process.exit(0); }
await updateDoc(ref, { hidden: !UNDO });
console.log(`\n✅ ${UNDO ? '다시 보임' : '숨김'}`);
process.exit(0);
