/**
 * 풍회 자금줄 넷의 시각 도장을 규칙대로 다시 찍는다.
 *
 * `createdAt` 이 `2026-08-04T09:00:00.000Z` 처럼 **UTC 09시**로 박혀 있어 로컬로 읽으면
 * 전부 18:00:00 이 된다. 스크립트로 넣으면서 시각을 대충 채운 자국이다(사장님 확인, 2026-09-03).
 *
 * 규칙은 `stampFor` — 소급이면 그날 맨 뒤(23:59:59), 당일이면 그때 시각.
 * 기준은 **그 줄을 만든 순간**(id 에 박힌 ms)이지 지금이 아니다.
 *
 * **금액도 날짜도 안 바뀐다.** 원장에서 그 줄이 그날 안에서 서는 자리만 바뀐다.
 * 8월이지만 사장님이 고치라고 하셨다 — 손으로 맞춰 두신 전표 날짜와는 별개다.
 *
 *   --dry (기본)  무엇이 어떻게 바뀌는지만
 *   --apply       고친다(백업 남김)
 *   --undo        되돌린다
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stampFor, timeOfLocal } from '../src/shared/voucherStamp';

const BACKUP = fileURLToPath(new URL('./fix-punghoe-1800-backup.json', import.meta.url));
const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--undo') ? 'undo' : 'dry';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (mode === 'undo') {
  if (!existsSync(BACKUP)) { console.log('되돌릴 backup 이 없다:', BACKUP); process.exit(1); }
  for (const b of JSON.parse(readFileSync(BACKUP, 'utf8'))) await updateDoc(doc(db, 'cashEntries', b.id), { createdAt: b.was });
  console.log('되돌렸다.');
  process.exit(0);
}

const rows = (await getDocs(collection(db, 'cashEntries'))).docs
  .map(d => ({ id: d.id, ...(d.data() as any) }))
  .filter(e => e.createdAt && timeOfLocal(e.createdAt) === '18:00:00');

const 고칠것 = rows.map(e => {
  const ms = /(\d{13})/.exec(e.id)?.[1];
  //  만든 순간을 모르면 손대지 않는다 — 소급인지 당일인지 알 길이 없다
  const to = ms ? stampFor(String(e.date).slice(0, 10), new Date(Number(ms))) : null;
  return { e, to, ms };
}).filter((x): x is { e: any; to: string; ms: string } => !!x.to && x.to !== x.e.createdAt);

console.log(`[${mode}] 시각이 18:00:00 인 자금줄 ${rows.length}개 · 고칠 것 ${고칠것.length}개`);
for (const { e, to, ms } of 고칠것)
  console.log(`  ${String(e.docNo ?? e.id).padEnd(12)} ${e.date}  ${e.dir} ${(Number(e.amount)||0).toLocaleString().padStart(11)}원  ${e.companyId ?? ''}  만든 ${new Date(Number(ms)).toLocaleString('sv-SE')}  ${timeOfLocal(e.createdAt)} → ${timeOfLocal(to)}`);
if (!고칠것.length) { console.log('  고칠 게 없다.'); process.exit(0); }
if (mode === 'dry') { console.log('\n--apply 를 붙여야 실제로 고친다.'); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify(고칠것.map(x => ({ id: x.e.id, was: x.e.createdAt })), null, 2), 'utf8');
for (const { e, to } of 고칠것) await updateDoc(doc(db, 'cashEntries', e.id), { createdAt: to });
console.log(`\n${고칠것.length}개 고쳤다. backup:`, BACKUP);
console.log('되돌리려면  npx tsx scripts/fix-punghoe-1800.mts --undo');
process.exit(0);
