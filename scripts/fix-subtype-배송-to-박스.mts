// 완제품 서브타입 `배송` → `박스`.
//   기본 = --dry (미리보기, 쓰기 없음).  실제 적용 = --apply.
//
// 분류 관리에서 완제품 서브타입 이름을 배송→박스로 바꿨는데 품목은 옛 값을 들고 있어,
// 새 이름으로 거르면 한 건도 안 나왔다("박스 서브카테고리에 속한 품목이 없다").
// 분류표를 고쳐도 이미 붙은 값은 안 따라온다 — 이름을 바꾸면 품목도 같이 옮겨야 한다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const APPLY = process.argv.includes('--apply');
const FROM = '배송';
const TO = '박스';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const items = (await getDocs(collection(db, 'items'))).docs.map(d => ({ id: d.id, ...d.data() } as any));

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

const hit = items.filter((i: any) => String(i.subtype ?? '') === FROM);
const byType = new Map<string, any[]>();
for (const i of hit) {
  const k = String(i.type);
  const arr = byType.get(k);
  if (arr) arr.push(i); else byType.set(k, [i]);
}
for (const [t, arr] of [...byType.entries()].sort()) {
  console.log(`── type=${t}  ${arr.length}건`);
  for (const i of arr.slice(0, 8)) console.log(`     ${String(i.name).padEnd(32)} cat='${i.category ?? ''}' 단위=${i.unit} 재고=${i.stock ?? 0}`);
  if (arr.length > 8) console.log(`     … 외 ${arr.length - 8}건`);
}
console.log(`\nsubtype '${FROM}' → '${TO}'  총 ${hit.length}건`);
console.log(`이미 '${TO}'인 것: ${items.filter((i: any) => String(i.subtype ?? '') === TO).length}건`);
console.log(`되돌리기: subtype을 '${FROM}'으로.`);

if (!APPLY) { console.log(`\n적용하려면: npx tsx scripts/fix-subtype-배송-to-박스.mts --apply`); process.exit(0); }

for (const i of hit) await updateDoc(doc(db, 'items', i.id), { subtype: TO });
console.log(`\n✅ ${hit.length}건 서브타입 이동`);
process.exit(0);
