// 미광팩 기초 미지급 전표를 다른 기초 전표와 같은 모양으로 고친다.
//   기본 = --dry (미리보기, 쓰기 없음).  실제 적용 = --apply.  되돌리기 = --undo
//
// 지금:  505 부자재매입 한 줄, side 없음
// 정상:  (차) 375 이월이익잉여금 / (대) 251 외상매입금   ← 기초 미지급 15건이 모두 이 모양
//
// autoJournal은 side 없는 줄을 만나면 **짐작하지 않고 분개를 통째로 안 만든다**(일부러 그렇게 해 뒀다).
// 그래서 이 4,391,800원이 시산표에도 거래처 잔액에도 안 잡혀 있었다.
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const ID_HINT = '기초260731-35';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

// 문서 id를 모르므로 docNo로 찾는다
const { collection, getDocs } = await import('firebase/firestore');
const all = (await getDocs(collection(db, 'issuedStatements'))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const target = all.find((s: any) => s.docNo === ID_HINT);
if (!target) { console.error(`${ID_HINT} 없음 — 중단`); process.exit(1); }

const amt = Number(target.totalAmount ?? 0);
const line = (accountCode: string, side: '차변' | '대변') => ({
  name: '기초 미지급(이월)', spec: '', qty: 1, price: amt,
  supply: amt, tax: 0, total: amt, isTaxExempt: true, accountCode, side,
});
const FIXED = [line('375', '차변'), line('251', '대변')];

console.log(`\n═══ ${UNDO ? '↩ 되돌리기(--undo)' : APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);
console.log(`  ${target.partnerName}  ${target.docNo}  ${amt.toLocaleString()}원  [${target.id}]`);
console.log(`  지금:`);
for (const it of (target.items ?? [])) console.log(`     ${JSON.stringify(it)}`);
console.log(`  ${UNDO ? '되돌릴' : '바꿀'} 모양:`);
for (const it of (UNDO ? (target.items ?? []) : FIXED)) console.log(`     ${it.side ? (it.side === '차변' ? '(차)' : '(대)') : '(side없음)'} ${it.accountCode}  ${Number(it.total).toLocaleString()}`);
console.log(`\n되돌리기: 505 한 줄로. (아래 --undo는 이 스크립트 안의 옛 모양을 다시 쓴다)`);

if (UNDO) {
  await updateDoc(doc(db, 'issuedStatements', target.id), {
    items: [{ name: '기초 미지급(이월)', spec: '', qty: 1, price: amt, supply: amt, tax: 0, total: amt, isTaxExempt: true, accountCode: '505' }],
  });
  console.log('\n✅ 옛 모양(505 한 줄)으로 되돌림');
  process.exit(0);
}
if (!APPLY) { console.log(`\n적용하려면: npx tsx scripts/fix-opening-mikwang.mts --apply`); process.exit(0); }
await updateDoc(doc(db, 'issuedStatements', target.id), { items: FIXED });
console.log('\n✅ (차) 375 / (대) 251 두 줄로 고침');
process.exit(0);
