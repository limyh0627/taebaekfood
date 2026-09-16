// **볶음참깨 — 재고와 로트를 양수 쪽에 맞춘다.**
//   미리보기  npx tsx scripts/fix-sesame-lots.mts
//   적용      … --apply          되돌리기  … --undo
//   백업: scripts/fix-sesame-lots-backup.json
//
// 왜 (2026-09-16 사장님) — "볶음참꺠 로트 틀어져 있던것도 재고관리화면에 양수재고
// 기록된 있던 걸로 맞췄냐", "다 값이 양수인거에다 맞춰".
//
// **어느 쪽이 양수냐가 품목마다 다르다:**
//   볶음참깨-낱개/1kg   stock  30  ↔  로트  −14개   → 로트를 30 으로
//   볶음참깨/1kg        stock  39  ↔  로트   −7박스  → 로트를 39 로
//   볶음참깨/1kg        stock  14  ↔  로트  −26박스  → 로트를 14 로
//   볶음참깨(벌크)      stock −59  ↔  로트   48kg    → stock 을 48 로
//
// 음수 로트는 **로트를 쓰기 전 재고가 출고를 앞지른 흔적**이다(`deductLotsByQty` 가
// '이월' 버킷으로 흡수한 것). 사람이 세어 넣은 양수 쪽이 실물이다.
//
// **바꾸는 것만 열거한다** — 아래 네 품목의 `lots`·`stock`, 그리고 벌크의 `lotsAreTotal`.
// 그 밖에는 아무것도 안 건드린다: 원료수불부·전표·주문·다른 품목 전부 그대로다.
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { anchorLotsByQty } from '../src/shared/lotAnchor';
import { lotQtyRemaining } from '../src/shared/lotUtils';
import type { RawMaterialLot } from '../src/shared/types';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const UNDO = args.includes('--undo');
const BACKUP = 'scripts/fix-sesame-lots-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const 돈 = (n: number) => Math.round(n * 1000) / 1000;

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error(`\n백업이 없다(${BACKUP}).\n`); process.exit(1); }
  const 백업본 = JSON.parse(readFileSync(BACKUP, 'utf-8')) as Record<string, { stock: number; lots: RawMaterialLot[]; lotsAreTotal?: boolean }>;
  for (const [id, 것] of Object.entries(백업본)) {
    await updateDoc(doc(db, 'items', id), { stock: 것.stock, lots: 것.lots, ...(것.lotsAreTotal !== undefined ? { lotsAreTotal: 것.lotsAreTotal } : {}) });
    console.log(`  되살림 ${id}`);
  }
  console.log('\n백업대로 되돌렸다.\n');
  process.exit(0);
}

const items = (await getDocs(collection(db, 'items'))).docs
  .map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
  .filter(i => !i.archived && /볶음참깨/.test(String(i.name ?? '')) && ((i.lots as unknown[])?.length ?? 0) > 0);

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

const 계획: { id: string; name: string; before: Record<string, unknown>; after: Record<string, unknown>; 설명: string }[] = [];

