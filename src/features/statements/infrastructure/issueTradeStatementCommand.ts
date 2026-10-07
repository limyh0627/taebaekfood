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

const partnerPaymentRunning = new Set<string>();

/** 번호·정산·자금 전표는 한 서버 거래로 확정하며 불확실 요청 전체를 보존한다. */
export async function recordPartnerPayment(companyId: string, input: PartnerPaymentInput): Promise<void> {
  const validDay = /^\d{4}-\d{2}-\d{2}$/.test(input.tradeDate)
    && Number.isFinite(Date.parse(`${input.tradeDate}T00:00:00Z`))
    && new Date(`${input.tradeDate}T00:00:00Z`).toISOString().slice(0, 10) === input.tradeDate;
  if (!validDay || !input.partnerId || input.partnerId.includes('/') || !input.cashAccountId || input.cashAccountId.includes('/')
    || !['입금', '출금'].includes(input.direction) || !Number.isSafeInteger(input.amount) || input.amount <= 0
    || typeof input.pin !== 'boolean' || !Array.isArray(input.allocations)
    || input.allocations.some(row => !row || !row.statementId || row.statementId.includes('/') || !Number.isSafeInteger(row.amount) || row.amount <= 0)
    || new Set(input.allocations.map(row => row.statementId)).size !== input.allocations.length
    || input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 500))
    throw new Error('수금·지불 날짜·금액·대상·입력을 확인해 주세요.');
  await authReady;
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
  const assertCompany = async () => {
    const { claims } = await user.getIdTokenResult();
    if (auth.currentUser?.uid !== user.uid || claims.companyId !== companyId || claims.isAdmin !== true)
      throw new Error('관리자 회사 권한이 바뀌었습니다.');
  };
  await assertCompany();
  const normalized: PartnerPaymentInput = { tradeDate: input.tradeDate, partnerId: input.partnerId, direction: input.direction,
    amount: input.amount, cashAccountId: input.cashAccountId, pin: input.pin,
    allocations: input.allocations.map(row => ({ statementId: row.statementId, amount: row.amount })), note: input.note?.trim() ?? '' };
  const fingerprint = JSON.stringify(normalized);
  type Request = PartnerPaymentInput & { operationId: string; expectedRevision: number; releaseId: string };
  const key = `partner-payment-pending:${companyId}:${input.partnerId}:${user.uid}`;
  if (partnerPaymentRunning.has(key)) throw new Error('이 거래처의 수금·지불 요청을 처리 중입니다.');
  partnerPaymentRunning.add(key);
  try {
    let pending: { version: 2; fingerprint: string; request: Request } | undefined;
    const saved = localStorage.getItem(key);
    if (saved) {
      try { pending = JSON.parse(saved); } catch { throw new Error('이전 수금 요청 기록을 확인할 수 없습니다.'); }
      if (pending?.version !== 2) {
        const legacy = pending as unknown as { fingerprint?: string; operationId?: string; revision?: number };
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)));
        const oldFingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (legacy?.fingerprint !== oldFingerprint || !Number.isSafeInteger(legacy.revision) || legacy.revision! < 0
          || !/^[A-Za-z0-9_-]{1,160}$/.test(legacy.operationId ?? ''))
          throw new Error('이 거래처의 이전 수금 결과가 불확실합니다. 같은 내용으로 다시 시도해 주세요.');
        // 원래 release를 추정하지 않는다. 기존 방식의 현재 release 확인 요청을 같은 작업으로 고정한다.
        const gate = (await getDoc(doc(db, 'appMeta', 'releaseCutover'))).data();
        if (gate?.status !== 'active' || !/^[A-Za-z0-9_-]{1,100}$/.test(gate?.releaseId ?? '')) throw new Error('수금 서버가 준비되지 않았습니다.');
        pending = { version: 2, fingerprint, request: { ...normalized, operationId: legacy.operationId!,
          expectedRevision: legacy.revision!, releaseId: gate.releaseId } };
        localStorage.setItem(key, JSON.stringify(pending));
      }
      const request = pending?.request;
      if (!request || pending.fingerprint !== fingerprint || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0
        || !/^[A-Za-z0-9_-]{1,160}$/.test(request.operationId) || !/^[A-Za-z0-9_-]{1,100}$/.test(request.releaseId)
        || JSON.stringify({ tradeDate: request.tradeDate, partnerId: request.partnerId, direction: request.direction,
          amount: request.amount, cashAccountId: request.cashAccountId, pin: request.pin, allocations: request.allocations, note: request.note }) !== fingerprint)
        throw new Error('이 거래처의 이전 수금 결과가 불확실합니다. 같은 내용으로 다시 시도해 주세요.');
    }
    if (!pending) {
      const [gate, state] = await Promise.all([
        getDoc(doc(db, 'appMeta', 'releaseCutover')),
        getDoc(doc(db, 'appMeta', `partnerPaymentState_${companyId}_${input.partnerId}`)),
      ]);
      const release = gate.data(), revision = state.exists() ? state.data().revision : 0;
      if (release?.status !== 'active' || !/^[A-Za-z0-9_-]{1,100}$/.test(release?.releaseId ?? '')) throw new Error('수금 서버가 준비되지 않았습니다.');
      if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('거래처 정산 상태가 잘못되었습니다.');
      pending = { version: 2, fingerprint, request: { ...normalized, operationId: `partner-payment-${crypto.randomUUID()}`,
        expectedRevision: revision, releaseId: release.releaseId } };
      localStorage.setItem(key, JSON.stringify(pending));
    }
    await assertCompany();
    const call = httpsCallable<Request, { status: 'applied' | 'duplicate'; id: string }>(functions, 'recordPartnerPaymentCommand');
    let result;
    try { result = await call(pending.request); }
    catch (error) {
      const failure = (error as { details?: { partnerPaymentFailure?: Record<string, unknown> } })?.details?.partnerPaymentFailure;
      if (failure?.version === 1 && failure.companyId === companyId && failure.partnerId === input.partnerId
        && failure.operationId === pending.request.operationId && failure.operationRejected === true && failure.financialWrites === false)
        localStorage.removeItem(key);
      throw error;
    }
    if (result.data.id !== pending.request.operationId || !['applied', 'duplicate'].includes(result.data.status))
      throw new Error('수금·지불 응답을 확인할 수 없습니다. 같은 내용으로 재시도해 주세요.');
    localStorage.removeItem(key);
  } finally { partnerPaymentRunning.delete(key); }
}
