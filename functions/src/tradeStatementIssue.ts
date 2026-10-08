import { costFromPurchaseLine } from './shared/purchaseCost';
import { readStatementDeletion } from './deleteIssuedStatementCommand';
import { readVoucherCounter, writeVoucherCounter } from './newScopeCounter';
import * as admin from 'firebase-admin';
import { createHash } from 'crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { formatVoucherNo, voucherSequenceKey } from './voucherIssue';
import { assertReleaseActive, assertVoucherDateAllowed, releaseGateRef } from './releaseGate';

type Row = Record<string, any>;
type Cost = { itemId: string; price: number; beforeCost: number; sourceLineIndex: number };
type Input = {
  operationId: string;
  statement: Row;
  orderIds: string[];
  poIds: string[];
  newPo?: { id: string; cardNo: string; items: Row[] };
  costUpdates: Cost[];
  releaseId: string;
};

const bad = (message: string): never => { throw new HttpsError('invalid-argument', message); };
const conflict = (message: string): never => { throw new HttpsError('failed-precondition', message); };
const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
const purchaseCost = (line: Row) => costFromPurchaseLine(line, 'supply-first');
const oldCompany = (row: Row) => row.companyId ?? 'taebaek';
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value as Row).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
    : value;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const uniqueIds = (ids: unknown): ids is string[] => Array.isArray(ids)
  && ids.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(id))
  && new Set(ids).size === ids.length;
const statementBusiness = (row: Row) => {
  const { docNo: _no, id: _id, issuedAt: _time, createdBy: _by,
    issueOperationId: _op, issuePayloadHash: _requestHash,
    issueStatementHash: _businessHash, issueVoucherNo: _voucherNo, issuePrefix: _prefix, ...business } = row;
  return business;
};

