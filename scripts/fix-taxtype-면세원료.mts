// 면세 농산물 원료에 taxType='면세'를 단다.
//   기본 = --dry (미리보기, 쓰기 없음).  실제 적용 = --apply.
//
// 원가에 걸린다 — 면세 원료로 과세품(참기름·들기름)을 만들면 매입세액을 못 빼서
// 그만큼이 그대로 원가에 얹힌다(bomCost의 vatUp, ×1.1).
// 사장님 지정: 참깨 · 들깨 · 검정참깨 · 탈피들깨 계열이 면세, 나머지는 과세(기본값).
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const APPLY = process.argv.includes('--apply');
const 면세 = ['참깨', '들깨', '검정참깨', '검정깨', '탈피들깨가루', '탈피들깨'];

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const items = (await getDocs(collection(db, 'items'))).docs.map(d => ({ id: d.id, ...d.data() } as any));

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);
const raws = items.filter((i: any) => !i.archived && ['raw', 'wip'].includes(String(i.type)));
const plan = raws.filter((i: any) => 면세.includes(String(i.name)) && i.taxType !== '면세');
console.log('── 면세로 달 것 ──');
for (const i of plan) console.log(`     ${String(i.name).padEnd(16)} ${String(i.type).padEnd(4)} 원가 ${i.cost ?? '-'}`);
console.log('\n── 과세 그대로 (기본값이라 안 건드림) ──');
for (const i of raws.filter((i: any) => !면세.includes(String(i.name)))) console.log(`     ${String(i.name).padEnd(16)} ${String(i.type).padEnd(4)} 원가 ${i.cost ?? '-'}`);
console.log(`\n총 ${plan.length}건`);
console.log("되돌리기: taxType 필드를 지우거나 '과세'로.");

if (!APPLY) { console.log(`\n적용하려면: npx tsx scripts/fix-taxtype-면세원료.mts --apply`); process.exit(0); }
for (const i of plan) await updateDoc(doc(db, 'items', i.id), { taxType: '면세' });
console.log(`\n✅ ${plan.length}건 면세 지정`);
process.exit(0);
