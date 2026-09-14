// 거래처–품목 연결에서 **단가가 0인 것은 과세/면세를 '모름'으로 되돌린다.**
//   미리보기  npx tsx scripts/fix-zero-price-taxtype-unknown.mts
//   적용      … --apply        되돌리기  … --undo
//   백업: scripts/fix-zero-price-taxtype-unknown-backup.json
//
// 왜 (2026-09-14 사장님) — "거래처 품목에 단가 0인 애들은 다 과세 면세 -로 바꿔놔 모르는 상태로".
//
//   옛 장부와 8월 전표를 맞대 보니 세액이 갈린 전표가 24건이었다. 까닭을 갈라 보니
//   **연결에 '과세'라고 적혀 있어서 과세로 나간 것이 27줄**이었다. 단가도 안 정해 놓고
//   과세만 '과세'로 적혀 있으면, 그건 정한 것이 아니라 **기본값이 굳어 버린 것**이다.
//   정한 적 없는 것은 정한 적 없는 상태로 두어야 화면에 `-` 로 뜨고, 그래야 사람이 보고 정한다.
//
// 무엇을 바꾸나 — `partner_item` 의 `taxType` **칸을 지운다.** 값을 '-' 로 넣지 않는다:
//   빈 글자를 넣어 두면 나중에 `''` 와 `undefined` 둘 다를 따져야 한다. 화면은 칸이 없으면 `-` 로 그린다.
//   **단가는 안 건드린다.** 계정과목(`Account_Code`)도 그대로 둔다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch, deleteField } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const UNDO = args.includes('--undo');
const BACKUP = 'scripts/fix-zero-price-taxtype-unknown-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error(`\n백업이 없다(${BACKUP}).\n`); process.exit(1); }
  const 백업본: Record<string, string> = JSON.parse(readFileSync(BACKUP, 'utf-8'));
  let batch = writeBatch(db); let n = 0;
  for (const [id, taxType] of Object.entries(백업본)) {
    batch.update(doc(db, 'partner_item', id), { taxType });
    if (++n % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
  }
  await batch.commit();
  console.log(`\n연결 ${Object.keys(백업본).length}건의 과세/면세를 백업대로 되돌렸다.\n`);
  process.exit(0);
}

const [연결, items, partners] = await Promise.all([load('partner_item'), load('items'), load('partners')]);
console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

const 품목이름 = new Map(items.map((i: any) => [i.id, i.name]));
const 거래처이름 = new Map(partners.map((p: any) => [p.id, p.name]));

/*  **단가를 모르는 연결** — 0 이거나 아예 없는 것. 둘 다 "정한 적 없다"는 뜻이다.
    값이 있는데 0 인 것과, 칸이 아예 없는 것을 갈라 세어 사장님이 보고 판단하게 한다. */
const 영 = 연결.filter((c: any) => Number(c.price) === 0 && c.price !== undefined && c.price !== null);
const 없음 = 연결.filter((c: any) => c.price === undefined || c.price === null);
const 셀것 = (list: any[]) => list.filter((c: any) => c.taxType === '과세' || c.taxType === '면세');

console.log(`거래처–품목 연결 ${연결.length}건`);
console.log(`  단가가 **0** 인 것            ${영.length}건  — 그 중 과세/면세가 적힌 것 ${셀것(영).length}건`);
console.log(`  단가 칸이 **아예 없는** 것     ${없음.length}건  — 그 중 과세/면세가 적힌 것 ${셀것(없음).length}건`);

const 바꿀것 = [...셀것(영), ...셀것(없음)];
if (!바꿀것.length) { console.log('\n바꿀 것이 없다.\n'); process.exit(0); }

const 갈래 = new Map<string, number>();
for (const c of 바꿀것) 갈래.set(c.taxType, (갈래.get(c.taxType) ?? 0) + 1);
console.log(`\n지울 것 ${바꿀것.length}건 — ${[...갈래].map(([k, v]) => `${k} ${v}`).join(' · ')}`);
for (const c of 바꿀것.slice(0, 12))
  console.log(`   ${String(거래처이름.get(c.partnerId) ?? c.partnerId).slice(0, 14).padEnd(16)} ${String(품목이름.get(c.itemId) ?? c.itemId).slice(0, 26).padEnd(28)} ${c.Direction ?? 'out'} 단가 ${c.price ?? '(없음)'} · ${c.taxType} → -`);
if (바꿀것.length > 12) console.log(`   … 외 ${바꿀것.length - 12}건`);

if (!APPLY) { console.log('\n미리보기였다. 적용하려면 --apply.\n'); process.exit(0); }

if (existsSync(BACKUP)) { console.error(`\n백업 파일이 이미 있다(${BACKUP}). 옮기고 다시 실행한다.\n`); process.exit(1); }
writeFileSync(BACKUP, JSON.stringify(Object.fromEntries(바꿀것.map((c: any) => [c.id, c.taxType])), null, 1), 'utf-8');
console.log(`\n백업 ${바꿀것.length}건 → ${BACKUP}`);

let batch = writeBatch(db); let n = 0;
for (const c of 바꿀것) {
  //  값을 '-' 로 넣지 않고 **칸을 지운다** — 빈 글자를 두면 나중에 둘 다 따져야 한다.
  batch.update(doc(db, 'partner_item', c.id), { taxType: deleteField() });
  if (++n % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
}
await batch.commit();
console.log(`연결 ${바꿀것.length}건의 과세/면세를 지웠다 — 화면에는 '-' 로 뜬다.\n`);
process.exit(0);
