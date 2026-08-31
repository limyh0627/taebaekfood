// 차할부금 템플릿(매달 10일 470,280) + 8월 적금 전표 1건.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 차를 **할부로 산 것**이라 상환이지 비용이 아니다. 통장에서 한 번 나가지만 두 줄로 끊는다.
//   (차) 253 미지급금  440,000     ← 부채가 준다 (재무상태표)
//   (차) 951 이자비용    30,280     ← 손익
//   (대) 통장          470,280
//
// ⚠ 원금 440,000 / 이자 30,280 은 **사장님이 확인해 주신 값이 아니라 예시로 든 갈래**다.
//   실제 상환표가 다르면 템플릿에서 원금·이자만 고치면 된다(합계는 따라 바뀐다).
//
// ⚠ 지금 장부에 차량(208)도 할부 부채(253)도 없다. 취득 전표를 안 세운 채 갚기만 하면
//   253이 음수로 파고든다. 취득가·할부 잔액이 정해지면 그때 한 번 세워야 한다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { buildStatementVoucher } from '../src/shared/autoVoucher';
import { statementBlockReason } from '../src/shared/statementGuard';
import { journalizeStatement } from '../src/shared/autoJournal';
import { nextDocNo } from '../src/shared/voucherStamp';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-car-installment-backup.json';

const CAR = {
  id: 'fct-car-installment', kind: 'voucher',
  name: '차할부금', mode: '상환', dir: '출금',
  loanCode: '253', principal: 440000, interest: 30280, amount: 470280,
  issueDay: 10, autoIssue: true,
  group: '고정비', category: '기타', active: false, hidden: false,
} as any;

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8')) as { tpl?: string; stmt?: string };
  if (prev.tpl) await deleteDoc(doc(db, 'fixedCostTemplates', prev.tpl));
  if (prev.stmt) await deleteDoc(doc(db, 'issuedStatements', prev.stmt));
  console.log('✅ 되돌림');
  process.exit(0);
}

const [tpls, stmts, codes] = await Promise.all([load('fixedCostTemplates'), load('issuedStatements'), load('accountCodes')]);
const nm = new Map(codes.map((c: any) => [String(c.code), c.name]));

// ── ① 차할부금 템플릿 ──
const tplNew = !tpls.some((t: any) => t.id === CAR.id);
console.log('── ① 차할부금 템플릿 ──');
if (!tplNew) console.log('  이미 있다. 건너뛴다');
else {
  console.log(`  매달 ${CAR.issueDay}일 · 출금 · 합계 ${CAR.amount.toLocaleString()}원`);
  console.log(`     원금 ${CAR.principal.toLocaleString()}  ${CAR.loanCode} ${nm.get(CAR.loanCode)}`);
  console.log(`     이자 ${CAR.interest.toLocaleString()}  951 ${nm.get('951')}`);
  if (CAR.principal + CAR.interest !== CAR.amount) { console.error('✖ 원금+이자가 합계와 다르다.'); process.exit(1); }
}

// ── ② 8월 적금 전표 ──
console.log('\n── ② 적금 전표 (8월) ──');
const sav = tpls.find((t: any) => t.id === 'fct-savings-suhyup');
if (!sav) { console.error('✖ 적금 템플릿이 없다. fix-add-voucher-templates.mts 를 먼저.'); process.exit(1); }
const v = buildStatementVoucher(sav as any, '2026-08', { docNo: '', accountName: nm.get(sav.accountCode) });
const already = stmts.some((s: any) => s.id === v.id);
let stmtId: string | null = null;
if (already) console.log('  이미 있다. 건너뛴다');
else {
  const docNo = nextDocNo(v.tradeDate, stmts);
  const full = { ...v, docNo } as any;
  const reason = statementBlockReason(full);
  console.log(`  ${full.tradeDate}  ${full.type}  ${full.partnerName}  ${docNo}  ${Number(full.totalAmount).toLocaleString()}원`);
  console.log(`  검사: ${reason ? '✖ ' + reason : '✅ 통과'}`);
  if (reason) process.exit(1);
  for (const l of journalizeStatement(full)?.lines ?? [])
    console.log(`     ${l.accountCode} ${String(nm.get(String(l.accountCode)) ?? '').padEnd(8)} 차 ${String(l.debit ?? 0).padStart(9)}  대 ${String(l.credit ?? 0).padStart(9)}`);
  stmtId = full.id;
  if (APPLY) {
    writeFileSync(BACKUP, JSON.stringify({ tpl: tplNew ? CAR.id : undefined, stmt: stmtId, at: new Date().toISOString() }, null, 2), 'utf8');
    await setDoc(doc(db, 'issuedStatements', full.id), full);
  }
}

if (!APPLY) { console.log('\n(--dry) 적용하려면 --apply'); process.exit(0); }
if (tplNew) {
  if (!existsSync(BACKUP)) writeFileSync(BACKUP, JSON.stringify({ tpl: CAR.id, stmt: stmtId, at: new Date().toISOString() }, null, 2), 'utf8');
  await setDoc(doc(db, 'fixedCostTemplates', CAR.id), CAR);
}
console.log('\n✅ 적용.  되돌리기: npx tsx scripts/fix-car-installment.mts --undo');
process.exit(0);
