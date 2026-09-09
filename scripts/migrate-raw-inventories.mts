// 원자화 이관 4단계 — `items.stock/lots` 에서 `rawInventories` 초기 문서를 만든다.
//   기본 = --dry (미리보기, 쓰기 없음).  적용 = --apply.  되돌리기 = --undo.
//   백업: scripts/migrate-raw-inventories-backup.json
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
import { getFirestore, collection, getDocs, doc, writeBatch, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { baseRawName } from '../src/constants/formula';
import { ledgerBalanceKg } from '../src/shared/rawLedgerBalance';
import { inventoryDocId, DEPLETED_RETENTION } from '../src/shared/rawInventoryCore';
import type { RawInventoryState } from '../src/shared/rawInventoryCore';
import type { RawMaterialEntry, RawMaterialLot, CompanyId } from '../src/shared/types';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/migrate-raw-inventories-backup.json';
const TOL = 1;   // 원장·로트 오차 한도(kg) — ledgerLotCheck.GAP_TOLERANCE_KG 와 같다

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

console.log(`\n═══ ${UNDO ? '↩ 되돌리기(--undo)' : APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없다: ${BACKUP}`);
  const b = JSON.parse(readFileSync(BACKUP, 'utf8')) as { 만든문서: string[] };
  console.log(`지울 문서 ${b.만든문서.length}개`);
  for (const id of b.만든문서) {
    await deleteDoc(doc(db, 'rawInventories', id));
    console.log(`  지움 ${id}`);
  }
  console.log('\n✅ 되돌렸다.\n');
  process.exit(0);
}

const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [items, ledger] = await Promise.all([load('items'), load('rawMaterialLedger')]);

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
    ...(last ? { lastStocktakeDate: String(last.date), lastStocktakeOperationId: String(last.id) } : {}),
    //  version 0 = 아직 이 문서로는 아무 작업도 안 먹었다. 첫 명령이 1 로 올린다.
    version: 0,
    updatedAt: now,
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

writeFileSync(BACKUP, JSON.stringify({
  적은때: now,
  설명: 'rawInventories 초기 문서 — 되돌리려면 --undo (이 문서들만 지운다. items 는 안 건드렸다)',
  만든문서: 문서.map(d => d.id),
}, null, 2), 'utf8');
console.log(`\n백업 → ${BACKUP}`);

const batch = writeBatch(db);
for (const d of 문서) batch.set(doc(db, 'rawInventories', d.id), JSON.parse(JSON.stringify(d)));
await batch.commit();
console.log(`\n✅ ${문서.length}개 만들었다.\n`);
process.exit(0);
