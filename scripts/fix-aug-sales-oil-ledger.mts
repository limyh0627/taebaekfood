/**
 * 8월 판매일지 20건의 주문 210건을 SKU BOM으로 환산한 통깨참기름 사용량 정정.
 * 이미 저장된 주문 자동사용 97줄은 감사 흔적으로 보존하고 날짜별 차액만 추가한다.
 * 8/31의 잘못된 원장 실사 앵커(3,890.008kg)는 제거한다.
 * 현재 품목 재고·로트·원자화 상태·회계 스냅샷은 절대 쓰지 않는다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { adminDb, 실행모드 } from './_admin.mts';

const db = adminDb();
const { APPLY, UNDO, 나머지 } = 실행모드();
if (APPLY && UNDO || 나머지.length ||
    process.argv.slice(2).some(x => !['--dry', '--apply', '--undo'].includes(x))) {
  throw new Error('지원 옵션: --dry(기본), --apply, --undo');
}
const COMPANY = 'taebaek';
const RAW_ID = 'raw-통깨참기름';
const MATERIAL = '통깨참기름';
const START = '2026-08-01';
const END = '2026-08-31';
const OLD_ANCHOR_ID = 'rm-anchor-통깨참기름-20260831';
const BACKUP = '로컬전용/백업/aug-sales-oil-ledger-remove-anchor-2026-09-25.json';
const round3 = (n: number) => Math.round(n * 1000) / 1000;

// 9/25 운영 DB의 8월 판매일지·연결 주문·현재 SKU BOM에서 도출한 값(kg).
// 삭제된 진참기름/A/1750ml p-150 36병은 동일한 A/1750ml p-106의
// 1.603kg/병 × 통깨 20%를 대리 적용해 8/14에 11.542kg 포함했다.
const EXPECTED: Record<string, number> = {
  '2026-08-03': 458.636, '2026-08-04': 441.437, '2026-08-05': 244.287,
  '2026-08-06': 157.610, '2026-08-07': 66.787, '2026-08-10': 295.395,
  '2026-08-11': 131.837, '2026-08-12': 154.841, '2026-08-13': 31.357,
  '2026-08-14': 193.093, '2026-08-18': 189.523, '2026-08-19': 390.497,
  '2026-08-20': 340.343, '2026-08-21': 887.369, '2026-08-24': 185.753,
  '2026-08-25': 310.905, '2026-08-26': 96.992, '2026-08-27': 667.182,
  '2026-08-28': 227.859, '2026-08-31': 591.935,
};
const LOG_ORDERS: Record<string, number> = {
  '2026-08-03': 13, '2026-08-04': 11, '2026-08-05': 8,
  '2026-08-06': 12, '2026-08-07': 6, '2026-08-10': 14,
  '2026-08-11': 11, '2026-08-12': 8, '2026-08-13': 8,
  '2026-08-14': 5, '2026-08-18': 18, '2026-08-19': 13,
  '2026-08-20': 9, '2026-08-21': 9, '2026-08-24': 13,
  '2026-08-25': 9, '2026-08-26': 11, '2026-08-27': 14,
  '2026-08-28': 7, '2026-08-31': 12,
};
type DocRow = { id: string; data: FirebaseFirestore.DocumentData };
type Plan = {
  rows: { id: string; date: string; expected: number; recorded: number; used: number }[];
  originals: DocRow[];
  journalIds: string[];
  orderIds: string[];
  previousAnchor: DocRow;
  snapshotQtyL: number;
};
type Backup = { projectId: 'taebaek-3abe4'; savedAt: string;
  before: Record<string, FirebaseFirestore.DocumentData | null>;
  after: Record<string, FirebaseFirestore.DocumentData | null>;
  source: { originalLedgerIds: string[]; journalIds: string[]; orderIds: string[];
    previousAnchor: DocRow; snapshotQtyL: number } };

async function plan(tx?: FirebaseFirestore.Transaction): Promise<Plan> {
  const getQuery = (q: FirebaseFirestore.Query) => tx ? tx.get(q) : q.get();
  const getDoc = (ref: FirebaseFirestore.DocumentReference) => tx ? tx.get(ref) : ref.get();
  const ledgerQuery = db.collection('rawMaterialLedger').where('date', '>=', START).where('date', '<=', END);
  const journalQuery = db.collection('productionSalesLogs').where('date', '>=', START).where('date', '<=', END);
  const orderQuery = db.collection('orders').where('deliveredAt', '>=', `${START}T00:00:00.000Z`)
    .where('deliveredAt', '<', '2026-09-01T00:00:00.000Z');
  const [ledgerSnap, journalSnap, orderSnap, snapshot] = await Promise.all([
    getQuery(ledgerQuery), getQuery(journalQuery), getQuery(orderQuery),
    getDoc(db.doc('inventorySnapshots/inv-snap-2026-08')),
  ]);
  const originals = ledgerSnap.docs.map(doc => ({ id: doc.id, data: doc.data() }))
    .filter(row => (row.data.companyId === COMPANY || !row.data.companyId) &&
      (row.data.rawItemId === RAW_ID || row.data.material === MATERIAL))
    .sort((a,b) => a.id.localeCompare(b.id));
  const logs = journalSnap.docs.map(doc => ({ id: doc.id, data: doc.data() }))
    .filter(row => row.data.companyId === COMPANY || !row.data.companyId);
  const orders = orderSnap.docs.map(doc => ({ id: doc.id, data: doc.data() }))
    .filter(row => row.data.companyId === COMPANY || !row.data.companyId);
  if (logs.length !== 20 || orders.length !== 210 || originals.length !== 129 ||
      logs.some(row => LOG_ORDERS[row.data.date] !== row.data.orderCount) ||
      Object.keys(LOG_ORDERS).some(date => !logs.some(row => row.data.date === date))) {
    throw new Error('8월 판매일지·주문·원장 건수가 dry 당시와 달라졌습니다. 중단합니다.');
  }
  const snapRow = (snapshot.data()?.items ?? []).find((row: any) => row.itemId === RAW_ID);
  if (!snapshot.exists || snapRow?.qty !== 332) throw new Error('8월 말 회계 스냅샷 332L를 확인할 수 없습니다.');
  const previousAnchor = originals.find(row => row.id === OLD_ANCHOR_ID);
  if (!previousAnchor || previousAnchor.data.targetKg !== 3890.008) {
    throw new Error('기존 8/31 원장 앵커가 dry 당시 3,890.008kg과 다릅니다.');
  }
  const byDate = new Map<string, number>();
  for (const row of originals) {
    if (row.data.targetKg != null || !Number(row.data.used ?? 0)) continue;
    if (row.data.unit === 'L') throw new Error(`8월 사용 원장에 L 단위가 있습니다: ${row.id}`);
    byDate.set(row.data.date, round3((byDate.get(row.data.date) ?? 0) + Number(row.data.used ?? 0)));
  }
  const recordedTotal = round3([...byDate.values()].reduce((n, v) => n + v, 0));
  if (recordedTotal !== 4956.990) throw new Error(`8월 자동사용이 dry 당시 4,956.990kg과 다릅니다: ${recordedTotal}`);
  const rows = Object.entries(EXPECTED).map(([date, expected]) => ({
    id: `rm-aug-sales-reconcile-20260925-${date.replaceAll('-', '')}`,
    date, expected, recorded: byDate.get(date) ?? 0,
    used: round3(expected - (byDate.get(date) ?? 0)),
  }));
  if (rows.some(row => row.used === 0) || round3(rows.reduce((n, row) => n + row.used, 0)) !== 1106.648) {
    throw new Error('날짜별 정정량이 dry 당시 +1,106.648kg과 다릅니다.');
  }
  return { rows, originals, journalIds: logs.map(row => row.id).sort(),
    orderIds: orders.map(row => row.id).sort(), previousAnchor, snapshotQtyL: snapRow.qty };
}

function docsOf(p: Plan, recordedAt: string): Record<string, FirebaseFirestore.DocumentData | null> {
  const docs = Object.fromEntries(p.rows.map(row => [row.id, {
    companyId: COMPANY, rawItemId: RAW_ID, material: MATERIAL, date: row.date,
    received: 0, used: row.used, unit: 'kg', type: 'correction',
    createdAt: recordedAt, recordedAt,
    note: `8월 판매일지/BOM 재구성: 당일 목표 ${row.expected.toFixed(3)}kg, 기존 자동사용 ${row.recorded.toFixed(3)}kg, 차액 ${row.used.toFixed(3)}kg`,
    addedBy: '본부장 승인 정정',
  }]));
  docs[OLD_ANCHOR_ID] = null;
  return docs;
}

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error('되돌릴 백업이 없습니다.');
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as Backup;
  if (backup.projectId !== 'taebaek-3abe4' || Object.keys(backup.after).length !== 21 ||
      backup.after[OLD_ANCHOR_ID] !== null || !backup.before[OLD_ANCHOR_ID]) {
    throw new Error('백업 대상·옵션이 다릅니다.');
  }
  await db.runTransaction(async tx => {
    const current = await Promise.all(Object.keys(backup.after).map(id => tx.get(db.collection('rawMaterialLedger').doc(id))));
    current.forEach((doc, i) => {
      const id = Object.keys(backup.after)[i];
      const expected = backup.after[id];
      if (expected === null ? doc.exists : !doc.exists || !isDeepStrictEqual(doc.data(), expected)) {
        throw new Error(`변경된 문서라 복원 중단: ${id}`);
      }
    });
    Object.keys(backup.after).forEach(id => {
      const ref = db.collection('rawMaterialLedger').doc(id);
      const original = backup.before[id];
      if (original === null) tx.delete(ref);
      else tx.create(ref, original);
    });
  });
  console.log('복원 완료: 정정 20줄 삭제, 기존 8/31 실사 앵커 복구. 로트·현재고는 그대로입니다.');
  process.exit(0);
}

const before = await plan();
if (existsSync(BACKUP)) throw new Error(`백업이 이미 있습니다. 중복 적용을 중단합니다: ${BACKUP}`);
const ids = before.rows.map(row => row.id);
const existing = await db.getAll(...ids.map(id => db.collection('rawMaterialLedger').doc(id)));
if (existing.some(doc => doc.exists)) throw new Error('정정 문서가 이미 있어 중복 적용을 중단합니다.');
const beforeById = Object.fromEntries(ids.map(id => [id, null])) as Record<string, FirebaseFirestore.DocumentData | null>;
beforeById[OLD_ANCHOR_ID] = before.previousAnchor.data;
const at = new Date().toISOString();
const after = docsOf(before, at);
// 원장 정렬은 같은 영업일의 기록 시각도 본다. 이번 정정은 과거 실사보다
// 나중에 기록되므로 8/13 정정은 그날 실사 뒤, 8/31 정정은 그날 실사 뒤에 놓인다.
const beforeAug31Correction = round3(before.rows
  .filter(row => row.date >= '2026-08-13' && row.date < END)
  .reduce((n, row) => n + row.used, 0));
const aug31Correction = before.rows.find(row => row.date === END)?.used ?? 0;
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry', removeOldAug31Anchor: OLD_ANCHOR_ID,
  source: { journals: before.journalIds.length, deliveredOrders: before.orderIds.length,
    ledgerRows: before.originals.length, snapshotL: before.snapshotQtyL },
  newLedgerRows: before.rows.length, deletedLedgerRows: 1,
  dailyAdjustments: before.rows.map(row => ({ date: row.date, usedKg: row.used })),
  recordedAutoUsedKg: 4956.990, salesBomExpectedKg: 6063.638,
  correctionKg: 1106.648, correctionBeforeAug31AnchorKg: beforeAug31Correction,
  correctionAfterAug31AnchorKg: aug31Correction,
  beforeAug31OldAnchorKg: 3530.008,
  projectedBeforeAug31AnchorKg: round3(3530.008 - beforeAug31Correction),
  projectedAug31ClosingKg: round3(3530.008 - beforeAug31Correction - aug31Correction),
  accountingSnapshotQtyL: before.snapshotQtyL,
  currentStockAndLotsUntouched: true, backupOnApply: BACKUP,
}, null, 2));
if (!APPLY) process.exit(0);

mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({ projectId: 'taebaek-3abe4',
  savedAt: at, before: beforeById, after,
  source: { originalLedgerIds: before.originals.map(row => row.id),
    journalIds: before.journalIds, orderIds: before.orderIds,
    previousAnchor: before.previousAnchor, snapshotQtyL: before.snapshotQtyL },
} satisfies Backup, null, 2), { encoding: 'utf8', flag: 'wx' });
await db.runTransaction(async tx => {
  const current = await plan(tx);
  if (!isDeepStrictEqual(current.rows, before.rows) ||
      !isDeepStrictEqual(current.originals, before.originals) ||
      !isDeepStrictEqual(current.journalIds, before.journalIds) ||
      !isDeepStrictEqual(current.orderIds, before.orderIds)) {
    throw new Error('dry 이후 8월 원장·판매일지·주문이 변경돼 적용을 중단합니다.');
  }
  const refs = ids.map(id => db.collection('rawMaterialLedger').doc(id));
  const snapshots = await Promise.all(refs.map(ref => tx.get(ref)));
  if (snapshots.some(doc => doc.exists)) throw new Error('정정 문서가 이미 있어 중복 적용을 중단합니다.');
  refs.forEach(ref => tx.create(ref, after[ref.id]!));
  tx.delete(db.collection('rawMaterialLedger').doc(OLD_ANCHOR_ID));
});
const verified = await db.getAll(...Object.keys(after).map(id => db.collection('rawMaterialLedger').doc(id)));
if (verified.some(doc => after[doc.id] === null ? doc.exists : !isDeepStrictEqual(doc.data(), after[doc.id]))) {
  throw new Error('적용 뒤 원장 문서 재조회가 다릅니다.');
}
console.log(`적용·재조회 완료: 8월 정정 ${ids.length}줄과 기존 실사 앵커 삭제. 백업 ${BACKUP}`);
