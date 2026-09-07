/**
 * 종에 쌓인 **재고 부족 알림**을 지운다.
 *
 * 2026-09-08 사장님: "알람에 재고부족경고 안오게 해".
 * 만드는 자리는 [orderStockEngine](../src/features/admin/orderStockEngine.ts) 에서 끊었지만,
 * 이미 쌓인 건 그대로 남아 있다(재고 부족 경고 67 · 원료 로트 부족 24 = 91건).
 * 전체 알림 455건의 20%다 — 새 주문·언급이 그 사이에 묻힌다.
 *
 * **지우는 건 이 둘뿐이다.** 같은 `inventory_shortage` 갈래여도
 *   · 원장·로트 불일치   원장과 로트가 갈렸다는 뜻 — **사고 신호다**
 *   · 배송완료일 없는 주문  서류에서 통째로 빠진다 — **사고 신호다**
 * 이 둘은 재고량 얘기가 아니라 **어긋남** 얘기라 남긴다.
 *
 *   npx tsx scripts/fix-clear-shortage-notifs.mts            (미리보기, 기본)
 *   npx tsx scripts/fix-clear-shortage-notifs.mts --apply
 *   npx tsx scripts/fix-clear-shortage-notifs.mts --undo
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, deleteDoc, setDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const BACKUP = 'scripts/fix-clear-shortage-notifs-backup.json';
/** 지울 제목 — 제목으로 고른다. 갈래(type)로 고르면 사고 신호까지 쓸려 나간다. */
const 지울제목 = new Set(['재고 부족 경고', '원료 로트 부족']);

const mode = process.argv.includes('--apply') ? 'apply'
  : process.argv.includes('--undo') ? 'undo' : 'dry';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (mode === 'undo') {
  if (!existsSync(BACKUP)) throw new Error('백업이 없다 — 되돌릴 수 없다');
  const rows = JSON.parse(readFileSync(BACKUP, 'utf8')).알림 as any[];
  for (const n of rows) {
    const { id, ...data } = n;
    await setDoc(doc(db, 'notifications', id), data);
  }
  console.log(`${rows.length}건 되살렸다.`);
  process.exit(0);
}

const all = (await getDocs(collection(db, 'notifications'))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const 대상 = all.filter(n => 지울제목.has(String(n.title ?? '')));
const 남길것 = all.filter(n => n.type === 'inventory_shortage' && !지울제목.has(String(n.title ?? '')));

console.log(`알림 전체 ${all.length}건`);
console.log(`  지울 것 ${대상.length}건: ${[...지울제목].join(' · ')}`);
console.log(`  남길 것 ${남길것.length}건: ${[...new Set(남길것.map(n => n.title))].join(' · ')}  ← 사고 신호라 둔다`);

if (대상.length === 0) { console.log('\n지울 게 없다.'); process.exit(0); }
if (mode === 'dry') { console.log('\n미리보기다. 실제로 지우려면 --apply'); process.exit(0); }

//  백업이 있으면 덮어쓰지 않는다 — 두 번 돌리면 빈 백업이 남아 --undo 가 아무것도 못 되살린다
if (!existsSync(BACKUP)) {
  writeFileSync(BACKUP, JSON.stringify({ 적은날: new Date().toISOString(), 알림: 대상 }, null, 2), 'utf8');
  console.log(`\n백업: ${BACKUP} (${대상.length}건)`);
} else {
  console.log(`\n백업이 이미 있다 — 그대로 둔다(${BACKUP})`);
}

let n = 0;
for (const x of 대상) { await deleteDoc(doc(db, 'notifications', x.id)); n++; }
console.log(`${n}건 지웠다.`);
process.exit(0);
