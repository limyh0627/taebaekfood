/**
 * 2026-09-19 수입산들기름 캔 40개 개봉 오연결 복구.
 *
 * 기본은 --dry, 실제 반영은 --apply, 되돌리기는 --undo.
 * 원료 660kg 입고는 공용 원자 명령을 통과시켜 items·rawInventories·원장을 같이 맞춘다.
 * 그 뒤 잘못 받은 wip-들기름 로트와 BOM을 고친다. 작업번호가 결정적이라 중간 실패 후
 * 다시 실행해도 원료 660kg이 두 번 들어가지 않는다.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  applyRawCommand, inventoryDocId, legacyOperationDocId, operationDocId,
  type RawInventoryCommand,
} from '../src/shared/rawInventoryCore';
import { normalizeRawInventoryState, normalizeRawMovement, toLedgerDoc } from '../src/shared/services/rawInventoryService';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
if (APPLY && UNDO) throw new Error('--apply와 --undo를 같이 쓸 수 없습니다.');

const CAN_ID = 'p-1773565128048';
const WRONG_BULK_ID = 'wip-들기름';
const RAW_ID = 'raw-수입들기름';
const WRONG_BOM_ID = 'bom-p-1773565128048__wip-들기름';
const RIGHT_BOM_ID = 'bom-p-1773565128048__raw-수입들기름';
const UNPACK_LOT_ID = 'unpack-p-1773565128048-1789801392834-0';
const KG = 660;
const OPERATION_ID = 'fix:unpack:p-1773565128048:2026-09-19:40';
const REVERSE_ID = `reverse:${OPERATION_ID}`;
const BACKUP = 'scripts/fix-imported-perilla-unpack-backup.json';

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'C:\\Users\\TAEBAEK\\.secrets\\taebaek-admin.json';
const app = initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))), projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
const refs = {
  can: db.doc(`items/${CAN_ID}`), wrong: db.doc(`items/${WRONG_BULK_ID}`), raw: db.doc(`items/${RAW_ID}`),
  wrongBom: db.doc(`item_bom/${WRONG_BOM_ID}`), rightBom: db.doc(`item_bom/${RIGHT_BOM_ID}`),
};
const snaps = await Promise.all(Object.values(refs).map(ref => ref.get()));
const data = Object.fromEntries(Object.keys(refs).map((key, i) => [key, snaps[i].exists ? snaps[i].data() : null])) as Record<string, any>;
const wrongLot = (data.wrong?.lots ?? []).find((lot: any) => lot.id === UNPACK_LOT_ID);
const alreadyFixed = !wrongLot && !data.wrongBom && !!data.rightBom;

console.log(`\n${UNDO ? '되돌리기' : APPLY ? '실제 적용' : '미리보기'} — 수입산들기름 캔 40개 개봉 복구\n`);
console.log(`캔: ${data.can?.name} ${data.can?.stock}개 (개봉 로트 40개 소진)`);
console.log(`잘못 간 곳: ${data.wrong?.name} ${data.wrong?.stock}kg / 해당 로트 ${wrongLot?.kgRemaining ?? '없음'}kg`);
console.log(`옮길 곳: ${data.raw?.name} ${data.raw?.stock}kg${alreadyFixed ? ' (복구 완료)' : ` → ${Math.round((Number(data.raw?.stock ?? 0) + KG) * 1000) / 1000}kg`}`);
console.log(`BOM: ${data.wrongBom ? WRONG_BULK_ID : '없음'} → ${data.rightBom ? `${RAW_ID}(이미 있음)` : RAW_ID}`);

if (!APPLY && !UNDO) {
  console.log('\n--dry 완료. 실제 반영은 --apply, 되돌리기는 --undo');
  process.exit(0);
}

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없습니다: ${BACKUP}`);
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8'));
  const reversed = await executeAdminCommand({
    operationId: REVERSE_ID, companyId: 'taebaek', rawItemId: RAW_ID,
    materialSnapshot: '수입들기름', effectiveAt: '2026-09-19T16:03:12+09:00',
    actorName: '정정 스크립트', source: { type: 'unpack', id: CAN_ID },
    kind: 'reverse', originalOperationId: OPERATION_ID,
  }, { note: '수입산들기름 캔 개봉 오연결 복구 되돌림', type: 'correction', addedBy: '정정 스크립트' });
  if (reversed.status === 'rejected' || reversed.status === 'conflict') throw new Error(`원료 되돌리기 실패: ${reversed.message}`);
  await db.runTransaction(async tx => {
    tx.set(refs.wrong, backup.wrong);
    if (backup.wrongBom) tx.set(refs.wrongBom, backup.wrongBom); else tx.delete(refs.wrongBom);
    if (backup.rightBom) tx.set(refs.rightBom, backup.rightBom); else tx.delete(refs.rightBom);
  });
  console.log('\n✅ 되돌렸습니다.');
  process.exit(0);
}

if (!existsSync(BACKUP)) {
  writeFileSync(BACKUP, JSON.stringify({
    savedAt: new Date().toISOString(), wrong: data.wrong,
    wrongBom: data.wrongBom, rightBom: data.rightBom,
  }, null, 2), 'utf8');
  console.log(`백업 저장: ${BACKUP}`);
}

if (!data.can || Number(data.can.stock) !== 0) throw new Error('캔 재고가 예상한 0개가 아닙니다. 중단합니다.');
if (wrongLot && (Number(wrongLot.kgIn) !== KG || Number(wrongLot.kgRemaining) !== KG)) {
  throw new Error('잘못 들어간 개봉 로트가 예상한 660kg과 다릅니다. 중단합니다.');
}

const received = await executeAdminCommand({
  operationId: OPERATION_ID, companyId: 'taebaek', rawItemId: RAW_ID,
  materialSnapshot: '수입들기름', effectiveAt: '2026-09-19T16:03:12+09:00',
  actorName: '정정 스크립트', source: { type: 'unpack', id: CAN_ID },
  kind: 'receive', kg: KG,
  lot: { supplierName: '이월', qtyIn: 40, packageType: '캔', packageKg: 16.5, receivedDate: '2026-09-19' },
}, { note: '수입산들기름 캔 40개 개봉 — 잘못 연결된 들기름에서 이동', type: 'correction', addedBy: '정정 스크립트', canSize: 16.5, canCount: 40 });
if (received.status === 'rejected' || received.status === 'conflict') throw new Error(`수입들기름 반영 실패: ${received.message}`);
console.log(`원료 명령: ${received.status}`);

await db.runTransaction(async tx => {
  const [wrongSnap, wrongBomSnap, rightBomSnap] = await Promise.all([
    tx.get(refs.wrong), tx.get(refs.wrongBom), tx.get(refs.rightBom),
  ]);
  if (!wrongSnap.exists) throw new Error('잘못 받은 들기름 품목이 없습니다.');
  const wrong = wrongSnap.data();
  const lots = (wrong.lots ?? []) as any[];
  const target = lots.find(lot => lot.id === UNPACK_LOT_ID);
  if (target && (Number(target.kgIn) !== KG || Number(target.kgRemaining) !== KG)) throw new Error('이동할 로트 수량이 달라졌습니다.');
  const remaining = lots.filter(lot => lot.id !== UNPACK_LOT_ID);
  const stock = Math.round(remaining.filter(lot => lot.status === 'active').reduce((sum, lot) => sum + Number(lot.kgRemaining ?? 0), 0) * 1000) / 1000;
  tx.update(refs.wrong, { lots: remaining, stock });
  if (wrongBomSnap.exists) tx.delete(refs.wrongBom);
  if (!rightBomSnap.exists) tx.set(refs.rightBom, {
    parent_id: CAN_ID, child_id: RAW_ID, quantity: 16.5, companyId: 'taebaek',
  });
});
console.log('✅ 660kg 이동과 BOM 정정을 완료했습니다.');

/** 운영 앱의 executeRawInventoryCommand와 같은 셈을 Admin 트랜잭션에서 실행한다. */
async function executeAdminCommand(command: RawInventoryCommand, legacy: Record<string, unknown>) {
  const now = '2026-09-19T07:03:12.834Z';
  const movementRef = db.doc(`rawMaterialLedger/${operationDocId(command.operationId)}`);
  const oldMovementRef = db.doc(`rawMaterialLedger/${legacyOperationDocId(command.operationId)}`);
  const stateRef = db.doc(`rawInventories/${inventoryDocId(command.companyId, command.rawItemId)}`);
  const itemRef = db.doc(`items/${command.rawItemId}`);
  const originalId = command.kind === 'reverse' ? command.originalOperationId : '';
  const originalRef = db.doc(`rawMaterialLedger/${operationDocId(originalId || '_none_')}`);
  const oldOriginalRef = db.doc(`rawMaterialLedger/${legacyOperationDocId(originalId || '_none_')}`);
  const guardRef = db.doc(`rawInventoryReversalGuards/${operationDocId(originalId || '_none_')}`);
  return db.runTransaction(async tx => {
    const [movementSnap, oldMovementSnap, stateSnap, itemSnap, originalSnap, oldOriginalSnap, guardSnap] = await Promise.all([
      tx.get(movementRef), tx.get(oldMovementRef), tx.get(stateRef), tx.get(itemRef),
      tx.get(originalRef), tx.get(oldOriginalRef), tx.get(guardRef),
    ]);
    if (!itemSnap.exists) throw new Error(`원료 품목이 없습니다: ${command.rawItemId}`);
    const existingSnap = movementSnap.exists ? movementSnap : oldMovementSnap.exists ? oldMovementSnap : null;
    const originalFound = originalSnap.exists ? originalSnap : oldOriginalSnap.exists ? oldOriginalSnap : null;
    const state = stateSnap.exists ? normalizeRawInventoryState(stateSnap.data()!) : null;
    if (!state) throw new Error(`원자화 상태가 없습니다: ${command.rawItemId}`);
    if (Math.abs(Number(itemSnap.data()?.stock ?? 0) - state.stockKg) > 1) {
      throw new Error(`품목 재고와 원료 상태가 어긋납니다: ${itemSnap.data()?.stock} / ${state.stockKg}`);
    }
    const result = applyRawCommand({
      state, command,
      existing: existingSnap ? normalizeRawMovement(existingSnap.data()!) : null,
      original: originalFound ? normalizeRawMovement(originalFound.data()!) : null,
      guard: guardSnap.exists ? guardSnap.data() as any : null,
      det: { now, newLotId: UNPACK_LOT_ID, carryOverLotId: `carry-${OPERATION_ID}` },
    });
    if (result.status !== 'applied') return result;
    const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    tx.set(stateRef, clean(result.state));
    tx.set(movementRef, clean(toLedgerDoc(result.movement, legacy as any)));
    if (result.guard) tx.set(guardRef, clean(result.guard));
    tx.update(itemRef, {
      lots: clean([...result.state.activeLots, ...result.state.recentDepletedLots]),
      stock: result.state.stockKg,
    });
    return result;
  });
}
