// 풍회 8월 급여를 발생주의로 바꾼다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 사장님 지시: "기존 급여 전표 280만원이랑 350만원을 미지급급여 출금으로 바꾸고
//               말일에 급여 두건 발생을 새로 만들어줘".
//
// 지금은 나갈 때 바로 비용으로 잡혀 있다 — (차) 515 급여 / (대) 통장.
// 태백처럼 **말일에 비용을 세우고 지급은 그 부채를 터는** 방식으로 바꾼다:
//
//   7/31 기초   (차) 375 이월이익잉여금 / (대) 263 미지급급여 6,300,000
//   8/13·8/18   (차) 263 미지급급여    / (대) 103 보통예금     ← 7월분을 갚는 것. 계정만 515→263
//   8/31 발생   (차) 515 급여         / (대) 263 미지급급여   ← 8월분. 9월에 나간다
//
// 고리가 이렇게 돈다:
//   263 = 기초 6,300,000 − 8월 지급 6,300,000 + 8월 발생 6,300,000 = 6,300,000 (9월에 나갈 몫)
// 8월에 나간 돈은 7월 인건비라 8월 손익에 안 잡히고, 8월 인건비는 8/31에 온전히 선다.
//
// ⚠ 원천공제는 0으로 둔다 — 뗀 게 있으면 gross가 더 크고 그 몫이 254 예수금으로 서야 한다.
//   공제액을 알려주시면 다시 세운다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { statementBlockReason } from '../src/shared/statementGuard';
import { journalizeTransfer } from '../src/shared/autoJournal';
import { nextDocNo, stampFor } from '../src/shared/voucherStamp';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-punghoe-payroll-0831-backup.json';
const DATE = '2026-08-31';

const OPEN_DATE = '2026-07-31';
const OPEN_ID = 'stmt-open-punghoe-미지급급여';
const OPEN_AMT = 6_300_000;

/** 계정만 바꿀 자금전표 — [id, 라벨] */
const PAYS: [string, string, number][] = [
  ['cash-1786602897488-g', '우용', 2_800_000],
  ['cash-ph-exp-20260818-3', '(이름 미기재)', 3_500_000],
];

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8')) as { cash: any[]; made: string[] };
  for (const e of prev.cash) { const { id, ...rest } = e; await setDoc(doc(db, 'cashEntries', id), rest); }
  for (const id of prev.made) await deleteDoc(doc(db, 'issuedStatements', id));
  console.log(`✅ 자금전표 ${prev.cash.length}건 복원 · 발생전표 ${prev.made.length}건 삭제`);
  process.exit(0);
}

const [cash, stmts, codes] = await Promise.all([load('cashEntries'), load('issuedStatements'), load('accountCodes')]);
const co = (x: any) => x?.companyId ?? 'taebaek';
const nm = new Map(codes.map((c: any) => [String(c.code), c.name]));
const phStmts = stmts.filter((s: any) => co(s) === 'punghoe');

// ── ① 자금전표 계정 바꾸기 ──
console.log('── ① 지급 전표 — 계정 515 급여 → 263 미지급급여 ──');
const cashBackup: any[] = [], cashWrites: { id: string; data: any }[] = [];
for (const [id, who, amt] of PAYS) {
  const e = cash.find((x: any) => x.id === id);
  if (!e) { console.error(`✖ 못 찾음: ${id}`); process.exit(1); }
  if (Math.round(Number(e.amount)) !== amt) { console.error(`✖ ${id} 금액이 다르다: ${e.amount} ≠ ${amt}`); process.exit(1); }
  if (String(e.accountCode) === '263') { console.log(`   ${e.date} ${who} — 이미 263이다. 건너뛴다`); continue; }
  console.log(`   ${e.date} ${String(who).padEnd(12)} ${amt.toLocaleString().padStart(11)}  ${e.accountCode} ${nm.get(String(e.accountCode))} → 263 미지급급여`);
  cashBackup.push(e);
  const { id: _i, ...rest } = e;
  cashWrites.push({ id, data: { ...rest, accountCode: '263', note: `${e.note ?? '급여'} (미지급급여 상계)` } });
}

