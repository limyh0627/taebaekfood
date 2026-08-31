// 풍회 장부를 태백 장부에 맞춘다 — 사장님 지시 "풍회쪽을 태백에 맞춰, 다른건 신경 쓰지말고".
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 태백이 풍회에 끊은 매입·지불이 기준이다. 풍회 쪽에 없으면 만들고, 태백에 원본이 없는
// 거울(수금)은 지운다. 왜 벌어졌나: 회사이체로 만든 건만 거울이 서고, 그냥 지불로
// 처리한 건은 한쪽에만 섰다. 게다가 거울 셋은 태백 원본이 나중에 지워졌다.
//
//   ① 매출전표 1건   8/28  8,235,000   태백 260828-08 의 짝
//   ② 수금 4건       8/04·8/11·8/24·8/31  합 13,010,000
//   ③ 거울 3건 삭제  8/07·8/11·8/18       합  7,612,719  (태백 원본 없음)
//
// 맞춰지고 나면: 매출(풍회) 66,189,600 = 매입(태백),  수금(풍회) 61,030,000 = 지불(태백)
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { statementBlockReason } from '../src/shared/statementGuard';
import { journalizeStatement } from '../src/shared/autoJournal';
import { nextDocNo } from '../src/shared/voucherStamp';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-punghoe-mirror-taebaek-backup.json';
const PID = 'c-taebaek-food', PNAME = '태백식품';

/** 태백 지불 → 풍회 수금으로 세울 것 */
const PAYS = [
  { date: '2026-08-04', amount: 6_200_000, src: 'cash-1787913912938' },
  { date: '2026-08-11', amount: 3_200_000, src: 'cash-1787914072010' },
  { date: '2026-08-24', amount: 3_110_000, src: 'cash-1787914131787' },
  { date: '2026-08-31', amount:   500_000, src: 'cash-1788162769092' },
];
/** 태백에 원본이 없는 거울 — 지운다 */
const DROP = [
  'cash-ph-mirror-cash-1786083076174-i',
  'cash-ph-mirror-cash-1786430851802',
  'cash-ph-mirror-cash-1787040257623',
];
const SRC_STMT = 'stmt-1787913261508';           // 태백 260828-08
const NEW_STMT = 'stmt-ph-mirror-260828-08';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8'));
  for (const id of prev.created ?? []) await deleteDoc(doc(db, id.startsWith('stmt') ? 'issuedStatements' : 'cashEntries', id));
  for (const e of prev.dropped ?? []) { const { id, ...d } = e; await setDoc(doc(db, 'cashEntries', id), d); }
  console.log(`✅ 만든 것 ${(prev.created ?? []).length}건 삭제 · 지운 거울 ${(prev.dropped ?? []).length}건 복원`);
  process.exit(0);
}

const [stmts, cash] = await Promise.all([load('issuedStatements'), load('cashEntries')]);
const co = (x: any) => x?.companyId ?? 'taebaek';
const phStmts = stmts.filter((s: any) => co(s) === 'punghoe');
const phCash = cash.filter((e: any) => co(e) === 'punghoe');
const pool = [...phStmts, ...phCash];

const created: string[] = [];
const writes: { col: string; id: string; data: any }[] = [];

// ── ① 매출전표 ──
console.log('── ① 8/28 매출전표 ──');
const src = stmts.find((s: any) => s.id === SRC_STMT);
if (!src) { console.error('✖ 태백 260828-08 을 못 찾았다.'); process.exit(1); }
if (stmts.some((s: any) => s.id === NEW_STMT)) console.log('   이미 있다. 건너뛴다');
else {
  //  풍회 쪽은 매출이다 — 품목 계정만 800 일반매출로 바꾸고 금액·과세는 태백 매입과 똑같이 둔다.
  const items = (src.items ?? []).map((i: any) => ({ ...i, accountCode: '800' }));
  const v: any = {
    id: NEW_STMT, companyId: 'punghoe', type: '매출',
    partnerId: PID, partnerName: PNAME,
    tradeDate: src.tradeDate, issuedAt: src.issuedAt, orderId: '',
    docNo: nextDocNo(src.tradeDate, pool),
    totalSupply: src.totalSupply, totalTax: src.totalTax, totalAmount: src.totalAmount,
    items,
  };
  const reason = statementBlockReason(v);
  console.log(`   ${v.tradeDate} 매출 ${PNAME} ${v.docNo} ${Number(v.totalAmount).toLocaleString()}원   검사 ${reason ? '✖ ' + reason : '✅ 통과'}`);
  if (reason) process.exit(1);
  for (const l of journalizeStatement(v)?.lines ?? [])
    console.log(`      ${l.accountCode} 차 ${String(l.debit ?? 0).padStart(9)}  대 ${String(l.credit ?? 0).padStart(9)}`);
  writes.push({ col: 'issuedStatements', id: v.id, data: v }); created.push(v.id);
}

// ── ② 수금 4건 ──
console.log('\n── ② 수금 4건 ──');
const made: { docNo?: string }[] = [];
for (const p of PAYS) {
  const id = `cash-ph-mirror-${p.src}`;
  if (cash.some((e: any) => e.id === id)) { console.log(`   ${p.date} ${p.amount.toLocaleString()} — 이미 있다`); continue; }
  const docNo = nextDocNo(p.date, [...pool, ...made]);
  made.push({ docNo });
  const e: any = {
    id, companyId: 'punghoe', date: p.date, dir: '입금', amount: p.amount,
    accountCode: '108', cashAccountId: '', partnerId: PID, partnerName: PNAME,
    note: '태백식품 수금', docNo, createdAt: `${p.date}T09:00:00.000Z`,
  };
  console.log(`   ${p.date}  입금 ${p.amount.toLocaleString().padStart(12)}  108 외상매출금  ${docNo}`);
  writes.push({ col: 'cashEntries', id, data: e }); created.push(id);
}

// ── ③ 원본 없는 거울 삭제 ──
console.log('\n── ③ 태백에 원본이 없는 거울 삭제 ──');
const dropped: any[] = [];
for (const id of DROP) {
  const e = cash.find((x: any) => x.id === id);
  if (!e) { console.log(`   ${id} — 없다`); continue; }
  const srcId = id.replace(/^cash-ph-mirror-/, '').replace(/-i$/, '');
  if (cash.some((x: any) => x.id === srcId)) { console.error(`   ✖ ${id} — 태백 원본(${srcId})이 살아 있다. 안 지운다`); continue; }
  console.log(`   ${e.date}  ${Number(e.amount).toLocaleString().padStart(12)}  ${e.note ?? ''}`);
  dropped.push(e);
}

if (!APPLY) { console.log('\n(--dry) 적용하려면 --apply'); process.exit(0); }
writeFileSync(BACKUP, JSON.stringify({ created, dropped, at: new Date().toISOString() }, null, 2), 'utf8');
for (const w of writes) await setDoc(doc(db, w.col, w.id), w.data);
for (const e of dropped) await deleteDoc(doc(db, 'cashEntries', e.id));
console.log(`\n✅ 만든 것 ${writes.length}건 · 지운 것 ${dropped.length}건`);
console.log('   되돌리기: npx tsx scripts/fix-punghoe-mirror-taebaek.mts --undo');
process.exit(0);
