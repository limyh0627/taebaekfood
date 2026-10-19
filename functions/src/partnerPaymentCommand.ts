import { normalizePartnerPaymentRecoveryCommand, type PartnerPaymentRecoveryCommand, type PartnerPaymentRecoveryResult, type PartnerPaymentListResult } from './shared/partnerPaymentRecovery';
import { readClaimsAfterReturnsAndAdvance as readClaimsAfterReturns } from './partnerAdvanceClaimReader';
import { projectCashLines, cashLineReduction, CashLineProjectionError } from './shared/cashLineProjection';
import { readVoucherCounter, writeVoucherCounter } from './newScopeCounter';
import * as admin from 'firebase-admin';
import { fingerprint, readPartnerPaymentReceipt } from './partnerPaymentReceipt';
export { fingerprint } from './partnerPaymentReceipt';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { formatVoucherNo, voucherSequenceKey } from './voucherIssue';
import { assertReleaseActive, assertVoucherDateAllowed, releaseGateRef } from './releaseGate';
import {readStatementTargetClaims,assertStatementTargetUnclaimed} from './statementIssueReceipt';
import { partnerQuarantined } from './partnerCutover';
import { PartnerPaymentValidationError, planPartnerPayment, type Claim, type PaymentCash, type PaymentSettlement,
  type ReturnApplication } from './partnerPaymentPlan';

type Row = Record<string, any>;
type Input = {
  operationId: string; tradeDate: string; partnerId: string; direction: '입금' | '출금';
  amount: number; cashAccountId: string; pin: boolean;
  allocations: { statementId: string; amount: number }[];
  expectedRevision: number; releaseId: string; note?: string;
};
const invalid = (message: string): never => { throw new HttpsError('invalid-argument', message); };
const conflict = (message: string): never => { throw new HttpsError('failed-precondition', message); };
const owner = (row: Row) => row.companyId ?? 'taebaek';
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  && !Number.isNaN(new Date(`${date}T00:00:00Z`).valueOf())
  && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
const nonTrade = /^(1[0-9]{2}|2[0-9]{2}|5[1-9][0-9]|6[0-9]{2}|8[0-9]{2}|9[0-9]{2})$/;
const tradeCodes = new Set(['500', '501', '503', '505']);

/** The adapter deliberately rejects ambiguous documents instead of inventing an account. */
export function claimFromStatement(id: string, row: Row): Claim | null {
  // 적용·취소의 신뢰성은 공용 reader가 감사와 함께 검증한다. 새 발생채무로 해석하지 않는다.
  if (row.noncashApplication !== undefined) return null;
  if (!row.partnerId) return null;
  const items: Row[] = Array.isArray(row.items) ? row.items : [];
  if (row.type === '매출' || row.type === '매입') {
    if (!items.length || items.some(item => !item.accountCode || !Number.isSafeInteger(item.supply)
      || !Number.isSafeInteger(item.tax) || !Number.isSafeInteger(item.total))) conflict('기존 전표의 원분개 줄이 잘못되었습니다.');
    const supply = items.reduce((sum, item) => sum + item.supply, 0);
    const tax = Number.isSafeInteger(row.totalTax) ? row.totalTax : items.reduce((sum, item) => sum + item.tax, 0);
    if (!Number.isSafeInteger(supply) || !Number.isSafeInteger(tax) || supply + tax !== row.totalAmount)
      conflict('기존 전표의 차변·대변 금액이 맞지 않습니다.');
  }
  const codes = items.map(item => String(item.accountCode ?? ''));
  let accountCode: Claim['accountCode'] | null = null;
  if (row.type === '매출') accountCode = '108';
  else if (row.type === '매입') {
    if (codes.includes('251')) accountCode = '251';
    else if (codes.includes('253')) accountCode = '253';
    else if (codes.some(code => tradeCodes.has(code)) || !codes.some(code => nonTrade.test(code))) accountCode = '251';
    else accountCode = '253';
  } else if (row.type === '비용') {
    if (!items.length || items.some(item => !item.accountCode || !['차변', '대변'].includes(item.side)
      || !Number.isSafeInteger(item.total) || item.total < 0)) conflict('기존 대체전표의 줄이 잘못되었습니다.');
    const debit = items.filter(item => item.side === '차변').reduce((sum, item) => sum + item.total, 0);
    const credit = items.filter(item => item.side === '대변').reduce((sum, item) => sum + item.total, 0);
    if (!debit || debit !== credit) conflict('기존 대체전표의 차변·대변이 맞지 않습니다.');
    const direct = [...new Set(items.filter(item => item.accountCode === '108' && item.side === '차변'
      || item.side === '대변' && ['251', '253'].includes(item.accountCode))
      .map(item => item.accountCode))];
    if (direct.length === 1) accountCode = direct[0] as Claim['accountCode'];
  }
  if (!accountCode) return null;
  if (!Number.isSafeInteger(row.totalAmount) || row.totalAmount === 0 || !validDate(row.tradeDate)) conflict('기존 전표의 금액·일자 근거가 불명확합니다.');
  return { id, companyId: owner(row), partnerId: row.partnerId, tradeDate: row.tradeDate,
    amount: row.totalAmount, accountCode };
}

