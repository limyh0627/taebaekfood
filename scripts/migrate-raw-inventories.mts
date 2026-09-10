// 원자화 이관 4단계 — `items.stock/lots` 에서 `rawInventories` 초기 문서를 만든다.
//   기본 = --dry (미리보기, 쓰기 없음).  적용 = --apply.  되돌리기 = --undo.
//   백업: scripts/migrate-raw-inventories-v2-backup.json
//
//   설계: docs/원료실제원장-로트-원자화-설계.md §15 의 4단계.
//
// 무엇을 만드나 —
//   원료 홀더 하나당 `rawInventories/{companyId}__{rawItemId}` 문서 하나.
//   현재 상태(활성 로트 + stockKg)를 그대로 옮겨 담는다.
//
//   등식(§2): `stockKg === activeLots 의 kgRemaining 합`.
//   그래서 `stockKg` 는 `items.stock` 이 아니라 **로트에서 다시 센다.**
//   `lotsAreTotal` 원료(볶음참깨)는 원래 `items.stock` 과 로트가 다른 숫자인데,
//   새 구조에서는 **로트만** 담는다 — 포장분은 자기 품목 재고가 맡는다(§2).
//
// 아직 아무도 안 읽는다 —
//   호출부 교체(5단계)는 다음이다. 이 문서를 만들어 두는 것만으로는 앱 동작이 안 바뀐다.
//   `items.stock/lots` 는 그대로 두고, 한동안 두 곳이 같이 있는다(설계 §2 "이관 기간").
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, runTransaction } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { baseRawName } from '../src/constants/formula';
import { ledgerBalanceKg } from '../src/shared/rawLedgerBalance';
import { inventoryDocId, DEPLETED_RETENTION } from '../src/shared/rawInventoryCore';
import type { RawInventoryState } from '../src/shared/rawInventoryCore';
import type { RawMaterialEntry, RawMaterialLot, CompanyId } from '../src/shared/types';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/migrate-raw-inventories-v2-backup.json';
const TOL = 1;   // 원장·로트 오차 한도(kg) — ledgerLotCheck.GAP_TOLERANCE_KG 와 같다

type StoredDocument = { id: string; data: Record<string, unknown> };
type MigrationBackup = {
  적은때: string;
  설명: string;
  기존문서: StoredDocument[];
  적용후문서: StoredDocument[];
};

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
};
const sameData = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

