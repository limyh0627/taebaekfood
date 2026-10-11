import { returnBusinessText } from '../../shared/returnBusinessEvidence';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, db, functions } from '../../shared/firebase';
import { today } from '../../shared/day';
import type { CompanyId, ReturnRequest } from '../../shared/types';

type Command = { operationId: string; returnRequestId: string; tradeDate: string; expectedPartnerRevision: number; releaseId: string; expectedBusinessHash?: string };
export type Result = { companyId?:CompanyId; operationId?:string; returnRequestId?:string; status: 'applied' | 'duplicate'; docNo: string; journalId: string };
const running = new Set<string>();
/** 불확실한 응답은 번호·날짜·revision·release를 모두 보존하여 같은 명령으로 재시도한다. */
export async function processReturn(companyId: CompanyId, request: ReturnRequest): Promise<Result> {
  if (request.companyId !== companyId || !/^[A-Za-z0-9_-]{1,140}$/.test(request.id)
    || (!request.linkedStatementId && !['매출','매입'].includes(request.returnType ?? '')) || !request.partnerId || request.partnerId.includes('/')
    || !Number.isSafeInteger(request.totalAmount) || request.totalAmount <= 0 || !Array.isArray(request.items) || !request.items.length)
    throw new Error('같은 회사의 거래처·반품 유형·품목과 양수 반품 금액을 확인해 주세요.');
  const fingerprint=returnBusinessText(request);
  const legacyFingerprint=JSON.stringify({companyId,linkedStatementId:request.linkedStatementId,partnerId:request.partnerId,returnType:request.returnType??null,totalAmount:request.totalAmount,items:request.items});
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
    let pending: ReturnPending | undefined;
    const saved = localStorage.getItem(key);
    if (saved !== null) {
      try { pending = JSON.parse(saved); } catch { throw new Error('저장된 반품 요청을 확인해야 합니다.'); }
      const command = pending?.command;
      if (![1,2].includes(pending?.version ?? 0) || pending!.fingerprint !== (pending!.version===1?legacyFingerprint:fingerprint) || !command
        || !/^return-[A-Za-z0-9_-]{1,143}$/.test(command.operationId) || command.returnRequestId !== request.id
        || !/^\d{4}-\d{2}-\d{2}$/.test(command.tradeDate) || !Number.isFinite(Date.parse(`${command.tradeDate}T00:00:00Z`))
        || new Date(`${command.tradeDate}T00:00:00Z`).toISOString().slice(0, 10) !== command.tradeDate
        || !Number.isSafeInteger(command.expectedPartnerRevision) || command.expectedPartnerRevision < 0
        || !/^[A-Za-z0-9_-]{1,100}$/.test(command.releaseId) || Object.keys(command).some(field=>!['operationId','returnRequestId','tradeDate','expectedPartnerRevision','releaseId',...(pending!.version===2?['expectedBusinessHash']:[])].includes(field)) || (pending!.version===2 && command.expectedBusinessHash!==await digestReturnBusiness(pending!.fingerprint)))
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
      pending = { version: 2, fingerprint, command: { operationId: `return-${crypto.randomUUID()}`, returnRequestId: request.id,
        tradeDate: today(), expectedPartnerRevision: revision, releaseId: release.releaseId, expectedBusinessHash:await digestReturnBusiness(fingerprint) } };
      await assertCompany();
      if(localStorage.getItem(key)!==saved) throw new Error('다른 화면에서 보존한 반품 요청이 있습니다. 기존 요청의 결과를 확인해 주세요.');
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
    if(pending.version===2 && (result.data.companyId!==companyId||result.data.operationId!==pending.command.operationId||result.data.returnRequestId!==request.id)) throw new Error('반품 응답의 회사·요청이 다릅니다.');
    await assertCompany();
    if (localStorage.getItem(key) === encoded) localStorage.removeItem(key);
    return result.data;
  } finally { running.delete(key); }
}

export type ReturnPending={version:1|2;fingerprint:string;command:Command};
async function digestReturnBusiness(text:string):Promise<string>{const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');}
export function readPendingReturn(companyId:CompanyId,returnRequestId:string):ReturnPending|null{
 const uid=auth.currentUser?.uid;if(!uid)return null;
 const saved=localStorage.getItem(`return-pending:${companyId}:${returnRequestId}:${uid}`);if(saved===null)return null;
 let pending:ReturnPending;try{pending=JSON.parse(saved);}catch{throw Error('저장된 반품 요청을 확인해야 합니다.');}
 if(![1,2].includes(pending?.version)||typeof pending.fingerprint!=='string'||pending.command?.returnRequestId!==returnRequestId)throw Error('저장된 반품 요청을 확인해야 합니다.');
 let evidence:Record<string,any>;try{evidence=JSON.parse(pending.fingerprint);}catch{throw Error('저장된 반품 원문을 확인해야 합니다.');}
 if(evidence.companyId!==companyId)throw Error('보존된 반품의 회사가 다릅니다.');
 const command=pending.command;if(!/^return-[A-Za-z0-9_-]{1,143}$/.test(command.operationId)||!/^\d{4}-\d{2}-\d{2}$/.test(command.tradeDate)||!Number.isSafeInteger(command.expectedPartnerRevision)||command.expectedPartnerRevision<0||!/^[A-Za-z0-9_-]{1,100}$/.test(command.releaseId)||!Array.isArray(evidence.items)||!evidence.items.length||!Number.isSafeInteger(evidence.totalAmount)||evidence.totalAmount<=0||(pending.version===2&&!/^[a-f0-9]{64}$/.test(command.expectedBusinessHash??'')))throw Error('저장된 반품 요청을 확인해야 합니다.');return pending;
}
export const hasPendingReturn=(companyId:CompanyId,returnRequestId:string):boolean=>readPendingReturn(companyId,returnRequestId)!==null;
export async function resumePendingReturn(companyId:CompanyId,returnRequestId:string):Promise<Result>{
 const pending=readPendingReturn(companyId,returnRequestId);if(!pending)throw Error('보존된 반품 요청이 없습니다.');
 const evidence=JSON.parse(pending.fingerprint);return processReturn(companyId,{...evidence,id:returnRequestId,status:'pending'} as ReturnRequest);
}
