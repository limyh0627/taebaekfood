// **캔을 반제품으로 옮기고, 풍회 캔에 구성을 넣는다.**
//   미리보기  npx tsx scripts/fix-cans-to-wip.mts
//   적용      … --apply          되돌리기  … --undo
//   백업: scripts/fix-cans-to-wip-backup.json
//
// 왜 (2026-09-16 사장님) — "캔 품목은 반제품으로 넣긴할거야 반제품 상태에서도 판매
// 가능하잖아", "나머지 캔 제품들은 그냥 그대로 반제품으로 서브타입만 바꾸면 돼",
// "풍회는 벌크 하나 만들고 공캔도 하나 만들고", "단위를 개로 바꿔놔".
//
// **코드를 먼저 고쳤다.** `type === 'product'` 만 보고 가르던 자리가 넷 있어서
// (생산 처리·출고 차감·원료 부족 경고·제조일 점검) 캔을 `wip` 으로 바꾸면 그 넷이
// 조용히 캔을 빼 버린다 — 주문에 넣어 팔아도 재고가 안 움직인다. 판정을
// `itemTaxonomy.holdsUnitStock` 하나로 모으고 네 자리를 바꿨다. 그게 이 스크립트의
// 전제다. 코드 없이 데이터만 바꾸면 재고가 멈춘다.
//
// **바꾸는 것만 열거한다:**
//   1. 캔 완제품 3개 → `type: wip` · `subtype: 캔` · `unit: 개`   (구성·주문·전표 그대로)
//   2. `시골향참기름3-캔` → **보관**하고 그 구성을 `깨분참기름/16.5kg`(태백 반제품)으로 옮긴다
//      — 같은 깨분참기름 캔이 둘인데, 완제품 쪽은 구성만 있고 안 쓰였고(주문0·전표0)
//        반제품 쪽은 전표 12줄을 쓰는데 구성이 없다. 정확히 거꾸로라 구성만 옮긴다.
//   3. 풍회에 `깨분참기름`(벌크) · `16.5kg 캔`(부자재)을 만들고, 풍회 캔에 구성을 넣는다
//   4. 풍회 캔에 `subtype: 캔`
// 그 밖에는 안 건드린다: 재고 수량 · 로트 · 원료수불부 · 전표 · 주문 · 단가.
// (`깨분참기름` −204.62 는 사장님이 "맞추지말고 냅둬" 하셨다 — 입고 누락으로 보신다)
//  **서비스 계정으로 붙는다**(2026-09-16) — 익명 로그인이 규칙에서 막혔다.
//  열쇠 경로는 `GOOGLE_APPLICATION_CREDENTIALS` 로만 읽고 어디에도 안 적는다.
import { adminDb, 실행모드 } from './_admin.mts';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const { APPLY, UNDO } = 실행모드();
const BACKUP = '로컬전용/백업/cans-to-wip-backup.json';

const 태백벌크_깨분 = 'raw-깨분참기름';
const 태백캔_깨분 = 'p-1779251603644';          // 깨분참기름/16.5kg (wip·캔) — 살릴 쪽
const 보관할완제품 = 'p-1773588080692';         // 시골향참기름3-캔/16.5kg — 구성만 넘기고 보관
const 풍회캔 = 'wip-깨분참기름-캔-punghoe';
const 풍회벌크 = 'raw-깨분참기름-punghoe';       // 새로 만든다
const 풍회공캔 = 'sub-16-5kg-can-punghoe';      // 새로 만든다
const 옮길캔 = ['p-1773565128048', 'p-1773565691663', 'p-1776067029004'];  // 들기름2 · 참기름1 · 들기름1

const bomId = (p: string, c: string) => `bom-${p}__${c}`.replace(/[/#$[\].]/g, '_');

const db = adminDb();

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error(`\n백업이 없다(${BACKUP}).\n`); process.exit(1); }
  const b = JSON.parse(readFileSync(BACKUP, 'utf-8')) as Record<string, Record<string, unknown>>;
  for (const [경로, 것] of Object.entries(b)) {
    const ref = db.doc(경로);
    if (것.__absent) { await ref.delete(); continue; }     // 우리가 만든 것은 지운다
    await ref.set(것);
  }
  console.log(`\n${Object.keys(b).length}건을 백업대로 되돌렸다.\n`);
  process.exit(0);
}

const items = new Map((await db.collection('items').get()).docs.map(d => [d.id, { id: d.id, ...(d.data() as Record<string, unknown>) }]));
const boms = (await db.collection('item_bom').get()).docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
const 이름 = (id: string) => String(items.get(id)?.name ?? `(없음 ${id})`);

for (const id of [...옮길캔, 태백캔_깨분, 보관할완제품, 풍회캔, 태백벌크_깨분]) {
  if (!items.has(id)) { console.error(`\n품목을 못 찾았다: ${id}. 멈춘다.\n`); process.exit(1); }
}

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

console.log('① 캔 완제품 → 반제품 (구성·주문·전표 그대로)');
for (const id of 옮길캔) {
  const i = items.get(id)!;
  console.log(`   ${이름(id).padEnd(24)} type ${i.type}→wip · subtype ${i.subtype ?? '-'}→캔 · unit ${i.unit}→개`);
}

