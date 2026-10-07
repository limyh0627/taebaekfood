import * as admin from 'firebase-admin';
import { createHash } from 'crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { assertReleaseActive, releaseGateRef } from './releaseGate';

type Kind = 'cashEntries' | 'issuedStatements';
type Input = { operationId: string; kind: Kind; voucherId: string; action: 'edit-note' | 'delete';
  expectedRevision: number; releaseId: string; note?: string };
type Row = Record<string, unknown>;
const reject = (message: string): never => { throw new HttpsError('failed-precondition', message); };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Deliberately narrow: connected accounting documents need a separate reversal contract. */
export async function mutateVoucher(db: admin.firestore.Firestore, companyId: string, actorId: string, input: Input) {
  if (!actorId || !input || !/^[A-Za-z0-9_-]{1,160}$/.test(input.operationId)
    || !/^[A-Za-z0-9_-]{1,160}$/.test(input.voucherId)
    || !['cashEntries', 'issuedStatements'].includes(input.kind)
    || !['edit-note', 'delete'].includes(input.action)
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
    || !/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId)
    || (input.action === 'edit-note' && (typeof input.note !== 'string' || input.note.length > 500))
    || (input.action === 'delete' && input.note !== undefined))
    throw new HttpsError('invalid-argument', '전표 변경 입력이 잘못되었습니다.');
  const requestHash = digest([companyId, input.kind, input.voucherId, input.action, input.expectedRevision,
    input.releaseId, input.note?.trim() ?? null]);
  const voucher = db.collection(input.kind).doc(input.voucherId);
  const operation = db.collection('voucherMutationOperations').doc(input.operationId);
  return db.runTransaction(async tx => {
    const [gate, prior, current, byCash, byStatement, returns, applications, purchaseOrders, orders, edits,
      costHistory, cashLinks, partnerPayment, loanMovement, transfer] = await Promise.all([
      tx.get(releaseGateRef(db)), tx.get(operation), tx.get(voucher),
      tx.get(db.collection('settlements').where('cashEntryId', '==', input.voucherId)),
      tx.get(db.collection('settlements').where('statementId', '==', input.voucherId)),
      tx.get(db.collection('returnRequests').where('linkedStatementId', '==', input.voucherId)),
      tx.get(db.collection('returnApplications').where('statementId', '==', input.voucherId)),
      tx.get(db.collection('purchaseOrders').where('linkedStatementId', '==', input.voucherId)),
      tx.get(db.collection('orders').where('linkedStatementId', '==', input.voucherId)),
      tx.get(db.collection('pendingStatementEdits').where('statementId', '==', input.voucherId)),
      tx.get(db.collection('itemCostHistory').where('sourceStatementId', '==', input.voucherId)),
      tx.get(db.collection('cashEntries').where('statementId', '==', input.voucherId)),
      tx.get(db.collection('partnerPaymentOperations').doc(input.voucherId)),
      tx.get(db.collection('loanMovementOperations').doc(input.voucherId)),
      tx.get(db.collection('companyTransferOperations').doc(input.voucherId)),
    ]);
    assertReleaseActive(gate, input.releaseId);
    if (prior.exists) {
      const old = prior.data()!;
      if (old.companyId !== companyId || old.requestHash !== requestHash
        || (input.action === 'delete' ? current.exists : !current.exists || current.data()?.mutationRevision !== input.expectedRevision + 1
          || current.data()?.note !== input.note!.trim())) reject('기존 전표 변경 작업과 요청이 다릅니다.');
      return { status: 'duplicate' as const, id: input.voucherId };
    }
    if (!current.exists || (current.data()?.companyId ?? 'taebaek') !== companyId) reject('전표의 회사가 맞지 않습니다.');
    const data = current.data() as Row;
    if ((data.mutationRevision ?? 0) !== input.expectedRevision) reject('전표가 이미 변경되었습니다.');
    const date = input.kind === 'cashEntries' ? data.date : data.tradeDate;
    const number = typeof data.docNo === 'string' ? /^(가공|반품|대체|급여|추가)?(\d{6})-(\d{2,})$/.exec(data.docNo) : null;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !number || number[2] !== date.slice(2).replace(/-/g, '')
      || (number[1] === '추가' && !(companyId === 'taebaek' && date === '2026-09-30'))
      || !Number.isSafeInteger(Number(number[3])) || Number(number[3]) < 1)
      reject('기존 전표의 날짜·번호가 불명확합니다.');
    if (input.kind === 'cashEntries'
      ? !Number.isSafeInteger(data.amount) || (data.amount as number) <= 0
      : !Number.isSafeInteger(data.totalAmount) || (data.totalAmount as number) === 0
        || !Number.isSafeInteger(data.totalSupply) || !Number.isSafeInteger(data.totalTax)
        || (data.totalSupply as number) + (data.totalTax as number) !== data.totalAmount)
      reject('기존 전표의 금액·분개 근거가 불명확합니다.');
    const cashCodes = input.kind === 'cashEntries'
      ? [data.accountCode, ...(Array.isArray(data.lines) ? data.lines.map((line: Row) => line?.accountCode) : [])]
      : [];
    if ((data.issueOperationId !== undefined && data.issueOperationId !== input.voucherId)
      || (data.issueOperationId === undefined && (data.issuePayloadHash || data.issuePrefix))
      || data.partnerPaymentOperationId || data.loanMovementOperationId || data.transferOperationId
      || data.payrollOperationId || data.oemFeeOperationId || data.oemReceiptOperationId
      || data.loanId || data.orderId || data.returnOperationId || data.reverseOfStatementId
      || data.payrollId || data.oemPoId || data.linkedStatementId || data.sourceStatementId
      || !byCash.empty || !byStatement.empty || !returns.empty || !applications.empty
      || !purchaseOrders.empty || !orders.empty || !edits.empty || !costHistory.empty || !cashLinks.empty
      || partnerPayment.exists || loanMovement.exists || transfer.exists
      || (input.action === 'delete' && cashCodes.some(code => ['108', '251', '253', '260', '293'].includes(String(code)))))
      reject('연결된 전표는 원본·정산·재고를 함께 검증하는 정정 절차가 필요합니다.');
    if (input.action === 'delete') tx.delete(voucher);
    else tx.update(voucher, { note: input.note!.trim(), mutationRevision: input.expectedRevision + 1 });
    tx.create(operation, { companyId, kind: input.kind, voucherId: input.voucherId, action: input.action,
      requestHash, createdBy: actorId, createdAt: new Date().toISOString() });
    return { status: 'applied' as const, id: input.voucherId };
  });
}

export const mutateVoucherCommand = onCall({ region: 'asia-northeast3' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const companyId = request.auth.token.companyId;
  if (!request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe'))
    throw new HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
  return mutateVoucher(admin.firestore(), companyId, request.auth.uid, request.data as Input);
});
