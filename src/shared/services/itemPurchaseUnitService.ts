import { collection, doc, onSnapshot, query, where, runTransaction, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import { COL } from '../collections';
import type { CompanyId, ItemPurchaseUnit } from '../types';
import { companyScopedWriteData } from './firebaseService';
import { makePurchaseUnitSnapshot } from '../purchaseUnit';

export function subscribeItemPurchaseUnits(companyId: CompanyId, onData: (rows: ItemPurchaseUnit[]) => void, onError: (error: Error) => void): () => void {
  return onSnapshot(query(collection(db, COL.itemPurchaseUnits), where('companyId', '==', companyId)), snapshot => {
    onData(snapshot.docs.map(document => ({ ...document.data(), id: document.id }) as ItemPurchaseUnit).filter(row => row.companyId === companyId));
  }, onError);
}

/** 등록표는 전표와 별개다. 수정해도 이미 발행한 전표의 중량은 바꾸지 않는다. */
export async function saveItemPurchaseUnitWithDb(store: Firestore, unit: ItemPurchaseUnit): Promise<void> {
  if (!unit.id || unit.id.includes('/') || !unit.itemId || unit.itemId.includes('/') || unit.partnerId?.includes('/') || !unit.createdAt || !unit.updatedAt) throw new Error('매입단위 식별 정보를 확인해 주세요.');
  makePurchaseUnitSnapshot({ ...unit, active: true }, 1);
  if (typeof unit.active !== 'boolean' || typeof unit.isDefault !== 'boolean') throw new Error('사용 상태를 확인해 주세요.');
  const scoped = await companyScopedWriteData(COL.itemPurchaseUnits, unit as unknown as Record<string, unknown>);
  const ref = doc(store, COL.itemPurchaseUnits, unit.id);
  await runTransaction(store, async transaction => {
    const previous = await transaction.get(ref);
    if (previous.exists()) {
      const before = previous.data();
      if (before.companyId !== unit.companyId || before.itemId !== unit.itemId || (before.partnerId ?? '') !== (unit.partnerId ?? '') || before.createdAt !== unit.createdAt) throw new Error('기존 매입단위의 회사·품목·거래처는 바꿀 수 없습니다. 새 단위를 등록해 주세요.');
    }
    transaction.set(ref, scoped);
  });
}
export const saveItemPurchaseUnit = (unit: ItemPurchaseUnit) => saveItemPurchaseUnitWithDb(db, unit);