const 넘길구성 = boms.filter(b => b.parent_id === 보관할완제품);
console.log(`\n② ${이름(보관할완제품)} → 보관, 구성 ${넘길구성.length}줄을 ${이름(태백캔_깨분)} 으로`);
for (const b of 넘길구성) console.log(`   ${이름(String(b.child_id))} ×${b.quantity}`);
const 기존구성 = boms.filter(b => b.parent_id === 태백캔_깨분);
if (기존구성.length) { console.error(`\n⚠ 받을 쪽에 이미 구성 ${기존구성.length}줄이 있다 — 멈춘다.\n`); process.exit(1); }

console.log(`\n③ 풍회에 새로 만든다`);
console.log(`   ${풍회벌크}   깨분참기름 (wip·벌크·L)`);
console.log(`   ${풍회공캔}   16.5kg 캔 (submaterial·개)`);
console.log(`\n④ ${이름(풍회캔)} 구성 = 깨분참기름 ×16.5 + 16.5kg 캔 ×1 · subtype 캔`);
if (boms.some(b => b.parent_id === 풍회캔)) { console.error('\n⚠ 풍회 캔에 이미 구성이 있다 — 멈춘다.\n'); process.exit(1); }
if (items.has(풍회벌크) || items.has(풍회공캔)) { console.error('\n⚠ 만들려는 품목이 이미 있다 — 멈춘다.\n'); process.exit(1); }

console.log('\n안 건드리는 것: 재고 수량 · 로트 · 원료수불부 · 전표 · 주문 · 거래처단가');
if (!APPLY) { console.log('\n미리보기였다. 적용하려면 --apply.\n'); process.exit(0); }

if (existsSync(BACKUP)) { console.error(`\n이미 백업이 있다(${BACKUP}) — 옮기고 다시 실행한다.\n`); process.exit(1); }
const 백업: Record<string, unknown> = {};
const 담기 = async (col: string, id: string) => {
  const snap = await db.collection(col).doc(id).get();
  백업[`${col}/${id}`] = snap.exists ? snap.data() : { __absent: true };
};
for (const id of [...옮길캔, 태백캔_깨분, 보관할완제품, 풍회캔, 풍회벌크, 풍회공캔]) await 담기('items', id);
for (const b of 넘길구성) await 담기('item_bom', String(b.id));
for (const b of 넘길구성) await 담기('item_bom', bomId(태백캔_깨분, String(b.child_id)));
await 담기('item_bom', bomId(풍회캔, 풍회벌크));
await 담기('item_bom', bomId(풍회캔, 풍회공캔));
writeFileSync(BACKUP, JSON.stringify(백업, null, 1), 'utf-8');
console.log(`\n백업 ${Object.keys(백업).length}건 → ${BACKUP}`);

//  ① 캔 셋을 반제품으로
for (const id of 옮길캔) await db.collection('items').doc(id).update({ type: 'wip', subtype: '캔', unit: '개' });

//  ② 구성 옮기고 완제품 보관
for (const b of 넘길구성) {
  await db.collection('item_bom').doc(bomId(태백캔_깨분, String(b.child_id)))
    .set({ parent_id: 태백캔_깨분, child_id: b.child_id, quantity: b.quantity });
  await db.collection('item_bom').doc(String(b.id)).delete();
}
await db.collection('items').doc(보관할완제품).update({ archived: true });
await db.collection('items').doc(태백캔_깨분).update({ unit: '개', subtype: '캔' });

//  ③ 풍회 벌크·공캔
const 태백벌크 = items.get(태백벌크_깨분)!;
await db.collection('items').doc(풍회벌크).set({
  name: '깨분참기름', type: 'wip', subtype: '벌크', category: '참기름', unit: 'L',
  spec: '벌크', stock: 0, minStock: 0, price: 0,
  cost: Number(태백벌크.cost ?? 0) || undefined, companyId: 'punghoe', image: '',
});
await db.collection('items').doc(풍회공캔).set({
  name: '16.5kg 캔', type: 'submaterial', category: '부자재', unit: '개',
  stock: 0, minStock: 0, price: 0, companyId: 'punghoe', image: '',
});

//  ④ 풍회 캔 구성
await db.collection('item_bom').doc(bomId(풍회캔, 풍회벌크)).set({ parent_id: 풍회캔, child_id: 풍회벌크, quantity: 16.5 });
await db.collection('item_bom').doc(bomId(풍회캔, 풍회공캔)).set({ parent_id: 풍회캔, child_id: 풍회공캔, quantity: 1 });
await db.collection('items').doc(풍회캔).update({ subtype: '캔', unit: '개' });

//  **다시 읽어 확인한다** — 썼다고 믿지 않는다.
console.log('\n═══ 다시 읽어 확인 ═══');
const 뒤boms = (await db.collection('item_bom').get()).docs.map(d => d.data() as Record<string, unknown>);
for (const id of [...옮길캔, 태백캔_깨분, 풍회캔]) {
  const d = (await db.collection('items').doc(id).get()).data() as Record<string, unknown>;
  const n = 뒤boms.filter(b => b.parent_id === id).length;
  const ok = d.type === 'wip' && d.subtype === '캔' && d.unit === '개' && n > 0;
  console.log(`  ${ok ? '✅' : '⚠'} ${d.name}  ${d.type}·${d.subtype}·${d.unit} · 구성 ${n}줄`);
}
const 보관 = (await db.collection('items').doc(보관할완제품).get()).data() as Record<string, unknown>;
console.log(`  ${보관.archived ? '✅' : '⚠'} ${보관.name} 보관됨 · 구성 ${뒤boms.filter(b => b.parent_id === 보관할완제품).length}줄`);
console.log('\n되돌리려면 --undo.\n');
process.exit(0);
