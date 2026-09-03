/**
 * 전표번호가 비어 있는 자금줄에 번호를 채운다.
 *
 * 246개 중 **220개**가 비어 있었다(전부 8월). 거래처원장에서 전표번호로 그 전표를
 * 찾아가는데, 비어 있으면 누를 게 없다(2026-09-03 사장님).
 *
 * 규칙은 전표와 같다 — **그날 쓰인 가장 큰 번호 + 1**(`nextDocNo`).
 * 그날 이미 번호가 있는 줄은 안 건드리고, 그 번호들을 피해서 채운다.
 * 만든 순서(id 에 박힌 ms)대로 매긴다 — 원장에서 서는 순서와 같아진다.
 *
 * **날짜·금액·계정은 안 바뀐다.** 비어 있던 칸을 채우는 것뿐이다.
 *
 *   --dry (기본) / --apply / --undo
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, deleteField } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nextDocNo } from '../src/shared/voucherStamp';

const BACKUP = fileURLToPath(new URL('./fix-cash-docno-backup.json', import.meta.url));
const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--undo') ? 'undo' : 'dry';
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (mode === 'undo') {
  if (!existsSync(BACKUP)) { console.log('되돌릴 backup 이 없다.'); process.exit(1); }
  for (const b of JSON.parse(readFileSync(BACKUP, 'utf8'))) await updateDoc(doc(db, 'cashEntries', b.id), { docNo: deleteField() });
  console.log('되돌렸다(번호를 다시 비웠다).'); process.exit(0);
}

const ce = (await getDocs(collection(db, 'cashEntries'))).docs.map(d => ({ id: d.id, ...(d.data() as any) }));
const msOf = (id: string) => { const m = /(\d{13})/.exec(id ?? ''); return m ? Number(m[1]) : 0; };

//  날짜별로 이미 쓰인 번호를 들고 시작한다
const 그날 = new Map<string, { docNo?: string }[]>();
for (const e of ce as any[]) {
  const d = String(e.date ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
  (그날.get(d) ?? 그날.set(d, []).get(d)!).push({ docNo: e.docNo });
}

const 채울 = (ce as any[])
  .filter(e => !e.docNo && /^\d{4}-\d{2}-\d{2}$/.test(String(e.date ?? '').slice(0, 10)))
  .sort((a, b) => msOf(a.id) - msOf(b.id));   // 만든 순서대로

const 결과: { id: string; date: string; docNo: string; note: string }[] = [];
for (const e of 채울) {
  const d = String(e.date).slice(0, 10);
  const 목록 = 그날.get(d)!;
  const no = nextDocNo(d, 목록);
  목록.push({ docNo: no });                    // 다음 것이 이걸 보고 피한다
  결과.push({ id: e.id, date: d, docNo: no, note: String(e.note ?? '').slice(0, 24) });
}

console.log(`[${mode}] 자금줄 ${ce.length}개 · 번호가 빈 것 ${채울.length}개`);
for (const r of 결과.slice(0, 10)) console.log(`  ${r.date}  ${r.docNo.padEnd(12)} ${r.note}`);
if (결과.length > 10) console.log(`  … 그 밖 ${결과.length - 10}개`);
if (!결과.length) { console.log('  채울 게 없다.'); process.exit(0); }
if (mode === 'dry') { console.log('\n--apply 를 붙여야 실제로 채운다.'); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify(결과, null, 2), 'utf8');
for (const r of 결과) await updateDoc(doc(db, 'cashEntries', r.id), { docNo: r.docNo });
console.log(`\n${결과.length}개 채웠다. backup:`, BACKUP);
console.log('되돌리려면  npx tsx scripts/fix-cash-docno.mts --undo');
process.exit(0);
