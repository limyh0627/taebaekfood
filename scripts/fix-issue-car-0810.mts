// 8월 차할부금 자금전표 1건 — 2026-08-10, 470,280원.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 템플릿(fct-car-installment)이 매달 10일에 내는 것과 **같은 값**을 만든다 —
// buildCashVoucher를 그대로 써서, 손으로 만든 8월분과 앞으로 나올 9월분이 어긋나지 않게.
//   (차) 253 미지급금 440,000  원금
//   (차) 951 이자비용  30,280  이자
//   (대) 통장         470,280
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { buildCashVoucher } from '../src/shared/autoVoucher';
import { journalizeCashEntry } from '../src/shared/autoJournal';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const TPL = 'fct-car-installment';
const YM = '2026-08';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

const [tpls, cash, codes] = await Promise.all([load('fixedCostTemplates'), load('cashEntries'), load('accountCodes')]);
const t = tpls.find((x: any) => x.id === TPL);
if (!t) { console.error('✖ 차할부금 템플릿이 없다.'); process.exit(1); }

//  자금 계좌는 빈 값 — 이 장부의 다른 자금전표가 전부 그렇다(통장 잔고는 관리 안 한다)
const e = buildCashVoucher(t as any, YM, { cashAccountId: '' }) as any;

if (UNDO) { await deleteDoc(doc(db, 'cashEntries', e.id)); console.log('✅ 삭제 — 되돌림'); process.exit(0); }

if (cash.some((x: any) => x.id === e.id)) { console.log('이미 있다.'); process.exit(0); }

const nm = new Map(codes.map((c: any) => [String(c.code), c.name]));
console.log(`${e.date}  ${e.dir}  ${Number(e.amount).toLocaleString()}원   ${e.note}`);
for (const l of (e.lines ?? [])) console.log(`   ${l.accountCode} ${String(nm.get(String(l.accountCode)) ?? '').padEnd(8)} ${Number(l.amount).toLocaleString().padStart(10)}  ${l.note ?? ''}`);
const sum = (e.lines ?? []).reduce((a: number, l: any) => a + l.amount, 0);
if (sum !== e.amount) { console.error(`✖ 줄 합 ${sum} ≠ 전표 금액 ${e.amount}`); process.exit(1); }
console.log('\n분개:');
for (const l of journalizeCashEntry(e)?.lines ?? [])
  console.log(`   ${l.accountCode} ${String(nm.get(String(l.accountCode)) ?? '').padEnd(8)} 차 ${String(l.debit ?? 0).padStart(9)}  대 ${String(l.credit ?? 0).padStart(9)}`);

if (!APPLY) { console.log('\n(--dry) 적용하려면 --apply'); process.exit(0); }
await setDoc(doc(db, 'cashEntries', e.id), e);
console.log(`\n✅ 만들었다 (${e.id}).  되돌리기: npx tsx scripts/fix-issue-car-0810.mts --undo`);
process.exit(0);
