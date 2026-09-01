// 풍회 카드대금을 전액 부가세로 — 사장님 확인: "풍회꺼 카드대금은 전부 부가세래".
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 어제 태백 것에 맞춰 부가세·법인세 반반으로 갈랐는데, 풍회는 전액 부가세였다.
// 998 법인세등 줄을 빼고 255 부가세예수금 한 줄로 되돌린다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { statementBlockReason } from '../src/shared/statementGuard';
import { journalizeStatement } from '../src/shared/autoJournal';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-punghoe-card-vat-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  for (const s of JSON.parse(readFileSync(BACKUP, 'utf8')) as any[]) {
    const { id, ...rest } = s; await setDoc(doc(db, 'issuedStatements', id), rest);
  }
  console.log('✅ 복원'); process.exit(0);
}

const [stmts, codes] = await Promise.all([load('issuedStatements'), load('accountCodes')]);
const nm = new Map(codes.map((c: any) => [String(c.code), c.name]));
const co = (x: any) => x?.companyId ?? 'taebaek';

//  풍회 장부에서 카드로 낸 세금 — 거래처가 카드대금이고 세금 계정이 붙은 것
const targets = stmts.filter((s: any) =>
  co(s) === 'punghoe'
  && /카드/.test(String(s.partnerName ?? ''))
  && (s.items ?? []).some((i: any) => ['255', '998', '261', '650'].includes(String(i.accountCode))));

if (!targets.length) { console.log('대상이 없다.'); process.exit(0); }

const backup: any[] = [], writes: { id: string; data: any }[] = [];
for (const s of targets) {
  const total = Math.round(Number(s.totalAmount ?? 0));
  console.log(`■ ${s.tradeDate} ${s.docNo} ${s.partnerName} ${total.toLocaleString()}원`);
  for (const i of (s.items ?? []))
    console.log(`   전: ${i.accountCode} ${nm.get(String(i.accountCode))} ${Number(i.total).toLocaleString()}`);
  const line = {
    name: '카드 세금납부 · 부가세', spec: '', qty: 1, price: total,
    supply: total, tax: 0, total, isTaxExempt: true, accountCode: '255',
  };
  const next = { ...s, items: [line], totalSupply: total, totalTax: 0, totalAmount: total };
  const reason = statementBlockReason(next);
  console.log(`   후: 255 부가세예수금 ${total.toLocaleString()}   검사 ${reason ? '✖ ' + reason : '✅ 통과'}`);
  if (reason) process.exit(1);
  for (const l of journalizeStatement(next as any)?.lines ?? [])
    console.log(`      ${l.accountCode} ${String(nm.get(String(l.accountCode)) ?? '').padEnd(10)} 차 ${String(l.debit ?? 0).padStart(9)}  대 ${String(l.credit ?? 0).padStart(9)}`);
  backup.push(s);
  const { id, ...data } = next;
  writes.push({ id, data });
}

if (!APPLY) { console.log('\n(--dry) 적용하려면 --apply'); process.exit(0); }
writeFileSync(BACKUP, JSON.stringify(backup, null, 2), 'utf8');
for (const w of writes) await setDoc(doc(db, 'issuedStatements', w.id), w.data);
console.log(`\n✅ ${writes.length}건 고쳤다.  되돌리기: npx tsx scripts/fix-punghoe-card-vat.mts --undo`);
process.exit(0);
