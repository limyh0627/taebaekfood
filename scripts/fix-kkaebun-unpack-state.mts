/**
 * 깨분참기름 80캔 개봉분을 원자화 상태에 복구한다.
 *
 * 기본 --dry / 실제 --apply / 되돌리기 --undo.
 * `items`에 이미 있는 음수·양수 로트를 그대로 `rawInventories`에 옮길 뿐 합치지 않는다.
 * 관리자가 화면에서 두 로트를 직접 합쳐 결과를 검증할 수 있게 하기 위함이다.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { inventoryDocId, operationDocId, type RawInventoryMovement } from '../src/shared/rawInventoryCore';
import { normalizeRawInventoryState, toLedgerDoc } from '../src/shared/services/rawInventoryService';
import type { RawMaterialLot } from '../src/shared/types';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
if (APPLY && UNDO) throw new Error('--apply와 --undo를 같이 쓸 수 없습니다.');

const RAW_ID = 'raw-깨분참기름';
const CAN_ID = 'p-1779251603644';
const COMPANY = 'taebaek';
const EXPECTED_UNPACK_KG = 1320;
const OPERATION_ID = 'fix:unpack-state:raw-깨분참기름:2026-09-22:80';
const BACKUP = 'scripts/fix-kkaebun-unpack-state-backup.json';
const NOW = '2026-09-22T15:55:00+09:00';

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'C:\\Users\\TAEBAEK\\.secrets\\taebaek-admin.json';
const app = initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))), projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
const itemRef = db.doc(`items/${RAW_ID}`);
const stateRef = db.doc(`rawInventories/${inventoryDocId(COMPANY, RAW_ID)}`);
const movementRef = db.doc(`rawMaterialLedger/${operationDocId(OPERATION_ID)}`);

const [itemSnap, stateSnap, movementSnap] = await Promise.all([itemRef.get(), stateRef.get(), movementRef.get()]);
if (!itemSnap.exists || !stateSnap.exists) throw new Error('깨분참기름 품목 또는 원자화 상태가 없습니다.');
const item = itemSnap.data()!;
const state = normalizeRawInventoryState(stateSnap.data()!);
const activeLots = ((item.lots ?? []) as RawMaterialLot[]).filter(l => l.status !== 'depleted');
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const lotSum = r3(activeLots.reduce((sum, lot) => sum + Number(lot.kgRemaining ?? 0), 0));
const delta = r3(lotSum - state.stockKg);

console.log(`\n${UNDO ? '되돌리기' : APPLY ? '실제 적용' : '미리보기'} — 깨분참기름 개봉 로트 원자화 복구\n`);
console.log(`items.stock:       ${item.stock}kg`);
console.log(`items 활성 로트합: ${lotSum}kg`);
console.log(`원자화 상태:       ${state.stockKg}kg`);
console.log(`복구 차이:         ${delta}kg (기대 ${EXPECTED_UNPACK_KG}kg)`);
for (const lot of activeLots) console.log(`  ${Number(lot.kgRemaining) < 0 ? '음수' : '양수'} ${lot.id} / ${lot.lotNo ?? '-'} / ${lot.kgRemaining}kg`);

if (!APPLY && !UNDO) {
  console.log('\n--dry 완료. 위 로트들이 그대로 보존되며 합치지는 않습니다.');
  process.exit(0);
}

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없습니다: ${BACKUP}`);
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8'));
  await db.runTransaction(async tx => {
    tx.set(stateRef, backup.state);
    if (backup.movement) tx.set(movementRef, backup.movement); else tx.delete(movementRef);
  });
  console.log('\n✅ 원자화 상태를 복구 전으로 되돌렸습니다.');
  process.exit(0);
}

if (movementSnap.exists) {
  console.log('\n↺ 이미 적용된 작업입니다.');
  process.exit(0);
}
if (Math.abs(Number(item.stock) - lotSum) > 0.001) throw new Error('items.stock과 items 로트합이 다릅니다. 중단합니다.');
if (Math.abs(delta - EXPECTED_UNPACK_KG) > 0.001) throw new Error(`복구 차이가 예상한 ${EXPECTED_UNPACK_KG}kg이 아닙니다. 중단합니다.`);
if (!activeLots.some(l => Number(l.kgRemaining) < 0) || !activeLots.some(l => Number(l.kgRemaining) > 0)) {
  throw new Error('음수·양수 활성 로트가 모두 있지 않습니다. 중단합니다.');
}
if (!existsSync(BACKUP)) {
  writeFileSync(BACKUP, JSON.stringify({ savedAt: new Date().toISOString(), state: stateSnap.data(), movement: null }, null, 2), 'utf8');
}
const before = new Map(state.activeLots.map(l => [l.id, l]));
const lotChanges = activeLots.flatMap(lot => {
  const old = before.get(lot.id);
  const beforeKg = Number(old?.kgRemaining ?? 0);
  const afterKg = Number(lot.kgRemaining ?? 0);
  const deltaKg = r3(afterKg - beforeKg);
  if (deltaKg === 0) return [];
  return [{
    lotId: lot.id, supplierName: lot.supplierName, lotNo: lot.lotNo, receivedDate: lot.receivedDate,
    beforeKg, afterKg, deltaKg, lotSnapshot: old ?? { ...lot, kgRemaining: 0 },
  }];
});
const movement: RawInventoryMovement = {
  id: operationDocId(OPERATION_ID), operationId: OPERATION_ID,
  commandHash: `repair-unpack:${RAW_ID}:${EXPECTED_UNPACK_KG}`,
  companyId: COMPANY, rawItemId: RAW_ID, materialSnapshot: '깨분참기름',
  effectiveAt: NOW, recordedAt: NOW, sequence: state.revision + 1,
  kind: 'unpack', reportedDeltaKg: delta, appliedDeltaKg: delta,
  balanceAfterKg: lotSum, lotChanges, source: { type: 'unpack', id: CAN_ID }, actorName: '정정 스크립트',
};

await db.runTransaction(async tx => {
  const [freshItem, freshState, freshMovement] = await Promise.all([tx.get(itemRef), tx.get(stateRef), tx.get(movementRef)]);
  if (freshMovement.exists) return;
  if (freshState.data()?.revision !== state.revision || Number(freshItem.data()?.stock) !== Number(item.stock)) {
    throw new Error('미리보기 이후 재고가 바뀌었습니다. 다시 확인하세요.');
  }
  tx.set(stateRef, strip({
    ...state, stockKg: lotSum, activeLots, revision: movement.sequence, lastProcessedAt: NOW,
  }));
  tx.set(movementRef, strip({
    ...toLedgerDoc(movement, {
      note: '깨분참기름 80캔 개봉분 원자화 상태 복구', type: 'correction', addedBy: '정정 스크립트',
      canSize: 16.5, canCount: 80,
    }),
    unpackMoves: activeLots.filter(l => Number(l.kgRemaining) > 0).map(l => ({
      lotNo: l.lotNo, supplierName: l.supplierName, receivedDate: l.receivedDate,
      cans: 80, bulkQty: EXPECTED_UNPACK_KG,
    })),
  }));
});

console.log(`\n✅ 음수·양수 로트를 합치지 않고 원자화 상태에 복구했습니다. 백업: ${BACKUP}`);
process.exit(0);

function strip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
