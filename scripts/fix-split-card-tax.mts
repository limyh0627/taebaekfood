// 카드로 낸 세금 전표를 반반 가른다 — 부가세 / 소득세(태백) · 법인세(풍회).
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 지금은 셋 다 650 카드대금 한 줄이다. 카드대금은 **결제 수단**이지 성격이 아니다.
// 세금은 성격이 셋으로 갈린다:
//   부가세  255 부가세예수금   받아 뒀던 걸 내는 것 (부채 감소)
//   소득세  338 인출금        개인사업자 종합소득세는 사업 비용이 아니다
//   법인세  998 법인세등      법인은 비용이다 (계정 신설)
// 앱의 '세금납부' 템플릿(mode:'세금')이 쓰는 계정과 같다 — VAT_CODE 255 / DRAW_CODE 338.
//
// 풍회 건은 **과세로 잡혀 있어** 부가세대급금 282,727이 붙어 있다. 세금 납부에 매입세액이
// 붙을 리 없다 — 면세로 바꾼다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { statementBlockReason } from '../src/shared/statementGuard';
import { journalizeStatement } from '../src/shared/autoJournal';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-split-card-tax-backup.json';

const CORP = { id: 'ac-998', code: '998', name: '법인세등', type: '자산', normalBalance: 'debit', isCash: false, groupId: 'ag-other-expense' };
//  type은 아래에서 '비용'으로 덮는다 — 위 리터럴은 모양만 맞춘 것
CORP.type = '비용';

const JOBS = [
  { id: 'stmt-1787211610899', label: '태백 8/20', second: { code: '338', name: '소득세' } },
  { id: 'stmt-1788162755035', label: '태백 8/31', second: { code: '338', name: '소득세' } },
  { id: 'stmt-1787559245559', label: '풍회 8/24', second: { code: '998', name: '법인세' } },
];

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8')) as { stmts: any[]; acct?: string };
  for (const s of prev.stmts) { const { id, ...rest } = s; await setDoc(doc(db, 'issuedStatements', id), rest); }
  if (prev.acct) await deleteDoc(doc(db, 'accountCodes', prev.acct));
  console.log(`✅ 전표 ${prev.stmts.length}건 되돌림${prev.acct ? ' · 998 삭제' : ''}`);
  process.exit(0);
}

const [stmts, codes] = await Promise.all([load('issuedStatements'), load('accountCodes')]);
const nm = new Map(codes.map((c: any) => [String(c.code), c.name]));
const needCorp = !codes.some((c: any) => String(c.code) === '998');
if (needCorp) { console.log(`── 계정 신설: 998 법인세등 (비용 · ${CORP.groupId})\n`); nm.set('998', '법인세등'); }

const backup: any[] = [];
const writes: { id: string; data: any }[] = [];

for (const j of JOBS) {
  const s = stmts.find((x: any) => x.id === j.id);
  if (!s) { console.error(`✖ ${j.label}: 전표를 못 찾았다 (${j.id})`); process.exit(1); }
  const total = Math.round(Number(s.totalAmount ?? 0));
  const half = Math.round(total / 2);
  const rest = total - half;                      // 홀수면 1원은 뒷줄로
  const line = (name: string, code: string, amt: number) => ({
    name, spec: '', qty: 1, price: amt, supply: amt, tax: 0, total: amt,
    isTaxExempt: true, accountCode: code,          // 세금 납부엔 매입세액이 없다
  });
  const next = {
    ...s,
    items: [line('카드 세금납부 · 부가세', '255', half), line(`카드 세금납부 · ${j.second.name}`, j.second.code, rest)],
    totalSupply: total, totalTax: 0, totalAmount: total,
  };
  const reason = statementBlockReason(next);
  console.log(`■ ${j.label}  ${s.tradeDate}  ${s.docNo}  ${total.toLocaleString()}원`);
  console.log(`   전: "${(s.items ?? [])[0]?.name}" 계정 ${(s.items ?? [])[0]?.accountCode} ${(s.items ?? [])[0]?.isTaxExempt ? '면세' : '과세'}`);
  console.log(`   후: 255 부가세예수금 ${half.toLocaleString()}  ·  ${j.second.code} ${nm.get(j.second.code)} ${rest.toLocaleString()}`);
  console.log(`   검사: ${reason ? '✖ ' + reason : '✅ 통과'}`);
  if (reason) process.exit(1);
  for (const l of journalizeStatement(next as any)?.lines ?? [])
    console.log(`      ${l.accountCode} ${String(nm.get(String(l.accountCode)) ?? '').padEnd(10)} 차 ${String(l.debit ?? 0).padStart(9)}  대 ${String(l.credit ?? 0).padStart(9)}`);
  console.log('');
  backup.push(s);
  const { id, ...data } = next;
  writes.push({ id, data });
}

if (!APPLY) { console.log('(--dry) 적용하려면 --apply'); process.exit(0); }
writeFileSync(BACKUP, JSON.stringify({ stmts: backup, acct: needCorp ? CORP.id : undefined, at: new Date().toISOString() }, null, 2), 'utf8');
if (needCorp) await setDoc(doc(db, 'accountCodes', CORP.id), CORP);
for (const w of writes) await setDoc(doc(db, 'issuedStatements', w.id), w.data);
console.log(`✅ 전표 ${writes.length}건 고쳤다${needCorp ? ' · 998 법인세등 만들었다' : ''}.`);
console.log('   되돌리기: npx tsx scripts/fix-split-card-tax.mts --undo');
process.exit(0);
