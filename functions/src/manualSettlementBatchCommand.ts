import * as admin from 'firebase-admin';
import { partnerQuarantined } from './partnerCutover';
import { createHash } from 'crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { cashFromEntry, claimFromStatement } from './partnerPaymentCommand';
import { claimsAfterReturns, type Claim, type ReturnApplication } from './partnerPaymentPlan';
import { assertReleaseActive, releaseGateRef } from './releaseGate';

type Allocation = { statementId: string; amount: number };
type Input = { operationId: string; cashEntryId: string; partnerId: string;
  allocations: Allocation[]; expectedPartnerRevision: number; releaseId: string };
const invalid = (message: string): never => { throw new HttpsError('invalid-argument', message); };
const conflict = (message: string): never => { throw new HttpsError('failed-precondition', message); };
const owner = (row: Record<string, any>) => row.companyId ?? 'taebaek';
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const manual = (row: Record<string, any>) => row.manual === true && !row.operationId
  && !row.returnOperationId && !row.transferOperationId && !row.issueOperationId
  && row.serverOwned !== true;

/** Replaces every manual allocation for one cash entry in a single transaction. */
export async function replaceManualSettlementBatch(db: admin.firestore.Firestore, companyId: string,
  actorId: string, input: Input) {
  if (!actorId || !input || typeof input !== 'object'
    || !/^[A-Za-z0-9_-]{1,120}$/.test(input.operationId)
    || !/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId)
    || typeof input.cashEntryId !== 'string' || !input.cashEntryId
    || typeof input.partnerId !== 'string' || !input.partnerId
    || !Number.isSafeInteger(input.expectedPartnerRevision) || input.expectedPartnerRevision < 0
    || !Array.isArray(input.allocations) || input.allocations.length > 200
    || input.allocations.some(row => !row || typeof row.statementId !== 'string'
      || !row.statementId || !positive(row.amount))
    || new Set(input.allocations.map(row => row.statementId)).size !== input.allocations.length)
    invalid('수동 상계 배분 입력이 잘못되었습니다.');
  const allocations = [...input.allocations].sort((a, b) => a.statementId.localeCompare(b.statementId));
  const requestHash = createHash('sha256').update(JSON.stringify({ companyId, cashEntryId: input.cashEntryId,
    partnerId: input.partnerId, allocations, expectedPartnerRevision: input.expectedPartnerRevision,
    releaseId: input.releaseId })).digest('hex');
  const operationRef = db.collection('manualSettlementBatchOperations').doc(input.operationId);
  const cashRef = db.collection('cashEntries').doc(input.cashEntryId);
  const stateRef = db.collection('appMeta').doc(`partnerPaymentState_${companyId}_${input.partnerId}`);
  const cutoverRef = db.collection('appMeta').doc(`partnerPaymentCutover_${companyId}`);
  return db.runTransaction(async tx => {
    const [operationSnap, cashSnap, stateSnap, cutoverSnap, releaseSnap, partnerSnap,
      statementRows, settlementRows, returnRows] = await Promise.all([
      tx.get(operationRef), tx.get(cashRef), tx.get(stateRef), tx.get(cutoverRef),
      tx.get(releaseGateRef(db)), tx.get(db.collection('partners').doc(input.partnerId)),
      tx.get(db.collection('issuedStatements').where('partnerId', '==', input.partnerId)),
      tx.get(db.collection('settlements')),
      tx.get(db.collection('returnApplications').where('partnerId', '==', input.partnerId)),
    ]);
    assertReleaseActive(releaseSnap, input.releaseId);
    const old = settlementRows.docs.filter(doc => doc.data().cashEntryId === input.cashEntryId && manual(doc.data()));
    if (operationSnap.exists) {
      const previous = operationSnap.data()!;
      const current = settlementRows.docs.filter(doc => doc.data().cashEntryId === input.cashEntryId);
      if (previous.companyId !== companyId || previous.partnerId !== input.partnerId
        || previous.cashEntryId !== input.cashEntryId || previous.requestHash !== requestHash
        || current.length !== allocations.length || current.some(doc => !manual(doc.data())
          || owner(doc.data()) !== companyId || !allocations.some(row =>
            row.statementId === doc.data().statementId && row.amount === doc.data().amount)))
        conflict('기존 수동 상계 작업과 현재 배분이 다릅니다.');
      return { status: 'duplicate' as const, revision: previous.revision };
    }
    const cutover = cutoverSnap.data();
    if (!cutoverSnap.exists || cutover?.companyId !== companyId || cutover?.enabled !== true
      || cutover?.legacyWritersBlocked !== true || cutover?.auditPassed !== true)
      conflict('정산 writer 전환이 준비되지 않았습니다.');
    if (partnerQuarantined(cutover, input.partnerId)) conflict('이 거래처는 과거 정산 내역 확인 후 처리할 수 있습니다.');
    const revision = stateSnap.exists ? stateSnap.data()?.revision : 0;
    if (!Number.isSafeInteger(revision) || revision !== input.expectedPartnerRevision)
      conflict('거래처 정산 상태가 변경되었습니다.');
    const source = cashSnap.data();
    if (!source) throw new HttpsError('failed-precondition', '자금전표가 없습니다.');
    if (owner(source) !== companyId || source.partnerId !== input.partnerId
      || !partnerSnap.exists || owner(partnerSnap.data()!) !== companyId)
      conflict('자금전표·거래처의 회사가 맞지 않습니다.');
    if (source.issueOperationId || source.transferOperationId || source.loanMovementOperationId
      || source.partnerPaymentOperationId || !['입금', '출금'].includes(source.dir) || !positive(source.amount))
      conflict('수동 정산할 수 없는 자금전표입니다.');
    const lines = Array.isArray(source.lines) && source.lines.length ? source.lines
      : source.accountCode ? [{ accountCode: source.accountCode, amount: source.amount }] : [];
    if (!lines.length || lines.some((line: Record<string, unknown>) =>
      typeof line.accountCode !== 'string' || !positive(line.amount))
      || lines.reduce((sum: number, line: { amount: number }) => sum + line.amount, 0) !== source.amount)
      conflict('자금전표 줄 총액이 원본 금액과 맞지 않습니다.');
    const cash = cashFromEntry(input.cashEntryId, source);
    if (!cash) conflict('자금전표 정산 계정이 불명확합니다.');
    const claims = claimsAfterReturns(statementRows.docs.filter(doc => owner(doc.data()) === companyId)
      .map(doc => claimFromStatement(doc.id, doc.data())).filter((row): row is Claim => row !== null),
    returnRows.docs.filter(doc => owner(doc.data()) === companyId)
      .map(doc => ({ id: doc.id, ...doc.data() } as ReturnApplication)));
    const byClaim = new Map(claims.map(row => [row.id, row]));
    const claimUsed = new Map<string, number>();
    const cashUsed = new Map<string, number>();
    for (const doc of settlementRows.docs) {
      const row = doc.data();
      if (old.some(prior => prior.id === doc.id)) continue;
      const claim = byClaim.get(row.statementId);
      if (!claim && row.cashEntryId !== input.cashEntryId) continue;
      if (!claim) throw new HttpsError('failed-precondition', '기존 정산 연결이 불명확합니다.');
      if (owner(row) !== companyId || !positive(row.amount))
        conflict('기존 정산 연결이 불명확합니다.');
      claimUsed.set(claim.id, (claimUsed.get(claim.id) ?? 0) + row.amount);
      if (row.cashEntryId === input.cashEntryId)
        cashUsed.set(claim.accountCode, (cashUsed.get(claim.accountCode) ?? 0) + row.amount);
    }
    for (const row of old) {
      if (owner(row.data()) !== companyId || !positive(row.data().amount)
        || !byClaim.has(row.data().statementId)) conflict('기존 수동 정산 연결이 불명확합니다.');
    }
    for (const row of allocations) {
      const claim = byClaim.get(row.statementId);
      if (!claim) throw new HttpsError('failed-precondition', '원전표가 없습니다.');
      if (claim.partnerId !== input.partnerId || claim.companyId !== companyId)
        conflict('원전표의 회사·거래처가 맞지 않습니다.');
      const eligible = cash!.parts.filter(part => part.accountCode === claim.accountCode)
        .reduce((sum, part) => sum + part.reduce, 0);
      if (eligible <= 0) conflict('원전표와 자금전표의 방향·계정이 맞지 않습니다.');
      claimUsed.set(claim.id, (claimUsed.get(claim.id) ?? 0) + row.amount);
      cashUsed.set(claim.accountCode, (cashUsed.get(claim.accountCode) ?? 0) + row.amount);
    }
    if ([...claimUsed].some(([id, used]) => !Number.isSafeInteger(used) || used > byClaim.get(id)!.amount)
      || [...cashUsed].some(([code, used]) => !Number.isSafeInteger(used)
        || used > cash!.parts.filter(part => part.accountCode === code)
          .reduce((sum, part) => sum + part.reduce, 0)))
      conflict('원전표 잔액 또는 자금전표 한도를 넘습니다.');
    const createdAt = new Date().toISOString();
    for (const row of old) tx.delete(row.ref);
    for (const row of allocations) tx.create(db.collection('settlements').doc(`manual-${input.operationId}-${row.statementId}`), {
      companyId, cashEntryId: input.cashEntryId, statementId: row.statementId,
      amount: row.amount, manual: true, createdAt, createdBy: actorId });
    if (stateSnap.exists) tx.update(stateRef, { revision: revision + 1 });
    else tx.create(stateRef, { companyId, partnerId: input.partnerId, revision: 1 });
    tx.create(operationRef, { companyId, partnerId: input.partnerId, cashEntryId: input.cashEntryId,
      requestHash, revision: revision + 1, createdAt, createdBy: actorId });
    return { status: 'applied' as const, revision: revision + 1 };
  });
}

export const replaceManualSettlementBatchCommand = onCall({ region: 'asia-northeast3' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const companyId = request.auth.token.companyId;
  if (!request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe'))
    throw new HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
  return replaceManualSettlementBatch(admin.firestore(), companyId, request.auth.uid, request.data as Input);
});
