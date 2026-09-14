// 기초 이월 전표의 **금액을 고친다.** 한 건씩만 — 전표 id 와 새 금액을 준다.
//   미리보기  npx tsx scripts/fix-opening-balance-amount.mts <전표id> <새금액>
//   적용      … --apply        되돌리기  … <전표id> --undo
//   백업: scripts/fix-opening-balance-amount-backup.json
//
// 왜 (2026-09-14 사장님) — "밝은 기초금액이 2917500원이 아니라 2917200원임".
//
// 기초 이월 전표는 **차·대 두 줄이 같은 금액**으로 서 있다(375 이월이익잉여금 ↔ 251 외상매입금).
// 한 줄만 고치면 차대가 안 맞아 분개가 통째로 버려진다(`buildJournals` 가 skipped 로 뺀다).
// 그래서 **두 줄과 합계를 같이** 고친다.
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const UNDO = args.includes('--undo');
const [전표id, 새금액글] = args.filter(a => !a.startsWith('--'));
const BACKUP = 'scripts/fix-opening-balance-amount-backup.json';

if (!전표id) { console.error('전표 id 를 준다.'); process.exit(1); }

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const ref = doc(db, 'issuedStatements', 전표id);
const snap = await getDoc(ref);
if (!snap.exists()) { console.error(`전표를 못 찾았다: ${전표id}`); process.exit(1); }
const s = snap.data() as any;

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error(`백업이 없다(${BACKUP}).`); process.exit(1); }
  const 백업본 = JSON.parse(readFileSync(BACKUP, 'utf-8'));
  const 것 = 백업본[전표id];
  if (!것) { console.error('이 전표의 백업이 없다.'); process.exit(1); }
  await updateDoc(ref, 것);
  console.log(`\n${전표id} 를 백업 상태로 되돌렸다.\n`);
  process.exit(0);
}

const 새금액 = Math.round(Number(새금액글));
if (!Number.isFinite(새금액) || 새금액 <= 0) { console.error('새 금액을 숫자로 준다.'); process.exit(1); }

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);
console.log(`${s.docNo} · ${s.tradeDate} · ${s.type} · ${s.partnerName}`);
console.log(`  지금 합계 ${Number(s.totalAmount).toLocaleString()} → ${새금액.toLocaleString()}`);
for (const l of s.items ?? []) console.log(`    «${l.name}» 계정 ${l.accountCode} ${l.side ?? '-'} : ${Number(l.price).toLocaleString()} → ${새금액.toLocaleString()}`);

//  기초 이월은 세액이 없다 — 면세로 서 있고 공급가액 = 합계다. 그 모양을 지킨다.
const 새줄 = (s.items ?? []).map((l: any) => ({ ...l, qty: 1, price: 새금액, supply: 새금액, tax: 0, total: 새금액 }));
const 고침 = { items: 새줄, totalAmount: 새금액, totalSupply: 새금액, totalTax: 0 };

if (!APPLY) { console.log('\n미리보기였다. 적용하려면 --apply.\n'); process.exit(0); }

const 백업본 = existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, 'utf-8')) : {};
if (백업본[전표id]) { console.error('이미 이 전표의 백업이 있다 — 옮기고 다시 실행한다.'); process.exit(1); }
백업본[전표id] = { items: s.items, totalAmount: s.totalAmount, totalSupply: s.totalSupply, totalTax: s.totalTax };
writeFileSync(BACKUP, JSON.stringify(백업본, null, 1), 'utf-8');

await updateDoc(ref, 고침);
console.log(`\n고쳤다. 백업 → ${BACKUP}\n`);
process.exit(0);
