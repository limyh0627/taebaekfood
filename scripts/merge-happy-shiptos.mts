// **해피유통 세 거래처를 하나로 합치고, 갈래를 배송지로 내린다.**
//   미리보기  npx tsx scripts/merge-happy-shiptos.mts
//   적용      … --apply          되돌리기  … --undo
//   백업: scripts/merge-happy-shiptos-backup.json
//
// 왜 (2026-09-16 사장님) — "거래처 해피유통 세개 거래처를 통합하고 거래처 내에 갈래로
// 두는 방식", "우리 기준으로는 그냥 배송지가 다르다고 보는게 맞아", "부모가 모든 품목과
// 단가를 들고있고 주문 넣거나 할때는 배송지마다 품목이 지금처럼 다르게 보이게".
//
// **거래처는 돈 받을 상대다.** 쿠팡도 네이버도 돈을 안 준다 — 해피유통이 준다.
// 그래서 거래처는 하나고, 갈래는 **물건이 가는 곳**(배송지)일 뿐이다.
// 지금은 셋으로 갈려 있어서 **쿠팡으로 들어온 돈이 포천 미수를 못 갚는다**
// (수금 매칭이 `partnerId` 단위로 돈다).
//
// ---
// **배송지 id 는 옛 거래처 id 를 그대로 쓴다**(C080·C081·c-…853).
// 새로 지으면 주문·전표를 고칠 때 짝을 다시 맞춰야 하고, 하나라도 어긋나면 그 주문이
// 어느 배송지로 갔는지 영영 모른다. 옛 id 를 쓰면 **그 자체가 짝**이다.
//
// **바꾸는 것만 열거한다:**
//   1. `partners/{포천}`  에 `shipTos` 셋을 단다 — 이 문서가 부모가 된다(이름 → '해피유통')
//   2. `partners/{쿠팡}` · `{네이버커머스}` 를 **보관**한다(`archived: true`). 안 지운다.
//   3. `partner_item` 58줄 → 부모로 옮기고 `shipToIds` 를 박는다. 겹치면 합친다.
//   4. `orders` 30건 → `partnerId` 를 부모로, `shipToId` 를 옛 id 로.
//   5. `issuedStatements` 26건 → `partnerId`·`partnerName` 을 부모로.
// 그 밖에는 안 건드린다: 분개·자금·재고·원료수불부 — 잔액은 전표에서 나오므로 따라온다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc, updateDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const UNDO = args.includes('--undo');
const BACKUP = 'scripts/merge-happy-shiptos-backup.json';

//  **부모는 포천이다** — 주문(17건)·단가(29줄)가 제일 많아 옮길 것이 가장 적다.
//  그리고 사장님이 기본 배송지로 포천을 고르셨으니, 맨 앞에 서는 것도 자연스럽다.
const 부모id = 'C080';
const 부모이름 = '해피유통';
const 배송지 = [
  { id: 'C080', name: '포천' },
  { id: 'C081', name: '쿠팡' },
  { id: 'c-1784010198853', name: '네이버커머스' },
];
const 옛id = new Set(배송지.map(s => s.id));

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error(`\n백업이 없다(${BACKUP}).\n`); process.exit(1); }
  const b = JSON.parse(readFileSync(BACKUP, 'utf-8')) as Record<string, Record<string, unknown>>;
  for (const [경로, 것] of Object.entries(b)) {
    if (것.__deleted) { await deleteDoc(doc(db, ...(경로.split('/') as [string, string]))); continue; }
    await setDoc(doc(db, ...(경로.split('/') as [string, string])), 것);
  }
  console.log(`\n${Object.keys(b).length}건을 백업대로 되돌렸다.\n`);
  process.exit(0);
}

const 파트너 = (await getDocs(collection(db, 'partners'))).docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
const pi = (await getDocs(collection(db, 'partner_item'))).docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) })).filter(x => 옛id.has(String(x.partnerId)));
const 주문 = (await getDocs(collection(db, 'orders'))).docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) })).filter(x => 옛id.has(String(x.partnerId)));
const 전표 = (await getDocs(collection(db, 'issuedStatements'))).docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) })).filter(x => 옛id.has(String(x.partnerId)));

for (const s of 배송지) {
  if (!파트너.some(p => p.id === s.id)) { console.error(`\n거래처를 못 찾았다: ${s.id}(${s.name}). 멈춘다.\n`); process.exit(1); }
}

/**
 * **단가 줄 합치기** — `(itemId, Direction)` 하나에 줄 하나로 접는다.
 *
 * 값이 갈리면 멈춘다. 운영 데이터를 재 보니 단가·과세·라벨·박스규격 충돌이 **0건**이라
 * 조용히 한쪽을 고를 일이 없다. 그래도 검사한다 — 나중에 갈린 채로 돌리면 어느 값이
 * 살아남았는지 아무도 모른다.
 */
const 접기 = new Map<string, { 기준: Record<string, unknown>; shipToIds: string[]; 지울것: string[] }>();
const 충돌: string[] = [];
const 볼칸 = ['price', 'taxType', 'labelId', 'boxTypeId', 'qtyPerBox', 'qty_per_box', 'displaySize', 'packageType', 'containerTypeId', 'tapeTypeId', 'Account_Code', 'isSmartStore'];

