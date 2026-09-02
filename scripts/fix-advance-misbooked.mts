// 발행과 동시에 수금·지불한 건이 통째로 선수금·선급금으로 앉은 것을 되돌린다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
//   원인: 그 순간 거래처 잔액이 **방금 끊은 전표를 몰라서** 받을 돈이 0으로 보였다.
//         코드는 shared/paymentSplit 로 고쳤다(방금 끊은 전표를 더해 센다).
//         이 스크립트는 이미 들어간 것을 맞춘다.
//
//   판정: 그 자금기록을 뺀 상태의 그 거래처 잔액으로 다시 가른다.
//         그날 갚을 게 정말 없었으면 선급금이 맞으므로 안 건드린다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { buildJournals } from '../src/shared/buildJournals';
import { allPartnerBalances } from '../src/features/admin/cashLedger';
import { splitPayment, owedNow } from '../src/shared/paymentSplit';
import { companyOf } from '../src/shared/types';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-advance-misbooked-backup.json';
const ADV = new Set(['259', '131']);

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('✖ 백업이 없다.'); process.exit(1); }
  for (const before of JSON.parse(readFileSync(BACKUP, 'utf8')).before) {
    const { id, ...rest } = before;
    await setDoc(doc(db, 'cashEntries', id), rest);
  }
  console.log('✅ 되돌림'); process.exit(0);
}

const [ce, st, ac] = await Promise.all([load('cashEntries'), load('issuedStatements'), load('accounts')]);
const hits = ce.filter((e: any) =>
  (e.lines ?? []).some((l: any) => ADV.has(String(l.accountCode)))
  || ADV.has(String(e.accountCode)));

console.log(`\n━━ 선수금·선급금 재판정 ━━  (${APPLY ? '적용' : '미리보기 — 적용하려면 --apply'})\n`);
const before: any[] = [];
const writes: { id: string; patch: any }[] = [];

for (const e of hits.sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)))) {
  const co = companyOf(e);
  const others = ce.filter((x: any) => x.id !== e.id && companyOf(x) === co);
  const { entries } = buildJournals({ statements: st.filter((s: any) => companyOf(s) === co), cashEntries: others, accounts: ac });
  const b = allPartnerBalances(entries).get(e.partnerId);
  const isSale = e.dir === '입금';
  const owed = owedNow(isSale ? b?.receivable : b?.payable, 0);
  const total = Number(e.amount ?? 0);
  const { settled, over } = splitPayment(total, owed);

  //  지금 장부에 적힌 채권·채무 계정 — 상계 줄이 있으면 그 계정을, 없으면 갈래로 정한다
  const payLine = (e.lines ?? []).find((l: any) => !ADV.has(String(l.accountCode)));
  const payCode = payLine?.accountCode ?? (isSale ? '108' : '251');
  const advCode = isSale ? '259' : '131';
  const advNow = (e.lines ?? []).filter((l: any) => ADV.has(String(l.accountCode)))
    .reduce((a: number, l: any) => a + Number(l.amount ?? 0), 0)
    || (ADV.has(String(e.accountCode)) ? total : 0);

  console.log(`${e.date}  ${String(e.partnerName ?? '-').padEnd(14)} ${e.dir} ${won(total).padStart(12)}   그때 ${isSale ? '미수' : '미지급'} ${won(owed).padStart(12)}`);
  if (Math.round(over) === Math.round(advNow)) { console.log(`   ✔ 그대로 둔다 (${isSale ? '선수금' : '선급금'} ${won(advNow)})\n`); continue; }
  console.log(`   상계 ${won(total - advNow).padStart(12)} → ${won(settled).padStart(12)}`);
  console.log(`   ${isSale ? '선수금' : '선급금'} ${won(advNow).padStart(12)} → ${won(over).padStart(12)}\n`);

  //  초과가 없으면 **한 줄짜리 옛 모양**으로 되돌린다 — 목록·분개·수정 어디서도 안 갈린다
  const patch = over > 0
    ? { lines: [
        ...(settled > 0 ? [{ accountCode: payCode, amount: settled, note: isSale ? '미수 상계' : '미지급 상계' }] : []),
        { accountCode: advCode, amount: over, note: isSale ? '초과수금 — 선수금' : '초과지급 — 선급금' },
      ], accountCode: null }
    : { accountCode: payCode, lines: null };
  before.push(e);
  writes.push({ id: e.id, patch });
}

if (!writes.length) { console.log('고칠 게 없다.\n'); process.exit(0); }
if (!APPLY) { console.log(`${writes.length}건이 바뀐다. 적용하려면 --apply\n`); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify({ at: new Date().toISOString(), before }, null, 2), 'utf8');
for (const w of writes) {
  const src = before.find(x => x.id === w.id);
  const next: any = { ...src, ...w.patch };
  //  null 로 표시한 건 지운다(Firestore 에 null 을 남기면 옛 값처럼 읽힌다)
  for (const k of Object.keys(w.patch)) if (w.patch[k] === null) delete next[k];
  const { id, ...rest } = next;
  await setDoc(doc(db, 'cashEntries', id), rest);
}
console.log(`✅ ${writes.length}건 고쳤다.  백업: ${BACKUP}  (되돌리기: --undo)\n`);
process.exit(0);
