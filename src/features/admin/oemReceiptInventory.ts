import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import { pruneDepletedLots, withCarryOverProductLot } from '../../shared/lotUtils';
import type { PurchaseOrder, RawMaterialLot } from '../../shared/types';

export interface OemReceiptItemChange {
  itemId: string;
  qty: number;
  lot?: RawMaterialLot;
  material?: string;
  unitKg?: number;
}

export interface OemReceiptInventoryInput {
  poId: string;
  operationId: string;
  date: string;
  items: OemReceiptItemChange[];
  poPatch: Partial<PurchaseOrder>;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const stripUndefined = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * OEM 완제품 입고의 DB 경계.
 *
 * 예전에는 화면이 들고 있던 `item.stock/lots`에 더한 값을 품목별로 차례로 덮어썼다.
 * 동시에 두 입고가 들어오면 뒤 쓰기가 앞 입고를 잃고, 중간 실패면 품목 일부만 입고됐다.
 * 배치 완료 표시까지 같은 transaction에 넣어 재시도 때 완제품이 한 번 더 늘어나는 길도 막는다.
 */
export async function applyOemReceiptInventory(
  db: Firestore,
  input: OemReceiptInventoryInput,
): Promise<'applied' | 'duplicate'> {
  const duplicateItemIds = input.items
    .map(row => row.itemId)
    .filter((itemId, index, ids) => ids.indexOf(itemId) !== index);
  if (duplicateItemIds.length > 0) {
    throw new Error(`OEM 입고 품목이 중복되었습니다: ${[...new Set(duplicateItemIds)].join(', ')}`);
  }
  return runTransaction(db, async tx => {
    const poRef = doc(db, 'purchaseOrders', input.poId);
    const itemRefs = input.items.map(row => doc(db, 'items', row.itemId));
    // Firestore transaction은 첫 write 전에 모든 read가 끝나야 한다.
    const [poSnapshot, ...itemSnapshots] = await Promise.all([
      tx.get(poRef),
      ...itemRefs.map(ref => tx.get(ref)),
    ]);
    if (!poSnapshot.exists()) throw new Error(`OEM 배치를 찾을 수 없습니다: ${input.poId}`);
    const po = poSnapshot.data() as Partial<PurchaseOrder>;
    if (po.status === 'received') {
      if (po.oemReceiptOperationId === input.operationId) return 'duplicate';
      throw new Error('이미 가공입고된 배치입니다.');
    }

    const missing = input.items.filter((_, index) => !itemSnapshots[index]!.exists()).map(row => row.itemId);
    if (missing.length > 0) throw new Error(`OEM 입고 품목 문서를 찾을 수 없습니다: ${missing.join(', ')}`);

    input.items.forEach((row, index) => {
      const data = itemSnapshots[index]!.data() ?? {};
      const stock = Number(data.stock ?? 0);
      const patch: { stock: number; lots?: RawMaterialLot[] } = { stock: round3(stock + row.qty) };
      if (row.lot && row.material && row.unitKg && row.unitKg > 0) {
        const currentLots: RawMaterialLot[] = Array.isArray(data.lots) ? data.lots : [];
        const baseLots = withCarryOverProductLot(currentLots, stock, row.material, row.unitKg, {
          id: `lot-carry-oem-${input.poId}-${row.itemId}`,
          createdAt: row.lot.createdAt,
          receivedDate: input.date,
        });
        // 같은 배치 로트가 이미 보이면 부분 복구 중인 데이터다. 한 번 더 붙이지 않는다.
        patch.lots = stripUndefined(pruneDepletedLots(
          baseLots.some(lot => lot.id === row.lot!.id) ? baseLots : [...baseLots, row.lot],
        ));
      }
      tx.update(itemRefs[index]!, patch);
    });
    tx.update(poRef, stripUndefined({ ...input.poPatch, oemReceiptOperationId: input.operationId }));
    return 'applied';
  });
}
