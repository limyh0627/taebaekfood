import { collection, doc, getDocs, query, runTransaction, where, type Firestore } from 'firebase/firestore';
import { pruneDepletedLots, withCarryOverProductLot } from '../../shared/lotUtils';
import { companyOf, type AdjustmentRequest, type CompanyId, type PurchaseOrder, type RawMaterialLot } from '../../shared/types';

export interface OemReceiptItemChange {
  itemId: string;
  qty: number;
  lot?: RawMaterialLot;
  material?: string;
  unitKg?: number;
}

export interface OemReceiptInventoryInput {
  companyId: CompanyId;
  poId: string;
  operationId: string;
  date: string;
  items: OemReceiptItemChange[];
  poPatch: Partial<PurchaseOrder>;
  feeRequest: AdjustmentRequest;
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
  const invalidQuantity = input.items.find(row => !Number.isFinite(row.qty) || row.qty <= 0);
  if (invalidQuantity) {
    // 호출 화면이 양수만 보내도 저장 경계에서 다시 막아야 입고가 차감 명령으로 바뀌지 않는다.
    throw new Error(`OEM 입고 수량은 0보다 큰 숫자여야 합니다: ${invalidQuantity.itemId}`);
  }
  const feeId = `OEMFEE-${input.poId}`;
  // adjustmentRequests는 없는 문서의 get을 허용하지 않는다. 회사 조건을 단 목록 조회로
  // 기존 요청을 확인하고, 같은 배치의 동시 입고는 아래 PO 거래로 직렬화한다.
  // 별도 작성자가 조회 후 같은 ID를 만들면 create-only가 없는 클라이언트 set은 이를 막지 못한다.
  // ID 조건을 더하면 없는 문서에 readOk()가 평가돼 권한 거부된다(실제 규칙 시험 확인).
  const feeQuery = query(collection(db, 'adjustmentRequests'), where('companyId', '==', input.companyId));
  const feeRequests = await getDocs(feeQuery);
  const feeExists = feeRequests.docs.some(snapshot => snapshot.id === feeId);
  const result = await runTransaction(db, async tx => {
    const poRef = doc(db, 'purchaseOrders', input.poId);
    const feeRef = doc(db, 'adjustmentRequests', feeId);
    const itemRefs = input.items.map(row => doc(db, 'items', row.itemId));
    // Firestore transaction은 첫 write 전에 모든 read가 끝나야 한다.
    const [poSnapshot, ...itemSnapshots] = await Promise.all([
      tx.get(poRef),
      ...itemRefs.map(ref => tx.get(ref)),
    ]);
    if (!poSnapshot.exists()) throw new Error(`OEM 배치를 찾을 수 없습니다: ${input.poId}`);
    const po = poSnapshot.data() as Partial<PurchaseOrder>;
    if (companyOf(po) !== input.companyId || (input.poPatch.companyId && input.poPatch.companyId !== input.companyId)) {
      throw new Error('다른 회사의 OEM 배치는 처리할 수 없습니다.');
    }
    if (input.feeRequest.companyId !== input.companyId || input.feeRequest.oemPoId !== input.poId || input.feeRequest.id !== `OEMFEE-${input.poId}`) {
      throw new Error('OEM 가공비 확인 요청의 회사나 배치가 다릅니다.');
    }
    if (po.status === 'received') {
      if (po.oemReceiptOperationId === input.operationId) {
        // 다른 화면이 첫 목록 조회 뒤 입고를 마쳤을 수 있다. 거래가 끝난 후 다시 확인한다.
        return feeExists || po.linkedStatementId ? 'duplicate' : 'verify-duplicate';
      }
      throw new Error('이미 가공입고된 배치입니다.');
    }
    if (po.status !== 'invoiced') throw new Error('입고 가능한 OEM 배치가 아닙니다.');
    if (feeExists) throw new Error('입고 전 가공비 확인 요청이 이미 있습니다.');

    const missing = input.items.filter((_, index) => !itemSnapshots[index]!.exists()).map(row => row.itemId);
    if (missing.length > 0) throw new Error(`OEM 입고 품목 문서를 찾을 수 없습니다: ${missing.join(', ')}`);
    const wrongCompany = input.items.filter((_, index) => companyOf(itemSnapshots[index]!.data() ?? {}) !== input.companyId);
    if (wrongCompany.length > 0) throw new Error(`다른 회사의 OEM 입고 품목입니다: ${wrongCompany.map(row => row.itemId).join(', ')}`);

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
    tx.update(poRef, stripUndefined({ ...input.poPatch, companyId: input.companyId, oemReceiptOperationId: input.operationId }));
    tx.set(feeRef, stripUndefined(input.feeRequest));
    return 'applied';
  });
  if (result !== 'verify-duplicate') return result;
  const latestFees = await getDocs(feeQuery);
  if (latestFees.docs.some(snapshot => snapshot.id === feeId)) return 'duplicate';
  throw new Error('가공비 확인 요청이 누락된 입고입니다. 관리자 복구가 필요합니다.');
}
