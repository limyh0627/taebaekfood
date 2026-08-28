// 태영상회 주문 삭제 건 — **재고는 되돌리지 않는다**(사장님 지시: "되돌리지마 그냥 삭제해").
//   기본 = --dry.  적용 = --apply.
//
// fix-delete-order-taeyoung.mts가 출고취소·생산취소로 낱개 36병·2호박스 3개를 되살렸다.
// 실물은 이미 나갔으니 그 복원을 다시 물린다. 주문 문서는 지워진 채로 둔다.
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, updateDoc, getDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const SRC = 'scripts/fix-delete-order-taeyoung-backup.json';
if (!existsSync(SRC)) { console.error('백업이 없다.'); process.exit(1); }

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const prev = JSON.parse(readFileSync(SRC, 'utf8')) as { items: Record<string, { stock: number; lots?: any[] }> };
console.log(`\n═══ ${APPLY ? '🔴 적용(--apply)' : '🟢 미리보기(dry)'} ═══\n`);
let n = 0;
for (const [id, v] of Object.entries(prev.items)) {
  const snap = await getDoc(doc(db, 'items', id));
  if (!snap.exists()) continue;
  const now = Number(snap.data().stock ?? 0);
  if (Math.abs(now - v.stock) < 0.001) continue;
  console.log(`   ${String(snap.data().name)} ${snap.data().spec ?? ''}  ${now} → ${v.stock}`);
  if (APPLY) await updateDoc(doc(db, 'items', id), v.lots ? { stock: v.stock, lots: v.lots } : { stock: v.stock });
  n++;
}
console.log(`\n${APPLY ? '✅' : ''} ${n}건 ${APPLY ? '되물림 (주문은 지워진 채로 둔다)' : '되물릴 예정'}`);
if (!APPLY) console.log(`적용: npx tsx scripts/fix-taeyoung-keep-stock.mts --apply`);
process.exit(0);