for (const r of pi) {
  const key = `${r.itemId}|${r.Direction}`;
  const 기존 = 접기.get(key);
  if (!기존) { 접기.set(key, { 기준: r, shipToIds: [String(r.partnerId)], 지울것: [] }); continue; }
  기존.shipToIds.push(String(r.partnerId));
  기존.지울것.push(String(r.id));
  for (const k of 볼칸) {
    const a = 기존.기준[k], b = r[k];
    const 비었나 = (v: unknown) => v === undefined || v === null || v === '' || v === 0;
    if (비었나(a) && !비었나(b)) { 기존.기준 = { ...기존.기준, [k]: b }; continue; }   // 빈칸은 채운다
    if (!비었나(a) && !비었나(b) && a !== b) 충돌.push(`${r.itemId} · ${k}: ${String(a)} vs ${String(b)}`);
  }
}

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);
console.log(`부모   ${부모이름}  [${부모id}]`);
console.log(`배송지 ${배송지.map(s => s.name).join(' · ')}   (맨 앞이 기본)`);
console.log(`\n단가   ${pi.length}줄 → ${접기.size}줄`);
console.log(`주문   ${주문.length}건 · 전표 ${전표.length}건`);

if (충돌.length) {
  console.error(`\n⚠ 값이 갈리는 칸 ${충돌.length}개 — 멈춘다. 사람이 정해야 한다:\n`);
  for (const c of 충돌.slice(0, 20)) console.error(`   ${c}`);
  process.exit(1);
}
console.log('\n값이 갈리는 칸 0개 — 기계적으로 합쳐진다.');

const 배송지별 = new Map(배송지.map(s => [s.id, 0]));
for (const [, v] of 접기) for (const id of v.shipToIds) 배송지별.set(id, (배송지별.get(id) ?? 0) + 1);
console.log('\n배송지마다 나가는 품목:');
for (const s of 배송지) console.log(`   ${s.name.padEnd(8)} ${배송지별.get(s.id)}개`);

console.log('\n안 건드리는 것: 분개 · 자금 · 재고 · 원료수불부 (잔액은 전표에서 나오므로 따라온다)');
if (!APPLY) { console.log('\n미리보기였다. 적용하려면 --apply.\n'); process.exit(0); }

if (existsSync(BACKUP)) { console.error(`\n이미 백업이 있다(${BACKUP}) — 옮기고 다시 실행한다.\n`); process.exit(1); }
const 백업: Record<string, unknown> = {};
const 담기 = async (col: string, id: string) => {
  const snap = await getDoc(doc(db, col, id));
  백업[`${col}/${id}`] = snap.exists() ? snap.data() : { __deleted: true };
};
for (const s of 배송지) await 담기('partners', s.id);
for (const r of pi) await 담기('partner_item', String(r.id));
for (const o of 주문) await 담기('orders', String(o.id));
for (const t of 전표) await 담기('issuedStatements', String(t.id));
writeFileSync(BACKUP, JSON.stringify(백업, null, 1), 'utf-8');
console.log(`\n백업 ${Object.keys(백업).length}건 → ${BACKUP}`);

//  ① 부모 세우기
await updateDoc(doc(db, 'partners', 부모id), { name: 부모이름, shipTos: 배송지 });
//  ② 나머지 갈래는 **보관**한다 — 지우면 되돌릴 때 근거가 없다
for (const s of 배송지.filter(x => x.id !== 부모id)) await updateDoc(doc(db, 'partners', s.id), { archived: true });
//  ③ 단가
for (const [, v] of 접기) {
  const { id, ...rest } = v.기준 as { id?: string } & Record<string, unknown>;
  await setDoc(doc(db, 'partner_item', String(id)), { ...rest, partnerId: 부모id, shipToIds: v.shipToIds });
  for (const 지울 of v.지울것) await deleteDoc(doc(db, 'partner_item', 지울));
}
//  ④ 주문 — 옛 거래처 id 가 그대로 배송지 id 다
for (const o of 주문) await updateDoc(doc(db, 'orders', String(o.id)), { partnerId: 부모id, partnerName: 부모이름, shipToId: String(o.partnerId) });
//  ⑤ 전표
for (const t of 전표) await updateDoc(doc(db, 'issuedStatements', String(t.id)), { partnerId: 부모id, partnerName: 부모이름 });

//  **다시 읽어 확인한다** — 썼다고 믿지 않는다.
console.log('\n═══ 다시 읽어 확인 ═══');
const 뒤파트너 = (await getDoc(doc(db, 'partners', 부모id))).data() as Record<string, unknown>;
console.log(`  거래처 ${뒤파트너.name} · 배송지 ${(뒤파트너.shipTos as { name: string }[]).map(s => s.name).join(' · ')}`);
const 남은단가 = (await getDocs(collection(db, 'partner_item'))).docs.map(d => d.data()).filter(x => 옛id.has(String(x.partnerId)) && String(x.partnerId) !== 부모id);
const 남은주문 = (await getDocs(collection(db, 'orders'))).docs.map(d => d.data()).filter(x => 옛id.has(String(x.partnerId)) && String(x.partnerId) !== 부모id);
const 남은전표 = (await getDocs(collection(db, 'issuedStatements'))).docs.map(d => d.data()).filter(x => 옛id.has(String(x.partnerId)) && String(x.partnerId) !== 부모id);
console.log(`  ${남은단가.length === 0 ? '✅' : '⚠'} 옛 거래처에 남은 단가 ${남은단가.length}줄`);
console.log(`  ${남은주문.length === 0 ? '✅' : '⚠'} 옛 거래처에 남은 주문 ${남은주문.length}건`);
console.log(`  ${남은전표.length === 0 ? '✅' : '⚠'} 옛 거래처에 남은 전표 ${남은전표.length}건`);
console.log('\n되돌리려면 --undo.\n');
process.exit(0);
