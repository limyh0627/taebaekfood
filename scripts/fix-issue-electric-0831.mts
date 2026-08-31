// 전기세 매입전표 1건 발행 — 한전, 2026-08-31, 1,233,780원.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 화면에서 저장이 막혀 있던 동안(statementGuard 오판) 못 끊은 건이다.
// 분개: (차) 520 전기세 1,233,780 / (대) 251 외상매입금 1,233,780
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { statementBlockReason } from '../src/shared/statementGuard';
import { journalizeStatement } from '../src/shared/autoJournal';
import { nextDocNo } from '../src/shared/voucherStamp';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const ID = 'stmt-elec-20260831';
const DATE = '2026-08-31', AMOUNT = 1233780;

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) { await deleteDoc(doc(db, 'issuedStatements', ID)); console.log('✅ 삭제'); process.exit(0); }

const [stmts, partners] = await Promise.all([load('issuedStatements'), load('partners')]);
//  태백 장부의 한전 — 풍회 사본(c-…-punghoe)이 아니라 원본이다
const p = partners.find((x: any) => String(x.name) === '한전' && (x.companyId ?? 'taebaek') === 'taebaek');
if (!p) { console.error('한전(태백)을 못 찾았다.'); process.exit(1); }
if (stmts.some((s: any) => s.id === ID)) { console.log('이미 발행돼 있다.'); process.exit(0); }

//  같은 날 같은 금액이 이미 있나 — 중복 발행을 막는다
const dup = stmts.find((s: any) => s.partnerId === p.id && s.tradeDate === DATE && Math.abs(Number(s.totalAmount) - AMOUNT) < 1);
if (dup) { console.log(`⚠ 이미 같은 전표가 있다: ${dup.docNo} ${Number(dup.totalAmount).toLocaleString()}원 (${dup.id})`); process.exit(1); }

const docNo = nextDocNo(DATE, stmts as any);
const stmt = {
  id: ID, companyId: 'taebaek',
  issuedAt: `${DATE}T23:59:59.000Z`, tradeDate: DATE,
  type: '매입', partnerId: p.id, partnerName: p.name, orderId: '', docNo,
  totalSupply: AMOUNT, totalTax: 0, totalAmount: AMOUNT,
  items: [{
    name: '전기세', spec: '', qty: 1, price: AMOUNT,
    supply: AMOUNT, tax: 0, total: AMOUNT, isTaxExempt: true, accountCode: '520',
  }],
};

const why = statementBlockReason(stmt as any);
const je = journalizeStatement(stmt as any);
console.log(`\n═══ ${APPLY ? '🔴 적용(--apply)' : '🟢 미리보기(dry)'} ═══\n`);
console.log(`   ${DATE}  매입  ${p.name}  ${docNo}  ${AMOUNT.toLocaleString()}원`);
console.log(`   검사: ${why ?? '✅ 통과'}`);
console.log(`   분개:`);
for (const l of (je?.lines ?? [])) console.log(`      ${l.accountCode}  차 ${String(l.debit ?? 0).padStart(10)}  대 ${String(l.credit ?? 0).padStart(10)}`);
if (why || !je) { console.error('\n검사에 걸린다 — 만들지 않는다.'); process.exit(1); }
console.log(`\n되돌리기: npx tsx scripts/fix-issue-electric-0831.mts --undo`);
if (!APPLY) { console.log(`\n적용: npx tsx scripts/fix-issue-electric-0831.mts --apply`); process.exit(0); }

await setDoc(doc(db, 'issuedStatements', ID), stmt);
console.log(`\n✅ 발행 (${ID})`);
process.exit(0);
