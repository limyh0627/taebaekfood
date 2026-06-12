/**
 * 유령 partner_item 연결을 후계 품목으로 재연결
 *
 *  1. 삭제된 품목 ID의 이름을 주문/전표/발주 기록 스냅샷에서 복원
 *  2. 이름 정규화 매칭으로 현재 품목(후계) 식별
 *     - "시골향 " 접두어, "/용량" 접미어를 제거하고 비교 (이번 이름 변경 반영)
 *  3. 거래처가 후계 품목에 미연결이면 → 단가/계정 유지한 채 재연결 생성 후 유령 삭제
 *     이미 연결돼 있으면 → 유령만 삭제 (기존 연결 유지)
 *     후계를 못 찾으면 → 보존하고 보고만
 *
 * 사용법:
 *   node scripts/relink-ghost-partner-items.mjs          # 드라이런
 *   node scripts/relink-ghost-partner-items.mjs --apply  # 적용
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const APPLY = process.argv.includes('--apply');

const firebaseConfig = {
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);
await signInAnonymously(auth);

const [itemsSnap, piSnap, partnersSnap, ordersSnap, poSnap] = await Promise.all([
  getDocs(collection(db, 'items')),
  getDocs(collection(db, 'partner_item')),
  getDocs(collection(db, 'partners')),
  getDocs(collection(db, 'orders')),
  getDocs(collection(db, 'purchaseOrders')),
]);
const itemMap = new Map(itemsSnap.docs.map(d => [d.id, d.data()]));
const partnerNameOf = new Map(partnersSnap.docs.map(d => [d.id, d.data().name]));

// ── 1. 유령 연결 수집 ─────────────────────────────────────────────
const ghosts = [];
for (const d of piSnap.docs) {
  const x = d.data();
  const iid = x.Item_ID ?? x.itemId;
  if (!iid || !itemMap.has(iid)) ghosts.push({ docId: d.id, data: x, itemId: iid });
}
const ghostItemIds = [...new Set(ghosts.map(g => g.itemId).filter(Boolean))];

// ── 2. 삭제된 품목 이름 복원 (주문/발주 스냅샷) ────────────────────
const recoveredName = new Map();
for (const d of ordersSnap.docs) {
  for (const oi of d.data().items ?? []) {
    if (oi.itemId && !itemMap.has(oi.itemId) && oi.name && !recoveredName.has(oi.itemId)) {
      recoveredName.set(oi.itemId, oi.name);
    }
  }
}
for (const d of poSnap.docs) {
  const po = d.data();
  if (po.itemId && !itemMap.has(po.itemId) && po.itemName && !recoveredName.has(po.itemId)) {
    recoveredName.set(po.itemId, po.itemName);
  }
  for (const l of po.items ?? []) {
    if (l.itemId && !itemMap.has(l.itemId) && l.name && !recoveredName.has(l.itemId)) {
      recoveredName.set(l.itemId, l.name);
    }
  }
}

// ── 3. 후계 품목 매칭 ─────────────────────────────────────────────
// 정규화: "시골향 " 접두어 제거, 끝의 "/용량" 제거, 공백 정리
const norm = (n) => (n ?? '')
  .replace(/^시골향\s+/, '')
  .replace(/\/\d+(\.\d+)?\s*(ml|kg|l|g)$/i, '')
  .replace(/\s+/g, '')
  .toLowerCase();

const currentByNorm = new Map();
for (const [id, x] of itemMap) {
  if (x.archived) continue;
  const k = norm(x.name);
  if (!currentByNorm.has(k)) currentByNorm.set(k, []);
  currentByNorm.get(k).push({ id, name: x.name, category: x.category });
}

const successorOf = new Map(); // deletedId → { id, name } | null (후보가 정확히 1개일 때만)
const ambiguousOf = new Map(); // deletedId → 후보 이름 목록 (동명 여러 개 → 추측 연결 금지)
for (const gid of ghostItemIds) {
  const oldName = recoveredName.get(gid);
  if (!oldName) { successorOf.set(gid, null); continue; }
  const candidates = currentByNorm.get(norm(oldName)) ?? [];
  if (candidates.length === 1) successorOf.set(gid, candidates[0]);
  else {
    successorOf.set(gid, null);
    if (candidates.length > 1) ambiguousOf.set(gid, candidates.map(c => c.name));
  }
}

console.log('═══ 삭제된 품목 → 후계 품목 매핑 ═══');
for (const gid of ghostItemIds) {
  const s = successorOf.get(gid);
  const oldName = recoveredName.get(gid);
  const amb = ambiguousOf.get(gid);
  console.log(`  ${gid} "${oldName ?? '(이름 복원 실패)'}" → ${s ? `${s.id} "${s.name}"` : amb ? `⚠ 후보 ${amb.length}개 (${amb.join(' / ')}) — 보존` : '✗ 후계 못 찾음 — 보존'}`);
}

// ── 4. 유령별 처리 계획 ──────────────────────────────────────────
const existingPairs = new Set();
for (const d of piSnap.docs) {
  const x = d.data();
  const iid = x.Item_ID ?? x.itemId;
  const cid = x.Partner_ID ?? x.partnerId;
  if (iid && cid && itemMap.has(iid)) existingPairs.add(`${iid}|${cid}|${x.Direction ?? 'out'}`);
}

const relinks = [];  // 새 연결 생성 + 유령 삭제
const dropOnly = []; // 이미 연결 있음 → 유령만 삭제
const keep = [];     // 후계 불명 → 보존
for (const g of ghosts) {
  const cid = g.data.Partner_ID ?? g.data.partnerId;
  const dir = g.data.Direction ?? 'out';
  const s = g.itemId ? successorOf.get(g.itemId) : null;
  if (!s) { keep.push(g); continue; }
  const pairKey = `${s.id}|${cid}|${dir}`;
  if (existingPairs.has(pairKey)) dropOnly.push({ ...g, successor: s });
  else {
    existingPairs.add(pairKey); // 같은 후계로 두 유령이 몰리는 중복 방지
    relinks.push({ ...g, successor: s, cid, dir });
  }
}

console.log(`\n═══ 재연결 (단가 유지하며 후계 품목으로 이전): ${relinks.length}건 ═══`);
for (const r of relinks) {
  console.log(`  ${partnerNameOf.get(r.cid) ?? r.cid}: ${r.itemId}("${recoveredName.get(r.itemId)}") → ${r.successor.name}${r.data.price ? ` [단가 ${r.data.price.toLocaleString()}원 유지]` : ''}`);
}
console.log(`\n═══ 유령만 삭제 (후계 품목에 이미 연결됨): ${dropOnly.length}건 ═══`);
for (const r of dropOnly) {
  console.log(`  ${partnerNameOf.get(r.data.Partner_ID ?? r.data.partnerId)}: ${r.itemId} (후계 ${r.successor.name} 연결 이미 있음)`);
}
console.log(`\n═══ 보존 (후계 불명 — 수동 확인 필요): ${keep.length}건 ═══`);
for (const g of keep) {
  console.log(`  ${partnerNameOf.get(g.data.Partner_ID ?? g.data.partnerId)}: ${g.itemId} "${recoveredName.get(g.itemId) ?? '이름 복원 실패'}"`);
}

if (!APPLY) {
  console.log('\n(드라이런 — 적용하려면 --apply)');
  process.exit(0);
}

console.log('\n═══ 적용 시작 ═══');
let done = 0;
const all = [
  ...relinks.map(r => (batch) => {
    const newId = `${r.successor.id}_${r.cid}_${r.dir}`;
    const { Item_ID, itemId, ...rest } = r.data;
    batch.set(doc(db, 'partner_item', newId), { ...rest, id: newId, Item_ID: r.successor.id, Partner_ID: r.cid, Direction: r.dir });
    batch.delete(doc(db, 'partner_item', r.docId));
  }),
  ...dropOnly.map(r => (batch) => batch.delete(doc(db, 'partner_item', r.docId))),
];
for (let i = 0; i < all.length; i += 200) {
  const batch = writeBatch(db);
  for (const fn of all.slice(i, i + 200)) fn(batch);
  await batch.commit();
  done = Math.min(i + 200, all.length);
  console.log(`  ${done}/${all.length} 커밋`);
}
console.log(`✅ 재연결 ${relinks.length}건, 유령 삭제 ${dropOnly.length}건, 보존 ${keep.length}건`);
process.exit(0);