console.log(`\n═══ ${UNDO ? '↩ 되돌리기(--undo)' : APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없다: ${BACKUP}`);
  const b = JSON.parse(readFileSync(BACKUP, 'utf8')) as MigrationBackup;
  const beforeById = new Map(b.기존문서.map(entry => [entry.id, entry.data]));
  await runTransaction(db, async transaction => {
    const refs = b.적용후문서.map(entry => doc(db, 'rawInventories', entry.id));
    const current = await Promise.all(refs.map(ref => transaction.get(ref)));
    for (let index = 0; index < current.length; index += 1) {
      const expected = b.적용후문서[index];
      if (!current[index].exists() || !sameData(current[index].data(), expected.data)) {
        throw new Error(`${expected.id}: 이관 뒤 재고 작업이 생겨 자동으로 되돌릴 수 없다.`);
      }
    }
    for (const entry of b.적용후문서) {
      const ref = doc(db, 'rawInventories', entry.id);
      const before = beforeById.get(entry.id);
      if (before) transaction.set(ref, before);
      else transaction.delete(ref);
    }
  });
  const kept = `${BACKUP}.undone-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  renameSync(BACKUP, kept);
  console.log(`백업 보존 → ${kept}`);
  console.log('\n✅ 되돌렸다.\n');
  process.exit(0);
}

const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [items, ledger, existingSnapshot] = await Promise.all([
  load('items'),
  load('rawMaterialLedger'),
  getDocs(collection(db, 'rawInventories')),
]);

const isHolder = (i: any) => String(i.subtype ?? '') === '벌크' && !i.phantom && !i.archived;
const companyOf = (x: any): CompanyId => (x?.companyId ?? 'taebaek') as CompanyId;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const now = new Date().toISOString();

const holders = items.filter(isHolder);
console.log(`원료 홀더 ${holders.length}개\n`);

const 문서: RawInventoryState[] = [];
const 경고: string[] = [];

for (const h of holders) {
  const companyId = companyOf(h);
  const material = baseRawName(h.name ?? '');
  const lots = (h.lots ?? []) as RawMaterialLot[];

  const active = lots.filter(l => l.status !== 'depleted');
  const depleted = lots.filter(l => l.status === 'depleted').slice(-DEPLETED_RETENTION).reverse();
  const stockKg = r3(active.reduce((a, l) => a + Number(l.kgRemaining ?? 0), 0));

  //  마지막 실사 앵커 — 소급 입력 판정(§10)이 이걸 본다.
  const mine = (ledger as RawMaterialEntry[]).filter(e => (e.rawItemId ?? '') === h.id);
  const anchors = mine.filter(e => e.targetKg != null)
    .sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')));
  const last = anchors[anchors.length - 1];

  //  출발선 확인 — 원장 잔량과 로트가 맞아야 옮길 수 있다.
  const 원장 = r3(ledgerBalanceKg(mine));
  if (Math.abs(원장 - stockKg) > TOL) {
    경고.push(`${companyId}/${material}: 원장 ${원장} ≠ 로트 ${stockKg} (${r3(원장 - stockKg)})`);
  }

  문서.push({
    id: inventoryDocId(companyId, h.id),
    companyId, rawItemId: h.id, materialSnapshot: material,
    stockKg, activeLots: active, recentDepletedLots: depleted,
    ...(last ? { stocktakeAnchor: {
      // 옛 실사는 시각이 없으므로 그날 끝으로 둔다. 새 실사부터 버튼을 누른 순간을 쓴다.
      effectiveAt: `${String(last.date)}T23:59:59.999+09:00`,
      operationId: String((last as any).operationId ?? last.id),
      sequence: 0,
    } } : {}),
    // revision 0 = 아직 새 상태 문서로는 아무 명령도 안 먹었다. 첫 명령이 1 로 올린다.
    revision: 0,
    lastProcessedAt: now,
  });

  const 크기 = JSON.stringify(문서[문서.length - 1]).length;
  console.log(`  ${companyId.padEnd(8)} ${material.padEnd(12)} stock ${String(stockKg).padStart(10)}  활성로트 ${String(active.length).padStart(2)}  소진보관 ${String(depleted.length).padStart(2)}  ${String(크기).padStart(5)}B  ${last ? `실사 ${last.date}` : ''}`);
}

const 최대 = Math.max(...문서.map(d => JSON.stringify(d).length));
console.log(`\n문서 ${문서.length}개 · 최대 ${최대}B (Firestore 한도 1MB — 여유 충분)`);

if (경고.length) {
  console.log(`\n⚠ 원장과 로트가 아직 갈린 곳 ${경고.length}건 — 옮기기 전에 맞춰야 한다`);
  for (const w of 경고) console.log(`   ${w}`);
  if (APPLY) { console.log('\n중단한다. 먼저 fix-raw-ledger-anchor-to-lots.mts 로 맞춰라.\n'); process.exit(1); }
}

if (!APPLY) {
  console.log('\n미리보기만 했다. 실제로 만들려면 --apply 를 붙여라.\n');
  process.exit(0);
}

// 최초 이관 백업은 ID만 있어 현재 문서를 복구하지 못한다. 최종 이관은 별도 백업에 실제 내용을 보존한다.
if (existsSync(BACKUP)) throw new Error(`기존 백업이 있다. 먼저 --undo 하거나 백업을 확인하라: ${BACKUP}`);

const targetIds = new Set(문서.map(entry => entry.id));
const 기존문서 = existingSnapshot.docs
  .filter(entry => targetIds.has(entry.id))
  .map(entry => ({ id: entry.id, data: JSON.parse(JSON.stringify(entry.data())) as Record<string, unknown> }));
const 적용후문서 = 문서.map(entry => ({
  id: entry.id,
  data: JSON.parse(JSON.stringify(entry)) as Record<string, unknown>,
}));
const backup: MigrationBackup = {
  적은때: now,
  설명: 'rawInventories 최종 규격 재이관 — 되돌리면 기존 문서 내용을 복구한다. 이관 뒤 작업이 있으면 중단한다.',
  기존문서,
  적용후문서,
};
writeFileSync(BACKUP, JSON.stringify(backup, null, 2), 'utf8');
console.log(`\n백업 → ${BACKUP}`);

const migrationItemData = (item: Record<string, any>) => ({
  companyId: item.companyId ?? null,
  name: item.name ?? null,
  subtype: item.subtype ?? null,
  phantom: item.phantom ?? null,
  archived: item.archived ?? null,
  lots: item.lots ?? [],
});
const itemById = new Map(items.map(item => [item.id, migrationItemData(item)] as const));
const existingById = new Map(기존문서.map(entry => [entry.id, entry.data]));
try {
  await runTransaction(db, async transaction => {
    const itemRefs = 문서.map(entry => doc(db, 'items', entry.rawItemId));
    const inventoryRefs = 문서.map(entry => doc(db, 'rawInventories', entry.id));
    const [currentItems, currentInventories] = await Promise.all([
      Promise.all(itemRefs.map(ref => transaction.get(ref))),
      Promise.all(inventoryRefs.map(ref => transaction.get(ref))),
    ]);

    for (let index = 0; index < 문서.length; index += 1) {
      const target = 문서[index];
      const currentItem = currentItems[index];
      if (!currentItem.exists() || !sameData(migrationItemData(currentItem.data()), itemById.get(target.rawItemId))) {
        throw new Error(`${target.rawItemId}: 미리보기 뒤 품목이 바뀌었다. 다시 실행하라.`);
      }
      const currentInventory = currentInventories[index];
      const before = existingById.get(target.id);
      if (before ? (!currentInventory.exists() || !sameData(currentInventory.data(), before)) : currentInventory.exists()) {
        throw new Error(`${target.id}: 미리보기 뒤 원료 상태가 바뀌었다. 다시 실행하라.`);
      }
    }

    for (const target of 적용후문서) {
      transaction.set(doc(db, 'rawInventories', target.id), target.data);
    }
  });
} catch (error) {
  const failed = `${BACKUP}.failed-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  renameSync(BACKUP, failed);
  console.error(`적용 실패 백업 보존 → ${failed}`);
  throw error;
}
console.log(`\n✅ ${문서.length}개를 한 트랜잭션으로 최종 규격에 맞췄다.\n`);
process.exit(0);