export function cashFromEntry(id: string, row: Row): PaymentCash | null {
  if (!row.partnerId) return null;
  if (!Number.isSafeInteger(row.amount) || row.amount <= 0 || !['입금', '출금', '대체'].includes(row.dir)) conflict('기존 자금전표가 잘못되었습니다.');
  let projection: ReturnType<typeof projectCashLines>;
  try { projection = projectCashLines(row as Parameters<typeof projectCashLines>[0], true); }
  catch (error) { if (error instanceof CashLineProjectionError) conflict(error.message); throw error; }
  const byCode = new Map<string, number>();
  for (const line of projection.parts) {
    if (!['108', '251', '253'].includes(line.accountCode)) continue;
    const reduce = cashLineReduction(row.dir, line.accountCode, line.amount);
    const sum = (byCode.get(line.accountCode) ?? 0) + reduce;
    if (!Number.isSafeInteger(sum)) conflict('기존 자금전표 계정 합계가 잘못되었습니다.');
    byCode.set(line.accountCode, sum);
  }
  const parts = [...byCode].filter(([, reduce]) => reduce !== 0).map(([accountCode, reduce]) => ({ accountCode, reduce }));
  return { id, companyId: owner(row), partnerId: row.partnerId, parts };
}

/** Cutover-gated command. Reads the full partner history inside the same transaction. */
export async function recordPartnerPayment(db: admin.firestore.Firestore, companyId: string, actorId: string, input: Input) {
  if (!actorId || !input || typeof input !== 'object') invalid('지급 요청이 잘못되었습니다.');
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(input.operationId) || !validDate(input.tradeDate)
    || !/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId)
    || !input.partnerId || !input.cashAccountId || !['입금', '출금'].includes(input.direction)
    || !Number.isSafeInteger(input.amount) || input.amount <= 0
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
    || typeof input.pin !== 'boolean' || !Array.isArray(input.allocations)
    || (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 500))) invalid('지급 입력이 잘못되었습니다.');
  const requestHash = fingerprint({ ...input, note: input.note?.trim() ?? '' });
  const operation = db.collection('partnerPaymentOperations').doc(input.operationId);
  const entry = db.collection('cashEntries').doc(input.operationId);
  const other = db.collection('issuedStatements').doc(input.operationId);
  const counter = db.collection('appMeta').doc(voucherSequenceKey(companyId, input.tradeDate));
  const catchUpCounter = db.collection('appMeta').doc(voucherSequenceKey(companyId, input.tradeDate, '추가'));
  const cutover = db.collection('appMeta').doc(`partnerPaymentCutover_${companyId}`);
  const state = db.collection('appMeta').doc(`partnerPaymentState_${companyId}_${input.partnerId}`);
  const account = db.collection('cashAccounts').doc(input.cashAccountId);
  const partner = db.collection('partners').doc(input.partnerId);
  const releaseGate = releaseGateRef(db);
  const outcome = await db.runTransaction(async tx => {
    const releaseSnap=await tx.get(releaseGate);
    const [statementRows,cashRows,settlementRows,returnRows]=await Promise.all([
      tx.get(db.collection('issuedStatements').where('partnerId','==',input.partnerId)),tx.get(db.collection('cashEntries').where('partnerId','==',input.partnerId)),
      tx.get(db.collection('settlements')),tx.get(db.collection('returnApplications').where('partnerId','==',input.partnerId)),
    ]);
    const normalCounterSnap=await tx.get(counter),catchUpCounterSnap=await tx.get(catchUpCounter);
    const targetClaims=await readStatementTargetClaims(db,tx,companyId,input.operationId);
    const [operationSnap, entrySnap, otherSnap, cutoverSnap, stateSnap, accountSnap, partnerSnap] = await Promise.all([
      tx.get(operation), tx.get(entry), tx.get(other), tx.get(cutover), tx.get(state), tx.get(account), tx.get(partner),
    ]);
    const prior = operationSnap.data();
    const ownedSettlements = settlementRows.docs.filter(doc => doc.data().operationId === input.operationId);
    if (operationSnap.exists && prior?.status === 'cancelled') {
      const cancelled = await readPartnerPaymentReceipt(db, tx,
        { companyId: companyId as 'taebaek' | 'punghoe', partnerId: input.partnerId, operationId: input.operationId }, actorId);
      if (cancelled.status !== 'cancelled') conflict('중단된 수금 요청의 금융 근거를 확인해 주세요.');
      return { status: 'cancelled' as const };
    }
    if (operationSnap.exists && prior?.status === 'rejected') {
      const rejected = await readPartnerPaymentReceipt(db, tx,
        { companyId: companyId as 'taebaek' | 'punghoe', partnerId: input.partnerId, operationId: input.operationId }, actorId, requestHash);
      if (rejected.status !== 'rejected') conflict('기존 거절 작업의 금융 미반영 근거를 확인하지 못했습니다.');
      return { status: 'rejected' as const, failureCode: prior.failureCode as 'invalid-argument' | 'failed-precondition', failureMessage: prior.failureMessage as string };
    }
    let writesStarted = false;
    try {
    if (operationSnap.exists) {
      const confirmed=await readPartnerPaymentReceipt(db,tx,{companyId:companyId as 'taebaek'|'punghoe',partnerId:input.partnerId,operationId:input.operationId},actorId);
      if(confirmed.status!=='applied'||confirmed.requestHash!==requestHash) conflict('기존 지급 작업과 요청 또는 금융 근거가 다릅니다.');
      return {status:'duplicate' as const,id:input.operationId,docNo:confirmed.docNo!};
    }
    assertReleaseActive(releaseSnap, input.releaseId);
    const mode = assertVoucherDateAllowed(releaseSnap, companyId, input.tradeDate, true);
    const effectivePrefix = mode === 'catchUp' ? '추가' : '';
    const counterSnap = mode === 'catchUp' ? catchUpCounterSnap : normalCounterSnap;
    assertStatementTargetUnclaimed(targetClaims);
    if (entrySnap.exists || otherSnap.exists) conflict('작업 ID가 이미 사용 중입니다.');
    if (!cutoverSnap.exists || cutoverSnap.data()?.companyId !== companyId
      || cutoverSnap.data()?.enabled !== true || cutoverSnap.data()?.legacyWritersBlocked !== true
      || cutoverSnap.data()?.auditPassed !== true) conflict('지급 writer 전환이 준비되지 않았습니다.');
    if (partnerQuarantined(cutoverSnap.data(), input.partnerId)) conflict('이 거래처는 과거 정산 내역 확인 후 처리할 수 있습니다.');
    const sequence = await readVoucherCounter(db, tx, counterSnap, releaseSnap, companyId, input.tradeDate, effectivePrefix);
    if (sequence.companyId !== companyId || sequence.tradeDate !== input.tradeDate || sequence.prefix !== effectivePrefix
      || !Number.isSafeInteger(sequence.last) || sequence.last < 0) conflict('전표 번호 카운터가 손상되었습니다.');
    const revision = stateSnap.exists ? stateSnap.data()?.revision : 0;
    if (!Number.isSafeInteger(revision) || revision !== input.expectedRevision) conflict('거래처 정산 상태가 변경되었습니다.');
    if (!accountSnap.exists || owner(accountSnap.data()!) !== companyId || accountSnap.data()?.active !== true) conflict('회사 계좌가 맞지 않습니다.');
    if (!partnerSnap.exists || owner(partnerSnap.data()!) !== companyId) conflict('거래처 회사가 맞지 않습니다.');
    const statements = await readClaimsAfterReturns(db, tx, statementRows.docs.filter(doc => owner(doc.data()) === companyId)
      .map(doc => claimFromStatement(doc.id, doc.data()))
      .filter((row): row is Claim => row !== null),
    returnRows.docs.filter(doc => owner(doc.data()) === companyId)
      .map(doc => ({ id: doc.id, ...doc.data() } as ReturnApplication)), statementRows.docs.map(doc => ({ ...doc.data(), id: doc.id })));
    const cashEntries = cashRows.docs.filter(doc => owner(doc.data()) === companyId)
      .map(doc => cashFromEntry(doc.id, doc.data())).filter((row): row is PaymentCash => row !== null);
    const settlements: PaymentSettlement[] = settlementRows.docs.map(doc => ({ id: doc.id, ...doc.data() } as PaymentSettlement));
    const plan = planPartnerPayment({ companyId, partnerId: input.partnerId, direction: input.direction,
      amount: input.amount, pin: input.pin, allocations: input.allocations, claims: statements, cashEntries, settlements });
    if (plan.ignoredOrphanSettlementIds.length) conflict('삭제되거나 다른 회사에 연결된 정산이 있습니다.');
    const next = sequence.last + 1;
    if (!Number.isSafeInteger(next)) conflict('전표 번호 범위를 초과했습니다.');
    const docNo = formatVoucherNo(input.tradeDate, next, effectivePrefix);
    const createdAt = new Date().toISOString();
    const business = { companyId, partnerId: input.partnerId, date: input.tradeDate,
      cashAccountId: input.cashAccountId, dir: input.direction, amount: input.amount,
      lines: plan.lines, note: input.note?.trim() ?? '' };
    writesStarted = true;
    writeVoucherCounter(tx, counterSnap, sequence, next);
    tx.create(entry, { ...business, partnerName: partnerSnap.data()?.name ?? '',
      docNo, createdAt, createdBy: actorId,
      issueOperationId: input.operationId, issuePayloadHash: requestHash, issuePrefix: effectivePrefix });
    for (const row of plan.settlements) tx.create(db.collection('settlements').doc(`st-${input.operationId}-${row.statementId}`), {
      companyId, operationId: input.operationId, cashEntryId: input.operationId,
      statementId: row.statementId, amount: row.amount, createdAt,
    });
    tx.create(operation, { companyId, partnerId: input.partnerId, requestHash,
      applications: plan.applications, settlements: plan.settlements,
      entryHash: fingerprint(business), docNo, issuePrefix: effectivePrefix, cashEntryId: input.operationId, createdAt, createdBy: actorId });
    if (stateSnap.exists) tx.update(state, { revision: revision + 1 });
    else tx.create(state, { companyId, partnerId: input.partnerId, revision: 1 });
    return { status: 'applied' as const, id: input.operationId, docNo };
    } catch (error) {
      if (error instanceof PartnerPaymentValidationError) error = new HttpsError('failed-precondition', error.message);
      if (!operationSnap.exists && !entrySnap.exists && !otherSnap.exists && !ownedSettlements.length
        && !writesStarted && error instanceof HttpsError
        && (error.code === 'invalid-argument' || error.code === 'failed-precondition')) {
        tx.create(operation, { companyId, partnerId: input.partnerId, requestHash, status: 'rejected',
          failureCode: error.code, failureMessage: error.message, createdAt: new Date().toISOString(), createdBy: actorId });
        return { status: 'rejected' as const, failureCode: error.code, failureMessage: error.message };
      }
      throw error;
    }
  });
  if(outcome.status==='cancelled')throw new HttpsError('failed-precondition','적용 전에 중단된 수금·지불 요청입니다.',{
    partnerPaymentCancelled:{version:1,companyId,partnerId:input.partnerId,operationId:input.operationId,operationCancelled:true,financialWrites:false},
  });
  if (outcome.status === 'rejected') throw new HttpsError(outcome.failureCode, outcome.failureMessage, {
    partnerPaymentFailure: { version: 1, companyId, partnerId: input.partnerId, operationId: input.operationId,
      operationRejected: true, financialWrites: false },
  });
  return outcome;
}

