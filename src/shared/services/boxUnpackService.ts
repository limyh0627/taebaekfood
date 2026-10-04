import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { companyOf, type RawMaterialLot } from '../types';
import { deductLotsByQty, lotQtyRemaining, pruneDepletedLots } from '../lotUtils';
import { itemKg } from '../orderUnits';

const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** 박스 한 개를 낱개로 옮긴다. 두 재고와 로트, 이동 근거는 함께 확정된다. */
export async function unpackBoxStock(params: {
  boxItemId: string; unitItemId: string; count: number; operationId: string;
}): Promise<{ ok: boolean; message: string }> {
  const { boxItemId, unitItemId, count, operationId } = params;
  if (!boxItemId || !unitItemId || boxItemId === unitItemId || !Number.isSafeInteger(count) || count < 1 || !operationId) {
    return { ok: false, message: '개봉할 박스와 낱개 품목, 수량을 확인하세요.' };
  }
  const now = new Date().toISOString();
  try {
    await runTransaction(db, async tx => {
      const boxRef = doc(db, 'items', boxItemId);
      const unitRef = doc(db, 'items', unitItemId);
      const moveRef = doc(db, 'itemUnpackMovements', operationId);
      const [boxSnap, unitSnap, moveSnap] = await Promise.all([tx.get(boxRef), tx.get(unitRef), tx.get(moveRef)]);
      if (moveSnap.exists()) {
        const move = moveSnap.data();
        if (move.boxItemId !== boxItemId || move.unitItemId !== unitItemId || move.count !== count) throw new Error('이미 다른 개봉에 사용된 작업번호입니다.');
        return;
      }
      if (!boxSnap.exists() || !unitSnap.exists()) throw new Error('개봉할 품목을 찾을 수 없습니다.');
      const box = boxSnap.data();
      const unit = unitSnap.data();
      if (companyOf(box) !== companyOf(unit)) throw new Error('두 품목의 회사가 다릅니다.');
      const boxStock = Number(box.stock ?? 0);
      const unitStock = Number(unit.stock ?? 0);
      if (!Number.isSafeInteger(boxStock) || boxStock < 1 || !Number.isSafeInteger(unitStock) || unitStock < 0) throw new Error('재고 수량을 확인하세요.');
      const boxLots = (box.lots ?? []) as RawMaterialLot[];
      const unitLots = (unit.lots ?? []) as RawMaterialLot[];
      if (lotQtyRemaining(boxLots) !== boxStock || lotQtyRemaining(unitLots) !== unitStock) {
        throw new Error('재고와 로트 수량이 다릅니다. 먼저 두 품목을 실사해 맞춘 뒤 개봉하세요.');
      }
      const taken = deductLotsByQty(boxLots, 1);
      if (taken.shortageQty > 0) throw new Error('개봉할 박스 로트가 없습니다.');
      const unitWeight = itemKg(unit as Parameters<typeof itemKg>[0]);
      const addedLots: RawMaterialLot[] = taken.distribution.map((source, index) => ({
        id: `lot-${operationId}-${index}`, material: String(unit.name ?? box.name ?? ''),
        supplierName: source.supplierName, lotNo: source.lotNo,
        receivedDate: source.receivedDate || now.slice(0, 10), createdAt: now,
        qtyIn: count * source.qty, qtyRemaining: count * source.qty,
        unitKg: unitWeight, kgIn: count * source.qty * unitWeight,
        kgRemaining: count * source.qty * unitWeight, status: 'active',
      }));
      tx.update(boxRef, { stock: boxStock - 1, lots: clean(pruneDepletedLots(taken.lots)) });
      tx.update(unitRef, { stock: unitStock + count, lots: clean([...unitLots, ...addedLots]) });
      tx.set(moveRef, clean({ id: operationId, companyId: companyOf(box), boxItemId, unitItemId,
        count, boxQty: 1, createdAt: now, sourceLots: taken.distribution,
        createdLotIds: addedLots.map(lot => lot.id) }));
    });
    return { ok: true, message: '박스 1개를 낱개로 개봉했습니다.' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