// ── ② 7/31 기초 미지급급여 ──
console.log(`\n── ② ${OPEN_DATE} 기초 미지급급여 ──`);
const line = (name: string, code: string, side: '차변' | '대변', amt: number) => ({
  name, spec: '', qty: 1, price: amt, supply: amt, tax: 0, total: amt,
  isTaxExempt: true, accountCode: code, side,
});
const pool: { docNo?: string }[] = [...phStmts];
const made: { id: string; data: any }[] = [];
const normalOf = (c: string) => (codes.find((x: any) => String(x.code) === c)?.normalBalance ?? 'debit') as 'debit' | 'credit';
const show = (v: any) => {
  for (const l of (journalizeTransfer(v, normalOf)?.lines ?? []))
    console.log(`      ${l.accountCode} ${String(nm.get(String(l.accountCode)) ?? '').padEnd(10)} 차 ${String(l.debit ?? 0).padStart(9)}  대 ${String(l.credit ?? 0).padStart(9)}`);
};
if (stmts.some((s: any) => s.id === OPEN_ID)) console.log('   이미 있다. 건너뛴다');
else {
  const docNo = nextDocNo(OPEN_DATE, pool, '기초');
  pool.push({ docNo });
  //  다른 기초 전표와 같은 모양 — 상대는 375 이월이익잉여금이다(자본에서 넘어온 잔액이라)
  const v: any = {
    id: OPEN_ID, companyId: 'punghoe', type: '비용',
    partnerId: '', partnerName: '급여', orderId: '',
    issuedAt: stampFor(OPEN_DATE), tradeDate: OPEN_DATE, docNo,
    totalSupply: OPEN_AMT, totalTax: 0, totalAmount: OPEN_AMT,
    items: [line('기초 미지급급여(이월)', '375', '차변', OPEN_AMT), line('기초 미지급급여(이월)', '263', '대변', OPEN_AMT)],
  };
  const reason = statementBlockReason(v);
  console.log(`   ${OPEN_DATE}  ${docNo}  ${OPEN_AMT.toLocaleString()}   검사 ${reason ? '✖ ' + reason : '✅ 통과'}`);
  if (reason) process.exit(1);
  show(v);
  made.push({ id: OPEN_ID, data: v });
}

// ── ③ 말일 발생 전표 두 건 ──
console.log(`\n── ③ ${DATE} 급여 발생 (대체전표) ──`);
for (const [, who, amt] of PAYS) {
  const id = `stmt-ph-payroll-${DATE.replace(/-/g, '')}-${who === '우용' ? '1' : '2'}`;
  if (stmts.some((s: any) => s.id === id)) { console.log(`   ${who} — 이미 있다. 건너뛴다`); continue; }
  const docNo = nextDocNo(DATE, pool, '급여');
  pool.push({ docNo });
  //  공제가 0이라 미지급급여가 총급여와 같다. 공제가 있으면 254 예수금 줄이 하나 더 선다.
  const v: any = {
    id, companyId: 'punghoe', type: '비용',
    partnerId: '', partnerName: '급여', orderId: '',
    issuedAt: stampFor(DATE), tradeDate: DATE, docNo,
    totalSupply: amt, totalTax: 0, totalAmount: amt,
    items: [line(`급여 · ${who}`, '515', '차변', amt), line('미지급급여', '263', '대변', amt)],
  };
  const reason = statementBlockReason(v);
  console.log(`   ${DATE}  ${docNo}  ${String(who).padEnd(12)} ${amt.toLocaleString().padStart(11)}   검사 ${reason ? '✖ ' + reason : '✅ 통과'}`);
  if (reason) process.exit(1);
  show(v);
  made.push({ id, data: v });
}

const tot = PAYS.reduce((a, [, , x]) => a + x, 0);
console.log(`\n── 263 미지급급여가 도는 고리 ──`);
console.log(`   7/31 기초        + ${OPEN_AMT.toLocaleString().padStart(11)}`);
console.log(`   8/13·8/18 지급   − ${tot.toLocaleString().padStart(11)}   (7월분을 갚은 것)`);
console.log(`   8/31 발생        + ${tot.toLocaleString().padStart(11)}   (8월분, 9월에 나간다)`);
console.log(`   ─────────────────────────────`);
console.log(`   8월말 잔액        = ${OPEN_AMT.toLocaleString().padStart(11)}`);
console.log(`\n   8월에 나간 돈은 7월 인건비라 8월 손익에 안 잡힌다. 8월 인건비는 8/31에 온전히 선다.`);

if (!APPLY) { console.log('\n(--dry) 적용하려면 --apply'); process.exit(0); }
writeFileSync(BACKUP, JSON.stringify({ cash: cashBackup, made: made.map(m => m.id) }, null, 2), 'utf8');
for (const w of cashWrites) await setDoc(doc(db, 'cashEntries', w.id), w.data);
for (const m of made) await setDoc(doc(db, 'issuedStatements', m.id), m.data);
console.log(`\n✅ 지급전표 ${cashWrites.length}건 고치고 발생전표 ${made.length}건 만들었다.`);
console.log('   되돌리기: npx tsx scripts/fix-punghoe-payroll-0831.mts --undo');
process.exit(0);
