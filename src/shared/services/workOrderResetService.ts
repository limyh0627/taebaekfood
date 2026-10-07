import { collection, doc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { CompanyId } from '../types';
import { deleteItem } from './firebaseService';

/** 날짜가 바뀐 뒤 회사 작업순서를 한 기기에서 비운다. */
export async function resetDailyWorkOrder(companyId: CompanyId): Promise<void> {
  const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }).replace(/\. /g, '-').replace('.', '');
  const resetRef = doc(db, 'appMeta', `workOrderReset_${companyId}`);
  let acquired = false;
  try {
    acquired = await runTransaction(db, async tx => {
      const snap = await tx.get(resetRef);
      if (snap.exists() && snap.data().companyId !== undefined && snap.data().companyId !== companyId) throw new Error('다른 회사의 작업순서 잠금입니다.');
      if (snap.exists() && snap.data().date === today) return false;
      tx.set(resetRef, { date: today, companyId });
      return true;
    });
    if (!acquired) return;
    const snap = await getDocs(query(collection(db, 'workOrderItems'), where('companyId', '==', companyId)));
    await Promise.all(snap.docs.map(row => deleteItem('workOrderItems', row.id)));
  } catch (error) {
    console.error('[작업순서 초기화] 실패:', error);
    if (!acquired) return;
    try {
      await runTransaction(db, async tx => {
        const snap = await tx.get(resetRef);
        if (!snap.exists() || snap.data().companyId !== companyId || snap.data().date !== today) return;
        tx.set(resetRef, { date: '', companyId });
      });
    } catch { /* 되돌리기까지 실패하면 다음 날 풀린다 */ }
  }
}
