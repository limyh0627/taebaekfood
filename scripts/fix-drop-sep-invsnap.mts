/**
 * 아직 안 끝난 9월의 '월말' 재고 스냅샷을 지운다.
 *
 * `inv-snap-2026-09` 가 **2026-09-01 10:03에** 기록돼 있고 값이 8월과 똑같다(219,518,832원).
 * 월말 실사액 자리에 전월 값이 들어가 있는 것이다.
 *
 * 그냥 두면 스케줄러가 9/30에 돌아도 **"이미 있네" 하고 건너뛴다.**
 * 지우면 9/30 23:00에 그날 재고로 제대로 찍힌다.
 *
 * 7·8월 스냅샷은 안 건드린다 — 지난 달 장부가 그걸 딛고 서 있다.
 *
 *   --dry (기본)  무엇을 지울지만 보여준다
 *   --apply       지운다. 지우기 전 원본을 backup json 으로 남긴다
 *   --undo        backup json 으로 되돌린다
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const YM = '2026-09';
const BACKUP = fileURLToPath(new URL('./fix-drop-sep-invsnap-backup.json', import.meta.url));
const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--undo') ? 'undo' : 'dry';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (mode === 'undo') {
  if (!existsSync(BACKUP)) { console.log('되돌릴 backup 이 없다:', BACKUP); process.exit(1); }
  for (const b of JSON.parse(readFileSync(BACKUP, 'utf8'))) await setDoc(doc(db, 'inventorySnapshots', b.id), b.data);
  console.log('되돌렸다.');
  process.exit(0);
}

const rows = (await getDocs(collection(db, 'inventorySnapshots'))).docs
  .map(d => ({ id: d.id, data: d.data() as any }))
  .filter(r => String(r.data.yearMonth ?? '') === YM);

console.log(`[${mode}] ${YM} 스냅샷 ${rows.length}개`);
for (const r of rows)
  console.log(`  ${r.id.padEnd(28)} 값 ${Math.round(Number(r.data.value)||0).toLocaleString()}원  회사 ${r.data.companyId ?? '(없음)'}  기록 ${String(r.data.recordedAt ?? '').slice(0, 16)}`);
if (!rows.length) { console.log('  지울 게 없다.'); process.exit(0); }
if (mode === 'dry') { console.log('\n--apply 를 붙여야 실제로 지운다.'); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify(rows, null, 2), 'utf8');
for (const r of rows) await deleteDoc(doc(db, 'inventorySnapshots', r.id));
console.log(`\n${rows.length}개 지웠다. backup:`, BACKUP);
console.log('되돌리려면  npx tsx scripts/fix-drop-sep-invsnap.mts --undo');
process.exit(0);
