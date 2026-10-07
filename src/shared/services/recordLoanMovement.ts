import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, db, functions } from '../firebase';

export type LoanMovementInput = {
  loanId: string; tradeDate: string; cashAccountId: string; action: '차입' | '상환';
  principal: number; interest: number; note?: string;
};
type Request = LoanMovementInput & { operationId: string; expectedRevision: number; releaseId: string };
const running = new Set<string>();

/** 서버 전용 대출 명령. 불확실한 응답의 입력/작업/버전/릴리스를 그대로 보존한다. */
export async function recordLoanMovement(companyId: string, input: LoanMovementInput) {
  const validDay = /^\d{4}-\d{2}-\d{2}$/.test(input.tradeDate)
    && Number.isFinite(Date.parse(`${input.tradeDate}T00:00:00Z`))
    && new Date(`${input.tradeDate}T00:00:00Z`).toISOString().slice(0, 10) === input.tradeDate;
  if (!input.loanId || input.loanId.includes('/') || !input.cashAccountId || input.cashAccountId.includes('/')
    || !validDay || !['차입', '상환'].includes(input.action)
    || !Number.isSafeInteger(input.principal) || input.principal < 0
    || !Number.isSafeInteger(input.interest) || input.interest < 0
    || !Number.isSafeInteger(input.principal + input.interest) || input.principal + input.interest <= 0
    || input.action === '차입' && (input.principal <= 0 || input.interest !== 0)
    || input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 500))
    throw new Error('대출 날짜·원금·이자·입력 길이를 확인하세요.');
  await authReady;
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 만료되었습니다.');
  const assertCompany = async () => {
    const { claims } = await user.getIdTokenResult();
    if (auth.currentUser?.uid !== user.uid || claims.companyId !== companyId || claims.isAdmin !== true)
      throw new Error('관리자 회사 권한이 바뀌었습니다.');
  };
  await assertCompany();
  const normalized = { ...input, note: input.note?.trim() ?? '' };
  const fingerprint = JSON.stringify(normalized);
  const key = `loan-movement-pending:${companyId}:${input.loanId}:${user.uid}`;
  if (running.has(key)) throw new Error('이 대출의 발행 요청을 처리 중입니다.');
  running.add(key);
  try {
    let pending: { fingerprint: string; request: Request } | undefined;
    const saved = localStorage.getItem(key);
    if (saved) {
      try { pending = JSON.parse(saved); } catch { throw new Error('이전 대출 요청 기록을 확인할 수 없습니다.'); }
      const request = pending?.request;
      if (!request || pending?.fingerprint !== fingerprint || !Number.isSafeInteger(request.expectedRevision)
        || request.expectedRevision < 0 || !/^[A-Za-z0-9_-]{1,160}$/.test(request.operationId)
        || !/^[A-Za-z0-9_-]{1,100}$/.test(request.releaseId)
        || JSON.stringify({ loanId: request.loanId, tradeDate: request.tradeDate, cashAccountId: request.cashAccountId,
          action: request.action, principal: request.principal, interest: request.interest, note: request.note }) !== fingerprint)
        throw new Error('이 대출의 이전 발행 결과가 불확실합니다. 같은 내용으로 다시 시도해 주세요.');
    }
    if (!pending) {
      const [gate, loan] = await Promise.all([
        getDoc(doc(db, 'appMeta', 'releaseCutover')), getDoc(doc(db, 'loanContracts', input.loanId)),
      ]);
      const release = gate.data(), contract = loan.data();
      if (release?.status !== 'active' || typeof release.releaseId !== 'string') throw new Error('대출 발행 서버가 준비되지 않았습니다.');
      if (!loan.exists() || (contract?.companyId ?? 'taebaek') !== companyId) throw new Error('대출 계약의 회사가 맞지 않습니다.');
      const revision = contract?.movementRevision ?? 0;
      if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('대출 계약 버전이 잘못되었습니다.');
      const operationId = `loan-${crypto.randomUUID()}`;
      pending = { fingerprint, request: { ...normalized, operationId,
        expectedRevision: revision, releaseId: release.releaseId } };
      localStorage.setItem(key, JSON.stringify(pending));
    }
    await assertCompany();
    const call = httpsCallable<Request, { status: 'applied' | 'duplicate'; id: string; docNo: string; balanceAfter: number }>(functions, 'recordLoanMovementCommand');
    let result;
    try { result = await call(pending.request); }
    catch (error) {
      const failure = (error as { details?: { loanMovementFailure?: Record<string, unknown> } })?.details?.loanMovementFailure;
      if (failure?.version === 2 && failure.companyId === companyId && failure.loanId === input.loanId
        && failure.operationId === pending.request.operationId && failure.operationRejected === true
        && failure.financialWrites === false) localStorage.removeItem(key);
      throw error;
    }
    if (result.data.id !== pending.request.operationId || !['applied', 'duplicate'].includes(result.data.status))
      throw new Error('대출 발행 응답을 확인할 수 없습니다. 같은 내용으로 재시도해 주세요.');
    localStorage.removeItem(key);
    return result.data;
  } finally { running.delete(key); }
}
