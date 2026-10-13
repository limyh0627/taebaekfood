import { readStatementDeletion } from './deleteIssuedStatementCommand';
import {readStatementCreation} from './statementCreationReceipt';
import { readCashCreationMutation } from './cashMutationReceipt';
import { projectCashLines, type CashProjectionInput } from './shared/cashLineProjection';
import { partnerQuarantined } from './partnerCutover';
import { formatVoucherNo } from './shared/voucherNumber';
export { formatVoucherNo } from './shared/voucherNumber';
import { readVoucherCounter, writeVoucherCounter,readVoucherScopeRows } from './newScopeCounter';
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { createHash } from 'crypto';
import { assertReleaseActive, assertVoucherDateAllowed, releaseGateRef } from './releaseGate';
import {readStatementTargetClaims,assertStatementTargetUnclaimed} from './statementIssueReceipt';

type Kind = 'issuedStatements' | 'cashEntries';
type Input = { kind: Kind; operationId: string; tradeDate: string; prefix?: string;
  document: Record<string, unknown>; releaseId: string };
const REGION = 'asia-northeast3';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}



export const voucherSequenceKey = (companyId: string, date: string, prefix = '') =>
  `voucherNo_${companyId}_${date}_${prefix || 'general'}`;

/** A missing counter is an explicit migration gate: existing numbers must be audited first. */
export async function issueVoucher(db: admin.firestore.Firestore, companyId: string, input: Input) {
  if (!input || typeof input !== 'object') throw new HttpsError('invalid-argument', '발행 요청이 잘못되었습니다.');
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId))
    throw new HttpsError('invalid-argument', '배포 전환 ID가 필요합니다.');
  const { kind, operationId, tradeDate, prefix = '', document } = input;
  if (kind !== 'issuedStatements' && kind !== 'cashEntries') throw new HttpsError('invalid-argument', '전표 종류가 잘못되었습니다.');
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(operationId)) throw new HttpsError('invalid-argument', '작업 ID가 잘못되었습니다.');
  const parsedDate = new Date(`${tradeDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate) || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== tradeDate) throw new HttpsError('invalid-argument', '전표일이 잘못되었습니다.');
  if (!['', '가공', '반품', '대체', '급여'].includes(prefix)) throw new HttpsError('invalid-argument', '전표 접두사가 잘못되었습니다.');
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new HttpsError('invalid-argument', '전표 내용이 잘못되었습니다.');
  if (document.companyId !== undefined && document.companyId !== companyId) throw new HttpsError('permission-denied', '다른 회사의 전표를 발행할 수 없습니다.');
  const field = kind === 'cashEntries' ? 'date' : 'tradeDate';
  if (document[field] !== tradeDate) throw new HttpsError('invalid-argument', '전표일이 일치하지 않습니다.');
  if (kind === 'cashEntries' && (typeof document.amount !== 'number' || !Number.isFinite(document.amount) || document.amount <= 0)) {
    throw new HttpsError('invalid-argument', '자금전표 금액은 0보다 큰 유한한 수여야 합니다.');
  }
  if (kind === 'cashEntries') {
    const protectedCodes = new Set(['260', '293']);
    const lines = Array.isArray(document.lines) ? document.lines : [];
    const codes = [document.accountCode, ...lines.map(line => (line && typeof line === 'object' ? line.accountCode : undefined))];
    if (codes.some(code => protectedCodes.has(String(code)))
      || ['loanId', 'payrollId', 'payrollRequestHash', 'transferOperationId', 'interCompanyTransferId', 'transferId', 'returnRequestId', 'returnOperationId', 'partnerPaymentOperationId', 'settlementId',
        'settlements', 'allocations', 'paymentId', 'reverse'].some(field => field in document)) {
      throw new HttpsError('failed-precondition', '거래처 지급·대출·반품 연결은 해당 서버 원자 명령에서 처리해야 합니다.');
    }
  }
  if (kind === 'issuedStatements') {
    const { totalAmount, totalSupply, totalTax } = document;
    if (typeof totalAmount !== 'number' || !Number.isFinite(totalAmount) || totalAmount === 0
      || typeof totalSupply !== 'number' || !Number.isFinite(totalSupply)
      || typeof totalTax !== 'number' || !Number.isFinite(totalTax)
      || Math.round((totalSupply + totalTax) * 100) !== Math.round(totalAmount * 100)) {
      throw new HttpsError('invalid-argument', '전표 공급가·세액·총액이 일치하지 않습니다.');
    }
  }
  const { id: _id, docNo: _docNo, issueOperationId: _operation, issuePayloadHash: _hash, issuePrefix: _prefix, ...body } = document;
  const payload: Record<string, unknown> = { ...body, companyId };
  // 발행 시각/담당자는 재시도 때 달라질 수 있다. 금액·상대·계정 등 업무 내용은 고정한다.
  const { createdAt: _createdAt, issuedAt: _issuedAt, createdBy: _createdBy, ...semanticPayload } = payload;
  const issuePayloadHash = createHash('sha256').update(JSON.stringify(canonical(semanticPayload))).digest('hex');
  const target = db.collection(kind).doc(operationId);
  const other = db.collection(kind === 'cashEntries' ? 'issuedStatements' : 'cashEntries').doc(operationId);
  const counter = db.collection('appMeta').doc(voucherSequenceKey(companyId, tradeDate, prefix));
  const catchUpCounter = db.collection('appMeta').doc(voucherSequenceKey(companyId, tradeDate, '추가'));
  const releaseGate = releaseGateRef(db);
  const protectedCash = kind === 'cashEntries' && [document.accountCode,
    ...(Array.isArray(document.lines) ? document.lines.map(line => line?.accountCode) : [])]
    .some(code => ['108', '251', '253'].includes(String(code)));
  return db.runTransaction(async tx => {
    // 누락 카운터만 먼저 읽으면 순환 잠금이 남는다. 기존 공통 gate→번호→개별 전표 순서를 유지한다.
    const releaseSnap=await tx.get(releaseGate);
    // 광범위 조회를 개별 전표 잠금 뒤에 보내면 다른 발행의 읽기 잠금과 쓰기 대기가 맞물린다.
    const codes=protectedCash?await tx.get(db.collection('accountCodes').where('companyId','==',companyId)):null;
    const cashCreationAudit=kind==='cashEntries'?await tx.get(db.collection('voucherMutationOperations').where('cashEntryIds','array-contains',operationId)):null;
    const statementDeletionAudit=kind==='issuedStatements'?await tx.get(db.collection('voucherMutationOperations').where('statementIds','array-contains',operationId)):null;
    if(kind==='issuedStatements')await tx.get(db.collection('voucherMutationOperations').where('statementId','==',operationId));
    const normalSequence=await tx.get(counter),catchUpSequence=await tx.get(catchUpCounter);
    // 최초 번호의 전체 원장도 개별 target을 잠그기 전에 같은 TX에서 읽는다.
    const initialRows=!normalSequence.exists?await readVoucherScopeRows(db,tx,companyId,tradeDate,prefix):undefined;
    // 공통 거래처와 상태를 같은 순서로 먼저 읽어 개별 발행 사이의 순환 잠금을 막는다.
    const commonAccount=protectedCash&&typeof document.cashAccountId==='string'&&document.cashAccountId&&!document.cashAccountId.includes('/')
      ?await tx.get(db.collection('cashAccounts').doc(document.cashAccountId)):undefined;
    const commonPartner=protectedCash&&typeof document.partnerId==='string'&&document.partnerId&&!document.partnerId.includes('/')
      ?await tx.get(db.collection('partners').doc(document.partnerId)):undefined;
    const commonState=commonPartner?await tx.get(db.collection('appMeta').doc(`partnerPaymentState_${companyId}_${document.partnerId}`)):undefined;
    const commonCutover=commonPartner?await tx.get(db.collection('appMeta').doc(`partnerPaymentCutover_${companyId}`)):undefined;
    const targetClaims=await readStatementTargetClaims(db,tx,companyId,operationId);
    const [existing, otherKind] = await Promise.all([
      tx.get(target), tx.get(other),
    ]);
    const validatesCreation=(row:Record<string,any>)=>{
      const {id:_id,docNo:_no,issueOperationId:_operation,issuePayloadHash:_hash,issuePrefix:_prefix,
        createdAt:_createdAt,issuedAt:_issuedAt,createdBy:_createdBy,...semantic}=row;
      const fullHash=createHash('sha256').update(JSON.stringify(canonical(semantic))).digest('hex');
      // 미수정 0 marker가 나중에 붙어도 최초 업무 해시는 같다. 다른 필드와 감사 사슬은 그대로 검증한다.
      const {mutationRevision:_revision,...beforeMarker}=semantic;
      const matchesSemantic=fullHash===issuePayloadHash||row.mutationRevision===0
        &&createHash('sha256').update(JSON.stringify(canonical(beforeMarker))).digest('hex')===issuePayloadHash;
      return row.companyId===companyId&&row[field]===tradeDate&&row.issueOperationId===operationId
        &&(row.issuePrefix===prefix||prefix===''&&row.issuePrefix==='추가')&&row.issuePayloadHash===issuePayloadHash
        &&typeof row.docNo==='string'&&!!row.docNo&&matchesSemantic;
    };
    if (otherKind.exists) throw new HttpsError('already-exists', '작업 ID가 다른 종류의 전표에 사용되었습니다.');
    if (kind === 'cashEntries' && cashCreationAudit!.docs.length && (!existing.exists || (existing.data()?.mutationRevision ?? 0) > 0)) {
      const original = await readCashCreationMutation(db, tx, companyId, operationId, existing, validatesCreation);
      if (original) return { id: operationId, docNo: original.docNo as string };
    }
    if (kind === 'issuedStatements' && statementDeletionAudit!.docs.length) {
      const deleted = await readStatementDeletion(db, tx, companyId, operationId, existing, validatesCreation);
      if (deleted) return { id: operationId, docNo: deleted.docNo as string };
    }
    if (existing.exists) {
      const data = existing.data()!;
      if(kind==='issuedStatements'){
        const original=await readStatementCreation(db,tx,companyId,operationId,data,validatesCreation);
        return {id:operationId,docNo:original.docNo as string};
      }
      if (!validatesCreation(data)) {
        throw new HttpsError('already-exists', '작업 ID가 다른 전표에 사용되었습니다.');
      }
      return { id: operationId, docNo: data.docNo };
    }
    // 완료 ACK는 금융 쓰기가 없다. 전환 release·발행 가능일은 신규 쓰기에만 적용한다.
    assertReleaseActive(releaseSnap, input.releaseId);
    const mode = assertVoucherDateAllowed(releaseSnap, companyId, tradeDate, prefix === '');
    const effectivePrefix = mode === 'catchUp' ? '추가' : prefix;
    const sequence = mode === 'catchUp' ? catchUpSequence : normalSequence;
    assertStatementTargetUnclaimed(targetClaims);
    // 선택 분개 신규 기록은 자동 배분하지 않는다. 거래처 원본 변경은 정산과 같은 TX 경계에 참여한다.
    let partnerState: admin.firestore.DocumentSnapshot | undefined;
    let cashPartner: admin.firestore.DocumentSnapshot | undefined;
    let financialWrites = false;
    try {
    if (protectedCash) {
      if ('balanceAdjustment' in document)
        throw new HttpsError('invalid-argument', '잔액 조정에는 계정 분개를 연결할 수 없습니다.');
      let projection: ReturnType<typeof projectCashLines>;
      try { projection = projectCashLines(document as CashProjectionInput, true); }
      catch (error) { throw new HttpsError('invalid-argument', error instanceof Error ? error.message : '분개가 잘못되었습니다.'); }
      if (typeof document.cashAccountId !== 'string' || !document.cashAccountId || document.cashAccountId.includes('/'))
        throw new HttpsError('invalid-argument', '회사 계좌가 필요합니다.');
      if (document.partnerId !== undefined && (typeof document.partnerId !== 'string' || document.partnerId.includes('/')))
        throw new HttpsError('invalid-argument', '거래처 입력이 잘못되었습니다.');
      const account=commonAccount!,partner=commonPartner,state=commonState,cutover=commonCutover;
      if (projection.parts.some(line => !codes!.docs.some(code => code.data().code === line.accountCode)))
        throw new HttpsError('failed-precondition', '현재 회사 계정과목을 확인해주세요.');
      if (!account.exists || (account.data()?.companyId ?? 'taebaek') !== companyId || account.data()?.active !== true)
        throw new HttpsError('failed-precondition', '현재 회사의 활성 계좌가 아닙니다.');
      if (partner && (!partner.exists || (partner.data()?.companyId ?? 'taebaek') !== companyId))
        throw new HttpsError('failed-precondition', '현재 회사 거래처가 아닙니다.');
      if (cutover?.exists && (cutover.data()?.companyId !== companyId || partnerQuarantined(cutover.data(), document.partnerId as string)))
        throw new HttpsError('failed-precondition', '이 거래처는 과거 정산 내역 확인 후 처리할 수 있습니다.');
      if (partner && (!Number.isSafeInteger(partner.data()?.revision ?? 0) || (partner.data()?.revision ?? 0) < 0
        || !Number.isSafeInteger((partner.data()?.revision ?? 0) + 1)))
        throw new HttpsError('failed-precondition', '거래처 원본 revision이 잘못되었습니다.');
      if (state && (!Number.isSafeInteger(state.data()?.revision ?? 0) || (state.data()?.revision ?? 0) < 0
        || !Number.isSafeInteger((state.data()?.revision ?? 0) + 1)
        || state.exists && (state.data()?.companyId !== companyId || state.data()?.partnerId !== document.partnerId)))
        throw new HttpsError('failed-precondition', '거래처 revision이 잘못되었습니다.');
      partnerState = state;
      cashPartner = partner;
    }
    const state = await readVoucherCounter(db, tx, sequence, releaseSnap, companyId, tradeDate, effectivePrefix,initialRows);
    if (state.companyId !== companyId || state.tradeDate !== tradeDate || state.prefix !== effectivePrefix || !Number.isSafeInteger(state.last) || state.last < 0) {
      throw new HttpsError('failed-precondition', '전표 번호 카운터가 손상되었습니다.');
    }
    const next = state.last + 1;
    if (!Number.isSafeInteger(next)) throw new HttpsError('resource-exhausted', '전표 번호 범위를 초과했습니다.');
    const docNo = formatVoucherNo(tradeDate, next, effectivePrefix);
    financialWrites = true;
    writeVoucherCounter(tx, sequence, state, next);
    tx.create(target, { ...payload, docNo, issueOperationId: operationId, issuePrefix: effectivePrefix, issuePayloadHash });
    if (partnerState) {
      const value = { companyId, partnerId: document.partnerId, revision: (partnerState.data()?.revision ?? 0) + 1 };
      if (partnerState.exists) tx.update(partnerState.ref, value); else tx.create(partnerState.ref, value);
    }
    if (cashPartner) tx.update(cashPartner.ref, { revision: (cashPartner.data()?.revision ?? 0) + 1 });
    return { id: operationId, docNo };
    } catch (error) {
      if (protectedCash && !financialWrites && error instanceof HttpsError)
        throw new HttpsError(error.code, error.message, { operationStatus: 'rejected', version: 1,
          financialWrites: false, companyId, operationId });
      throw error;
    }
  });
}

export const issueNumberedVoucher = onCall({ region: REGION }, async request => {
  const companyId = request.auth?.token.companyId;
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  if (!request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe')) {
    throw new HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
  }
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(request.data?.releaseId))
    throw new HttpsError('invalid-argument', '배포 전환 ID가 필요합니다.');
  return issueVoucher(admin.firestore(), companyId, request.data as Input);
});
