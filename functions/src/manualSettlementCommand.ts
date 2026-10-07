import * as admin from 'firebase-admin';
import { partnerQuarantined } from './partnerCutover';
import { createHash } from 'crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { claimFromStatement, cashFromEntry } from './partnerPaymentCommand';
import { claimsAfterReturns, type ReturnApplication } from './partnerPaymentPlan';
import { assertReleaseActive, releaseGateRef } from './releaseGate';

type Action = 'add' | 'update' | 'delete';
type Input = { operationId: string; action: Action; partnerId: string; cashEntryId: string;
  statementId: string; amount: number; expectedAmount?: number; settlementId?: string;
  expectedRevision: number; releaseId: string };
const bad = (message: string): never => { throw new HttpsError('invalid-argument', message); };
const fail = (message: string): never => { throw new HttpsError('failed-precondition', message); };
const owner = (row: Record<string, any>) => row.companyId ?? 'taebaek';
const hash = (input: Input, companyId: string) => createHash('sha256').update(JSON.stringify({ companyId,
  operationId: input.operationId, action: input.action, partnerId: input.partnerId,
  cashEntryId: input.cashEntryId, statementId: input.statementId, amount: input.amount,
  expectedAmount: input.expectedAmount ?? null, settlementId: input.settlementId ?? null,
  expectedRevision: input.expectedRevision, releaseId: input.releaseId })).digest('hex');
const positive = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;

