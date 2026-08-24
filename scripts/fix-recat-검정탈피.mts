// 검정참깨 · 탈피들깨 품목을 새 카테고리로 옮긴다.
//   기본 = --dry (미리보기, 쓰기 없음).  실제 적용 = --apply.
//
// 새로 만든 분류가 비어 있고 그 품목들이 상위 분류(참깨·들깨)에 섞여 있었다.
//
// **제품 계열(완제품·반제품·원료)만 옮긴다.** 부자재는 category가 '무슨 물건이냐'
// (라벨·비닐·테이프)라서 건드리면 안 된다 — '모란 검정참깨'는 라벨이지 검정참깨가 아니고
// '테이프-검정'의 검정은 색이다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const APPLY = process.argv.includes('--apply');
const MOVES: { to: string; match: RegExp; from: string[] }[] = [
  { to: '검정참깨', match: /검정/, from: ['참깨'] },
  { to: '탈피들깨', match: /탈피/, from: ['들깨'] },
];
const PRODUCT_LINE = ['product', 'wip', 'raw'];

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const items = (await getDocs(collection(db, 'items'))).docs.map(d => ({ id: d.id, ...d.data() } as any));

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

const plan: { id: string; name: string; type: string; from: string; to: string }[] = [];
const skipped: string[] = [];
for (const m of MOVES) {
  for (const i of items) {
    if (i.archived) continue;
    if (!m.match.test(String(i.name))) continue;
    const cur = String(i.category ?? '');
    if (cur === m.to) continue;
    if (!PRODUCT_LINE.includes(String(i.type))) { skipped.push(`${i.name} (${i.type}/${cur})`); continue; }
    if (!m.from.includes(cur)) { skipped.push(`${i.name} (${i.type}/${cur || '없음'}) — 예상 밖 카테고리`); continue; }
    plan.push({ id: i.id, name: i.name, type: i.type, from: cur, to: m.to });
  }
}

for (const m of MOVES) {
  const rows = plan.filter(p => p.to === m.to);
  console.log(`── '${m.to}'로 ${rows.length}건`);
  for (const r of rows) console.log(`     ${String(r.name).padEnd(30)} ${String(r.type).padEnd(8)} ${r.from} → ${r.to}`);
}
console.log(`\n── 안 건드리는 것 ${skipped.length}건 (부자재는 category가 물건 종류다)`);
for (const s of skipped) console.log(`     ${s}`);
console.log(`\n되돌리기: 위 목록의 '→' 왼쪽 값으로 category를 되돌리면 된다.`);

if (!APPLY) { console.log(`\n적용하려면: npx tsx scripts/fix-recat-검정탈피.mts --apply`); process.exit(0); }

for (const r of plan) await updateDoc(doc(db, 'items', r.id), { category: r.to });
console.log(`\n✅ ${plan.length}건 카테고리 이동`);
process.exit(0);
