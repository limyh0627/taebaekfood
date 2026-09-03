/**
 * 근거가 지워진 지정매칭(settlements)을 치운다.
 *
 * `settlements` 는 "이 수금은 이 전표를 갚은 것"이라는 **연결 기록**이다.
 * 그런데 자금줄(cashEntries)을 지울 때 매달린 연결은 안 지워서 고아가 남는다.
 * 2026-09-03 실측 — 155줄 중 **11줄(38,976,313원)** 이 지워진 자금줄을 가리키고 있었다.
 *
 * 잔액(전표 목록의 미수·미지급)은 `allocatePartnerCash` 가 살아 있는 자금줄만 보므로
 * 멀쩡했다. 그런데 **자금줄을 전표에 매칭하는 창**은 `openBalance` 를 쓰는데 그쪽이
 * 생사를 안 봐서 같은 전표가 두 화면에서 다르게 보였다 —
 *
 *   260827-02 희성실업   전표 목록 1,026만 미지급   매칭 창 186만
 *   260902-04 해피유통    전표 목록      0원        매칭 창 **−995만**
 *
 * 코드는 고쳤다(`openBalance` 도 살아 있는 자금줄만 센다). 이건 남은 찌꺼기를 치우는 일이다.
 * **잔액은 안 바뀐다** — 이미 안 세고 있던 것을 실제로 지우는 것뿐이다.
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

const BACKUP = fileURLToPath(new URL('./fix-orphan-settlements-backup.json', import.meta.url));
const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--undo') ? 'undo' : 'dry';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const grab = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...(d.data() as any) }));

if (mode === 'undo') {
  if (!existsSync(BACKUP)) { console.log('되돌릴 backup 이 없다:', BACKUP); process.exit(1); }
  for (const b of JSON.parse(readFileSync(BACKUP, 'utf8'))) await setDoc(doc(db, 'settlements', b.id), b.data);
  console.log('되돌렸다.');
  process.exit(0);
}

const st: any[] = await grab('issuedStatements');
const ce: any[] = await grab('cashEntries');
const se: any[] = await grab('settlements');
const won = (n: number) => Math.round(n).toLocaleString() + '원';
const cIds = new Set(ce.map(x => x.id));
const sById = new Map(st.map(x => [x.id, x]));

const 고아 = se.filter(x => !cIds.has(x.cashEntryId));
console.log(`[${mode}] 지정매칭 ${se.length}줄 · 근거 자금줄이 없는 것 ${고아.length}줄 · ${won(고아.reduce((a, x) => a + (Number(x.amount) || 0), 0))}`);
for (const x of 고아.sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))) {
  const s: any = sById.get(x.statementId);
  console.log(`  ${won(Number(x.amount) || 0).padStart(14)}  ${s ? `${String(s.docNo ?? '').padEnd(14)} ${s.tradeDate} ${String(s.type).padEnd(3)} ${String(s.partnerName ?? '').slice(0, 16)}` : `(전표도 없음 ${x.statementId})`}`);
}
if (!고아.length) { console.log('  치울 게 없다.'); process.exit(0); }
if (mode === 'dry') { console.log('\n--apply 를 붙여야 실제로 지운다.'); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify(고아.map(x => { const { id, ...data } = x; return { id, data }; }), null, 2), 'utf8');
for (const x of 고아) await deleteDoc(doc(db, 'settlements', x.id));
console.log(`\n${고아.length}줄 지웠다. backup:`, BACKUP);
console.log('되돌리려면  npx tsx scripts/fix-orphan-settlements.mts --undo');
process.exit(0);