/** 수동 연결만 변경한다. 발행·반품 명령이 소유한 정산 행은 수정하지 않는다. */
export async function mutateManualSettlement(db: admin.firestore.Firestore, companyId: string, actorId: string, input: Input) {
  if (!actorId || !input || typeof input !== 'object') bad('정산 요청이 잘못되었습니다.');
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(input.operationId)
    || !['add', 'update', 'delete'].includes(input.action)
    || !/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId)
    || !input.partnerId || !input.cashEntryId || !input.statementId
    || !positive(input.amount) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
    || (input.action === 'add' ? input.settlementId !== undefined || input.expectedAmount !== undefined
      : !input.settlementId || (input.action === 'update' && !positive(input.expectedAmount))))
    bad('정산 입력이 잘못되었습니다.');
  const settlementId = input.action === 'add' ? `manual-${input.operationId}` : input.settlementId!;
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(settlementId)) bad('정산 ID가 잘못되었습니다.');
  const requestHash = hash(input, companyId);
  const operationRef = db.collection('manualSettlementOperations').doc(input.operationId);
  const settlementRef = db.collection('settlements').doc(settlementId);
  const statementRef = db.collection('issuedStatements').doc(input.statementId);
  const cashRef = db.collection('cashEntries').doc(input.cashEntryId);
  const stateRef = db.collection('appMeta').doc(`partnerPaymentState_${companyId}_${input.partnerId}`);
  const cutoverRef = db.collection('appMeta').doc(`partnerPaymentCutover_${companyId}`);
  return db.runTransaction(async tx => {
    const [operationSnap, settlementSnap, statementSnap, cashSnap, stateSnap, cutoverSnap, releaseSnap,
      settlementRows, returnRows, partnerSnap] = await Promise.all([
      tx.get(operationRef), tx.get(settlementRef), tx.get(statementRef), tx.get(cashRef),
      tx.get(stateRef), tx.get(cutoverRef), tx.get(releaseGateRef(db)),
      tx.get(db.collection('settlements')),
      tx.get(db.collection('returnApplications').where('statementId', '==', input.statementId)),
      tx.get(db.collection('partners').doc(input.partnerId)),
    ]);
    assertReleaseActive(releaseSnap, input.releaseId);
    if (operationSnap.exists) {
      const previous = operationSnap.data()!;
      const current = settlementSnap.data();
      if (previous.companyId !== companyId || previous.requestHash !== requestHash
        || previous.settlementId !== settlementId || previous.partnerId !== input.partnerId
        || (input.action === 'delete' ? settlementSnap.exists
          : !settlementSnap.exists || current?.cashEntryId !== input.cashEntryId
            || current?.statementId !== input.statementId || current?.amount !== input.amount
            || owner(current!) !== companyId)) fail('기존 정산 작업과 현재 행이 다릅니다.');
      return { status: 'duplicate' as const, settlementId, revision: previous.revision };
    }
    const cutover = cutoverSnap.data();
    if (!cutoverSnap.exists || cutover?.companyId !== companyId || cutover?.enabled !== true
      || cutover?.legacyWritersBlocked !== true || cutover?.auditPassed !== true)
      fail('정산 writer 전환이 준비되지 않았습니다.');
    if (partnerQuarantined(cutover, input.partnerId)) fail('이 거래처는 과거 정산 내역 확인 후 처리할 수 있습니다.');
    const revision = stateSnap.exists ? stateSnap.data()?.revision : 0;
    if (!Number.isSafeInteger(revision) || revision !== input.expectedRevision)
      fail('거래처 정산 상태가 변경되었습니다.');
    if (!partnerSnap.exists || owner(partnerSnap.data()!) !== companyId
      || !statementSnap.exists || !cashSnap.exists
      || owner(statementSnap.data()!) !== companyId || owner(cashSnap.data()!) !== companyId
      || statementSnap.data()?.partnerId !== input.partnerId || cashSnap.data()?.partnerId !== input.partnerId)
      fail('원전표·자금전표·거래처의 회사가 맞지 않습니다.');
    if (cashSnap.data()?.issueOperationId || cashSnap.data()?.transferOperationId
      || cashSnap.data()?.loanMovementOperationId || cashSnap.data()?.partnerPaymentOperationId)
      fail('서버 명령이 소유한 자금전표의 연결은 수동으로 바꿀 수 없습니다.');
    const cashSource = cashSnap.data()!;
    if (!['입금', '출금'].includes(cashSource.dir) || !positive(cashSource.amount))
      fail('실제 입출금 자금전표만 수동 정산할 수 있습니다.');
    const cashLines = Array.isArray(cashSource.lines) && cashSource.lines.length ? cashSource.lines
      : cashSource.accountCode ? [{ accountCode: cashSource.accountCode, amount: cashSource.amount }] : [];
    if (!cashLines.length || cashLines.some((line: Record<string, unknown>) =>
      typeof line.accountCode !== 'string' || !positive(line.amount))
      || cashLines.reduce((sum: number, line: { amount: number }) => sum + line.amount, 0) !== cashSource.amount)
      fail('자금전표 줄 총액이 원본 금액과 맞지 않습니다.');
    const claim = claimFromStatement(input.statementId, statementSnap.data()!);
    const cash = cashFromEntry(input.cashEntryId, cashSnap.data()!);
    if (!claim || !cash) fail('원전표·자금전표의 정산 계정을 확인할 수 없습니다.');
    const returned = returnRows.docs.map(doc => ({ id: doc.id, ...doc.data() } as ReturnApplication));
    const net = claimsAfterReturns([claim!], returned)[0].amount;
    const availableCash = cash!.parts.filter(part => part.accountCode === claim!.accountCode)
      .reduce((sum, part) => sum + part.reduce, 0);
    if (!Number.isSafeInteger(net) || net < 0 || !Number.isSafeInteger(availableCash)
      || availableCash <= 0 || availableCash > cashSource.amount)
      fail('원전표 잔액 또는 자금전표 방향이 맞지 않습니다.');
    const prior = settlementSnap.data();
    if (input.action === 'add' ? settlementSnap.exists : !settlementSnap.exists
      || prior?.cashEntryId !== input.cashEntryId || prior?.statementId !== input.statementId
      || !positive(prior?.amount) || prior.amount !== (input.action === 'update' ? input.expectedAmount : input.amount)
      || owner(prior!) !== companyId || prior?.operationId || prior?.returnOperationId
      || prior?.transferOperationId || prior?.issueOperationId || prior?.serverOwned === true
      || settlementId.startsWith('st-')) fail('수동 정산 행이 없거나 서버 명령 소유·값이 변경되었습니다.');
    let settledClaim = 0, settledCash = 0;
    for (const doc of settlementRows.docs) {
      if (doc.id === settlementId) continue;
      const row = doc.data();
      if (row.statementId !== input.statementId && row.cashEntryId !== input.cashEntryId) continue;
      if (!positive(row.amount)) fail('기존 정산 금액이 잘못되었습니다.');
      if (row.statementId === input.statementId) {
        if (owner(row) !== companyId) fail('원전표에 다른 회사 정산이 있습니다.');
        const linked = await tx.get(db.collection('cashEntries').doc(row.cashEntryId));
        if (!linked.exists || owner(linked.data()!) !== companyId || linked.data()?.partnerId !== input.partnerId)
          fail('기존 원전표 정산 연결이 불명확합니다.');
        settledClaim += row.amount;
      }
      if (row.cashEntryId === input.cashEntryId) {
        if (owner(row) !== companyId) fail('자금전표에 다른 회사 정산이 있습니다.');
        const linked = await tx.get(db.collection('issuedStatements').doc(row.statementId));
        const linkedClaim = linked.exists ? claimFromStatement(linked.id, linked.data()!) : null;
        if (!linkedClaim || linkedClaim.partnerId !== input.partnerId || linkedClaim.companyId !== companyId
          || linkedClaim.accountCode !== claim!.accountCode) fail('기존 자금 정산 연결이 불명확합니다.');
        settledCash += row.amount;
      }
    }
    const nextAmount = input.action === 'delete' ? 0 : input.amount;
    if (!Number.isSafeInteger(settledClaim + nextAmount) || settledClaim + nextAmount > net
      || !Number.isSafeInteger(settledCash + nextAmount) || settledCash + nextAmount > availableCash)
      fail('원전표·자금전표 정산 한도를 넘습니다.');
    const createdAt = new Date().toISOString();
    if (input.action === 'add') tx.create(settlementRef, { companyId, cashEntryId: input.cashEntryId,
      statementId: input.statementId, amount: input.amount, manual: true, createdAt, createdBy: actorId });
    else if (input.action === 'update') tx.update(settlementRef, { amount: input.amount, updatedAt: createdAt,
      updatedBy: actorId });
    else tx.delete(settlementRef);
    if (stateSnap.exists) tx.update(stateRef, { revision: revision + 1 });
    else tx.create(stateRef, { companyId, partnerId: input.partnerId, revision: 1 });
    tx.create(operationRef, { companyId, partnerId: input.partnerId, requestHash, settlementId,
      action: input.action, revision: revision + 1, createdAt, createdBy: actorId });
    return { status: 'applied' as const, settlementId, revision: revision + 1 };
  });
}

export const mutateManualSettlementCommand = onCall({ region: 'asia-northeast3' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const companyId = request.auth.token.companyId;
  if (!request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe'))
    throw new HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
  return mutateManualSettlement(admin.firestore(), companyId, request.auth.uid, request.data as Input);
});
