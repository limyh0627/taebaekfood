import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { createHash } from 'crypto';

type Approval = { pendingEditRequestId: string; pendingEditRequestHash: string };
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key,canonical(item)])) : value;
const pendingData = (value: Record<string, any>) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'id'));
const approvedSource = (value: Record<string, any>) => ({ ...Object.fromEntries(Object.entries(pendingData(value)).filter(([key]) => !['approvalOperationId','approvedRequestHash','approvedAt','approvedBy'].includes(key))), status: 'pending' });
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const fields = new Set(['tradeDate', 'issuedAt', 'memo', 'partnerId', 'partnerName', 'partySnapshot', 'totalSupply', 'totalTax', 'totalAmount', 'items', 'evidence', 'taxIssuedAt', 'exemptIssuedAt']);
const money = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const companyOf = (value: unknown) => value === 'punghoe' ? 'punghoe' : 'taebaek';

/** 운영 전표의 수정은 클라이언트 직접 쓰기 대신 회사·정산·버전을 확인한 뒤 서버에서 확정한다. */
export async function editIssuedStatement(db: admin.firestore.Firestore, request: { auth?: { uid: string; token: Record<string, any> }; data?: any }) {
  const claims = request.auth?.token;
  if (claims?.isAdmin !== true || typeof claims.employeeId !== 'string' || !['taebaek', 'punghoe'].includes(String(claims.companyId))) {
    throw new HttpsError('permission-denied', '이 회사의 전표 수정 권한이 없습니다.');
  }
  const { statementId, releaseId, expectedRevision, operationId, patch, pendingEditRequestId, pendingEditRequestHash } = request.data ?? {};
  if (typeof statementId !== 'string' || !/^[\w-]{1,150}$/.test(statementId) ||
      typeof operationId !== 'string' || !/^[\w-]{8,150}$/.test(operationId) ||
      typeof releaseId !== 'string' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      !patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new HttpsError('invalid-argument', '전표 수정 요청 형식이 올바르지 않습니다.');
  }
  const approval: Approval | undefined = pendingEditRequestId === undefined && pendingEditRequestHash === undefined ? undefined : { pendingEditRequestId, pendingEditRequestHash };
  if (approval && (typeof pendingEditRequestId !== 'string' || !/^[\w-]{1,150}$/.test(pendingEditRequestId)
    || typeof pendingEditRequestHash !== 'string' || !/^[a-f0-9]{64}$/.test(pendingEditRequestHash)))
    throw new HttpsError('invalid-argument', '전표 승인 요청 형식이 올바르지 않습니다.');
  const names = Object.keys(patch);
  if (!names.length || names.some(name => !fields.has(name))) throw new HttpsError('invalid-argument', '수정할 수 없는 전표 항목이 포함됐습니다.');
  const requestHash = createHash('sha256').update(JSON.stringify({ statementId, expectedRevision, patch, ...(approval ?? {}) })).digest('hex');
  if ('tradeDate' in patch && (typeof patch.tradeDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(patch.tradeDate) ||
      Number.isNaN(Date.parse(`${patch.tradeDate}T00:00:00Z`)))) throw new HttpsError('invalid-argument', '거래일이 올바르지 않습니다.');
  for (const key of ['totalSupply', 'totalTax', 'totalAmount']) {
    if (key in patch && !money(patch[key])) throw new HttpsError('invalid-argument', `${key} 금액이 올바르지 않습니다.`);
  }
  if ('items' in patch && (!Array.isArray(patch.items) || !patch.items.length || patch.items.length > 200 ||
    patch.items.some((line: Record<string, unknown>) => !line || typeof line !== 'object' ||
      typeof line.name !== 'string' || !['qty', 'price', 'supply', 'tax', 'total'].every(key => money(line[key]))))) {
    throw new HttpsError('invalid-argument', '전표 품목의 수량·금액이 올바르지 않습니다.');
  }
  const gateRef = db.doc('appMeta/releaseCutover');
  const statementRef = db.collection('issuedStatements').doc(statementId);
  const operationRef = db.collection('voucherMutationOperations').doc(operationId);
  const settlementQuery = db.collection('settlements').where('statementId', '==', statementId);
  return db.runTransaction(async tx => {
    const [gate, operation, original, settlements] = await Promise.all([
      tx.get(gateRef), tx.get(operationRef), tx.get(statementRef), tx.get(settlementQuery),
    ]);
    const editRef = approval ? db.collection('pendingStatementEdits').doc(approval.pendingEditRequestId) : null;
    const editSnap = editRef ? await tx.get(editRef) : null;
    if (gate.get('status') !== 'active' || gate.get('releaseId') !== releaseId) {
      throw new HttpsError('failed-precondition', '전표 수정 서버의 배포 상태가 변경됐습니다. 화면을 새로고침해 주세요.');
    }
    if (operation.exists) {
      if (operation.get('statementId') !== statementId || operation.get('uid') !== request.auth?.uid || operation.get('requestHash') !== requestHash) {
        throw new HttpsError('already-exists', '다른 전표 수정 요청과 번호가 겹쳤습니다.');
      }
      if (approval && (!editSnap?.exists || (editSnap.data()?.companyId ?? 'taebaek') !== claims.companyId
        || editSnap.get('statementId') !== statementId || editSnap.get('status') !== 'approved'
        || hash(approvedSource(editSnap.data()!)) !== approval.pendingEditRequestHash
        || editSnap.get('approvalOperationId') !== operationId || editSnap.get('approvedRequestHash') !== approval.pendingEditRequestHash
        || operation.get('pendingEditRequestId') !== approval.pendingEditRequestId
        || operation.get('pendingEditRequestHash') !== approval.pendingEditRequestHash
        || operation.get('companyId') !== claims.companyId))
        throw new HttpsError('failed-precondition', '기존 전표 승인 근거와 요청이 다릅니다.');
      return { status: 'duplicate', revision: operation.get('revision') as number };
    }
    if (!original.exists) throw new HttpsError('not-found', '전표를 찾을 수 없습니다.');
    const old = original.data()!;
    if (companyOf(old.companyId) !== claims.companyId) throw new HttpsError('permission-denied', '다른 회사 전표는 수정할 수 없습니다.');
    if (approval && (!editSnap?.exists || (editSnap.data()?.companyId ?? 'taebaek') !== claims.companyId
      || editSnap.get('statementId') !== statementId || editSnap.get('status') !== 'pending'
      || hash(pendingData(editSnap.data()!)) !== approval.pendingEditRequestHash || hash(editSnap.get('proposedData')) !== hash(patch)))
      throw new HttpsError('failed-precondition', '전표 수정 요청이 변경됐습니다. 다시 확인해 주세요.');
    const revision = Number(old.mutationRevision ?? 0);
    if (revision !== expectedRevision) throw new HttpsError('aborted', '전표가 다른 곳에서 수정됐습니다. 화면을 새로고침하고 다시 확인해 주세요.');
    if ('partnerId' in patch && patch.partnerId !== old.partnerId &&
        (settlements.size > 0 || String(old.orderId ?? '').trim())) {
      throw new HttpsError('failed-precondition', '주문이나 수금이 연결된 전표는 거래처를 바꿀 수 없습니다.');
    }
    if ('partnerId' in patch && patch.partnerId !== old.partnerId) {
      // 거래처 변경은 별도 연결 검사가 필요하므로 이 명령에서는 제한한다.
      throw new HttpsError('failed-precondition', '거래처 변경은 연결된 장부를 확인한 뒤 처리해야 합니다.');
    }
    const next = { ...old, ...patch };
    if ('items' in patch) {
      const sum = (key: 'supply' | 'tax' | 'total') => (next.items as Record<string, number>[]).reduce((total, line) => total + line[key], 0);
      if (Math.abs(sum('supply') - next.totalSupply) > 1 || Math.abs(sum('tax') - next.totalTax) > 1 ||
          Math.abs(sum('total') - next.totalAmount) > 1) {
        throw new HttpsError('invalid-argument', '품목 합계와 전표 합계가 일치하지 않습니다.');
      }
    }
    const settled = settlements.docs.reduce((total, row) => total + Number(row.get('amount') ?? 0), 0);
    if (settled > 0 && money(next.totalAmount) && next.totalAmount < settled) {
      throw new HttpsError('failed-precondition', `수정 후 전표 금액이 이미 수금한 ${settled.toLocaleString()}원보다 작습니다.`);
    }
    tx.update(statementRef, { ...patch, mutationRevision: revision + 1, editedAt: new Date().toISOString(), editedBy: claims.employeeId });
    if (approval && editRef) tx.update(editRef, { status: 'approved', approvalOperationId: operationId,
      approvedRequestHash: approval.pendingEditRequestHash, approvedAt: new Date().toISOString(), approvedBy: claims.employeeId });
    tx.create(operationRef, { ...(approval ?? {}), statementId, uid: request.auth!.uid, companyId: claims.companyId, requestHash, revision: revision + 1, action: 'edit-statement', createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return { status: 'applied', revision: revision + 1 };
  });
}
export const editIssuedStatementCommand = onCall({ region: 'asia-northeast3' }, async request =>
  editIssuedStatement(admin.firestore(), request));
