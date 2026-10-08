import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, db, functions } from '../../shared/firebase';
import type { CompanyId } from '../../shared/types';

export type ManualSettlementInput = { action: 'add' | 'update' | 'delete'; partnerId: string;
  cashEntryId: string; statementId: string; amount: number; expectedAmount?: number; settlementId?: string };
type Request = ManualSettlementInput & { operationId: string; expectedRevision: number; releaseId: string };
type Result = { status: 'applied' | 'duplicate'; settlementId: string; revision: number };
type Pending = { version: 1; fingerprint: string; request: Request };
const running = new Set<string>();
const id = (value: unknown, max = 180): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= max && !/[\s/]/.test(value);
const positive = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;

/** 한 수동 정산의 요청 전체를 고정한다. 확정 거절 감사가 있는 경우만 새 입력을 허용한다. */
export async function mutateManualSettlement(companyId: CompanyId, input: ManualSettlementInput): Promise<Result> {
  if (!input || !['add', 'update', 'delete'].includes(input.action)
    || !id(input.partnerId) || !id(input.cashEntryId) || !id(input.statementId) || !positive(input.amount)
    || (input.action === 'add' ? input.settlementId !== undefined || input.expectedAmount !== undefined
      : !/^[A-Za-z0-9_-]{1,180}$/.test(input.settlementId ?? '')
        || (input.action === 'update' && !positive(input.expectedAmount))))
    throw new Error('수동 정산 입력을 확인해 주세요.');
  // 허용 필드만 저장한다. UI가 전달한 id/company/createdAt은 서버 명령 입력이 아니다.
  const business: ManualSettlementInput = { action: input.action, partnerId: input.partnerId,
    cashEntryId: input.cashEntryId, statementId: input.statementId, amount: input.amount,
    ...(input.settlementId !== undefined ? { settlementId: input.settlementId } : {}),
    ...(input.expectedAmount !== undefined ? { expectedAmount: input.expectedAmount } : {}) };
  const fingerprint = JSON.stringify(business);
  await authReady;
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 필요합니다.');
  const assertCompany = async () => {
    const { claims } = await user.getIdTokenResult();
    if (auth.currentUser?.uid !== user.uid || claims.companyId !== companyId || claims.isAdmin !== true)
      throw new Error('관리자 회사 권한이 바뀌었습니다.');
  };
  await assertCompany();
  const key = `manual-settlement-pending:${companyId}:${user.uid}:${input.cashEntryId}:${input.settlementId ?? input.statementId}`;
  if (running.has(key)) throw new Error('이 정산을 처리 중입니다.');
  running.add(key);
  try {
    let pending: Pending | undefined;
    const saved = localStorage.getItem(key);
    if (saved) {
      try { pending = JSON.parse(saved); } catch { throw new Error('저장된 수동 정산 요청을 확인해야 합니다.'); }
      const request = pending?.request;
      if (pending?.version !== 1 || pending.fingerprint !== fingerprint || !request
        || !/^[A-Za-z0-9_-]{1,150}$/.test(request.operationId)
        || !/^[A-Za-z0-9_-]{1,100}$/.test(request.releaseId)
        || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0
        || JSON.stringify({ ...business, operationId: request.operationId,
          expectedRevision: request.expectedRevision, releaseId: request.releaseId }) !== JSON.stringify(request))
        throw new Error('이전 정산 결과가 불확실합니다. 같은 입력으로 재시도해 주세요.');
    }
    if (!pending) {
      const [releaseDoc, stateDoc] = await Promise.all([
        getDoc(doc(db, 'appMeta', 'releaseCutover')),
        getDoc(doc(db, 'appMeta', `partnerPaymentState_${companyId}_${input.partnerId}`)),
      ]);
      const release = releaseDoc.data();
      const state = stateDoc.data();
      const revision = stateDoc.exists() ? state?.revision : 0;
      if (release?.status !== 'active' || !/^[A-Za-z0-9_-]{1,100}$/.test(release.releaseId ?? ''))
        throw new Error('정산 서버가 준비되지 않았습니다.');
      if (!Number.isSafeInteger(revision) || revision < 0
        || (stateDoc.exists() && (state?.companyId !== companyId || state?.partnerId !== input.partnerId)))
        throw new Error('거래처 정산 상태를 확인해야 합니다.');
      pending = { version: 1, fingerprint, request: { ...business, operationId: `manual-${crypto.randomUUID()}`,
        expectedRevision: revision, releaseId: release.releaseId } };
      localStorage.setItem(key, JSON.stringify(pending));
    }
    const stored = JSON.stringify(pending);
    const clearOwn = () => { if (localStorage.getItem(key) === stored) localStorage.removeItem(key); };
    await assertCompany();
    let result;
    try { result = await httpsCallable<Request, Result>(functions, 'mutateManualSettlementCommand')(pending.request); }
    catch (error) {
      const failure = (error as { details?: { manualSettlementFailure?: Record<string, unknown> } })?.details?.manualSettlementFailure;
      if (failure?.version === 1 && failure.companyId === companyId && failure.partnerId === input.partnerId
        && failure.operationId === pending.request.operationId && failure.operationRejected === true && failure.financialWrites === false)
        clearOwn();
      throw error;
    }
    await assertCompany();
    const expectedId = input.action === 'add' ? `manual-${pending.request.operationId}` : input.settlementId;
    if (!['applied', 'duplicate'].includes(result.data?.status) || result.data.settlementId !== expectedId
      || result.data.revision !== pending.request.expectedRevision + 1)
      throw new Error('정산 응답이 불확실합니다. 같은 입력으로 재시도해 주세요.');
    clearOwn();
    return result.data;
  } finally { running.delete(key); }
}
