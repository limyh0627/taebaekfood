import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, db, functions } from '../../shared/firebase';
import { today } from '../../shared/day';
import type { CompanyId, ReturnRequest } from '../../shared/types';

type Command = { operationId: string; returnRequestId: string; tradeDate: string; expectedPartnerRevision: number; releaseId: string };
type Result = { status: 'applied' | 'duplicate'; docNo: string; journalId: string };
const running = new Set<string>();
/** 불확실한 응답은 번호·날짜·revision·release를 모두 보존하여 같은 명령으로 재시도한다. */
export async function processReturn(companyId: CompanyId, request: ReturnRequest): Promise<Result> {
  if (request.companyId !== companyId || !/^[A-Za-z0-9_-]{1,140}$/.test(request.id)
    || !request.linkedStatementId || !request.partnerId || request.partnerId.includes('/')
    || !Number.isSafeInteger(request.totalAmount) || request.totalAmount <= 0 || !request.items.length)
    throw new Error('같은 회사의 원전표·거래처와 양수 반품 금액이 필요합니다.');
  const fingerprint = JSON.stringify({ companyId, linkedStatementId: request.linkedStatementId, partnerId: request.partnerId,
    returnType: request.returnType ?? null, totalAmount: request.totalAmount, items: request.items });
  await authReady;
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 필요합니다.');
  const assertCompany = async () => {
    const { claims } = await user.getIdTokenResult();
    if (auth.currentUser?.uid !== user.uid || claims.companyId !== companyId || claims.isAdmin !== true)
      throw new Error('관리자 회사 권한이 바뀌었습니다.');
  };
  await assertCompany();
  const key = `return-pending:${companyId}:${request.id}:${user.uid}`;
  if (running.has(key)) throw new Error('이 반품을 처리 중입니다.');
  running.add(key);
  try {
    let pending: { version: 1; fingerprint: string; command: Command } | undefined;
    const saved = localStorage.getItem(key);
    if (saved) {
      try { pending = JSON.parse(saved); } catch { throw new Error('저장된 반품 요청을 확인해야 합니다.'); }
      const command = pending?.command;
      if (pending?.version !== 1 || pending.fingerprint !== fingerprint || !command
        || !/^return-[A-Za-z0-9_-]{1,143}$/.test(command.operationId) || command.returnRequestId !== request.id
        || !/^\d{4}-\d{2}-\d{2}$/.test(command.tradeDate) || !Number.isFinite(Date.parse(`${command.tradeDate}T00:00:00Z`))
        || new Date(`${command.tradeDate}T00:00:00Z`).toISOString().slice(0, 10) !== command.tradeDate
        || !Number.isSafeInteger(command.expectedPartnerRevision) || command.expectedPartnerRevision < 0
        || !/^[A-Za-z0-9_-]{1,100}$/.test(command.releaseId))
        throw new Error('이전 반품 결과가 불확실합니다. 같은 입력으로 재시도해 주세요.');
    }
    if (!pending) {
      const [releaseDoc, stateDoc] = await Promise.all([
        getDoc(doc(db, 'appMeta', 'releaseCutover')),
        getDoc(doc(db, 'appMeta', `partnerPaymentState_${companyId}_${request.partnerId}`)),
      ]);
      const release = releaseDoc.data(), revision = stateDoc.exists() ? stateDoc.data()?.revision : 0;
      if (release?.status !== 'active' || !/^[A-Za-z0-9_-]{1,100}$/.test(release?.releaseId ?? ''))
        throw new Error('반품 서버가 준비되지 않았습니다.');
      if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('거래처 정산 상태를 확인해야 합니다.');
      pending = { version: 1, fingerprint, command: { operationId: `return-${crypto.randomUUID()}`, returnRequestId: request.id,
        tradeDate: today(), expectedPartnerRevision: revision, releaseId: release.releaseId } };
      localStorage.setItem(key, JSON.stringify(pending));
    }
    await assertCompany();
    const encoded = JSON.stringify(pending);
    let result;
    try {
      result = await httpsCallable<Command, Result>(functions, 'processGeneralStockReturnCommand')(pending.command);
    } catch (error) {
      const failure = error as { code?: string; details?: Record<string, unknown> };
      const details = failure?.details;
      if (['functions/invalid-argument', 'functions/failed-precondition'].includes(failure?.code ?? '')
        && details?.operationStatus === 'rejected' && details.companyId === companyId
        && details.operationId === pending.command.operationId && details.returnRequestId === request.id) {
        try {
          await assertCompany();
          const rejected = await getDoc(doc(db, 'returnOperations', pending.command.operationId));
          const data = rejected.data();
          await assertCompany();
          if (rejected.exists() && data?.status === 'rejected' && data.companyId === companyId
            && data.operationId === pending.command.operationId
            && data.createdBy === user.uid && data.returnRequestId === request.id
            && data.requestHash === details.requestHash && typeof data.requestHash === 'string'
            && data.failureCode === failure.code!.replace('functions/', '')
            && data.command && Object.keys(data.command).length === Object.keys(pending.command).length
            && Object.entries(pending.command).every(([field, value]) => data.command?.[field] === value)
            && localStorage.getItem(key) === encoded) localStorage.removeItem(key);
        } catch { /* 확인할 수 없는 실패는 같은 요청을 보존한다. */ }
      }
      throw error;
    }
    if (!['applied', 'duplicate'].includes(result.data?.status) || result.data.journalId !== `return-${pending.command.operationId}`
      || typeof result.data.docNo !== 'string' || !result.data.docNo)
      throw new Error('반품 응답이 불확실합니다. 같은 입력으로 재시도해 주세요.');
    if (localStorage.getItem(key) === encoded) localStorage.removeItem(key);
    return result.data;
  } finally { running.delete(key); }
}
