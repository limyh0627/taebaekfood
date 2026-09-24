import { collection, doc, getDocs, query, runTransaction, where, type Firestore } from 'firebase/firestore';
import { companyOf, type CompanyId, type IssuedStatement, type PurchaseOrder } from '../../shared/types';

export interface OemFeeStatementWrite {
  companyId: CompanyId;
  poId: string;
  perKg: number;
  statement: IssuedStatement;
}

/** 발주 카드와 가공비 전표를 같은 트랜잭션에 넣어, 링크 실패 후 중복 발행을 막는다. */
export async function applyOemFeeStatement(db: Firestore, input: OemFeeStatementWrite): Promise<string> {
  const statementId = `OEMFEE-${input.poId}`;
  if (input.statement.id !== statementId || input.statement.orderId !== input.poId || companyOf(input.statement) !== input.companyId) {
    throw new Error('OEM 가공비 전표의 회사나 배치가 다릅니다.');
  }
  // 구버전은 임의 ID로 전표를 먼저 저장했다. 링크만 빠진 전표가 있으면 새 ID로 중복 발행하지 않는다.
  // 회사 범위 질의만 써서 규칙을 통과하고, 별도 복합 인덱스 배포 없이 옛 임의 ID도 찾아낸다.
  const companyStatements = await getDocs(query(collection(db, 'issuedStatements'), where('companyId', '==', input.companyId)));
  if (companyStatements.docs.some(snap => snap.id !== statementId && snap.data().orderId === input.poId && snap.data().type === '매입')) {
    throw new Error('이 배치에 연결되지 않은 기존 가공비 전표가 있습니다. 관리자 확인 후 연결해야 합니다.');
  }
  return runTransaction(db, async tx => {
    const poRef = doc(db, 'purchaseOrders', input.poId);
    const statementRef = doc(db, 'issuedStatements', statementId);
    const [poSnap, statementSnap] = await Promise.all([tx.get(poRef), tx.get(statementRef)]);
    if (!poSnap.exists()) throw new Error('OEM 배치가 없습니다.');
    const po = poSnap.data() as PurchaseOrder;
    if (companyOf(po) !== input.companyId || po.poType !== 'oem' || po.status !== 'received') throw new Error('가공비 전표를 발행할 수 없는 OEM 배치입니다.');
    if (po.linkedStatementId) {
      if (po.linkedStatementId === statementId && statementSnap.exists()) {
        const existing = statementSnap.data() as IssuedStatement;
        if (companyOf(existing) !== input.companyId || existing.orderId !== input.poId || existing.type !== '매입') {
          throw new Error('연결된 가공비 전표의 회사나 배치가 다릅니다.');
        }
        return statementId;
      }
      throw new Error('이미 다른 가공비 전표가 발행된 배치입니다.');
    }
    if (statementSnap.exists()) {
      const existing = statementSnap.data() as IssuedStatement;
      if (companyOf(existing) !== input.companyId || existing.orderId !== input.poId || existing.type !== '매입') throw new Error('가공비 전표 ID가 다른 자료에 사용 중입니다.');
      // 예전 순차 쓰기에서 전표만 생성되고 링크가 실패한 경우 연결만 복구한다.
      tx.update(poRef, { linkedStatementId: statementId, oemFeePerKg: input.perKg });
      return statementId;
    }
    tx.set(statementRef, input.statement);
    tx.update(poRef, { linkedStatementId: statementId, oemFeePerKg: input.perKg });
    return statementId;
  });
}
