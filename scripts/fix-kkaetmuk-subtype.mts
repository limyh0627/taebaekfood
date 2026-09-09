// 태백 깻묵 — 원료 홀더인데 `subtype` 이 비어 있어 절반의 코드에서 안 보이던 것을 '벌크' 로 맞춘다.
//   기본 = --dry (미리보기, 쓰기 없음).  실제 적용 = --apply.
//   백업: scripts/fix-kkaetmuk-subtype-backup.json
//
// 왜 —
//   "벌크 홀더인가" 판정은 [itemTaxonomy.isBulkItem](../src/shared/itemTaxonomy.ts) 하나가 안다.
//   근거는 `subtype === '벌크'` 뿐이다. 그런데 원료 홀더 18개 중 **태백 깻묵만 subtype 이 비어**
//   있었다(2026-09-09 조사). 재고 3,000kg 에 로트도 있는 진짜 원료다.
//
//   그래서 지금 앱은 깻묵을 **자리마다 다르게** 본다 —
//     · `isBulkItem` 을 쓰는 12곳(주문 차감·OEM·원가…)에서는 **안 보인다**
//     · 옛 규칙(`type==='raw'`)이 남아 있던 입고·수불부 자리에서는 **보인다**
//   같은 품목이 어떤 화면에선 원료고 어떤 화면에선 아니다. 조용히 어긋난다.
//
//   풍회 깻묵(`raw-깻묵-punghoe`)은 이미 '벌크' 다. 태백 것만 빠져 있다.
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const ITEM_ID = 'p-1782788799105';
const BACKUP = 'scripts/fix-kkaetmuk-subtype-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

const ref = doc(db, 'items', ITEM_ID);
const snap = await getDoc(ref);
if (!snap.exists()) throw new Error(`품목을 찾을 수 없다: ${ITEM_ID}`);
const d = snap.data() as any;

if (String(d.name ?? '') !== '깻묵') throw new Error(`깻묵이 아니다: ${d.name}`);
if (d.type !== 'raw') throw new Error(`raw 가 아니다: type=${d.type}`);
if (String(d.subtype ?? '') === '벌크') { console.log('이미 벌크다 — 할 일 없음.\n'); process.exit(0); }

console.log(`품목    ${d.name}  (${ITEM_ID})`);
console.log(`현재    type=${d.type}  subtype=${JSON.stringify(d.subtype ?? null)}  unit=${d.unit}  stock=${d.stock}  로트 ${(d.lots ?? []).length}개`);
console.log(`변경 후  subtype='벌크'   (나머지는 안 건드린다)`);

if (!APPLY) {
  console.log('\n미리보기만 했다. 실제로 바꾸려면 --apply 를 붙여라.\n');
  process.exit(0);
}

writeFileSync(BACKUP, JSON.stringify({
  적은때: new Date().toISOString(),
  설명: '태백 깻묵 subtype 을 벌크로 — 적용 전 원본',
  itemId: ITEM_ID,
  before: { subtype: d.subtype ?? null },
}, null, 2), 'utf8');
console.log(`백업 → ${BACKUP}`);

await updateDoc(ref, { subtype: '벌크' });
console.log('\n✅ 적용 완료.\n');
process.exit(0);
