// 주문 **한 건만** 지운다. 재고는 안 건드린다 — 기록만 지운다.
//   미리보기  npx tsx scripts/delete-order.mts <주문id>
//   적용      … --apply        되돌리기  … <주문id> --undo
//   백업: scripts/delete-order-backup.json
//
// 왜 (2026-09-16 사장님) — "대왕푸드 이 주문은 삭제해야하는데",
// "재고 원복하거나 할 필요없이 그냥 삭제해 상관없어".
//
// **재고를 안 되돌리는 것이 맞다.** 이 주문은 줄별 재고기록(`itemInventory`)이 없는 옛 주문이라
// 당시 무엇이 얼마나 빠졌는지 근거가 없다. 지금 BOM 으로 추정해 되돌리면 **오늘 재고를 오히려
// 망친다** — 앱의 예전 주문 삭제도 같은 까닭으로 기록만 지운다(`handleDeleteOrder`).
//
// **지울 것을 열거한다**(남길 것이 아니라): `orders` 문서 하나. 그것뿐이다.
// 전표·자금·원료수불부에는 손대지 않는다 — 이 주문에 걸린 전표는 없다(확인함).
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, deleteDoc, setDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const UNDO = args.includes('--undo');
const [주문id] = args.filter(a => !a.startsWith('--'));
const BACKUP = 'scripts/delete-order-backup.json';

if (!주문id) { console.error('주문 id 를 준다.'); process.exit(1); }

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const ref = doc(db, 'orders', 주문id);

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error(`\n백업이 없다(${BACKUP}).\n`); process.exit(1); }
  const 백업본 = JSON.parse(readFileSync(BACKUP, 'utf-8'));
  const 것 = 백업본[주문id];
  if (!것) { console.error('이 주문의 백업이 없다.'); process.exit(1); }
  await setDoc(ref, 것);
  console.log(`\n${주문id} 를 백업대로 되살렸다.\n`);
  process.exit(0);
}

const snap = await getDoc(ref);
if (!snap.exists()) { console.error(`\n주문을 못 찾았다: ${주문id}\n(이미 지웠을 수 있다)\n`); process.exit(1); }
const o = snap.data() as any;

console.log(`\n═══ ${APPLY ? '🔴 실제 삭제(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);
console.log('지울 것 — orders 문서 하나:');
console.log(`  ${주문id}`);
console.log(`  ${o.partnerName} · ${o.status} · 출고예정 ${String(o.deliveryDate ?? '').slice(0, 10)}`);
console.log(`  품목 ${(o.items ?? []).map((i: any) => `${i.name} ${i.quantity}`).join(' · ')}`);
console.log('\n안 건드리는 것: 재고 · 원료 로트 · 원료수불부 · 전표 · 자금원장');
console.log('  (이 주문은 생산·출고가 이미 끝난 옛 주문이라, 되돌릴 근거가 없어 재고를 그대로 둔다)');

if (!APPLY) { console.log('\n미리보기였다. 지우려면 --apply.\n'); process.exit(0); }

const 백업본 = existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, 'utf-8')) : {};
if (백업본[주문id]) { console.error('\n이미 이 주문의 백업이 있다 — 옮기고 다시 실행한다.\n'); process.exit(1); }
백업본[주문id] = o;
writeFileSync(BACKUP, JSON.stringify(백업본, null, 1), 'utf-8');
console.log(`\n백업 → ${BACKUP}`);

await deleteDoc(ref);

//  **지웠는지 다시 읽어 확인한다** — 썼다고 믿지 않는다.
const 확인 = await getDoc(ref);
console.log(확인.exists() ? '\n⚠ 아직 남아 있다 — 다시 확인해라.\n' : '\n지웠다. 되돌리려면 --undo.\n');
process.exit(0);
