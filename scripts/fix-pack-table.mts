// 상품(goods)의 개입수를 **포장 환산표(item_pack)** 로 옮긴다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
//   개입수의 근거를 둘로 줄인다.
//     ① BOM          박스를 별개 품목으로 둔 것(136품목) — 그대로 둔다
//     ② item_pack    낱개로만 세는데 박스로 말하는 것(상품 9품목) — 여기로 옮긴다
//
//   걷어내는 것: 품목의 `boxSize` 필드 · 규격 글자 폴백 · 코드의 '향미유면 12'.
//   규격 글자는 **한 품목도 안 쓰고 있었다**(131개가 전부 BOM 도 갖고 있었다).
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { setBomIndex, buildBomIndex } from '../src/shared/bomIndex';
import { unpackComponent } from '../src/shared/orderUnits';
import { parseSpecCount } from '../src/constants/formula';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-pack-table-backup.json';
const COL = 'item_pack';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('✖ 백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8'));
  for (const before of prev.items) { const { id, ...rest } = before; await setDoc(doc(db, 'items', id), rest); }
  for (const id of prev.packIds) await deleteDoc(doc(db, COL, id));
  console.log('✅ 되돌림'); process.exit(0);
}

const [items, boms, packs] = await Promise.all([load('items'), load('item_bom'), load(COL)]);
setBomIndex(buildBomIndex(items as never, boms as never));
const 있는표 = new Set(packs.map((r: any) => r.item_id));

//  BOM 이 답하지 못하는데 옛 폴백에 기대던 품목 = 환산표로 갈 것
const 대상 = items
  .filter((p: any) => (p.type === 'product' || p.type === 'goods') && !unpackComponent(p))
  .map((p: any) => {
    const n = Number(p.boxSize) > 1 ? Number(p.boxSize)
      : parseSpecCount(p.spec) > 1 ? parseSpecCount(p.spec)
      : (p.category === '향미유' || p.type === '향미유') ? 12 : 0;
    const 출처 = Number(p.boxSize) > 1 ? `boxSize ${p.boxSize}` : parseSpecCount(p.spec) > 1 ? `규격 '${p.spec}'` : '코드의 12';
    return { p, n, 출처 };
  })
  .filter((x: any) => x.n > 1);

console.log(`\n━━ 상품 개입수를 환산표로 ━━  (${APPLY ? '적용' : '미리보기 — 적용하려면 --apply'})\n`);
console.log(`   기존 item_pack 줄: ${packs.length}개\n`);
for (const { p, n, 출처 } of 대상) {
  console.log(`   ${String(n).padStart(3)}개입   ${출처.padEnd(16)} → item_pack   ${Number(p.boxSize) > 1 ? '· boxSize 필드 삭제' : ''}   ${p.name}`);
}
if (!대상.length) { console.log('   옮길 게 없다.\n'); process.exit(0); }
if (!APPLY) { console.log(`\n${대상.length}건. 적용하려면 --apply\n`); process.exit(0); }

const before = { items: 대상.filter((x: any) => Number(x.p.boxSize) > 1).map((x: any) => x.p), packIds: [] as string[] };
for (const { p, n } of 대상) {
  const id = `pack-${p.id}`;
  before.packIds.push(id);
  if (!있는표.has(p.id)) await setDoc(doc(db, COL, id), { item_id: p.id, units_per_box: n });
  //  옛 필드는 뗀다 — 근거가 둘로 줄었으니 남겨 두면 또 헷갈린다
  if (Number(p.boxSize) > 1) { const { id: _d, boxSize: _b, ...rest } = p; await setDoc(doc(db, 'items', p.id), rest); }
}
writeFileSync(BACKUP, JSON.stringify({ at: new Date().toISOString(), ...before }, null, 2), 'utf8');
console.log(`\n✅ ${대상.length}건 옮겼다.  백업: ${BACKUP}  (되돌리기: --undo)\n`);
process.exit(0);
