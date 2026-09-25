/**
 * 태백 참깨 2026-09-14 입고 1,200+4,200kg을 9/8로 옮기고,
 * 실측이 아닌 9/11·9/14 이관용 재고맞춤 앵커 두 건을 제거한다.
 *
 * 사장님 승인: 두 앵커를 제외한 날짜순 현재고 3,270kg을 원료 상태·품목·로트에도 반영.
 * 옛 원자 이력을 고치는 일은 예외적이다. 네 축을 한 DB 트랜잭션에서 고치고
 * 원본 전체를 백업한다. 재고 차이 -2,280kg은 새 정정 이력으로 남겨 감사 연결을 지킨다.
 *
 * 기본 --dry / --apply / --undo. 운영 DB 전용. 배포와 관계없다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { adminDb, 실행모드 } from './_admin.mts';
import { applyRawCommand, operationDocId } from '../src/shared/rawInventoryCore.ts';
import { toLedgerDoc } from '../src/shared/services/rawInventoryService.ts';
import { applyLedgerRowByBusinessDate, sortLedger, authoritativeLedgerBalanceKg } from '../src/shared/rawLedgerBalance.ts';
import { companyOf } from '../src/shared/types.ts';

const { APPLY, UNDO } = 실행모드();
if (APPLY && UNDO) throw new Error('--apply와 --undo를 같이 쓸 수 없습니다.');
const db = adminDb();
const RAW_ID = 'p-1779251176421';
const INV_PATH = `rawInventories/taebaek__${RAW_ID}`;
const ITEM_PATH = `items/${RAW_ID}`;
const BACKUP = '로컬전용/백업/sep-sesame-receipt-date-2026-09-25.json';
const TARGET_KG = 3270;
const OLD_STOCK_KG = 5550;
const CORRECTION_ID = 'fix-sep-sesame-receipt-date-20260925';
const CORRECTION_PATH = `rawMaterialLedger/${operationDocId(CORRECTION_ID)}`;
const STOCKTAKE_OPS = [
  'fix-state-to-lots-taebaek-p-1779251176421-2026-09-11',
  'fix-stock-align-p-1779251176421-1789360741512',
];
const RECEIPTS = [
  { op: 'purchase:po-1789375003242:p-1779251176421:2026-09-14:1200', kg: 1200 },
  { op: 'purchase:po-1789375003242:p-1779251176421:2026-09-14:4200', kg: 4200 },
];
const receiptPaths = RECEIPTS.map(row => `rawMaterialLedger/${operationDocId(row.op)}`);
const stocktakePaths = STOCKTAKE_OPS.map(op => `rawMaterialLedger/${operationDocId(op)}`);
const TARGET_PATHS = [ITEM_PATH, INV_PATH, ...receiptPaths, ...stocktakePaths, CORRECTION_PATH];
const SHIFTED_DATE = '2026-09-08';
const SHIFTED_AT = '2026-09-08T12:00:00+09:00';
const shiftedLotNo = (op: string) => op.endsWith(':1200') ? '260908-01' : '260908-02';

type Data = Record<string, any>;
type Backup = { savedAt: string; before: Record<string, Data | null>; after: Record<string, Data | null> };
const plain = (value: unknown): any => JSON.parse(JSON.stringify(value));
const same = (a: unknown, b: unknown) => isDeepStrictEqual(plain(a), plain(b));
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const lotSum = (lots: Data[]) => r3(lots.reduce((sum, lot) => sum + Number(lot.kgRemaining ?? 0), 0));
const ref = (path: string) => db.doc(path);

function assertPlain(value: unknown, path = '$'): void {
  if (value == null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPlain(entry, `${path}[${index}]`));
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`백업으로 복원하기 어려운 비일반 객체가 있습니다: ${path}`);
  }
  for (const [key, nested] of Object.entries(value)) assertPlain(nested, `${path}.${key}`);
}

async function readTargets(): Promise<Record<string, Data | null>> {
  const snaps = await Promise.all(TARGET_PATHS.map(path => ref(path).get()));
  return Object.fromEntries(snaps.map((snap, i) => {
    const data = snap.exists ? snap.data() as Data : null;
    if (data) assertPlain(data, TARGET_PATHS[i]);
    return [TARGET_PATHS[i], data ? plain(data) : null];
  }));
}

function assertBaseline(before: Record<string, Data | null>): void {
  const item = before[ITEM_PATH], state = before[INV_PATH];
  if (!item || !state || companyOf(item) !== 'taebaek' || state.companyId !== 'taebaek'
    || state.rawItemId !== RAW_ID || state.materialSnapshot !== '참깨') throw new Error('참깨 품목·상태 대상이 아닙니다.');
  if (Number(item.stock) !== OLD_STOCK_KG || Number(state.stockKg) !== OLD_STOCK_KG
    || Number(state.revision) !== 16 || lotSum(item.lots ?? []) !== OLD_STOCK_KG
    || lotSum(state.activeLots ?? []) !== OLD_STOCK_KG) throw new Error('현재 참깨 네 축·revision이 미리 본 값과 다릅니다.');
  if (before[CORRECTION_PATH]) throw new Error('정정 작업이 이미 존재합니다. 중복 적용을 중단합니다.');
  if (state.stocktakeAnchor?.operationId !== STOCKTAKE_OPS[1]) throw new Error('마지막 실사 앵커가 예상과 다릅니다.');
  const lotIds = RECEIPTS.map(r => `lot-${r.op}`);
  for (const lotId of lotIds) {
    const inItem = (item.lots ?? []).find((lot: Data) => lot.id === lotId);
    const inState = [...(state.activeLots ?? []), ...(state.recentDepletedLots ?? [])]
      .find((lot: Data) => lot.id === lotId);
    if (!inItem || !inState || inItem.receivedDate !== '2026-09-14'
      || inState.receivedDate !== '2026-09-14' || Number(inItem.kgRemaining) !== 0
      || Number(inState.kgRemaining) !== 0) throw new Error(`옮길 로트가 예상과 다릅니다: ${lotId}`);
  }
  const firstStocktake = before[stocktakePaths[0]];
  const secondStocktake = before[stocktakePaths[1]];
  if (firstStocktake?.kind !== 'stocktake' || firstStocktake.targetKg !== -480
    || firstStocktake.date !== '2026-09-11'
    || firstStocktake.stocktakeAnchorBefore?.effectiveAt !== '2026-08-20T23:59:59.999+09:00'
    || secondStocktake?.kind !== 'stocktake' || secondStocktake.targetKg !== -1320
    || secondStocktake.date !== '2026-09-14') throw new Error('제거할 재고맞춤 실사 두 건이 예상과 다릅니다.');
  RECEIPTS.forEach((row, index) => {
    const movement = before[receiptPaths[index]];
    if (movement?.kind !== 'receive' || movement.operationId !== row.op
      || movement.companyId !== 'taebaek' || movement.rawItemId !== RAW_ID
      || movement.date !== '2026-09-14' || movement.reportedDeltaKg !== row.kg
      || movement.received !== row.kg || movement.source?.type !== 'purchase') {
      throw new Error(`옮길 입고가 예상과 다릅니다: ${receiptPaths[index]}`);
    }
  });
}

function shiftLot(lot: Data): Data {
  const receipt = RECEIPTS.find(row => lot.id === `lot-${row.op}`);
  if (!receipt) return lot;
  return { ...lot, receivedDate: SHIFTED_DATE, lotNo: shiftedLotNo(receipt.op) };
}

function buildAfter(before: Record<string, Data | null>, now: string): Record<string, Data | null> {
  assertBaseline(before);
  const item = plain(before[ITEM_PATH]) as Data;
  const state = plain(before[INV_PATH]) as Data;
  state.activeLots = (state.activeLots ?? []).map(shiftLot);
  state.recentDepletedLots = (state.recentDepletedLots ?? []).map(shiftLot);
  // 지워질 9/14 앵커를 새 정정의 '직전 앵커'로 남기지 않는다.
  state.stocktakeAnchor = before[stocktakePaths[0]]!.stocktakeAnchorBefore;
  const command = {
    operationId: CORRECTION_ID, companyId: 'taebaek' as const, rawItemId: RAW_ID,
    materialSnapshot: '참깨', effectiveAt: now,
    source: { type: 'stocktake' as const, id: CORRECTION_ID },
    actorName: '입고일·이관실사 정정 스크립트',
    kind: 'stocktake' as const, targetKg: TARGET_KG,
  };
  const result = applyRawCommand({
    state, command, det: { now, newLotId: `lot-${CORRECTION_ID}`,
      carryOverLotId: `carry-${CORRECTION_ID}` },
  });
  if (result.status !== 'applied' || result.state.stockKg !== TARGET_KG
    || result.movement.appliedDeltaKg !== -2280) throw new Error(`정정 코어 결과가 예상과 다릅니다: ${result.status}`);
  const nextLots = [...result.state.activeLots, ...result.state.recentDepletedLots];
  if (lotSum(nextLots) !== TARGET_KG || nextLots.some(lot => Number(lot.kgRemaining ?? 0) < 0)) {
    throw new Error('정정 뒤 로트 합계 또는 음수 로트가 예상과 다릅니다.');
  }
  const after: Record<string, Data | null> = { ...before };
  after[ITEM_PATH] = { ...item, stock: TARGET_KG, lots: nextLots };
  after[INV_PATH] = plain(result.state);
  after[CORRECTION_PATH] = plain(toLedgerDoc(result.movement, {
    note: '9/8 참깨 입고일·이관 재고맞춤 두 건 정정 (5,550kg → 3,270kg)',
    type: 'correction', addedBy: '정정 스크립트',
  }));
  RECEIPTS.forEach((row, index) => {
    const path = receiptPaths[index];
    const movement = plain(before[path]) as Data;
    after[path] = {
      ...movement, originalDate: movement.date, originalEffectiveAt: movement.effectiveAt,
      correctedBy: CORRECTION_ID, date: SHIFTED_DATE, effectiveAt: SHIFTED_AT,
      lotChanges: (movement.lotChanges ?? []).map((change: Data) => ({
        ...change,
        ...(change.lotId === `lot-${row.op}` ? {
          receivedDate: SHIFTED_DATE, lotNo: shiftedLotNo(row.op),
          lotSnapshot: { ...change.lotSnapshot, receivedDate: SHIFTED_DATE, lotNo: shiftedLotNo(row.op) },
        } : {}),
      })),
    };
  });
  stocktakePaths.forEach(path => { after[path] = null; });
  return after;
}

function businessBalance(rows: Data[], thru = '9999-12-31'): number {
  let balance = 0;
  for (const row of sortLedger(rows.filter(r => String(r.date ?? '') <= thru)))
    balance = applyLedgerRowByBusinessDate(balance, row, 1);
  return balance;
}

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없습니다: ${BACKUP}`);
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as Backup;
  if (Object.keys(backup.before).length !== TARGET_PATHS.length
    || !TARGET_PATHS.every(path => Object.hasOwn(backup.before, path) && Object.hasOwn(backup.after, path))) {
    throw new Error('백업 대상이 현재 스크립트와 다릅니다.');
  }
  await db.runTransaction(async tx => {
    const snaps = await Promise.all(TARGET_PATHS.map(path => tx.get(ref(path))));
    snaps.forEach((snap, index) => {
      const path = TARGET_PATHS[index];
      if (!same(snap.exists ? snap.data() : null, backup.after[path])) throw new Error(`적용 뒤 값이 변경되어 되돌리기를 중단합니다: ${path}`);
    });
    TARGET_PATHS.forEach(path => backup.before[path] === null
      ? tx.delete(ref(path))
      : tx.set(ref(path), backup.before[path]!));
  });
  const verified = await readTargets();
  if (!same(verified, backup.before)) throw new Error('되돌리기 후 재조회가 백업과 다릅니다.');
  console.log('참깨 9/8 입고일·재고맞춤 두 건 정정 복원 완료');
  process.exit(0);
}

const before = await readTargets();
assertBaseline(before);
const allLedger = (await db.collection('rawMaterialLedger').get()).docs
  .map(doc => ({ id: doc.id, ...doc.data() }))
  .filter(row => companyOf(row) === 'taebaek' && (row.material === '참깨' || row.materialSnapshot === '참깨'));
const after = buildAfter(before, new Date().toISOString());
const shiftedForPreview = allLedger
  .filter(row => !stocktakePaths.some(path => path.endsWith(`/${row.id}`)))
  .map(row => {
    const i = receiptPaths.findIndex(path => path.endsWith(`/${row.id}`));
    return i < 0 ? row : { ...row, date: SHIFTED_DATE, effectiveAt: SHIFTED_AT };
  });
const currentBusiness = businessBalance(allLedger);
const correctedBusiness = businessBalance(shiftedForPreview);
if (currentBusiness !== OLD_STOCK_KG || correctedBusiness !== TARGET_KG) {
  throw new Error(`날짜별 재계산이 예상과 다릅니다: 현재 ${currentBusiness}, 정정 뒤 ${correctedBusiness}`);
}
console.log(JSON.stringify({
  mode: APPLY ? '적용' : '미리보기(dry)',
  receipts: RECEIPTS.map(row => ({ operationId: row.op, kg: row.kg,
    from: '2026-09-14', to: SHIFTED_DATE })),
  removedStocktakes: STOCKTAKE_OPS,
  currentStockKg: { before: OLD_STOCK_KG, after: TARGET_KG },
  currentLots: (after[INV_PATH]?.activeLots ?? []).map((lot: Data) => ({
    lotNo: lot.lotNo, receivedDate: lot.receivedDate, kgRemaining: lot.kgRemaining })),
  date8BalanceKg: { before: businessBalance(allLedger, SHIFTED_DATE),
    after: businessBalance(shiftedForPreview, SHIFTED_DATE) },
  correctionMovement: CORRECTION_ID,
  backup: BACKUP,
}, null, 2));
if (!APPLY) process.exit(0);
if (existsSync(BACKUP)) throw new Error(`백업이 이미 있습니다. 두 번 적용하지 않습니다: ${BACKUP}`);
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({ savedAt: new Date().toISOString(), before, after } satisfies Backup, null, 2),
  { encoding: 'utf8', flag: 'wx' });
try {
  await db.runTransaction(async tx => {
    const snaps = await Promise.all(TARGET_PATHS.map(path => tx.get(ref(path))));
    snaps.forEach((snap, index) => {
      const path = TARGET_PATHS[index];
      if (!same(snap.exists ? snap.data() : null, before[path])) throw new Error(`미리보기 후 문서가 바뀌었습니다: ${path}`);
    });
    TARGET_PATHS.forEach(path => after[path] === null
      ? tx.delete(ref(path))
      : tx.set(ref(path), after[path]!));
  });
} catch (error) {
  console.error('트랜잭션 결과가 불확실할 수 있습니다. 백업은 보존합니다. 적용 여부를 재조회하세요.');
  throw error;
}
const verified = await readTargets();
if (!same(verified, after)) throw new Error('적용 뒤 재조회가 예상과 다릅니다.');
const newLedger = allLedger.filter(row => !stocktakePaths.some(path => path.endsWith(`/${row.id}`)))
  .map(row => {
    const path = `rawMaterialLedger/${row.id}`;
    return after[path] ?? row;
  }).concat(after[CORRECTION_PATH]!);
if (businessBalance(newLedger) !== TARGET_KG || authoritativeLedgerBalanceKg(newLedger as never) !== TARGET_KG) {
  throw new Error('정정 뒤 날짜별/원자화 원장 잔량이 목표와 다릅니다.');
}
console.log(`적용·재조회 완료: 참깨 ${TARGET_KG}kg / 백업 ${BACKUP} / --undo 가능`);
