/**
 * 태백 2026-08 기말재고의 통깨참기름 벌크만 332L로 정정한다.
 * 이 옛 스냅샷은 수량을 L로 기록했다. 당시 평가액에서 역산한 L당 단가를 유지해
 * 수량과 평가액을 함께 고치고, 현재 품목 재고·로트에는 손대지 않는다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { adminDb, 실행모드 } from './_admin.mts';

const SNAP_ID = 'inv-snap-2026-08';
const ITEM_ID = 'raw-통깨참기름';
const TARGET_L = 332;
const ORIGINAL_QTY = 3322.333;
const ORIGINAL_ITEM_VALUE = 31_139_950;
const BACKUP = '로컬전용/백업/aug-tongkkae-snapshot-2026-09-25.json';
const { APPLY, UNDO } = 실행모드();
if (APPLY && UNDO) throw new Error('--apply와 --undo는 함께 쓸 수 없습니다.');

const db = adminDb();
const ref = db.collection('inventorySnapshots').doc(SNAP_ID);
const itemRef = db.collection('items').doc(ITEM_ID);
const same = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error('백업이 없어 되돌릴 수 없습니다.');
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as { before: Record<string, unknown>; after: Record<string, unknown> };
  await db.runTransaction(async tx => {
    const current = await tx.get(ref);
    if (!current.exists || !same(current.data(), backup.after)) throw new Error('적용 뒤 스냅샷이 다시 바뀌어 자동 복원을 중단합니다.');
    tx.set(ref, backup.before);
  });
  const restored = await ref.get();
  if (!same(restored.data(), backup.before)) throw new Error('복원 후 재조회가 백업과 다릅니다.');
  console.log('복원 완료: 태백 2026-08 통깨참기름 벌크 스냅샷');
  process.exit(0);
}

const [snapshot, item] = await Promise.all([ref.get(), itemRef.get()]);
if (!snapshot.exists || !item.exists) throw new Error('스냅샷 또는 통깨참기름 벌크 품목이 없습니다.');
const before = snapshot.data() as Record<string, unknown>;
const product = item.data() as Record<string, unknown>;
if (before.companyId !== 'taebaek' || before.yearMonth !== '2026-08') throw new Error('회사 또는 월이 다릅니다.');
if (product.companyId !== 'taebaek' || product.subtype !== '벌크' || product.unit !== 'L') throw new Error('품목의 회사·서브타입·단위가 예상과 다릅니다.');
const rows = before.items as Array<Record<string, unknown>> | undefined;
if (!Array.isArray(rows)) throw new Error('품목별 스냅샷 줄이 없습니다.');
const matches = rows.filter(row => row.itemId === ITEM_ID);
if (matches.length !== 1) throw new Error(`대상 품목 줄이 ${matches.length}개입니다.`);
const original = matches[0]!;
if (original.qty !== ORIGINAL_QTY || original.value !== ORIGINAL_ITEM_VALUE || original.spec !== '벌크') {
  throw new Error('원래 수량·평가액·규격이 확인한 값과 달라졌습니다.');
}
const oldTotal = Number(before.value);
const rowsTotal = rows.reduce((sum, row) => sum + Number(row.value ?? 0), 0);
if (!Number.isFinite(oldTotal) || oldTotal !== rowsTotal) throw new Error('스냅샷 총액과 품목별 합계가 다릅니다.');

const unitValue = ORIGINAL_ITEM_VALUE / ORIGINAL_QTY;
const newItemValue = Math.round(TARGET_L * unitValue);
const newTotal = oldTotal - ORIGINAL_ITEM_VALUE + newItemValue;
const nextRows = rows.map(row => row.itemId === ITEM_ID ? { ...row, qty: TARGET_L, value: newItemValue } : row);
const after = { ...before, items: nextRows, value: newTotal };

console.log(JSON.stringify({
  document: `inventorySnapshots/${SNAP_ID}`,
  itemId: ITEM_ID,
  quantityL: { before: ORIGINAL_QTY, after: TARGET_L },
  unitValuePreserved: unitValue,
  itemValueWon: { before: ORIGINAL_ITEM_VALUE, after: newItemValue },
  snapshotValueWon: { before: oldTotal, after: newTotal },
  currentItemStockUnchanged: product.stock,
  mode: APPLY ? 'apply' : 'dry',
}, null, 2));
if (!APPLY) process.exit(0);
if (existsSync(BACKUP)) throw new Error('백업이 이미 있어 재실행을 중단합니다.');
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({ before, after }, null, 2), { encoding: 'utf8', flag: 'wx' });
await db.runTransaction(async tx => {
  const current = await tx.get(ref);
  if (!current.exists || !same(current.data(), before)) throw new Error('미리보기 이후 스냅샷이 변경돼 적용을 중단합니다.');
  tx.set(ref, after);
});
const verified = await ref.get();
if (!same(verified.data(), after)) throw new Error('적용 후 재조회가 예상값과 다릅니다.');
console.log(`적용·재조회 완료. 되돌리기: node -r ./로컬전용/tsx-userinfo-preload.cjs --import tsx scripts/fix-aug-tongkkae-snapshot.mts --undo`);
