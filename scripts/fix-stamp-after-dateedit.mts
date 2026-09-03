/**
 * 거래일을 고친 뒤 시각 도장이 안 따라간 전표·자금줄을 다시 찍는다.
 *
 * 발행할 때는 `stampFor(tradeDate)` 로 제대로 찍었는데(소급 23:59:59 · 예약 00:00:00 · 당일 지금),
 * **수정 경로에는 그게 안 붙어 있었다.** 그래서 날짜를 옮긴 전표가 옛 날짜의 시각을 달고 있다.
 * 코드는 고쳤고(shared/statementEdit), 이건 이미 어긋난 것을 맞추는 일이다.
 *
 * `issuedAt`·`createdAt` 은 **그날 안에서 어디 설 것인가**만 뜻한다(rowStamp 가 날짜는
 * tradeDate 에서, 시각은 여기서 가져다 붙인다). 신원이 아니라 정렬 기준이라 다시 찍어도 잃는 게 없다.
 * **전표번호(docNo)는 안 건드린다** — 인쇄해서 건넨 종이에 박혀 있을 수 있다.
 *
 * **8월 전표는 절대 안 건드린다** — 사장님이 손으로 다 맞춰 둔 것이다(2026-09-03 지시).
 * 오류로 보이는 것도 그대로 둔다. 기본 시작달이 2026-09 인 이유다.
 *
 *   --from=YYYY-MM  이 달부터만 본다 (기본 2026-09)
 *   --dry (기본)  무엇이 어떻게 바뀌는지만 보여준다
 *   --apply       고친다. 고치기 전 원본을 backup json 으로 남긴다
 *   --undo        backup json 으로 되돌린다
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stampFor, timeOfLocal } from '../src/shared/voucherStamp';

const BACKUP = fileURLToPath(new URL('./fix-stamp-after-dateedit-backup.json', import.meta.url));
const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--undo') ? 'undo' : 'dry';
//  **8월 이전은 손대지 않는다.** 사장님이 맞춰 둔 것이라 오류로 보여도 그대로 둔다.
const FROM = (process.argv.find(a => a.startsWith('--from='))?.slice(7)) || '2026-09';
if (FROM < '2026-09') { console.log('8월 이전은 손대지 않기로 했다(사장님 지시). --from 은 2026-09 이상만.'); process.exit(1); }

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const grab = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...(d.data() as any) }));

if (mode === 'undo') {
  if (!existsSync(BACKUP)) { console.log('되돌릴 backup 이 없다:', BACKUP); process.exit(1); }
  for (const b of JSON.parse(readFileSync(BACKUP, 'utf8'))) await updateDoc(doc(db, b.col, b.id), { [b.key]: b.was });
  console.log('되돌렸다.');
  process.exit(0);
}

const msOf = (id: string) => { const m = /(\d{13})/.exec(id ?? ''); return m ? Number(m[1]) : 0; };
/**
 * **기준은 '지금'이 아니라 그 줄을 만든 순간이다.**
 * 지금 기준으로 다시 찍으면, 9/1에 제때 잘 찍힌 줄까지 이제 지난 날짜가 됐다고
 * 23:59:59 로 밀어 버린다 — 그날 안의 순서가 통째로 뭉개진다.
 */
const 규칙적용 = new Date('2026-08-21T14:09:30+09:00').getTime();   // 커밋 1a421f5
const 고칠것: any[] = [];
let 못봄 = 0, 규칙전 = 0, 이전달 = 0;
const 손안댐: any[] = [];

const 훑기 = (rows: any[], col: string, dateKey: string, isoKey: string) => {
  for (const x of rows) {
    const d = String(x[dateKey] ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !x[isoKey]) continue;
    if (d.slice(0, 7) < FROM) { 이전달++; continue; }      // 8월은 그대로 둔다
    const ms = msOf(x.id);
    if (!ms) { 못봄++; continue; }                      // 만든 순간을 모르면 손대지 않는다
    if (ms < 규칙적용) { 규칙전++; continue; }            // 규칙이 없던 시절 것은 그대로 둔다
    const 새도장 = stampFor(d, new Date(ms));
    if (timeOfLocal(새도장) === timeOfLocal(x[isoKey]) && String(새도장).slice(0, 10) === String(x[isoKey]).slice(0, 10)) continue;
    //  **18:00:00 은 손대지 않는다.** 코드에도 문서에도 그렇게 찍는 자리가 없다 —
    //  사람이 일부러 박아 둔 값으로 보인다(태백↔풍회 입금 넷). 뜻을 모르는 값은 안 덮는다.
    if (timeOfLocal(x[isoKey]) === '18:00:00') { 손안댐.push({ col, label: `${x.docNo ?? x.id} ${x[dateKey]} ${String(x.partnerName ?? '').slice(0, 12)}`, to: 새도장 }); continue; }
    고칠것.push({ col, id: x.id, key: isoKey, was: x[isoKey], to: 새도장, d,
      label: `${x.docNo ?? x.id} ${x[dateKey]} ${x.type ?? x.dir ?? ''} ${String(x.partnerName ?? x.memo ?? '').slice(0, 14)}`,
      만든: new Date(ms).toLocaleString('sv-SE') });
  }
};
훑기(await grab('issuedStatements'), 'issuedStatements', 'tradeDate', 'issuedAt');
훑기(await grab('cashEntries'), 'cashEntries', 'date', 'createdAt');

console.log(`[${mode}] 도장이 거래일과 안 맞는 줄 ${고칠것.length}개`);
console.log(`  (건드리지 않음 — ${FROM} 이전 ${이전달}줄, 만든 순간 모름 ${못봄}, 규칙 붙기 전 ${규칙전})`);
for (const x of 고칠것)
  console.log(`  ${x.col === 'cashEntries' ? '자금' : '전표'} ${x.label.padEnd(44)} 만든 ${x.만든}  ${timeOfLocal(x.was)} → ${timeOfLocal(x.to)}`);
if (손안댐.length) {
  console.log(`
  ** 18:00:00 이라 손대지 않은 줄 ${손안댐.length}개 — 뜻을 모르는 값이라 사장님 확인이 필요하다 **`);
  for (const x of 손안댐) console.log(`     ${x.label}  (규칙대로면 ${timeOfLocal(x.to)})`);
}
if (mode === 'dry') { console.log('\n--apply 를 붙여야 실제로 고친다.'); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify(고칠것.map(x => ({ col: x.col, id: x.id, key: x.key, was: x.was })), null, 2), 'utf8');
for (const x of 고칠것) await updateDoc(doc(db, x.col, x.id), { [x.key]: x.to });
console.log(`\n${고칠것.length}개 고쳤다. backup:`, BACKUP);
console.log('되돌리려면  npx tsx scripts/fix-stamp-after-dateedit.mts --undo');
process.exit(0);
