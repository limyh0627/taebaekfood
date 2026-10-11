import { readOemCostInvalidation, writeOemCostInvalidation } from './oemBatchCostInvalidation';
import { readPurchaseUnitSnapshot, validatePurchaseUnitRegistration, type ItemPurchaseUnit } from './shared/purchaseUnit';
import { isRawPurchaseItem } from './shared/purchaseCost';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { createHash } from 'crypto';
import { cashOriginalHash } from './cashMutationReceipt';
import { readPartnerAdvanceSnapshot, resolveSelectedAdvance } from './partnerAdvanceReader';
import { activeAdvanceApplications, sourceKey } from './shared/partnerAdvance';
import { readPartnerAdvanceWriteScope, prepareAdvanceCancellation, prepareAdvanceApplication, writePartnerAdvanceMutations } from './partnerAdvanceCommand';
import { kstDateOf } from './shared/calculation';

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
  if ('items' in patch) {
    try { patch.items.forEach((line: Record<string, any>) => readPurchaseUnitSnapshot(line)); }
    catch (error) { throw new HttpsError('invalid-argument', error instanceof Error ? error.message : '매입 단위 스냅샷이 잘못되었습니다.'); }
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
    if (old.noncashApplication) throw new HttpsError('failed-precondition', '적용 전표는 직접 수정할 수 없습니다. 적용 취소 후 다시 적용해 주세요. 취소 기록은 보존합니다.');
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
    const purchaseOrderUpdates: { ref: admin.firestore.DocumentReference; beforeItems: Record<string, any>[]; items: Record<string, any>[] }[] = [];
    if ('items' in patch || ('partnerId' in patch && patch.partnerId !== old.partnerId && (old.items ?? []).some((line:Record<string,any>)=>readPurchaseUnitSnapshot(line)))) {
      const oldLines: Record<string, any>[] = old.items ?? [], nextLines: Record<string, any>[] = next.items;
      const originalIndex = (line: Record<string, any>) => {
        if (line.sourceLineIndex !== undefined) {
          if (!Number.isSafeInteger(line.sourceLineIndex) || line.sourceLineIndex < 0
            || oldLines[line.sourceLineIndex]?.itemId !== line.itemId)
            throw new HttpsError('invalid-argument', '원전표 행 연결이 올바르지 않습니다.');
          return line.sourceLineIndex as number;
        }
        const indexes = oldLines.map((row,index)=>row.itemId===line.itemId?index:-1).filter(index=>index>=0);
        if (indexes.length !== 1) throw new HttpsError('failed-precondition', '원전표 원료 행을 확인해 주세요.');
        return indexes[0];
      };
      const changed = nextLines.filter((line,position) => {
        const snapshot = readPurchaseUnitSnapshot(line);
        if (!snapshot) return false;
        const index = originalIndex(line);
        if (line.sourceLineIndex !== index || position !== index)
          throw new HttpsError('failed-precondition', '매입 단위가 연결된 원전표 행의 순서는 유지해 주세요.');
        if (line.purchaseQuantityKg !== undefined && line.purchaseQuantityKg !== snapshot.inventoryQty)
          throw new HttpsError('invalid-argument', '매입 단위와 직접 입력한 원가 기준 kg가 다릅니다.');
        return hash(readPurchaseUnitSnapshot(oldLines[index])) !== hash(snapshot) || next.partnerId !== old.partnerId;
      });
      oldLines.forEach((previous,index)=> {
        if (!readPurchaseUnitSnapshot(previous)) return;
        const matching = nextLines[index];
        if (!matching || matching.itemId !== previous.itemId || matching.sourceLineIndex !== index
          || !readPurchaseUnitSnapshot(matching))
          throw new HttpsError('failed-precondition', '확정 매입 단위 행을 제거하려면 전표와 입고 연결을 취소한 뒤 다시 발행해 주세요.');
      });
      if (changed.length) {
        if (next.type !== '매입') throw new HttpsError('invalid-argument', '매입 단위는 원료 매입에서만 선택할 수 있습니다.');
        const [poRows, returnRows, unitRows, itemRows] = await Promise.all([
          tx.get(db.collection('purchaseOrders').where('linkedStatementId', '==', statementId)),
          tx.get(db.collection('returnRequests').where('linkedStatementId', '==', statementId)),
          Promise.all(changed.map(line => tx.get(db.collection('item_purchase_unit').doc(line.purchaseUnitId)))),
          Promise.all(changed.map(line => tx.get(db.collection('items').doc(line.itemId)))),
        ]);
        const pos = poRows.docs.filter(row => companyOf(row.data().companyId) === claims.companyId);
        for (let index = 0; index < changed.length; index++) {
          const line = changed[index], sourceIndex = originalIndex(line), previous = oldLines[sourceIndex];
          if (!previous) throw new HttpsError('failed-precondition', '새 원료 품목은 신규 전표 발행에서 선택해 주세요.');
          const snapshot = readPurchaseUnitSnapshot(line)!;
          const linked = pos.flatMap(po => {
            const rows = po.data().items ?? [{itemId:po.data().itemId, quantity:po.data().quantity}];
            return rows.filter((row: Record<string, any>) => row.itemId === line.itemId && (row.sourceLineIndex !== undefined ? row.sourceLineIndex === sourceIndex : oldLines.filter(entry=>entry.itemId===line.itemId).length===1)).map((row: Record<string, any>) => ({po,row,rows}));
          });
          if (linked.length > 1) throw new HttpsError('failed-precondition', '원료에 연결된 여러 발주를 먼저 확인해 주세요.');
          if (returnRows.docs.some(row => companyOf(row.data().companyId) === claims.companyId
            && row.data().items?.some((item: Record<string, any>) => item.itemId === line.itemId && (item.sourceLineIndex === undefined || item.sourceLineIndex === sourceIndex))))
            throw new HttpsError('failed-precondition', '반품이 연결된 원료의 매입 단위·수량은 변경할 수 없습니다. 연결된 반품 내역을 확인해 주세요.');
          if (linked.some(({po}) => !['pending','invoiced'].includes(po.data().status)))
            throw new HttpsError('failed-precondition', '이미 입고된 원료의 매입 단위·수량은 입고 취소 후 변경해 주세요.');
          if (!readPurchaseUnitSnapshot(previous) && linked.length !== 1)
            throw new HttpsError('failed-precondition', '기존 원료의 입고대기 발주 연결을 확인한 뒤 단위를 선택하거나 새로 발행해 주세요.');
          const item = itemRows[index], registration = unitRows[index];
          if (!item.exists || companyOf(item.data()!.companyId) !== claims.companyId || !isRawPurchaseItem(item.data()!))
            throw new HttpsError('failed-precondition', '등록된 원료 품목·매입 단위를 확인해 주세요.');
          const previousUnit = readPurchaseUnitSnapshot(previous);
          const sameSavedUnit = previousUnit && previousUnit.purchaseUnitId === snapshot.purchaseUnitId && previousUnit.purchaseUnit === snapshot.purchaseUnit && previousUnit.unitKg === snapshot.unitKg && next.partnerId === old.partnerId;
          if (!sameSavedUnit && !registration.exists) throw new HttpsError('failed-precondition', '등록된 매입 단위를 확인해 주세요.');
          try { if (!sameSavedUnit) validatePurchaseUnitRegistration(snapshot, {...registration.data(),id:registration.id} as ItemPurchaseUnit,
            {companyId:claims.companyId,itemId:line.itemId,partnerId:next.partnerId}); }
          catch (error) { throw new HttpsError('failed-precondition', error instanceof Error ? error.message : '매입 단위가 변경되었습니다.'); }
          if (linked.length) {
            const {po,row,rows}=linked[0];
            if (row.quantity !== previous.qty || hash(readPurchaseUnitSnapshot(row)) !== hash(readPurchaseUnitSnapshot(previous)))
              throw new HttpsError('failed-precondition', '기존 전표와 입고대기 발주의 수량·단위가 다릅니다.');
            let update = purchaseOrderUpdates.find(entry => entry.ref.path === po.ref.path);
            if (!update) { update={ref:po.ref,beforeItems:rows,items:rows.map((entry:Record<string,any>)=>({...entry}))}; purchaseOrderUpdates.push(update); }
            update.items = update.items.map(entry => entry.itemId === line.itemId && (entry.sourceLineIndex !== undefined ? entry.sourceLineIndex === sourceIndex : oldLines.filter(oldLine=>oldLine.itemId===line.itemId).length===1) ? {...entry,quantity:line.qty,sourceLineIndex:sourceIndex,...snapshot}:entry);
          }
        }
      }
    }
    const settled = settlements.docs.reduce((total, row) => total + Number(row.get('amount') ?? 0), 0);
    if (settled > 0 && money(next.totalAmount) && next.totalAmount < settled) {
      throw new HttpsError('failed-precondition', `수정 후 전표 금액이 이미 수금한 ${settled.toLocaleString()}원보다 작습니다.`);
    }
    const editedAt = new Date().toISOString();
    const after = { ...old, ...patch, mutationRevision: revision + 1, editedAt, editedBy: claims.employeeId };
    const editProof = { statementId, uid: request.auth!.uid, companyId: claims.companyId, kind: 'issuedStatements', status: 'applied',
      action: 'edit-statement', expectedRevision, revision: revision + 1, beforeSnapshot: old, beforeHash: cashOriginalHash(old), afterHash: cashOriginalHash(after) };
    const feeChanged = ['totalSupply','totalTax','totalAmount','partnerId','items'].some(key => key in patch && hash(patch[key]) !== hash(old[key]));
    const oemCostInvalidation = feeChanged ? await readOemCostInvalidation(db, tx, claims.companyId, statementId, 'fee-changed') : [];
    if (oemCostInvalidation.length + purchaseOrderUpdates.length + (approval ? 3 : 2) > 500) throw new HttpsError('failed-precondition', '연결된 원가 근거가 너무 많습니다.');
    const advanceSnapshot = old.partnerId ? await readPartnerAdvanceSnapshot(db, tx, claims.companyId, old.partnerId) : null;
    const affected = advanceSnapshot ? activeAdvanceApplications(advanceSnapshot.rows.issuedStatements as any, claims.companyId, old.partnerId)
      .filter(row => row.noncashApplication.kind === 'advance-application' && row.noncashApplication.allocations.some(allocation => allocation.statementId === statementId)) : [];
    const advanceDate = [kstDateOf(new Date()), next.tradeDate, ...affected.map(row => row.tradeDate)].filter((date): date is string => typeof date === 'string').sort().at(-1)!;
    const advanceScope = affected.length ? await readPartnerAdvanceWriteScope(db, tx, advanceSnapshot!, advanceDate, releaseId) : null;
    const advanceMutations = [];
    if (advanceScope) {
      const projected = { ...advanceSnapshot!, rows: Object.fromEntries(Object.entries(advanceSnapshot!.rows).map(([key, rows]) => [key, [...rows]])) as NonNullable<typeof advanceSnapshot>['rows'] };
      projected.rows.issuedStatements = projected.rows.issuedStatements.map(row => row.id === statementId ? { ...after, id: statementId } : row);
      for (const application of affected) {
        const canceled = await prepareAdvanceCancellation(db, tx, advanceSnapshot!, application.id, { operationId: 'edit-cancel-' + hash([operationId, application.id]), date: advanceDate, reason: '원전표 수정에 따른 적용 재계산', actorId: request.auth!.uid }, advanceScope);
        advanceMutations.push(canceled); projected.rows.issuedStatements.push(canceled.statement); projected.rows.partnerAdvanceOperations.push(canceled.operation);
      }
      for (const application of affected) {
        if (application.noncashApplication.kind !== 'advance-application') continue;
        for (const allocation of application.noncashApplication.allocations) {
          const internal = allocation.statementId === statementId ? { pendingTargetEdit: { beforeSnapshot: old, afterSnapshot: after, operation: editProof } } : undefined;
          const resolved = await resolveSelectedAdvance(db, tx, projected, allocation.source, allocation.statementId, internal);
          const source = resolved.context.sources[0], target = resolved.context.targets[0];
          const amount = Math.min(allocation.amount, source.originalAmount - (resolved.context.priorSourceUse.get(sourceKey(allocation.source)) ?? 0), target.remaining);
          if (amount <= 0) continue;
          const reapplied = await prepareAdvanceApplication(db, tx, projected, advanceScope, request.auth!.uid, {
            operationId: 'edit-reapply-' + hash([operationId, application.id, sourceKey(allocation.source), allocation.statementId]), date: advanceDate,
            partnerId: old.partnerId, source: allocation.source, statementId: allocation.statementId, accountCode: allocation.accountCode, amount,
            expectedRevision: advanceScope.revision, releaseId, expectedSourceFingerprint: resolved.sourceFingerprint, expectedTargetFingerprint: resolved.targetFingerprint,
          }, internal);
          advanceMutations.push(reapplied); projected.rows.issuedStatements.push(reapplied.statement); projected.rows.partnerAdvanceOperations.push(reapplied.operation);
        }
      }
      if (advanceMutations.length * 2 + oemCostInvalidation.length + purchaseOrderUpdates.length + (approval ? 5 : 4) > 500) throw new HttpsError('failed-precondition', '연결된 적용 내역이 너무 많습니다.');
      writePartnerAdvanceMutations(tx, advanceSnapshot!, advanceScope, advanceMutations);
    }
    writeOemCostInvalidation(tx, oemCostInvalidation);
    for (const update of purchaseOrderUpdates) tx.update(update.ref,{items:update.items,...(next.partnerId !== old.partnerId ? {partnerId:next.partnerId,partnerName:next.partnerName}: {})});
    tx.update(statementRef, { ...patch, mutationRevision: revision + 1, editedAt, editedBy: claims.employeeId });
    if (approval && editRef) tx.update(editRef, { status: 'approved', approvalOperationId: operationId,
      approvedRequestHash: approval.pendingEditRequestHash, approvedAt: new Date().toISOString(), approvedBy: claims.employeeId });
    tx.create(operationRef, { ...(approval ?? {}), statementId, uid: request.auth!.uid, companyId: claims.companyId, requestHash, revision: revision + 1, action: 'edit-statement',
      kind: 'issuedStatements', status: 'applied', expectedRevision, beforeSnapshot: old, beforeHash: cashOriginalHash(old), afterHash: cashOriginalHash(after), advanceStatementIds: advanceMutations.map(row => row.statement.id), purchaseOrderUpdates: purchaseOrderUpdates.map(row=>({id:row.ref.id,beforeItems:row.beforeItems,items:row.items})), createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return { status: 'applied', revision: revision + 1 };
  });
}
export const editIssuedStatementCommand = onCall({ region: 'asia-northeast3' }, async request =>
  editIssuedStatement(admin.firestore(), request));
