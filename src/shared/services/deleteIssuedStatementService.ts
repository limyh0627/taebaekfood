import { collection, deleteField, doc, getDoc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { auth, authReady, db } from '../firebase';
import { companyOf, type CompanyId } from '../types';

const sourceIds = (row: Record<string, any>, kind: 'orders' | 'purchaseOrders'): string[] => {
  const values = kind === 'orders' ? String(row.orderId ?? '').split(/[\s,]+/)
    : [...(Array.isArray(row.purchaseOrderIds) ? row.purchaseOrderIds : []), ...(Array.isArray(row.confirmedProductIds) ? row.confirmedProductIds : []), row.sourcePoId];
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && !!value))].sort();
};

/** 전표와 실제로 같은 전표를 가리키는 연결만 함께 삭제한다. 재고·상태·번호는 유지한다. */
export async function deleteIssuedStatement(companyId: CompanyId, id: string): Promise<void> {
  await authReady;
  if (!auth.currentUser) throw new Error('로그인이 만료되었습니다.');
  if ((await auth.currentUser.getIdTokenResult()).claims.companyId !== companyId) throw new Error('회사 권한이 없습니다.');
  const statementRef = doc(db, 'issuedStatements', id);
  const original = await getDoc(statementRef);
  if (!original.exists()) throw new Error('대상 전표를 찾을 수 없습니다.');
  if (companyOf(original.data()) !== companyId) throw new Error('다른 회사의 전표는 삭제할 수 없습니다.');
  const groups = ['orders', 'purchaseOrders', 'settlements'] as const;
  const partnerId = original.data().partnerId;
  const stateRef = partnerId ? doc(db, 'appMeta', `partnerPaymentState_${companyId}_${partnerId}`) : null;
  await runTransaction(db, async tx => {
    const [state, statement] = await Promise.all([stateRef ? tx.get(stateRef) : Promise.resolve(null), tx.get(statementRef)]);
    if (!statement.exists()) throw new Error('대상 전표를 찾을 수 없습니다.');
    if (companyOf(statement.data()) !== companyId) throw new Error('다른 회사의 전표는 삭제할 수 없습니다.');
    if (statement.data().partnerId !== partnerId) throw new Error('전표 거래처가 변경되었습니다. 다시 확인해 주세요.');
    const revision = state?.exists() ? state.data().revision : 0;
    if (state?.exists() && (state.data().companyId !== companyId || state.data().partnerId !== partnerId)) throw new Error('거래처 정산 회사가 일치하지 않습니다.');
    if (!Number.isSafeInteger(revision) || revision < 0 || !Number.isSafeInteger(revision + 1)) throw new Error('거래처 정산 상태가 손상되었습니다.');
    // 공유 정산 상태를 읽은 뒤 매 재시도마다 연결 목록을 새로 수집한다.
    const results = await Promise.all(groups.map(name => getDocs(query(collection(db, name), where('companyId', '==', companyId), where(name === 'settlements' ? 'statementId' : 'linkedStatementId', '==', id)))));
    const refs = groups.map((name, index) => {
      const ids = new Set(results[index].docs.map(row => row.id));
      if (name !== 'settlements') sourceIds(statement.data(), name).forEach(value => ids.add(value));
      return [...ids].map(value => doc(db, name, value));
    });
    if (refs.reduce((sum, rows) => sum + rows.length, stateRef ? 2 : 1) > 500) throw new Error('연결 문서가 너무 많아 삭제할 수 없습니다.');
    const rows = await Promise.all(refs.flat().map(ref => tx.get(ref)));
    for (const kind of ['orders', 'purchaseOrders'] as const) {
      if (JSON.stringify(sourceIds(statement.data(), kind)) !== JSON.stringify(sourceIds(original.data(), kind))) throw new Error('전표 연결이 변경되었습니다. 다시 확인해 주세요.');
    }
    for (const row of rows) {
      if (row.exists() && companyOf(row.data()) !== companyId) throw new Error('다른 회사의 연결 문서가 있습니다.');
    }
    let offset = 0;

    groups.forEach((name, group) => refs[group].forEach(ref => {
      const row = rows[offset++];
      if (!row.exists()) return;
      if (name === 'settlements') { if (row.data().statementId === id) tx.delete(ref); }
      else if (row.data().linkedStatementId === id) tx.update(ref, { linkedStatementId: deleteField(), linkedStatementAt: deleteField() });
    }));
    if (stateRef) {
      if (state?.exists()) tx.update(stateRef, { revision: revision + 1 });
      else tx.set(stateRef, { companyId, partnerId, revision: revision + 1 });
    }
    tx.delete(statementRef);
  });
}
