import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, db, functions } from '../../../shared/firebase';
import { companyScopedWriteData } from '../../../shared/services/firebaseService';
import type { CashEntry, IssuedStatement } from '../../../shared/types';

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

/** 일반 입출금 전표도 운영의 서버 소유 번호·장부 경계를 통과한다. */
export async function issueNumberedCashEntry(entry: CashEntry): Promise<{ id: string; docNo: string }> {
  await authReady;
  const gate = (await getDoc(doc(db, 'appMeta', 'releaseCutover'))).data();
  if (gate?.status !== 'active' || typeof gate.releaseId !== 'string') {
    throw new Error('전표 발행 서버가 준비되지 않았습니다. 관리자에게 문의해 주세요.');
  }
  const scoped = await companyScopedWriteData('cashEntries', entry as unknown as Record<string, unknown>);
  const call = httpsCallable<unknown, { id: string; docNo: string }>(functions, 'issueNumberedVoucher');
  const result = await call({
    kind: 'cashEntries', operationId: entry.id, tradeDate: entry.date, prefix: '',
    document: JSON.parse(JSON.stringify(scoped)), releaseId: gate.releaseId,
  });
  return result.data;
}

type PartnerPaymentInput = {
  tradeDate: string; partnerId: string; direction: '입금' | '출금'; amount: number;
  cashAccountId: string; pin: boolean; allocations: { statementId: string; amount: number }[]; note?: string;
};

/** 거래처 지급은 번호·정산·자금 전표가 한 서버 거래로 확정되어야 한다. */
export async function recordPartnerPayment(companyId: string, input: PartnerPaymentInput): Promise<void> {
  await authReady;
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
  const gate = (await getDoc(doc(db, 'appMeta', 'releaseCutover'))).data();
  if (gate?.status !== 'active' || typeof gate.releaseId !== 'string') throw new Error('수금 서버가 준비되지 않았습니다.');
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const key = `partner-payment-pending:${companyId}:${input.partnerId}:${user.uid}`;
  const saved = localStorage.getItem(key);
  let pending: { fingerprint: string; operationId: string; revision: number } | null = null;
  if (saved) {
    try { pending = JSON.parse(saved); } catch { throw new Error('이전 수금 요청 기록을 확인할 수 없습니다. 관리자에게 문의해 주세요.'); }
    if (!pending || pending.fingerprint !== fingerprint || !Number.isSafeInteger(pending.revision)) {
      throw new Error('이 거래처의 이전 수금 결과가 불확실합니다. 같은 내용으로 다시 시도해 주세요.');
    }
  }
  if (!pending) {
    const state = await getDoc(doc(db, 'appMeta', `partnerPaymentState_${companyId}_${input.partnerId}`));
    const revision = state.exists() ? state.data().revision : 0;
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('거래처 정산 상태가 잘못되었습니다.');
    pending = { fingerprint, operationId: `partner-payment-${crypto.randomUUID()}`, revision };
    localStorage.setItem(key, JSON.stringify(pending));
  }
  const call = httpsCallable<unknown, { status: string }>(functions, 'recordPartnerPaymentCommand');
  await call({ ...input, operationId: pending.operationId, expectedRevision: pending.revision, releaseId: gate.releaseId });
  localStorage.removeItem(key);
}
