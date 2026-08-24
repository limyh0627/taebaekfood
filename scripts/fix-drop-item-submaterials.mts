// items 문서에서 옛 `submaterials`·`unpackTo` 필드를 지운다.
//   기본 = --dry (미리보기, 쓰기 없음).  실제 적용 = --apply.
//
// 구성은 이제 `item_bom`이 유일 원천이다(shared/bomIndex). 품목 문서에 남은 옛 배열은
// **아무도 안 읽는데 남아 있어** 진단할 때마다 "어느 쪽이 참이냐"를 되묻게 만든다.
// 지우기 전에 item_bom과 다른 줄이 있으면 알린다 — 그건 사람이 봐야 할 자리다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, deleteField } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const APPLY = process.argv.includes('--apply');

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [items, boms] = await Promise.all([load('items'), load('item_bom')]);

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

const bomOf = new Map<string, Map<string, number>>();
for (const b of boms) {
  if (!b?.parent_id || !b?.child_id) continue;
  const m = bomOf.get(b.parent_id) ?? new Map<string, number>();
  m.set(b.child_id, typeof b.quantity === 'number' ? b.quantity : 1);
  bomOf.set(b.parent_id, m);
}

const targets = items.filter((i: any) => 'submaterials' in i || 'unpackTo' in i);
let mismatch = 0;
for (const i of targets) {
  const subs: any[] = Array.isArray(i.submaterials) ? i.submaterials : [];
  const cur = bomOf.get(i.id) ?? new Map<string, number>();
  const only = subs.filter(s => !cur.has(s.id));
  const diff = subs.filter(s => cur.has(s.id) && cur.get(s.id) !== (typeof s.stock === 'number' ? s.stock : 1));
  const flag = only.length || diff.length;
  if (flag) mismatch++;
  console.log(`  ${String(i.name).padEnd(28)} 옛 ${subs.length}줄 / item_bom ${cur.size}줄${i.unpackTo ? '  unpackTo있음' : ''}${flag ? '   ★차이' : ''}`);
  for (const s of only) console.log(`       item_bom에 없음: ${s.name ?? s.id} ×${s.stock ?? 1}`);
  for (const s of diff) console.log(`       수량 다름: ${s.name ?? s.id}  옛 ${s.stock ?? 1} vs BOM ${cur.get(s.id)}`);
}
console.log(`\n대상 ${targets.length}건, 그중 item_bom과 다른 것 ${mismatch}건`);
console.log(`되돌리기: 지운 배열은 복구 안 된다 — 위 미리보기가 유일한 기록이다.`);

if (!APPLY) { console.log(`\n적용하려면: npx tsx scripts/fix-drop-item-submaterials.mts --apply`); process.exit(0); }

let n = 0;
for (const i of targets) {
  const patch: Record<string, unknown> = {};
  if ('submaterials' in i) patch.submaterials = deleteField();
  if ('unpackTo' in i) patch.unpackTo = deleteField();
  await updateDoc(doc(db, 'items', i.id), patch);
  n++;
}
console.log(`\n✅ ${n}건에서 옛 필드 제거`);
process.exit(0);
