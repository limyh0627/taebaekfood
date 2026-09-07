/**
 * 9/4 대왕 전표(260904-006)에 20번 주문을 잇고, 20번을 예전 주문으로 되돌린다.
 *
 * ── 왜 ──────────────────────────────────────────────────────────────────
 * 2026-09-07 사장님: 20번이 중복인 줄 알고 지우려다, 그 물건을 이미 9/4 에 손으로
 * 끊어 청구했다는 걸 확인했다(619,500원). 지울 게 아니라 **이어야 할 것**이었다.
 *
 *   전표 260904-006  시골향들깨가루(중간)/1kg×20 · 시골향참기름/분/1800ml×12 · 참기름/특A/대왕/1800ml×12
 *   주문 20번        시골향들깨가루(중간)/1kg×20 · 시골향참기름/분/1800ml×1  · 참기름/A/천하1750ml×10
 *
 * 전표는 `orderId` 가 빈 글자였다 — 손으로 끊으면 안 채워진다. 그래서 20번이
 * '미발행'으로 떠서 중복처럼 보였다. 발행 여부는 **전표 실물**이 근거라
 * (`voucherMerge.voucheredOrderIds`), 이 칸을 채우면 미발행 목록에서 빠진다.
 *
 * ── 상태 되돌리기 ────────────────────────────────────────────────────────
 * 지우려고 앱에서 작업중(PROCESSING)으로 내렸는데 **재고 되돌리기는 안 돌았다.**
 * 확인한 값 — producedAt 있음 · shippedOut true · rawLotsDeducted true ·
 * rawConsumedLots 3건 · 원료원장 3줄 그대로. 재고와 원료가 출고된 상태 그대로다.
 *
 * 그래서 여기서는 **status 한 칸만** DELIVERED 로 되돌린다. 재고를 건드리면 안 된다 —
 * 안 빠진 걸 또 빼거나, 이미 빠진 걸 되돌리면 그때부터 장부가 갈린다.
 *
 * ── 쓰는 법 ──────────────────────────────────────────────────────────────
 *   npx tsx scripts/fix-link-o20-stmt260904.mts            (미리보기, 기본)
 *   npx tsx scripts/fix-link-o20-stmt260904.mts --apply
 *   npx tsx scripts/fix-link-o20-stmt260904.mts --undo
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

//  프로젝트 뿌리에서 돌리는 걸 전제로 상대경로를 쓴다(다른 fix-* 와 같은 방식).
//  import.meta.url 로 만들면 폴더 이름의 한글이 %EC%96%B4 로 새어 나와 파일을 못 연다.
const BACKUP = 'scripts/fix-link-o20-stmt260904-backup.json';

const STMT = 'stmt-1788713871068';           // 260904-006 · 대왕푸드 · 619,500
const ORDER = 'ORD-1788768673611';           // ORD-260907-020

const mode = process.argv.includes('--apply') ? 'apply'
  : process.argv.includes('--undo') ? 'undo' : 'dry';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const stmtRef = doc(db, 'issuedStatements', STMT);
const orderRef = doc(db, 'orders', ORDER);
const [s, o] = await Promise.all([getDoc(stmtRef), getDoc(orderRef)]);
if (!s.exists()) throw new Error(`전표 ${STMT} 가 없다`);
if (!o.exists()) throw new Error(`주문 ${ORDER} 가 없다`);
const sd = s.data() as any, od = o.data() as any;

if (mode === 'undo') {
  if (!existsSync(BACKUP)) throw new Error('백업이 없다 — 되돌릴 수 없다');
  const b = JSON.parse(readFileSync(BACKUP, 'utf8'));
  await updateDoc(stmtRef, { orderId: b.stmt.orderId });
  await updateDoc(orderRef, { status: b.order.status });
  console.log(`되돌렸다 — 전표 orderId=${JSON.stringify(b.stmt.orderId)} · 주문 status=${b.order.status}`);
  process.exit(0);
}

console.log(`전표 ${sd.docNo}  ${sd.tradeDate}  ${(sd.totalAmount ?? 0).toLocaleString()}원  ${sd.partnerName}`);
console.log(`  orderId : ${JSON.stringify(sd.orderId ?? '')}  →  ${JSON.stringify(ORDER)}`);
console.log(`주문 ${od.cardNo}  ${od.partnerName}`);
console.log(`  status  : ${od.status}  →  DELIVERED`);
console.log(`  ※ 재고·원료는 손대지 않는다 (rawLotsDeducted=${od.rawLotsDeducted} · shippedOut=${od.shippedOut} — 이미 빠진 그대로다)`);

//  이미 이어져 있으면 아무것도 안 한다 — 두 번 돌려도 탈이 없어야 한다
if (String(sd.orderId ?? '') === ORDER && od.status === 'DELIVERED') {
  console.log('\n이미 되어 있다 — 할 일 없음.');
  process.exit(0);
}

if (mode === 'dry') {
  console.log('\n미리보기다. 실제로 고치려면 --apply');
  process.exit(0);
}

//  백업이 이미 있으면 덮어쓰지 않는다 — 두 번 돌리면 '고친 값'이 원본으로 남아 --undo 가 죽는다
if (!existsSync(BACKUP)) {
  writeFileSync(BACKUP, JSON.stringify({
    적은날: new Date().toISOString(),
    stmt: { id: STMT, docNo: sd.docNo, orderId: sd.orderId ?? '' },
    order: { id: ORDER, cardNo: od.cardNo, status: od.status },
  }, null, 2), 'utf8');
  console.log(`\n백업: ${BACKUP}`);
} else {
  console.log(`\n백업이 이미 있다 — 그대로 둔다(${BACKUP})`);
}

await updateDoc(stmtRef, { orderId: ORDER });
await updateDoc(orderRef, { status: 'DELIVERED' });
console.log('고쳤다.');
process.exit(0);
