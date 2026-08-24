// 볶음참깨-낱개/1kg BOM의 유령 부자재를 새 비닐 품목으로 갈아끼운다.
//   기본 = --dry (미리보기, 쓰기 없음).  실제 적용 = --apply.
//
// 옛 `1KG-볶음참깨`(PLYZ-S-1000)는 2026-07-13에 archived 처리됐는데 BOM에는 그대로
// 남아 있었다. 보관된 품목은 화면·원가 롤업에서 빠지므로 1kg 낱개의 비닐 원가가
// 통째로 0으로 잡혔다. 사장님이 새로 만든 같은 이름의 비닐 품목으로 옮긴다.
//   PLYZ-S-1000     (보관, category='용기', 원가 없음)
//   p-1787560459683 (2026-08-24 신규, category='비닐', 원가 110원)
// 이 BOM 한 줄 말고 옛 품목을 물고 있는 곳은 없다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, deleteDoc, setDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const APPLY = process.argv.includes('--apply');
const PARENT = 'PLDhkjOgcPIhO1hhReHm';        // 볶음참깨-낱개/1kg
const OLD_CHILD = 'PLYZ-S-1000';               // 1KG-볶음참깨 (보관)
const NEW_CHILD = 'p-1787560459683';           // 1KG-볶음참깨 (비닐, 신규)
const QTY = 1;

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [items, boms] = await Promise.all([load('items'), load('item_bom')]);
const byId = new Map(items.map((i: any) => [i.id, i]));

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

const newItem = byId.get(NEW_CHILD);
if (!newItem) { console.error(`새 부자재 ${NEW_CHILD} 없음 — 중단`); process.exit(1); }
if (newItem.archived) { console.error(`새 부자재 ${NEW_CHILD}가 보관 상태다 — 중단`); process.exit(1); }

const oldRows = boms.filter((b: any) => b.parent_id === PARENT && b.child_id === OLD_CHILD);
if (oldRows.length === 0) { console.log('이미 갈아끼워진 듯 — 옛 줄이 없다. 중단.'); process.exit(0); }

console.log(`품목    ${byId.get(PARENT)?.name} [${PARENT}]`);
console.log(`현재 BOM`);
for (const b of boms.filter((x: any) => x.parent_id === PARENT)) {
  const c = byId.get(b.child_id);
  console.log(`   [${b.id}]  ${c?.name ?? '(품목없음)'} ×${b.quantity}  cat='${c?.category ?? ''}' 원가=${c?.cost ?? '-'}${c?.archived ? '  ★보관됨' : ''}`);
}
const newId = `bom-${PARENT}__${NEW_CHILD}`.replace(/[/#$[\].]/g, '_');
console.log(`\n바꿀 것`);
for (const b of oldRows) console.log(`   삭제  [${b.id}]  ${byId.get(OLD_CHILD)?.name} ×${b.quantity} (보관 품목)`);
console.log(`   추가  [${newId}]  ${newItem.name} ×${QTY}  cat='${newItem.category}' 원가=${newItem.cost}`);
console.log(`\n되돌리기: 새 줄을 지우고 {parent_id:'${PARENT}', child_id:'${OLD_CHILD}', quantity:${oldRows[0].quantity}} 를 되살리면 된다.`);

if (!APPLY) { console.log(`\n적용하려면: npx tsx scripts/fix-bokkeum-1kg-vinyl.mts --apply`); process.exit(0); }

await setDoc(doc(db, 'item_bom', newId), { parent_id: PARENT, child_id: NEW_CHILD, quantity: QTY });
for (const b of oldRows) await deleteDoc(doc(db, 'item_bom', b.id));
const after = (await getDocs(collection(db, 'item_bom'))).docs.map(d => ({ id: d.id, ...d.data() } as any))
  .filter((b: any) => b.parent_id === PARENT);
console.log(`\n✅ 적용됨 — 새 BOM`);
for (const b of after) console.log(`   ${byId.get(b.child_id)?.name ?? b.child_id} ×${b.quantity}`);
process.exit(0);
