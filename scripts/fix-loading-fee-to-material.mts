// 상차비를 잡손실(980) → 원료매입(500)으로 돌린다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 상차비는 참깨를 들여오는 데 든 **취득부대비용**이다. 원료 원가에 얹히는 게 맞고,
// 잡손실(영업외비용)로 빠지면 재료비가 그만큼 적게, 영업외비용이 그만큼 크게 잡힌다.
// 금액·과세는 그대로 두고 계정만 바꾼다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { statementBlockReason } from '../src/shared/statementGuard';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-loading-fee-to-material-backup.json';

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

const stmts = await load('issuedStatements');
const targets = stmts.filter((s: any) => (s.items ?? []).some((i: any) => String(i.accountCode) === '980'));
if (!targets.length) { console.log('980이 붙은 전표가 없다.'); process.exit(0); }

const backup: any[] = [], writes: { id: string; data: any }[] = [];
for (const s of targets) {
  const hit = (s.items ?? []).filter((i: any) => String(i.accountCode) === '980');
  console.log(`■ ${s.tradeDate} ${s.docNo} ${s.partnerName}  전표 ${Number(s.totalAmount).toLocaleString()}원`);
  for (const i of hit) console.log(`   "${i.name}" 980 잡손실 ${Number(i.total).toLocaleString()} → 500 원료매입`);
  const next = { ...s, items: (s.items ?? []).map((i: any) => (String(i.accountCode) === '980' ? { ...i, accountCode: '500' } : i)) };
  const reason = statementBlockReason(next);
  console.log(`   검사: ${reason ? '✖ ' + reason : '✅ 통과'}`);
  if (reason) process.exit(1);
  backup.push(s);
  const { id, ...data } = next;
  writes.push({ id, data });
}
const moved = targets.flatMap((s: any) => (s.items ?? []).filter((i: any) => String(i.accountCode) === '980'))
  .reduce((a: number, i: any) => a + Number(i.total ?? 0), 0);
console.log(`\n옮기는 금액 합계 ${Math.round(moved).toLocaleString()}원 — 잡손실에서 빠지고 재료비로 간다`);

if (!APPLY) { console.log('\n(--dry) 적용하려면 --apply'); process.exit(0); }
writeFileSync(BACKUP, JSON.stringify(backup, null, 2), 'utf8');
for (const w of writes) await setDoc(doc(db, 'issuedStatements', w.id), w.data);
console.log(`\n✅ ${writes.length}건 고쳤다.  되돌리기: npx tsx scripts/fix-loading-fee-to-material.mts --undo`);
process.exit(0);
