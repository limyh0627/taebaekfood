// 적금(수협)을 매입전표 → 자금 출금으로 바로잡는다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 잘못: 템플릿을 dir '대체' + 거래처로 만들어서 매입전표가 됐다.
//         (차) 106 정기적금 / (대) 251 외상매입금
//       251은 재고·물건을 외상으로 샀을 때 서는 부채다. 적금과 아무 상관이 없다.
//       수협은행에 갚을 외상이 생긴 것처럼 잡혀 거래처 미지급금까지 부풀었다.
//
// 바름: 적금은 통장에서 그날 바로 빠진다 — 자금 출금이다.
//         (차) 106 정기적금 / (대) 103 보통예금
//
// 옆의 이자(수협) 템플릿도 같은 모양이라 같은 병이 있다(9/19에 터진다). 그건 따로 여쭙는다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { buildCashVoucher } from '../src/shared/autoVoucher';
import { journalizeCashEntry } from '../src/shared/autoJournal';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-savings-to-cash-backup.json';
const TPL = 'fct-savings-suhyup';
const YM = '2026-08';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8'));
  const { id: tid, ...tdata } = prev.tpl;
  await setDoc(doc(db, 'fixedCostTemplates', tid), tdata);
  if (prev.stmt) { const { id, ...d } = prev.stmt; await setDoc(doc(db, 'issuedStatements', id), d); }
  if (prev.cashId) await deleteDoc(doc(db, 'cashEntries', prev.cashId));
  console.log('✅ 되돌림');
  process.exit(0);
}

const [tpls, stmts, cash, codes] = await Promise.all(
  ['fixedCostTemplates', 'issuedStatements', 'cashEntries', 'accountCodes'].map(load));
const t = tpls.find((x: any) => x.id === TPL);
if (!t) { console.error('✖ 적금 템플릿이 없다.'); process.exit(1); }
const nm = new Map(codes.map((c: any) => [String(c.code), c.name]));

//  거래처는 그대로 둔다 — 106 줄은 채권·채무가 아니라 잔액을 안 흔든다. 누가 받았는지는 남는 게 낫다.
const nextTpl = { ...t, dir: '출금' };
delete (nextTpl as any).taxExempt;   // 자금전표엔 부가세 갈래가 없다

const e = buildCashVoucher(nextTpl as any, YM, { cashAccountId: '' }) as any;
const oldStmt = stmts.find((s: any) => s.id === buildCashVoucher(t as any, YM).id
  || (s.tradeDate === '2026-08-12' && s.partnerId === t.partnerId && Number(s.totalAmount) === Number(t.amount)));

console.log('── 템플릿 ──');
console.log(`   갈래  ${t.dir} → ${nextTpl.dir}`);
console.log(`   매달 ${t.issueDay}일 · ${Number(t.amount).toLocaleString()}원 · ${t.accountCode} ${nm.get(String(t.accountCode))} · ${t.partnerName}`);

console.log('\n── 8월분 전표 ──');
if (oldStmt) {
  console.log(`   지울 매입전표: ${oldStmt.tradeDate} ${oldStmt.docNo} ${Number(oldStmt.totalAmount).toLocaleString()}원`);
  console.log(`      (차) 106 정기적금 / (대) 251 외상매입금   ← 251은 적금과 상관없다`);
} else console.log('   지울 매입전표: 없음');
if (cash.some((x: any) => x.id === e.id)) console.log('   자금전표: 이미 있다');
else {
  console.log(`   만들 자금전표: ${e.date} ${e.dir} ${Number(e.amount).toLocaleString()}원  계정 ${e.accountCode} ${nm.get(String(e.accountCode))}`);
  for (const l of journalizeCashEntry(e)?.lines ?? [])
    console.log(`      ${l.accountCode} ${String(nm.get(String(l.accountCode)) ?? '').padEnd(8)} 차 ${String(l.debit ?? 0).padStart(8)}  대 ${String(l.credit ?? 0).padStart(8)}`);
}

if (!APPLY) { console.log('\n(--dry) 적용하려면 --apply'); process.exit(0); }
writeFileSync(BACKUP, JSON.stringify({ tpl: t, stmt: oldStmt ?? null, cashId: e.id, at: new Date().toISOString() }, null, 2), 'utf8');
const { id: _tid, ...tdata } = nextTpl as any;
await setDoc(doc(db, 'fixedCostTemplates', TPL), tdata);
if (oldStmt) await deleteDoc(doc(db, 'issuedStatements', oldStmt.id));
await setDoc(doc(db, 'cashEntries', e.id), e);
console.log('\n✅ 고쳤다.  되돌리기: npx tsx scripts/fix-savings-to-cash.mts --undo');
process.exit(0);