export const recordPartnerPaymentCommand = onCall({ region: 'asia-northeast3' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const companyId = request.auth.token.companyId;
  if (!request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe'))
    throw new HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
  return recordPartnerPayment(admin.firestore(), companyId, request.auth.uid, request.data as Input);
});

export async function recoverPartnerPayment(db: admin.firestore.Firestore, companyId: string, actorUid: string,
  value: PartnerPaymentRecoveryCommand): Promise<PartnerPaymentRecoveryResult | PartnerPaymentListResult> {
  let input: PartnerPaymentRecoveryCommand;
  try { input = normalizePartnerPaymentRecoveryCommand(value); }
  catch (error) { throw new HttpsError('invalid-argument', error instanceof Error ? error.message : '복구 요청을 확인해 주세요.'); }
  const reference = input.mode === 'list' ? { companyId: input.companyId, partnerId: input.partnerId } : input.reference;
  if (!actorUid || reference.companyId !== companyId) throw new HttpsError('permission-denied', '현재 회사와 계정의 수금 요청만 확인할 수 있습니다.');
  if (input.mode === 'list') {
    return db.runTransaction(async tx => {
      let query = db.collection('partnerPaymentOperations').where('companyId', '==', companyId)
        .where('createdBy', '==', actorUid).where('partnerId', '==', input.partnerId)
        .orderBy(admin.firestore.FieldPath.documentId()).limit(21);
      if (input.cursor) query = query.startAfter(input.cursor);
      const rows = await tx.get(query);
      const entries: PartnerPaymentRecoveryResult[] = [];
      for (const row of rows.docs.slice(0, 20)) {
        entries.push(await readPartnerPaymentReceipt(db, tx, { companyId: input.companyId, partnerId: input.partnerId, operationId: row.id }, actorUid));
      }
      return { version: 1, companyId: input.companyId, partnerId: input.partnerId, actorUid, entries,
        nextCursor: rows.docs.length > 20 ? rows.docs[19].id : null };
    });
  }
  return db.runTransaction(async tx => {
    const confirmed = await readPartnerPaymentReceipt(db, tx, input.reference, actorUid);
    if (input.mode === 'inspect' || confirmed.status !== 'unknown') return confirmed;
    const operation = db.collection('partnerPaymentOperations').doc(input.reference.operationId);
    const prior = await tx.get(operation);
    const entry = await tx.get(db.collection('cashEntries').doc(input.reference.operationId));
    const other = await tx.get(db.collection('issuedStatements').doc(input.reference.operationId));
    const settlements = await tx.get(db.collection('settlements').where('operationId', '==', input.reference.operationId));
    const mutations = await tx.get(db.collection('voucherMutationOperations').where('cashEntryIds', 'array-contains', input.reference.operationId));
    if (prior.exists || entry.exists || other.exists || settlements.docs.length > 0 || mutations.docs.length > 0) return confirmed;
    const request = input.requestText === undefined ? null : JSON.parse(input.requestText);
    const requestHash = request === null ? null : fingerprint({ ...request, note: request.note?.trim() ?? '' });
    const cancelled: PartnerPaymentRecoveryResult = { version: 1, reference: input.reference, actorUid,
      status: 'cancelled', requestHash, message: '이 수금·지불 요청을 적용 전에 중단했습니다. 늦게 도착하는 같은 요청도 금융 자료를 만들지 않습니다.' };
    tx.create(operation, { companyId, partnerId: input.reference.partnerId, createdBy: actorUid, status: 'cancelled',
      requestHash, financialWrites: false, cancelledAt: new Date().toISOString() });
    return cancelled;
  });
}

export const partnerPaymentRecoveryCommand = onCall({ region: 'asia-northeast3' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const companyId = request.auth.token.companyId;
  if (request.auth.token.isAdmin !== true || !['taebaek', 'punghoe'].includes(String(companyId))) throw new HttpsError('permission-denied', '현재 회사의 관리자 권한이 필요합니다.');
  return recoverPartnerPayment(admin.firestore(), companyId as string, request.auth.uid, request.data);
});
