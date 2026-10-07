import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import type { CompanyId, PurchaseOrder, ReturnRequest } from '../types';
import { pendingFlowQuantityPatch } from '../pendingFlowQuantity';

/** 최신 대기 기록과 원본 수량을 확인한 뒤 수량만 저장한다. */
export async function updatePendingFlowQuantity(
  companyId: CompanyId,
  type: '입고' | '반품',
  id: string,
  updates: { itemId: string; previousQuantity: number; quantity: number }[],
): Promise<void> {
  const ref = doc(db, type === '입고' ? 'purchaseOrders' : 'returnRequests', id);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('대상 기록을 찾을 수 없습니다.');
    tx.update(ref, pendingFlowQuantityPatch(type, snap.data() as PurchaseOrder | ReturnRequest, updates, companyId));
  });
}
