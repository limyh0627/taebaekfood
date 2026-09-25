/**
 * 통깨참기름 과거 원장 3건 정정: 9/4 +244.8kg 자동입고, 9/10 실사 앵커,
 * 9/11 +403.2kg legacy 중복 입고. 원자화 receive·소진 로트·현재고는 그대로 둔다.
 *
 * 기본 --dry / --apply / --undo. Admin SDK이므로 대상·백업·재조회 검증을 직접 한다.
 * 본부장 승인 전에는 --apply를 실행하지 않는다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { adminDb } from './_admin.mts';
import { applyLedgerRowByBusinessDate, authoritativeLedgerBalanceKg, sortLedger } from '../src/shared/rawLedgerBalance.ts';
import type { RawMaterialEntry } from '../src/shared/types.ts';

type Data = FirebaseFirestore.DocumentData;
type Snapshot = Record<string, Data | null>;
const db = adminDb();
const args = process.argv.slice(2);
if (args.some(arg => !['--dry', '--apply', '--undo'].includes(arg)) ||
    args.includes('--apply') && args.includes('--undo')) {
  throw new Error('지원 옵션: --dry(기본), --apply, --undo');
}
const APPLY = args.includes('--apply');
const UNDO = args.includes('--undo');
const COMPANY = 'taebaek';
const RAW_ID = 'raw-통깨참기름';
const MATERIAL = '통깨참기름';
const SEP4 = 'rawMaterialLedger/rm-yield-1788578724744';
const SEP10 = 'rawMaterialLedger/rm-anchor-raw-통깨참기름-20260910';
const SEP11 = 'rawMaterialLedger/rm-yield-1789175440350';
const RECEIVE = 'rawMaterialLedger/op_Zml4LXN0YXRlLTA5MTEtcHJlc3MtcmF3Le2Gteq5qOywuOq4sOumhA';
const STOCKTAKE = 'rawMaterialLedger/op_Zml4LXN0YXRlLXRvLWxvdHMtdGFlYmFlay1yYXct7Ya16rmo7LC46riw66aELTIwMjYtMDktMTE';
const PREVIOUS = 'rawMaterialLedger/rm-stocktake-1786664525686';
const PATHS = [SEP4, SEP10, SEP11, RECEIVE, STOCKTAKE] as const;
const BACKUP = '로컬전용/백업/tongkkae-three-ledger-records-2026-09-25.json';
const SEP4_LOT = 'lot-통깨참기름-1788578724855-1htu';
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const idOf = (path: string) => path.split('/')[1];

async function readDocs(paths: readonly string[]): Promise<Snapshot> {
  const docs = await db.getAll(...paths.map(path => db.doc(path)));
  return Object.fromEntries(docs.map((snap, index) =>
    [paths[index], snap.exists ? snap.data()! : null]));
}

function assertJsonRoundTrip(snapshot: Snapshot, label: string) {
  for (const [path, data] of Object.entries(snapshot)) {
    if (data == null) continue;
    // Firestore Timestamp/GeoPoint 같은 객체는 JSON 백업 뒤 타입이 사라져 undo 비교·복원이 틀어진다.
    // 이번 대상은 모두 평범한 원장 객체여야 하므로 적용 전에 왕복 동일성을 강제한다.
    const restored = JSON.parse(JSON.stringify(data));
    if (!isDeepStrictEqual(data, restored)) {
      throw new Error(`${label} 문서에 JSON 백업으로 복원할 수 없는 필드가 있습니다: ${path}`);
    }
  }
}

async function readWitness() {
  const [item, state, ledger] = await Promise.all([
    db.doc(`items/${RAW_ID}`).get(),
    db.doc(`rawInventories/${COMPANY}__${RAW_ID}`).get(),
    db.collection('rawMaterialLedger').where('material', '==', MATERIAL).get(),
  ]);
  if (!item.exists || !state.exists) throw new Error('품목·원자화 상태가 없습니다.');
  const itemData = item.data()!;
  const stateData = state.data()!;
  const entries = ledger.docs.map(doc => ({ id: doc.id, ...doc.data() } as RawMaterialEntry))
    .filter(row => row.rawItemId === RAW_ID && (row.companyId === COMPANY || !row.companyId));
  const stock = round3(Number(itemData.stock));
  const stateStock = round3(Number(stateData.stockKg));
  const lotKg = round3((itemData.lots ?? []).reduce((sum: number, lot: Data) =>
    sum + Number(lot.kgRemaining ?? 0), 0));
  const authoritative = round3(authoritativeLedgerBalanceKg(entries, 0.916));
  if (itemData.companyId !== COMPANY || stateData.companyId !== COMPANY ||
      !Number.isFinite(stock) || stock !== stateStock || stock !== lotKg || stock !== authoritative) {
    throw new Error(`현재 재고 4축이 다릅니다: stock ${stock}, state ${stateStock}, lot ${lotKg}, ledger ${authoritative}`);
  }
  const itemLot = (itemData.lots ?? []).find((lot: Data) => lot.id === SEP4_LOT);
  const stateLot = [...(stateData.activeLots ?? []), ...(stateData.recentDepletedLots ?? [])]
    .find((lot: Data) => lot.id === SEP4_LOT);
  if (!itemLot || !stateLot || itemLot.kgIn !== 244.8 || stateLot.kgIn !== 244.8 ||
      itemLot.kgRemaining !== 0 || stateLot.kgRemaining !== 0 ||
      itemLot.receivedDate !== '2026-09-04' || stateLot.receivedDate !== '2026-09-04') {
    throw new Error('9/4 소진 로트 상태가 조사 당시와 다릅니다.');
  }
  return { entries, stock, stateStock, lotKg, authoritative, itemLot, stateLot };
}

function assertBaseline(docs: Snapshot) {
  const sep4 = docs[SEP4], sep10 = docs[SEP10], sep11 = docs[SEP11];
  const receive = docs[RECEIVE], stocktake = docs[STOCKTAKE];
  const base = (d: Data | null, date: string, received: number) =>
    d?.companyId === COMPANY && d.rawItemId === RAW_ID && d.material === MATERIAL &&
    d.date === date && Number(d.received) === received && Number(d.used) === 0;
  if (!base(sep4, '2026-09-04', 244.8) || sep4?.type !== 'auto' ||
      !base(sep10, '2026-09-10', 0) || sep10?.type !== 'correction' || sep10.targetKg !== 5094.453 ||
      !base(sep11, '2026-09-11', 403.2) || sep11?.type !== 'auto') {
    throw new Error('삭제할 세 원장 기록의 ID·회사·일자·수량이 조사 당시와 다릅니다.');
  }
  if (!base(receive, '2026-09-11', 403.2) || receive?.kind !== 'receive' ||
      receive.operationId !== 'fix-state-0911-press-raw-통깨참기름' ||
      receive.source?.id !== idOf(SEP11) || receive.source?.type !== 'manual' ||
      receive.lotChanges?.length !== 1 ||
      receive.lotChanges[0].lotId !== 'lot-fix-state-0911-press-raw-통깨참기름' ||
      receive.lotChanges[0].deltaKg !== 403.2 || receive.archivedSourceSnapshot != null) {
    throw new Error('9/11 원자화 입고의 출처·로트가 예상과 다릅니다.');
  }
  if (!base(stocktake, '2026-09-11', 0) || stocktake?.kind !== 'stocktake' ||
      stocktake.targetKg !== 4553.863 || stocktake.stocktakeAnchorBefore?.operationId !== idOf(SEP10) ||
      stocktake.stocktakeAnchorBefore?.effectiveAt !== '2026-09-10T23:59:59.999+09:00' ||
      stocktake.stocktakeAnchorBefore?.sequence !== 0) {
    throw new Error('9/11 실사의 이전 앵커 참조가 조사 당시와 다릅니다.');
  }
}

function balances(entries: RawMaterialEntry[], skipIds = new Set<string>()) {
  let kg = 0;
  const days: Record<string, number> = {};
  for (const row of sortLedger(entries)) {
    if (skipIds.has(row.id)) continue;
    kg = applyLedgerRowByBusinessDate(kg, row, 0.916);
    if (['2026-09-04', '2026-09-10', '2026-09-11'].includes(row.date)) days[row.date] = kg;
  }
  return { days, finalKg: kg };
}

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error('되돌릴 백업이 없습니다.');
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as {
    projectId: string; paths: string[]; before: Snapshot; after: Snapshot;
  };
  if (backup.projectId !== 'taebaek-3abe4' ||
      !isDeepStrictEqual(backup.paths, [...PATHS]) ||
      !isDeepStrictEqual(Object.keys(backup.before).sort(), [...PATHS].sort()) ||
      !isDeepStrictEqual(Object.keys(backup.after).sort(), [...PATHS].sort())) {
    throw new Error('백업 프로젝트·대상 문서가 다릅니다.');
  }
  await readWitness();
  await db.runTransaction(async tx => {
    const refs = PATHS.map(path => db.doc(path));
    const snaps = await Promise.all(refs.map(ref => tx.get(ref)));
    snaps.forEach((snap, index) => {
      if (!isDeepStrictEqual(snap.exists ? snap.data() : null, backup.after[PATHS[index]])) {
        throw new Error(`적용 뒤 문서가 바뀌어 되돌리기를 중단합니다: ${PATHS[index]}`);
      }
    });
    PATHS.forEach((path, index) => {
      const before = backup.before[path];
      if (before == null) tx.delete(refs[index]);
      else tx.set(refs[index], before);
    });
  });
  if (!isDeepStrictEqual(await readDocs(PATHS), backup.before)) throw new Error('복원 재조회가 백업과 다릅니다.');
  console.log('세 원장 기록·9/11 참조 복원 완료. 품목·로트·상태는 변경하지 않았습니다.');
  process.exit(0);
}

const before = await readDocs(PATHS);
assertJsonRoundTrip(before, '변경 전');
assertBaseline(before);
const previous = (await db.doc(PREVIOUS).get()).data();
if (!previous || previous.companyId !== COMPANY || previous.rawItemId !== RAW_ID ||
    previous.material !== MATERIAL || previous.date !== '2026-08-13' ||
    previous.targetKg !== 527.616) {
  throw new Error('9/10 삭제 뒤 되살릴 8/13 실사 앵커가 예상과 다릅니다.');
}
const witness = await readWitness();
const removedIds = new Set([idOf(SEP4), idOf(SEP10), idOf(SEP11)]);
const references = witness.entries.filter(row =>
  removedIds.has((row as any).source?.id) ||
  removedIds.has((row as any).stocktakeAnchorBefore?.operationId));
if (references.length !== 2 ||
    !references.some(row => row.id === idOf(RECEIVE)) ||
    !references.some(row => row.id === idOf(STOCKTAKE))) {
  throw new Error('삭제 기록을 참조하는 원자화 명령이 예상한 두 건과 다릅니다.');
}
const beforeBalance = balances(witness.entries);
const afterBalance = balances(witness.entries, removedIds);
if (round3(beforeBalance.finalKg) !== witness.stock ||
    round3(afterBalance.finalKg) !== witness.stock) {
  throw new Error('세 기록 제거 후 최종 원장 잔량이 현재 재고와 다릅니다.');
}
const after: Snapshot = {
  ...before,
  [SEP4]: null,
  [SEP10]: null,
  [SEP11]: null,
  // 명령 해시의 source는 원본 ID 그대로 둔다. 삭제된 원본의 내용은 명령 안과 별도 백업에 남긴다.
  [RECEIVE]: { ...before[RECEIVE]!, archivedSourceSnapshot: before[SEP11]! },
  // 실사 reverse가 직전 앵커를 복구할 때 삭제된 9/10 대신 살아 있는 8/13을 가리키게 한다.
  [STOCKTAKE]: { ...before[STOCKTAKE]!, stocktakeAnchorBefore: {
    effectiveAt: '2026-08-13T23:59:59.999+09:00', operationId: idOf(PREVIOUS), sequence: 0,
  } },
};
assertJsonRoundTrip(after, '변경 후');
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry', deletePaths: [SEP4, SEP10, SEP11],
  sep11CanonicalReceiveKept: RECEIVE, sep11SourceSnapshotAdded: true,
  sep11StocktakePreviousAnchor: { from: idOf(SEP10), to: idOf(PREVIOUS) },
  currentKg: { item: witness.stock, lots: witness.lotKg, state: witness.stateStock,
    ledger: witness.authoritative },
  predictedCurrentKg: { item: witness.stock, lots: witness.lotKg,
    state: witness.stateStock, ledger: afterBalance.finalKg },
  historicalClosingKg: { before: beforeBalance.days, after: afterBalance.days },
  depletedSep4LotKept: witness.itemLot.id,
  historicalLotTimelineRemains: '9/4 244.8kg 입고 로트와 이후 생산 사용 이력은 로트 화면에 남음',
  backupJsonRoundTripVerified: true, backup: BACKUP }, null, 2));
if (!APPLY) process.exit(0);
if (existsSync(BACKUP)) throw new Error('백업이 이미 있습니다. 중복 적용을 중단합니다.');
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({ projectId: 'taebaek-3abe4', paths: [...PATHS],
  savedAt: new Date().toISOString(), before, after }, null, 2),
  { encoding: 'utf8', flag: 'wx' });
await db.runTransaction(async tx => {
  const refs = PATHS.map(path => db.doc(path));
  const snaps = await Promise.all(refs.map(ref => tx.get(ref)));
  snaps.forEach((snap, index) => {
    if (!isDeepStrictEqual(snap.exists ? snap.data() : null, before[PATHS[index]])) {
      throw new Error(`백업 뒤 문서가 변경됐습니다: ${PATHS[index]}`);
    }
  });
  PATHS.forEach((path, index) => {
    if (after[path] == null) tx.delete(refs[index]);
    else tx.set(refs[index], after[path]!);
  });
});
if (!isDeepStrictEqual(await readDocs(PATHS), after)) throw new Error('적용 재조회가 예상과 다릅니다.');
const verified = await readWitness();
if (verified.stock !== witness.stock || verified.lotKg !== witness.lotKg ||
    verified.stateStock !== witness.stateStock || verified.authoritative !== witness.authoritative) {
  throw new Error('적용 뒤 현재 재고 네 축이 바뀌었습니다.');
}
console.log('과거 원장 세 건만 제거 완료. 현재 품목·로트·상태 수량은 변경하지 않았습니다.');
