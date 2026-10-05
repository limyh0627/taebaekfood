import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { authReady, db, functions } from '../../../shared/firebase';
import { companyScopedWriteData } from '../../../shared/services/firebaseService';
import type { IssuedStatement } from '../../../shared/types';

export type TradeStatementIssueInput = {
  operationId: string;
  statement: IssuedStatement;
  orderIds: string[];
  poIds: string[];
  newPo?: { id: string; cardNo: string; items: Record<string, unknown>[] };
  costUpdates: { itemId: string; price: number; beforeCost: number; sourceLineIndex: number }[];
};

/** 운영 규칙은 전표 직접 쓰기를 막는다. 발행과 연관 기록은 서버의 한 거래로 저장한다. */
export async function issueTradeStatementCommand(input: TradeStatementIssueInput): Promise<{
  status: 'applied' | 'duplicate'; id: string; docNo: string;
}> {
  await authReady;
  const gate = (await getDoc(doc(db, 'appMeta', 'releaseCutover'))).data();
  if (gate?.status !== 'active' || typeof gate.releaseId !== 'string') {
    throw new Error('전표 발행 서버가 준비되지 않았습니다. 관리자에게 문의해 주세요.');
  }
  const scoped = await companyScopedWriteData('issuedStatements', input.statement as unknown as Record<string, unknown>);
  const call = httpsCallable<unknown, { status: 'applied' | 'duplicate'; id: string; docNo: string }>(functions, 'issueTradeStatementCommand');
  const result = await call({ ...input, statement: JSON.parse(JSON.stringify(scoped)), releaseId: gate.releaseId });
  return result.data;
}

/** 주문 연결이 없는 일반 대체전표도 번호와 본문을 서버에서 함께 확정한다. */
export async function issueNumberedStatement(statement: IssuedStatement): Promise<{ id: string; docNo: string }> {
  await authReady;
  const gate = (await getDoc(doc(db, 'appMeta', 'releaseCutover'))).data();
  if (gate?.status !== 'active' || typeof gate.releaseId !== 'string') {
    throw new Error('전표 발행 서버가 준비되지 않았습니다. 관리자에게 문의해 주세요.');
  }
  const scoped = await companyScopedWriteData('issuedStatements', statement as unknown as Record<string, unknown>);
  const call = httpsCallable<unknown, { id: string; docNo: string }>(functions, 'issueNumberedVoucher');
  const result = await call({
    kind: 'issuedStatements', operationId: statement.id, tradeDate: statement.tradeDate,
    prefix: statement.type === '비용' ? '대체' : '',
    document: JSON.parse(JSON.stringify(scoped)), releaseId: gate.releaseId,
  });
  return result.data;
}
