import { companyOf } from '../types';
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
function normalizeInput(input: LoanMovementInput) {
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
  return { ...input, note: input.note?.trim() ?? '' };
}

type PendingLoanMovement = { fingerprint: string; request: Request };
export interface LoanMovementObservation {
  companyId: string;
  actorUid: string;
  loanId: string;
  key: string;
  raw: string;
  fingerprint: string;
}
const pendingKey = (companyId: string, loanId: string, actorUid: string) => `loan-movement-pending:${companyId}:${loanId}:${actorUid}`;
function retained(raw: string, fingerprint: string): PendingLoanMovement {
  let pending: PendingLoanMovement;
  try { pending = JSON.parse(raw); } catch { throw new Error('이전 대출 요청 기록을 확인할 수 없습니다.'); }
  const request = pending?.request;
  if (!request || pending?.fingerprint !== fingerprint || !Number.isSafeInteger(request.expectedRevision)
    || request.expectedRevision < 0 || !/^[A-Za-z0-9_-]{1,160}$/.test(request.operationId)
    || !/^[A-Za-z0-9_-]{1,100}$/.test(request.releaseId)
    || JSON.stringify({ loanId: request.loanId, tradeDate: request.tradeDate, cashAccountId: request.cashAccountId,
      action: request.action, principal: request.principal, interest: request.interest, note: request.note }) !== fingerprint)
    throw new Error('이 대출의 이전 발행 결과가 불확실합니다. 같은 내용으로 다시 시도해 주세요.');
  return pending;
}
function clearObserved(key: string, raw: string) { if (localStorage.getItem(key) === raw) localStorage.removeItem(key); }

/** 재시도 판단은 현재 잔액이 아니라 해당 사용자에게 보관된 최초 원문으로 한다. */
export function readMatchingLoanMovement(companyId: string, input: LoanMovementInput): LoanMovementObservation | null {
  const fingerprint = JSON.stringify(normalizeInput(input));
  const actorUid = auth.currentUser?.uid;
  if (!actorUid) return null;
  const key = pendingKey(companyId, input.loanId, actorUid), raw = localStorage.getItem(key);
  if (raw === null) return null;
  retained(raw, fingerprint);
  return { companyId, actorUid, loanId: input.loanId, key, raw, fingerprint };
}

/** 관측 이후 사본이 없어져도 새 요청을 만들지 않는 결과 재확인 경로다. */
export async function retryLoanMovement(companyId: string, input: LoanMovementInput, observed: LoanMovementObservation, isCurrent: () => boolean) {
  const snapshot = { ...observed };
  const fingerprint = JSON.stringify(normalizeInput(input));
  const user = auth.currentUser;
  const actorUid = user?.uid;
  const key = user ? pendingKey(companyId, input.loanId, user.uid) : '';
  if (!user || snapshot.actorUid !== user.uid || snapshot.companyId !== companyId || snapshot.loanId !== input.loanId
    || snapshot.key !== key || snapshot.fingerprint !== fingerprint) throw new Error('대출 요청의 회사와 로그인 사용자를 다시 확인하세요.');
  const pending = retained(snapshot.raw, fingerprint);
  const assertCurrent = () => {
    if (!isCurrent() || auth.currentUser?.uid !== actorUid) throw new Error('대출 선택 또는 로그인 사용자가 변경되었습니다.');
  };
  const assertObserved = () => {
    if (localStorage.getItem(key) !== snapshot.raw) throw new Error('기기에 남은 대출 요청 정보가 바뀌었습니다. 다시 확인하세요.');
  };
  if (running.has(key)) throw new Error('이 대출의 발행 요청을 처리 중입니다.');
  running.add(key);
  try {
    assertCurrent(); assertObserved();
    await authReady; assertCurrent(); assertObserved();
    const { claims } = await user.getIdTokenResult();
    assertCurrent();
    if (claims.companyId !== companyId || claims.isAdmin !== true) throw new Error('관리자 회사 권한이 바뀌었습니다.');
    assertObserved();
    const call = httpsCallable<Request, { status: 'applied' | 'duplicate'; id: string; docNo: string; balanceAfter: number }>(functions, 'recordLoanMovementCommand');
    let result;
    try { result = await call(pending.request); }
    catch (error) {
      assertCurrent();
      const failure = (error as { details?: { loanMovementFailure?: Record<string, unknown> } })?.details?.loanMovementFailure;
      if (failure?.version === 2 && failure.companyId === companyId && failure.loanId === input.loanId
        && failure.operationId === pending.request.operationId && failure.operationRejected === true && failure.financialWrites === false)
        clearObserved(key, snapshot.raw);
      throw error;
    }
    assertCurrent();
    if (result.data.id !== pending.request.operationId || !['applied', 'duplicate'].includes(result.data.status))
      throw new Error('대출 발행 응답을 확인할 수 없습니다. 같은 내용으로 재시도해 주세요.');
    clearObserved(key, snapshot.raw);
    return result.data;
  } finally { running.delete(key); }
}

export async function recordLoanMovement(companyId: string, input: LoanMovementInput) {
  const normalized = normalizeInput(input);
  await authReady;
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 만료되었습니다.');
  const assertCompany = async () => {
    const { claims } = await user.getIdTokenResult();
    if (auth.currentUser?.uid !== user.uid || claims.companyId !== companyId || claims.isAdmin !== true)
      throw new Error('관리자 회사 권한이 바뀌었습니다.');
  };
  await assertCompany();
  const fingerprint = JSON.stringify(normalized);
  const key = pendingKey(companyId, input.loanId, user.uid);
  if (running.has(key)) throw new Error('이 대출의 발행 요청을 처리 중입니다.');
  running.add(key);
  try {
    let pending: { fingerprint: string; request: Request } | undefined;
    const saved = localStorage.getItem(key);
    if (saved !== null) pending = retained(saved, fingerprint);
    if (!pending) {
      const [gate, loan] = await Promise.all([
        getDoc(doc(db, 'appMeta', 'releaseCutover')), getDoc(doc(db, 'loanContracts', input.loanId)),
      ]);
      const release = gate.data(), contract = loan.data();
      if (release?.status !== 'active' || typeof release.releaseId !== 'string') throw new Error('대출 발행 서버가 준비되지 않았습니다.');
      if (!loan.exists() || companyOf(contract) !== companyId) throw new Error('대출 계약의 회사가 맞지 않습니다.');
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