/** The voucher, counter, order flags, purchase-order links and cost history commit together. */
export async function issueTradeStatement(db: admin.firestore.Firestore, companyId: string, actorId: string, input: Input) {
  if (!input || typeof input !== 'object') bad('전표 요청이 잘못되었습니다.');
  if (!actorId) bad('인증 사용자 ID가 필요합니다.');
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId)) bad('배포 전환 ID가 필요합니다.');
  const { operationId, statement: supplied, orderIds, poIds, newPo, costUpdates } = input;
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) bad('전표 본문이 잘못되었습니다.');
  const raw = supplied as Row;
  if (typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(raw.id)
    || operationId !== `${raw.id}:ISSUE`) bad('전표 작업 ID가 잘못되었습니다.');
  const date = raw.tradeDate;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) bad('거래일이 잘못되었습니다.');
  if (raw.companyId !== undefined && raw.companyId !== companyId) bad('전표 회사가 일치하지 않습니다.');
  if (raw.type !== '매출' && raw.type !== '매입') bad('일반 전표 종류가 잘못되었습니다.');
  if (typeof raw.partnerId !== 'string' || !raw.partnerId) bad('거래처가 필요합니다.');
  if (!uniqueIds(orderIds) || !uniqueIds(poIds)) bad('주문 또는 발주 연결이 잘못되었습니다.');
  if (raw.type !== '매입' && (poIds.length || newPo)) bad('매출 전표에는 발주카드를 연결할 수 없습니다.');
  if (poIds.length && newPo) bad('기존 발주 연결과 신규 발주 생성은 함께 할 수 없습니다.');
  if (newPo && (typeof newPo.id !== 'string' || newPo.id !== `po-${raw.id}`
    || typeof newPo.cardNo !== 'string' || !/^PO-\d{6}-\d{3,}$/.test(newPo.cardNo)
    || !Array.isArray(newPo.items) || !newPo.items.length)) bad('신규 발주카드가 잘못되었습니다.');
  if (!Array.isArray(raw.items) || !raw.items.length || raw.items.some((line: Row) => {
    if (!line || typeof line !== 'object' || !line.accountCode || !finite(line.qty)
      || !line.qty || !finite(line.price) || !line.price || !finite(line.supply)
      || !finite(line.tax) || !finite(line.total)) return true;
    const gross = Math.round(line.qty * line.price);
    const supply = line.isTaxExempt ? gross : Math.round(gross / 1.1);
    return line.total !== gross || line.supply !== supply || line.tax !== gross - supply;
  })) bad('전표 줄이 잘못되었습니다.');
  if (newPo && newPo.items.some(item => !item || typeof item.itemId !== 'string'
    || !raw.items.some((line: Row) => line.itemId === item.itemId && line.qty === item.quantity)
    || !finite(item.quantity) || item.quantity <= 0 || item.isBox !== false)) bad('신규 발주 품목이 전표와 일치하지 않습니다.');
  const sums = raw.items.reduce((a: number[], line: Row) => [a[0] + line.supply, a[1] + line.tax, a[2] + line.total], [0, 0, 0]);
  if (!finite(raw.totalSupply) || !finite(raw.totalTax) || !finite(raw.totalAmount)
    || raw.totalAmount <= 0 || sums.some((n: number, i: number) => Math.round(n * 100) !== Math.round([raw.totalSupply, raw.totalTax, raw.totalAmount][i] * 100))) bad('전표 합계가 일치하지 않습니다.');
  if (raw.orderId !== orderIds.join(',')) bad('전표와 주문 연결이 일치하지 않습니다.');
  if (!Array.isArray(costUpdates) || (raw.type !== '매입' && costUpdates.length)) bad('원가 갱신이 잘못되었습니다.');
  for (const cost of costUpdates) {
    const line = raw.items[cost.sourceLineIndex];
    if (!line || line.itemId !== cost.itemId || !finite(cost.price) || !finite(cost.beforeCost)
      || !raw.items.some((candidate: Row) => candidate.itemId === cost.itemId && purchaseCost(candidate) === cost.price)) {
      bad('전표 줄과 원가가 일치하지 않습니다.');
    }
  }
  const semantic = statementBusiness(raw);
  const statementHash = hash({ ...semantic, companyId });
  const payloadHash = hash({ statement: semantic, orderIds, poIds,
    newPo: newPo ? { id: newPo.id, items: newPo.items } : undefined, costUpdates });
  const statementRef = db.collection('issuedStatements').doc(raw.id);
  const otherKindRef = db.collection('cashEntries').doc(raw.id);
  const counterRef = db.collection('appMeta').doc(voucherSequenceKey(companyId, date, ''));
  const catchUpCounterRef = db.collection('appMeta').doc(voucherSequenceKey(companyId, date, '추가'));
  const partnerRef = db.collection('partners').doc(raw.partnerId);
  const orderRefs = orderIds.map(id => db.collection('orders').doc(id));
  const poRefs = poIds.map(id => db.collection('purchaseOrders').doc(id));
  const newPoRef = newPo ? db.collection('purchaseOrders').doc(newPo.id) : null;
  const costRefs = costUpdates.map(c => db.collection('items').doc(c.itemId));
  const newPoItemRefs = newPo ? [...new Set(newPo.items.map(item => item.itemId as string))]
    .map(id => db.collection('items').doc(id)) : [];
  const historyRefs = costUpdates.filter(c => c.beforeCost !== c.price)
    .map(c => db.collection('itemCostHistory').doc(`${raw.id}_${c.itemId}_${c.sourceLineIndex}`));
  const cardNoQuery = newPo ? db.collection('purchaseOrders').where('cardNo', '==', newPo.cardNo) : null;
  const poNumberRef = (cardNo: string) => db.collection('appMeta').doc(`poCardNo_${companyId}_${cardNo}`);
  const poReservationRef = newPo ? poNumberRef(newPo.cardNo) : null;
  const accountCodesQuery = db.collection('accountCodes');
  // invoicePrinted는 송장 출력 상태다. 전표 중복은 실제 연결 기록으로 판정한다.
  const partnerStatementsQuery = db.collection('issuedStatements').where('partnerId', '==', raw.partnerId);
  const releaseGate = releaseGateRef(db);
  return db.runTransaction(async tx => {
    const recordedAt = new Date().toISOString();
    const [existing, otherKind, normalSequence, catchUpSequence, partner, orders, pos, freshPo, items, poItems, histories, cardNos, poReservation, codes, partnerStatements, releaseSnap] = await Promise.all([
      tx.get(statementRef), tx.get(otherKindRef), tx.get(counterRef), tx.get(catchUpCounterRef), tx.get(partnerRef),
      Promise.all(orderRefs.map(ref => tx.get(ref))), Promise.all(poRefs.map(ref => tx.get(ref))),
      newPoRef ? tx.get(newPoRef) : Promise.resolve(null), Promise.all(costRefs.map(ref => tx.get(ref))),
      Promise.all(newPoItemRefs.map(ref => tx.get(ref))), Promise.all(historyRefs.map(ref => tx.get(ref))),
      cardNoQuery ? tx.get(cardNoQuery) : Promise.resolve(null),
      poReservationRef ? tx.get(poReservationRef) : Promise.resolve(null),
      tx.get(accountCodesQuery),
      tx.get(partnerStatementsQuery),
      tx.get(releaseGate),
    ]);
    assertReleaseActive(releaseSnap, input.releaseId);
    const mode = assertVoucherDateAllowed(releaseSnap, companyId, date, true);
    const effectivePrefix = mode === 'catchUp' ? '추가' : '';
    const sequence = mode === 'catchUp' ? catchUpSequence : normalSequence;
    if (otherKind.exists) conflict('작업 ID가 자금전표에 사용되었습니다.');
    const deleted = await readStatementDeletion(db, tx, companyId, raw.id, existing, row =>
      row.issueOperationId === operationId && (row.issuePrefix ?? '') === effectivePrefix
      && row.issuePayloadHash === payloadHash && row.issueStatementHash === statementHash
      && typeof row.docNo === 'string' && !!row.docNo && row.issueVoucherNo === row.docNo);
    if (deleted) return { status: 'duplicate' as const, id: raw.id, docNo: deleted.docNo as string };
    if (existing.exists) {
      const saved = existing.data()!;
      if (saved.companyId !== companyId || saved.issueOperationId !== operationId
        || (saved.issuePrefix ?? '') !== effectivePrefix
        || saved.issuePayloadHash !== payloadHash || saved.issueStatementHash !== statementHash
        || hash(statementBusiness(saved)) !== statementHash
        || typeof saved.docNo !== 'string' || saved.docNo !== saved.issueVoucherNo) conflict('기존 전표와 재시도 내용이 다릅니다.');
      if (orders.some(snap => !snap.exists || oldCompany(snap.data()!) !== companyId
        || snap.data()!.partnerId !== raw.partnerId
        || (snap.data()!.linkedStatementId && snap.data()!.linkedStatementId !== raw.id))) {
        conflict('기존 전표의 주문 연결이 변경되었습니다.');
      }
      if (pos.some(snap => !snap.exists || oldCompany(snap.data()!) !== companyId
        || snap.data()!.linkedStatementId !== raw.id)
        || (newPo && (!freshPo?.exists || oldCompany(freshPo.data()!) !== companyId
          || freshPo.data()!.linkedStatementId !== raw.id
          || hash(freshPo.data()!.items) !== hash(newPo.items)))) {
        conflict('기존 전표의 발주 연결이 변경되었습니다.');
      }
      if (newPo) {
        const savedCardNo = freshPo!.data()!.cardNo;
        if (typeof savedCardNo !== 'string') conflict('기존 발주카드 번호가 없습니다.');
        const savedReservation = savedCardNo === newPo.cardNo ? poReservation : await tx.get(poNumberRef(savedCardNo));
        if (!savedReservation?.exists || savedReservation.data()!.statementId !== raw.id
          || savedReservation.data()!.poId !== newPo.id) conflict('기존 발주카드 번호 예약이 변경되었습니다.');
      }
      const historyCosts = costUpdates.filter(c => c.beforeCost !== c.price);
      if (histories.some((snap, i) => !snap.exists || snap.data()!.sourceStatementId !== raw.id
        || snap.data()!.itemId !== historyCosts[i].itemId
        || snap.data()!.beforeCost !== historyCosts[i].beforeCost
        || snap.data()!.afterCost !== historyCosts[i].price)) {
        conflict('기존 전표의 원가 이력이 변경되었습니다.');
      }
      return { status: 'duplicate' as const, id: raw.id, docNo: saved.docNo };
    }
    const allowedCodes = new Set(codes.docs.filter(snap => oldCompany(snap.data()) === companyId).map(snap => snap.data().code));
    if (raw.items.some((line: Row) => !allowedCodes.has(line.accountCode))) conflict('회사 계정과목이 일치하지 않습니다.');
    if (!partner.exists || oldCompany(partner.data()!) !== companyId) conflict('거래처 회사가 일치하지 않습니다.');
    const linkedOrderIds = new Set(partnerStatements.docs
      .filter(snap => snap.id !== raw.id && oldCompany(snap.data()) === companyId)
      .flatMap(snap => String(snap.data().orderId ?? '').split(/[\s,]+/).filter(Boolean)));
    orders.forEach((snap, i) => {
      if (!snap.exists || oldCompany(snap.data()!) !== companyId
        || snap.data()!.partnerId !== raw.partnerId || snap.data()!.linkedStatementId
        || linkedOrderIds.has(orderIds[i])) conflict(`주문 ${orderIds[i]}에 이미 연결된 전표가 있습니다.`);
    });
    pos.forEach((snap, i) => {
      if (!snap.exists || oldCompany(snap.data()!) !== companyId
        || snap.data()!.partnerId !== raw.partnerId || snap.data()!.linkedStatementId
        || !['pending', 'received'].includes(snap.data()!.status)) conflict(`발주카드 ${poIds[i]} 상태가 변경되었습니다.`);
    });
    if (freshPo?.exists) conflict('신규 발주카드 ID가 이미 사용되었습니다.');
    if (cardNos?.docs.some(snap => oldCompany(snap.data()) === companyId)) conflict('발주카드 번호가 이미 사용되었습니다.');
    if (poReservation?.exists) conflict('발주카드 번호가 이미 예약되었습니다.');
    poItems.forEach(snap => {
      if (!snap.exists || oldCompany(snap.data()!) !== companyId || snap.data()!.type === 'service') {
        conflict('발주 품목이 변경되었습니다.');
      }
      if (newPo?.items.some(item => item.itemId === snap.id
        && (item.itemName !== snap.data()!.name || item.unit !== (snap.data()!.unit || '개')))) conflict('발주 품목 이름 또는 단위가 변경되었습니다.');
    });
    items.forEach((snap, i) => {
      if (!snap.exists || oldCompany(snap.data()!) !== companyId
        || Number(snap.data()!.cost ?? 0) !== costUpdates[i].beforeCost
        || snap.data()!.type === 'service') conflict(`품목 ${costUpdates[i].itemId} 원가가 변경되었습니다.`);
    });
    const state = await readVoucherCounter(db, tx, sequence, releaseSnap, companyId, date, effectivePrefix);
    if (state.companyId !== companyId || state.tradeDate !== date || state.prefix !== effectivePrefix
      || !Number.isSafeInteger(state.last) || state.last < 0 || !Number.isSafeInteger(state.last + 1)) conflict('전표 번호 카운터가 손상되었습니다.');
    const docNo = formatVoucherNo(date, state.last + 1, effectivePrefix);
    writeVoucherCounter(tx, sequence, state, state.last + 1);
    tx.create(statementRef, { ...raw, companyId, docNo, issueOperationId: operationId,
      issuePayloadHash: payloadHash, issueStatementHash: statementHash, issueVoucherNo: docNo, issuePrefix: effectivePrefix });
    orderRefs.forEach(ref => tx.update(ref, { linkedStatementId: raw.id, linkedStatementAt: recordedAt }));
    poRefs.forEach((ref, i) => tx.update(ref, pos[i].data()!.status === 'received'
      ? { linkedStatementId: raw.id, linkedStatementAt: recordedAt }
      : { linkedStatementId: raw.id, status: 'invoiced', invoicedAt: recordedAt }));
    if (newPoRef && newPo) tx.create(newPoRef, {
      cardNo: newPo.cardNo, itemId: '', itemName: '', quantity: 0,
      partnerId: raw.partnerId, partnerName: raw.partnerName,
      items: newPo.items, status: 'invoiced', invoicedAt: recordedAt,
      createdAt: recordedAt, linkedStatementId: raw.id, companyId,
    });
    if (poReservationRef && newPo) tx.create(poReservationRef, { companyId, cardNo: newPo.cardNo, statementId: raw.id, poId: newPo.id });
    costUpdates.forEach((cost, i) => {
      tx.update(costRefs[i], { cost: cost.price });
      if (cost.beforeCost !== cost.price) tx.set(db.collection('itemCostHistory').doc(`${raw.id}_${cost.itemId}_${cost.sourceLineIndex}`), {
        companyId, itemId: cost.itemId, beforeCost: cost.beforeCost, afterCost: cost.price,
        effectiveAt: date, recordedAt, actorId,
        sourceStatementId: raw.id, sourceLineIndex: cost.sourceLineIndex,
      });
    });
    return { status: 'applied' as const, id: raw.id, docNo };
  });
}

export const issueTradeStatementCommand = onCall({ region: 'asia-northeast3' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const companyId = request.auth.token.companyId;
  if (!request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe')) {
    throw new HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
  }
  try {
    return await issueTradeStatement(admin.firestore(), companyId, request.auth.uid, request.data as Input);
  } catch (error) {
    // 업무 내용과 고객 정보는 남기지 않고, 운영에서 어떤 검증이 거절했는지만 확인한다.
    console.warn('trade statement issue rejected', {
      code: error instanceof HttpsError ? error.code : 'internal',
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});
