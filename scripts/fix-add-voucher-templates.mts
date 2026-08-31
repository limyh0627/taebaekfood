// 전표 템플릿 추가 — ① 할부금(기본 템플릿) ② 적금(수협, 매달 12일 300,000).
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 화면이 읽는 원천은 DB(fixedCostTemplates)다. CASH_TEMPLATES는 시드일 뿐이라
// 코드에만 넣으면 화면에 안 뜬다 — 둘 다 넣는다.
//
// 적금은 taxExempt: true 다. 안 그러면 300,000이 272,727 + 부가세 27,273으로 갈린다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-add-voucher-templates-backup.json';

const NEW: any[] = [
  {
    id: 'fct-builtin-installment', builtin: 'installment', kind: 'voucher',
    name: '할부금', accountCode: '253', dir: '출금', mode: '일반',
    group: '수시', category: '기타', amount: 0, active: false, hidden: false,
  },
  {
    id: 'fct-savings-suhyup', kind: 'voucher',
    name: '적금 (수협)', itemName: '정기적금', accountCode: '106',
    partnerId: 'c-bank-suhyup', partnerName: '수협은행',
    dir: '대체', mode: '일반', group: '고정비', category: '기타',
    amount: 300000, issueDay: 12, autoIssue: true, taxExempt: true,
    active: false, hidden: false,
  },
];

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8')) as { created: string[] };
  for (const id of prev.created) await deleteDoc(doc(db, 'fixedCostTemplates', id));
  console.log(`✅ ${prev.created.length}개 삭제 — 되돌림`);
  process.exit(0);
}

const [tpls, codes, partners] = await Promise.all(
  ['fixedCostTemplates', 'accountCodes', 'partners'].map(async c =>
    (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any))));
const haveT = new Set(tpls.map((t: any) => t.id));
const haveC = new Set(codes.map((c: any) => String(c.code)));
const haveP = new Set(partners.map((p: any) => p.id));

const todo = NEW.filter(n => !haveT.has(n.id));
for (const n of NEW) if (haveT.has(n.id)) console.log(`· ${n.name} — 이미 있다. 건너뛴다`);
for (const n of todo) {
  if (n.accountCode && !haveC.has(n.accountCode)) { console.error(`✖ ${n.name}: 계정 ${n.accountCode}이 없다.`); process.exit(1); }
  if (n.partnerId && !haveP.has(n.partnerId)) { console.error(`✖ ${n.name}: 거래처 ${n.partnerId}가 없다.`); process.exit(1); }
}
if (todo.length === 0) { console.log('만들 게 없다.'); process.exit(0); }

const nm = new Map(codes.map((c: any) => [String(c.code), c.name]));
console.log('\n만들 템플릿:');
for (const n of todo) console.log(
  `  ${n.name.padEnd(10)} ${n.dir}  ${n.accountCode} ${nm.get(n.accountCode) ?? ''}  ` +
  `${n.amount ? Number(n.amount).toLocaleString() + '원' : '금액없음'}  ` +
  `${n.issueDay ? n.issueDay + '일' : ''} ${n.partnerName ?? ''} ${n.taxExempt ? '면세' : ''}`);

if (!APPLY) { console.log('\n(--dry) 적용하려면 --apply'); process.exit(0); }
writeFileSync(BACKUP, JSON.stringify({ created: todo.map(n => n.id), at: new Date().toISOString() }, null, 2), 'utf8');
for (const n of todo) await setDoc(doc(db, 'fixedCostTemplates', n.id), n);
console.log(`\n✅ ${todo.length}개 만들었다.  되돌리기: npx tsx scripts/fix-add-voucher-templates.mts --undo`);
process.exit(0);