for (const i of items) {
  const lots = ((i.lots ?? []) as RawMaterialLot[]);
  const stock = Number(i.stock ?? 0);
  const 개수로트 = lots.some(l => l.qtyRemaining != null);

  if (개수로트) {
    //  개수로 세는 품목(박스·낱개) — **로트를 stock 에 맞춘다.**
    const before = lotQtyRemaining(lots);
    if (돈(before) === 돈(stock)) { console.log(`건너뜀 ${i.name} — 이미 맞는다(${stock})`); continue; }
    const a = anchorLotsByQty({
      lots, targetQty: stock,
      unitKg: lots.find(l => l.unitKg)?.unitKg
        ?? (lots.find(l => l.qtyIn)?.kgIn ?? 0) / (lots.find(l => l.qtyIn)?.qtyIn || 1),
      det: { id: `fix-sesame-${i.id}`, createdAt: new Date().toISOString(), receivedDate: new Date().toISOString().slice(0, 10) },
    });
    계획.push({
      id: i.id as string, name: i.name as string,
      before: { stock, 로트합: before },
      after: { stock, 로트합: lotQtyRemaining(a.lots) },
      설명: `로트 ${before} → ${lotQtyRemaining(a.lots)} (이월 버킷에 ${a.deltaQty > 0 ? '+' : ''}${a.deltaQty})`,
    });
    (i as Record<string, unknown>).__nextLots = a.lots;
  } else {
    //  kg 으로 세는 벌크 — **stock 을 로트합에 맞춘다.** stock 이 음수라 말이 안 된다.
    const 로트합 = 돈(lots.filter(l => l.status === 'active').reduce((s, l) => s + Number(l.kgRemaining ?? 0), 0));
    if (돈(stock) === 로트합) { console.log(`건너뜀 ${i.name} — 이미 맞는다(${stock})`); continue; }
    계획.push({
      id: i.id as string, name: i.name as string,
      before: { stock, 로트합, lotsAreTotal: !!i.lotsAreTotal },
      after: { stock: 로트합, 로트합, lotsAreTotal: false },
      설명: `stock ${stock} → ${로트합}` + (i.lotsAreTotal ? ` · lotsAreTotal ON → OFF` : ''),
    });
    (i as Record<string, unknown>).__nextStock = 로트합;
  }
}

if (!계획.length) { console.log('\n바꿀 것이 없다.\n'); process.exit(0); }

for (const p of 계획) {
  console.log(`\n  ${p.name}  [${p.id}]`);
  console.log(`     전  ${JSON.stringify(p.before)}`);
  console.log(`     후  ${JSON.stringify(p.after)}`);
  console.log(`     → ${p.설명}`);
}

console.log('\n안 건드리는 것: 원료수불부 · rawInventories 상태문서 · 전표 · 주문 · 다른 품목');
console.log('  (벌크의 lotsAreTotal 을 끄는 까닭: 켜 두면 실사로 맞춰도 다음 입고·사용부터');
console.log('   stock 이 로트를 안 따라가 곧바로 다시 갈린다)');

if (!APPLY) { console.log('\n미리보기였다. 적용하려면 --apply.\n'); process.exit(0); }

if (existsSync(BACKUP)) { console.error(`\n이미 백업이 있다(${BACKUP}) — 옮기고 다시 실행한다.\n`); process.exit(1); }
const 백업본: Record<string, unknown> = {};
for (const p of 계획) {
  const snap = await getDoc(doc(db, 'items', p.id));
  const d = snap.data() as Record<string, unknown>;
  백업본[p.id] = { stock: d.stock ?? 0, lots: d.lots ?? [], ...(d.lotsAreTotal !== undefined ? { lotsAreTotal: d.lotsAreTotal } : {}) };
}
writeFileSync(BACKUP, JSON.stringify(백업본, null, 1), 'utf-8');
console.log(`\n백업 → ${BACKUP}`);

for (const p of 계획) {
  const i = items.find(x => x.id === p.id) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (i.__nextLots) patch.lots = JSON.parse(JSON.stringify(i.__nextLots));
  if (i.__nextStock !== undefined) { patch.stock = i.__nextStock; patch.lotsAreTotal = false; }
  await updateDoc(doc(db, 'items', p.id), patch);
  console.log(`  적용 ${p.name}`);
}

//  **다시 읽어 확인한다** — 썼다고 믿지 않는다.
console.log('\n═══ 다시 읽어 확인 ═══');
for (const p of 계획) {
  const d = (await getDoc(doc(db, 'items', p.id))).data() as Record<string, unknown>;
  const lots = (d.lots ?? []) as RawMaterialLot[];
  const 개수 = lots.some(l => l.qtyRemaining != null);
  const 합 = 개수 ? lotQtyRemaining(lots) : 돈(lots.filter(l => l.status === 'active').reduce((s, l) => s + Number(l.kgRemaining ?? 0), 0));
  const 맞나 = 돈(Number(d.stock ?? 0)) === 돈(합);
  console.log(`  ${맞나 ? '✅' : '⚠'} ${p.name}  stock ${d.stock} · 로트합 ${합}${d.lotsAreTotal ? ' · lotsAreTotal ON' : ''}`);
}
console.log('\n되돌리려면 --undo.\n');
process.exit(0);
