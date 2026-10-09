import { readClaimsAfterReturns } from './returnClaimReader';
import { ReturnValidationError } from './returnValidationError';
import * as admin from 'firebase-admin';
import { readVoucherCounter, writeVoucherCounter } from './newScopeCounter';
import { createHash } from 'crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { formatVoucherNo, voucherSequenceKey } from './voucherIssue';
import { planReturnReversal, planStandaloneReturn, type ReturnRow, type Source } from './returnReversalPlan';
import { planGeneralReturnReceipt, planGeneralReturnIssue, type Item } from './returnGeneralStockPlan';
import { planUnitReturnReceipt, planUnitReturnIssue } from './returnUnitStockPlan';
import { unpackStockComponent, stockUnitKg } from './shared/stockUnitMeasure';
import { prepareReturnRawStock, writeReturnRawStock } from './returnRawStockPlan';
import type { RawInventoryState } from './shared/rawInventoryCore';
import { returnStockKind } from './shared/returnStockKind';
import { cashFromEntry, claimFromStatement } from './partnerPaymentCommand';
import { openClaimBalances, PartnerPaymentValidationError, type ReturnApplication } from './partnerPaymentPlan';
import { planReturnAllocation } from './returnAllocationPlan';
import { assertReleaseActive, assertVoucherDateAllowed, releaseGateRef } from './releaseGate';
import { partnerQuarantined } from './partnerCutover';
import { readPartnerAdvanceSnapshot, resolveSelectedAdvance, advanceClaims } from './partnerAdvanceReader';
import { activeAdvanceApplications, sourceKey } from './shared/partnerAdvance';
import { readPartnerAdvanceWriteScope, prepareAdvanceCancellation, prepareAdvanceApplication, writePartnerAdvanceMutations } from './partnerAdvanceCommand';
import { kstDateOf } from './shared/calculation';

type Row = Record<string, any>;
type Input = { operationId: string; returnRequestId: string; tradeDate: string;
  expectedPartnerRevision: number; releaseId: string };
const fail = (message: string): never => { throw new HttpsError('failed-precondition', message); };
const bad = (message: string): never => { throw new HttpsError('invalid-argument', message); };
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  && !Number.isNaN(new Date(`${date}T00:00:00Z`).valueOf())
  && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value as Row).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, canonical(v)])) : value;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

/** 반품 역분개·정산과 품목별 재고/로트를 한 거래로 저장한다. 회사별 전환 설정은 별도 확인한다. */
export async function processGeneralStockReturn(
  db: admin.firestore.Firestore, companyId: string, actorId: string, input: Input,
) {
  if (!actorId || !input || typeof input !== 'object') bad('반품 요청이 잘못되었습니다.');
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(input.operationId) || !/^[A-Za-z0-9_-]{1,150}$/.test(input.returnRequestId)
    || !/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId)
    || !validDate(input.tradeDate) || !Number.isSafeInteger(input.expectedPartnerRevision)
    || input.expectedPartnerRevision < 0) bad('반품 작업 입력이 잘못되었습니다.');
  const requestHash = hash(input);
  const operation = db.collection('returnOperations').doc(input.operationId);
  const returnRef = db.collection('returnRequests').doc(input.returnRequestId);
  const journal = db.collection('issuedStatements').doc(`return-${input.operationId}`);
  const appRef = db.collection('returnApplications').doc(`return-${input.operationId}`);
  const counter = db.collection('appMeta').doc(voucherSequenceKey(companyId, input.tradeDate, '반품'));
  const cutover = db.collection('appMeta').doc(`returnCutover_${companyId}`);
  const paymentCutover = db.collection('appMeta').doc(`partnerPaymentCutover_${companyId}`);
  const releaseGate = releaseGateRef(db);
  const outcome = await db.runTransaction(async tx => {
    const opSnap = await tx.get(operation);
    const outputRows = await Promise.all([
      tx.get(db.collection('issuedStatements').where('returnOperationId', '==', input.operationId)),
      tx.get(db.collection('returnApplications').where('operationId', '==', input.operationId)),
      tx.get(db.collection('itemReceipts').where('returnOperationId', '==', input.operationId)),
      tx.get(db.collection('rawMaterialLedger').where('returnOperationId', '==', input.operationId)),
    ]);
    const journalOutput = await tx.get(journal), applicationOutput = await tx.get(appRef);
    const outputsAbsent = !journalOutput.exists && !applicationOutput.exists && outputRows.every(rows => rows.empty);
    if (opSnap.exists && opSnap.data()?.status === 'rejected') {
      const prior = opSnap.data()!;
      if (prior.companyId !== companyId || prior.createdBy !== actorId
        || prior.operationId !== input.operationId || prior.returnRequestId !== input.returnRequestId
        || prior.requestHash !== requestHash || hash(prior.command) !== requestHash
        || !['invalid-argument', 'failed-precondition'].includes(prior.failureCode)
        || typeof prior.failureMessage !== 'string' || !prior.failureMessage || !outputsAbsent)
        fail('기존 반품 거절 감사와 요청이 다릅니다.');
      return { status: 'rejected' as const, failureCode: prior.failureCode as 'invalid-argument' | 'failed-precondition', failureMessage: prior.failureMessage as string };
    }
    let writesStarted = false;
    try {
    const requestSnap = await tx.get(returnRef);
    const journalSnap = await tx.get(journal);
    const appSnap = await tx.get(appRef);
    const counterSnap = await tx.get(counter);
    const cutoverSnap = await tx.get(cutover);
    const paymentCutoverSnap = await tx.get(paymentCutover);
    const releaseSnap = await tx.get(releaseGate);
    assertReleaseActive(releaseSnap, input.releaseId);
    assertVoucherDateAllowed(releaseSnap, companyId, input.tradeDate);
    if (!requestSnap.exists || requestSnap.data()?.companyId !== companyId) fail('반품 요청의 회사가 맞지 않습니다.');
    const request = requestSnap.data()!;
    if (request.cancelledAt !== undefined || request.cancelledBy !== undefined || request.cancellationReceipt !== undefined)
      fail('취소된 반품 접수는 처리할 수 없습니다.');
    const standalone = !request.linkedStatementId;
    if (!request.partnerId || !Array.isArray(request.items) || (standalone && !['매출','매입'].includes(request.returnType)))
      fail('반품 원전표·거래처·품목 연결이 없습니다.');
    const businessHash = hash({ companyId: request.companyId, linkedStatementId: request.linkedStatementId,
      partnerId: request.partnerId, returnType: request.returnType ?? null,
      totalAmount: request.totalAmount, items: request.items, ...(standalone && {payableAccountCode:request.payableAccountCode ?? null}) });
    const sourceRef = standalone ? null : db.collection('issuedStatements').doc(request.linkedStatementId);
    const partnerRef = db.collection('partners').doc(request.partnerId);
    const stateRef = db.collection('appMeta').doc(`partnerPaymentState_${companyId}_${request.partnerId}`);
    const sourceSnap = sourceRef ? await tx.get(sourceRef) : null;
    const partnerSnap = await tx.get(partnerRef);
    const stateSnap = await tx.get(stateRef);
    const priorReturns = sourceRef ? await tx.get(db.collection('returnRequests').where('linkedStatementId', '==', request.linkedStatementId)) : {docs:[]};
    const statementRows = await tx.get(db.collection('issuedStatements').where('partnerId', '==', request.partnerId));
    const cashRows = await tx.get(db.collection('cashEntries').where('partnerId', '==', request.partnerId));
    const settlementRows = await tx.get(db.collection('settlements'));
    const priorApplications = await tx.get(db.collection('returnApplications').where('partnerId', '==', request.partnerId));
    const itemRows = await tx.get(db.collection('items'));
    const bomRows = await tx.get(db.collection('item_bom'));
    const accountCodes = await tx.get(db.collection('accountCodes'));
    if (opSnap.exists) {
      const prior = opSnap.data()!, saved = journalSnap.data();
      const expectedApps: { id: string; statementId: string; amount: number; applicationHash?: string }[] =
        prior.applications ?? [{ id: appRef.id, statementId: request.linkedStatementId, amount: prior.amount }];
      const storedApps: admin.firestore.DocumentSnapshot[] = [];
      for (const row of expectedApps) storedApps.push(await tx.get(db.collection('returnApplications').doc(row.id)));
      if (prior.companyId !== companyId || prior.requestHash !== requestHash
        || prior.businessHash !== businessHash
        || request.status !== 'processed' || request.returnJournalId !== journal.id
        || request.returnApplicationId !== appRef.id
        || !journalSnap.exists || saved?.docNo !== prior.docNo
        || saved?.returnOperationId !== input.operationId || hash(saved) !== prior.journalHash
        || expectedApps.length === 0 || expectedApps.reduce((sum, row) => sum + row.amount, 0) !== prior.amount
        || storedApps.some((snap, index) => !snap.exists || snap.data()?.companyId !== companyId
          || snap.data()?.partnerId !== request.partnerId || snap.data()?.statementId !== expectedApps[index].statementId
          || snap.data()?.amount !== expectedApps[index].amount || snap.data()?.operationId !== input.operationId
          || (expectedApps[index].applicationHash && hash(snap.data()) !== expectedApps[index].applicationHash)))
        fail('기존 반품 작업과 요청이 다릅니다.');
      for (const expected of prior.receipts ?? []) {
        const receipt = await tx.get(db.collection('itemReceipts').doc(expected.id));
        if (!receipt.exists || receipt.data()?.returnOperationId !== input.operationId
          || receipt.data()?.returnReceiptFingerprint !== expected.fingerprint
          || receipt.data()?.companyId !== companyId || receipt.data()?.itemId !== expected.itemId
          || receipt.data()?.quantity !== expected.quantity
          || hash(receipt.data()) !== expected.receiptHash) fail('기존 반품 입고와 요청이 다릅니다.');
      }
      const rawMovements: Row[] = prior.rawMovements ?? [];
      if (!Array.isArray(rawMovements) || (rawMovements.length && hash(rawMovements) !== prior.rawMovementsHash))
        fail('기존 원료 반품 근거가 변경되었습니다.');
      for (const expected of rawMovements) {
        if (typeof expected.id !== 'string' || expected.id.includes('/')) fail('기존 원료 반품 ID가 잘못되었습니다.');
        const movement = await tx.get(db.collection('rawMaterialLedger').doc(expected.id));
        if (!movement.exists || movement.data()?.companyId !== companyId
          || movement.data()?.returnOperationId !== input.operationId
          || hash(movement.data()) !== expected.movementHash) fail('기존 원료 반품 이력이 변경되었습니다.');
      }
      if ((sourceSnap?.data()?.type ?? request.returnType) === '매입') {
        const physicalRows = [...(prior.stockMovements ?? []), ...rawMovements.map(row => ({ ...row, itemId: row.requestItemId }))];
        if (!Array.isArray(prior.stockMovements) || physicalRows.length !== request.items.length
          || hash(prior.stockMovements) !== prior.stockMovementsHash
          || new Set(physicalRows.map(row => row.itemId)).size !== request.items.length
          || physicalRows.some((row: Row) => row.companyId !== companyId
            || row.partnerId !== request.partnerId || row.operationId !== input.operationId
            || row.quantityDelta !== -request.items.find((item: Row) => item.itemId === row.itemId)?.quantity
            || row.date !== input.tradeDate)) fail('기존 반품 출고 근거가 변경되었습니다.');
      }
      return { status: 'duplicate' as const, docNo: prior.docNo, journalId: journal.id };
    }
    if (journalSnap.exists || appSnap.exists) fail('반품 작업 ID가 이미 사용 중입니다.');
    if ((!standalone && (!sourceSnap?.exists || sourceSnap.data()?.companyId !== companyId || !['매출', '매입'].includes(sourceSnap.data()?.type)))
      || !partnerSnap.exists || partnerSnap.data()?.companyId !== companyId)
      fail('반품 원전표·거래처가 맞지 않습니다.');
    for (const gateSnap of [cutoverSnap, paymentCutoverSnap]) {
      const gate = gateSnap.data();
      if (!gateSnap.exists || gate?.companyId !== companyId || gate?.enabled !== true
        || gate?.legacyWritersBlocked !== true || gate?.auditPassed !== true)
        fail('반품·지급 writer 전환이 준비되지 않았습니다.');
      if (partnerQuarantined(gate, request.partnerId)) fail('이 거래처는 과거 정산 내역 확인 후 반품 처리할 수 있습니다.');
    }
    const sequence = await readVoucherCounter(db, tx, counterSnap, releaseSnap, companyId, input.tradeDate, '반품');
    if (sequence?.companyId !== companyId || sequence?.tradeDate !== input.tradeDate
      || sequence?.prefix !== '반품' || !Number.isSafeInteger(sequence?.last) || sequence.last < 0
      || !Number.isSafeInteger(sequence.last + 1)) fail('반품 전표 번호 카운터가 준비되지 않았습니다.');
    const revision = stateSnap.exists ? stateSnap.data()?.revision : 0;
    if (!Number.isSafeInteger(revision) || revision !== input.expectedPartnerRevision)
      fail('거래처 정산 상태가 변경되었습니다.');
    const source = sourceSnap?.data();
    const purchase = (source?.type ?? request.returnType) === '매입';
    if (purchase && cutoverSnap.data()?.purchaseGeneralStockEnabled !== true)
      fail('매입 반품 원장 연결이 준비되지 않았습니다.');
    const direction = purchase ? '출금' as const : '입금' as const;
    const oldReturns = priorReturns.docs.map(doc => ({ ...doc.data(), id: doc.id } as ReturnRow));
    if (standalone && request.status !== 'pending') fail('처리 대기 반품만 새로 확정할 수 있습니다.');
    if (standalone && request.items.some((item:Row) => !itemRows.docs.some(doc => doc.id === item.itemId && (doc.data().companyId ?? 'taebaek') === companyId))) fail('반품 품목의 회사·원문을 확인해주세요.');
    if (standalone && request.items.some((item:Row) => ['108','251','253','135','255'].includes(item.accountCode))) fail('반품 품목 계정과 채권·채무·세금 계정은 구분해주세요.');
    const plan = standalone ? planStandaloneReturn(request as Parameters<typeof planStandaloneReturn>[0]) : planReturnReversal(companyId,
      { ...request, id: requestSnap.id } as ReturnRow, { ...source, id: sourceSnap!.id } as Source, oldReturns);
    const stockItemCount = purchase ? request.items.length
      : request.items.filter((item: Row) => item.isResellable).length;
    if (plan.stockEffects.length !== stockItemCount
      || plan.stockEffects.some(effect => purchase ? effect.quantityDelta >= 0 : effect.quantityDelta <= 0))
      fail('일반 재고로 복귀하는 매출 반품만 지원합니다.');
    const sourceClaim = sourceSnap && source ? claimFromStatement(sourceSnap.id, source) : null;
    const sourceAccountCode = standalone ? (purchase ? request.payableAccountCode : '108') : sourceClaim?.accountCode;
    if (!sourceAccountCode || (purchase ? !['251', '253'].includes(sourceAccountCode) : sourceAccountCode !== '108'))
      fail('원전표 채권 계정이 명확하지 않습니다.');
    if (purchase && !plan.journalLines.some(line => line.accountCode === sourceAccountCode
      && line.side === '차변' && line.amount === plan.amount)) fail('매입 반품 채무 계정이 일치하지 않습니다.');
    const existingApps = priorApplications.docs.filter(doc => (doc.data().companyId ?? 'taebaek') === companyId)
      .map(doc => ({ id: doc.id, ...doc.data(), companyId: doc.data().companyId ?? 'taebaek' } as ReturnApplication));
    const claims = statementRows.docs.filter(doc => (doc.data().companyId ?? 'taebaek') === companyId)
      .map(doc => claimFromStatement(doc.id, doc.data())).filter((row): row is NonNullable<typeof row> => row !== null);
    const advanceSnapshot = await readPartnerAdvanceSnapshot(db, tx, companyId as 'taebaek' | 'punghoe', request.partnerId);
    const affectedAdvances = activeAdvanceApplications(advanceSnapshot.rows.issuedStatements as any, companyId as 'taebaek' | 'punghoe', request.partnerId)
      .filter(row => row.noncashApplication.kind === 'advance-application' && row.noncashApplication.allocations.some(allocation => allocation.accountCode === sourceAccountCode));
    const advanceDate = [kstDateOf(new Date()), input.tradeDate, ...affectedAdvances.map(row => row.tradeDate)].sort().at(-1)!;
    const advanceScope = affectedAdvances.length ? await readPartnerAdvanceWriteScope(db, tx, advanceSnapshot, advanceDate, input.releaseId, revision) : null;
    const projectedAdvance = { ...advanceSnapshot, rows: Object.fromEntries(Object.entries(advanceSnapshot.rows).map(([key, rows]) => [key, [...rows]])) as typeof advanceSnapshot.rows };
    const advanceMutations = [];
    for (const application of affectedAdvances) {
      const canceled = await prepareAdvanceCancellation(db, tx, advanceSnapshot, application.id, { operationId: 'return-cancel-' + hash([input.operationId, application.id]), date: advanceDate, reason: '반품에 따른 적용 잔량 재계산', actorId }, advanceScope!);
      advanceMutations.push(canceled); projectedAdvance.rows.issuedStatements.push(canceled.statement); projectedAdvance.rows.partnerAdvanceOperations.push(canceled.operation);
    }
    const reducedClaims = advanceScope ? advanceClaims(projectedAdvance) : await readClaimsAfterReturns(db, tx, claims, existingApps, statementRows.docs.map(doc => ({ ...doc.data(), id: doc.id })));
    const claimById = new Map(claims.map(row => [row.id, row]));
    for (const claim of claims) {
      const priorReturned = existingApps.filter(row => row.statementId === claim.id)
        .reduce((sum, row) => sum + row.amount, 0);
      const pinnedCash = settlementRows.docs.filter(doc => doc.data().statementId === claim.id)
        .reduce((sum, doc) => sum + doc.data().amount, 0);
      if (!Number.isSafeInteger(pinnedCash) || pinnedCash < 0
        || (claim.amount < 0 ? pinnedCash !== 0 || priorReturned !== 0 : pinnedCash + priorReturned > claim.amount))
        fail('기존 현금 정산과 반품 상계가 원청구액을 넘습니다.');
    }
    if (sourceSnap && !claimById.has(sourceSnap.id)) fail('원전표 채권을 확인할 수 없습니다.');
    for (const old of oldReturns.filter(row => row.id !== requestSnap.id && row.linkedStatementId === sourceSnap?.id
      && row.status === 'processed')) {
      if (!existingApps.some(app => (app as Row).returnRequestId === old.id))
        fail('기존 반품의 비현금 적용 기록이 없습니다.');
    }
    const cashEntries = cashRows.docs.filter(doc => (doc.data().companyId ?? "taebaek") === companyId)
      .map(doc => cashFromEntry(doc.id, doc.data())).filter((row): row is NonNullable<typeof row> => row !== null);
    const open = openClaimBalances({ companyId, partnerId: request.partnerId, direction,
      claims: reducedClaims, cashEntries, settlements: settlementRows.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)) });
    const allocation = planReturnAllocation({ returnId: requestSnap.id, companyId, partnerId: request.partnerId,
      direction, amount: plan.amount, ...(sourceSnap && {linkedStatementId:sourceSnap.id}),
      claims: claims.filter(claim => claim.accountCode === sourceAccountCode).map(claim => ({ id: claim.id,
        companyId: claim.companyId, partnerId: claim.partnerId, direction, tradeDate: claim.tradeDate,
        amount: open.get(claim.id) ?? 0, cashApplied: 0 })), priorAllocations: [] });
    if (allocation.unappliedAmount) fail("반품 상계액이 미결 채권을 넘습니다.");
    const applications = allocation.allocations.map((row, index) => ({
      id: index === 0 ? appRef.id : `${appRef.id}-${row.statementId}`, statementId: row.statementId, amount: row.amount,
    }));
    const extraAppSnaps = await Promise.all(applications.slice(1).map(row => tx.get(db.collection("returnApplications").doc(row.id))));
    if (extraAppSnaps.some(snap => snap.exists)) fail("반품 상계 ID가 이미 사용 중입니다.");
    const todayIso = new Date().toISOString();
    const itemDocs = new Map(itemRows.docs.map(doc => [doc.id, doc.data()]));
    const companyItems = itemRows.docs.filter(doc => (doc.data().companyId ?? 'taebaek') === companyId)
      .map(doc => ({ ...doc.data(), id: doc.id } as any));
    const prepared: (ReturnType<typeof planGeneralReturnReceipt> | ReturnType<typeof planGeneralReturnIssue>
      | ReturnType<typeof planUnitReturnReceipt> | ReturnType<typeof planUnitReturnIssue>)[] = [];
    const rawPrepared: NonNullable<Awaited<ReturnType<typeof prepareReturnRawStock>>>[] = [];
    const rawVirtual = new Map<string, { state: RawInventoryState; itemData: Row }>();
    for (const effect of plan.stockEffects) {
      const item = itemDocs.get(effect.itemId);
      if (!item) fail('반품 품목을 찾을 수 없습니다.');
      const base = String(item!.rawMaterialName || item!.name || '').split('/')[0].trim();
      const rawTargetExists = itemRows.docs.some(doc => {
        const row = doc.data();
        return (row.companyId ?? 'taebaek') === companyId && row.subtype === '벌크'
          && !row.phantom && !row.archived && String(row.name ?? '').split('/')[0].trim() === base;
      });
      const stockInput = { operationId: input.operationId, companyId, date: input.tradeDate,
        createdAt: todayIso, partnerId: request.partnerId, partnerName: partnerSnap.data()!.name,
        item: { ...item, id: effect.itemId, companyId: item!.companyId ?? 'taebaek' } as Item, quantityDelta: effect.quantityDelta, rawTargetExists };
      if (returnStockKind(companyId as 'taebaek' | 'punghoe', { ...item, id: effect.itemId } as any, companyItems) === 'unit') {
        const component = unpackStockComponent(bomRows.docs.filter(doc => doc.data().parent_id === effect.itemId)
          .map(doc => ({ childId: doc.data().child_id, qty: typeof doc.data().quantity === 'number' ? doc.data().quantity : 1,
            child: itemDocs.has(doc.data().child_id) && (itemDocs.get(doc.data().child_id)?.companyId ?? 'taebaek') === companyId
              ? itemDocs.get(doc.data().child_id) : undefined })));
        const unitKg = stockUnitKg(item!, component, id => itemDocs.get(id)) ?? 0;
        prepared.push(purchase ? planUnitReturnIssue(stockInput, unitKg) : planUnitReturnReceipt(stockInput, unitKg));
        continue;
      }
      const raw = await prepareReturnRawStock(db, tx, { ...stockInput, companyId: companyId as 'taebaek' | 'punghoe',
        requestId: returnRef.id, item: { ...item, id: effect.itemId } as any,
        allItems: companyItems,
        bomLines: bomRows.docs.map(doc => doc.data() as { parent_id: string; child_id: string; quantity?: number }),
      }, rawVirtual);
      if (raw) rawPrepared.push(raw);
      else prepared.push(purchase ? planGeneralReturnIssue(stockInput) : planGeneralReturnReceipt(stockInput));
    }
    const receipts = prepared.filter((row): row is ReturnType<typeof planGeneralReturnReceipt> => 'receipt' in row);
    const stockMovements = JSON.parse(JSON.stringify(prepared.flatMap(row => 'movement' in row ? [row.movement] : []))) as Row[];
    const rawMovements = rawPrepared.map(row => ({ id: row.movementRef.id, companyId, partnerId: request.partnerId,
      operationId: input.operationId, date: input.tradeDate, requestItemId: row.requestItemId,
      quantityDelta: row.quantityDelta, movementHash: hash(row.movement) }));
    const receiptSnaps = await Promise.all(receipts.map(row => tx.get(db.collection('itemReceipts').doc(row.receiptId))));
    if (receiptSnaps.some(snap => snap.exists)) fail('반품 입고 기록이 이미 있습니다.');
    const codes = new Set(accountCodes.docs.filter(doc => doc.data().companyId === companyId).map(doc => doc.data().code));
    if (plan.journalLines.some(line => !codes.has(line.accountCode))) fail('반품 역분개 계정이 준비되지 않았습니다.');
    const docNo = formatVoucherNo(input.tradeDate, sequence!.last + 1, '반품');
    const journalData = { companyId, issuedAt: todayIso, tradeDate: input.tradeDate, type: '비용',
      partnerId: request.partnerId, partnerName: partnerSnap.data()!.name,
      orderId: returnRef.id, docNo, totalSupply: plan.supply, totalTax: plan.tax, totalAmount: plan.amount,
      returnOperationId: input.operationId, ...(sourceSnap ? {reverseOfStatementId:sourceSnap.id} : {sourceMode:'standalone'}),
      items: plan.journalLines.map(line => ({ name: '반품 역분개', spec: '', qty: 1, price: line.amount,
        supply: line.amount, tax: 0, total: line.amount, isTaxExempt: true,
        accountCode: line.accountCode, side: line.side })),
    };
    const returnOperationData = { companyId, requestHash, businessHash, returnRequestId: returnRef.id, ...(sourceSnap ? {sourceStatementId:sourceSnap.id} : {sourceMode:'standalone',returnType:request.returnType}),
      amount: plan.amount, docNo, journalId: journal.id, journalHash: hash(journalData),
      applications: applications.map(row => ({ id: row.id, statementId: row.statementId, amount: row.amount,
        applicationHash: hash({ companyId, partnerId: request.partnerId, statementId: row.statementId,
          returnRequestId: returnRef.id, operationId: input.operationId, amount: row.amount, createdAt: todayIso }) })),
      stockMovements, stockMovementsHash: hash(stockMovements),
      rawMovements, rawMovementsHash: hash(rawMovements),
      receipts: receipts.map(row => ({ id: row.receiptId, itemId: row.itemId,
        quantity: row.receipt.quantity, fingerprint: row.receipt.returnReceiptFingerprint,
        receiptHash: hash(row.receipt) })),
      createdAt: todayIso, createdBy: actorId };
    if (advanceScope) {
      projectedAdvance.rows.issuedStatements.push({ ...journalData, id: journal.id });
      projectedAdvance.rows.returnApplications.push(...applications.map(row => ({ id: row.id, companyId, partnerId: request.partnerId, statementId: row.statementId, returnRequestId: returnRef.id, operationId: input.operationId, amount: row.amount, createdAt: todayIso })));
      projectedAdvance.rows.returnOperations.push({ ...returnOperationData, id: operation.id });
      for (const application of affectedAdvances) {
        if (application.noncashApplication.kind !== 'advance-application') continue;
        for (const allocation of application.noncashApplication.allocations) {
          const resolved = await resolveSelectedAdvance(db, tx, projectedAdvance, allocation.source, allocation.statementId);
          const source = resolved.context.sources[0], target = resolved.context.targets[0];
          const amount = Math.min(allocation.amount, source.originalAmount - (resolved.context.priorSourceUse.get(sourceKey(allocation.source)) ?? 0), target.remaining);
          if (amount <= 0) continue;
          const reapplied = await prepareAdvanceApplication(db, tx, projectedAdvance, advanceScope, actorId, {
            operationId: 'return-reapply-' + hash([input.operationId, application.id, sourceKey(allocation.source), allocation.statementId]), date: advanceDate,
            partnerId: request.partnerId, source: allocation.source, statementId: allocation.statementId, accountCode: allocation.accountCode, amount,
            expectedRevision: revision, releaseId: input.releaseId, expectedSourceFingerprint: resolved.sourceFingerprint, expectedTargetFingerprint: resolved.targetFingerprint,
          });
          advanceMutations.push(reapplied); projectedAdvance.rows.issuedStatements.push(reapplied.statement); projectedAdvance.rows.partnerAdvanceOperations.push(reapplied.operation);
        }
      }
      if (advanceMutations.length * 2 + prepared.length * 2 + rawPrepared.length * 4 + applications.length + 5 > 500) fail('연결된 반품 적용 내역이 너무 많습니다.');
    }
    writesStarted = true;
    if (advanceScope) writePartnerAdvanceMutations(tx, advanceSnapshot, advanceScope, advanceMutations, { writePartnerRevision: false });
    writeVoucherCounter(tx, counterSnap, sequence, sequence.last + 1);
    for (const row of prepared) {
      tx.update(db.collection('items').doc(row.itemId), { stock: row.nextStock,
        ...('lots' in row ? { lots: JSON.parse(JSON.stringify(row.lots)) } : {}) });
      if ('receipt' in row) tx.create(db.collection('itemReceipts').doc(row.receiptId), row.receipt);
    }
    for (const row of rawPrepared) writeReturnRawStock(tx, row);
    tx.create(journal, journalData);
    for (const row of applications) tx.create(db.collection('returnApplications').doc(row.id), {
      companyId, partnerId: request.partnerId, statementId: row.statementId,
      returnRequestId: returnRef.id, operationId: input.operationId, amount: row.amount, createdAt: todayIso,
    });
    tx.update(returnRef, { status: 'processed', processedAt: todayIso, processedBy: actorId,
      returnJournalId: journal.id, returnApplicationId: appRef.id });
    if (stateSnap.exists) tx.update(stateRef, { revision: revision + 1 });
    else tx.create(stateRef, { companyId, partnerId: request.partnerId, revision: 1 });
    tx.create(operation, { ...returnOperationData, advanceStatementIds: advanceMutations.map(row => row.statement.id) });
    return { status: 'applied' as const, docNo, journalId: journal.id };
    } catch (error) {
      const validation = error instanceof ReturnValidationError || error instanceof PartnerPaymentValidationError
        ? new HttpsError('failed-precondition', error.message) : error;
      if (writesStarted || opSnap.exists || !outputsAbsent || !(validation instanceof HttpsError)
        || !['invalid-argument', 'failed-precondition'].includes(validation.code)) throw error;
      const failureCode = validation.code as 'invalid-argument' | 'failed-precondition';
      tx.create(operation, { status: 'rejected', companyId, operationId: input.operationId,
        returnRequestId: input.returnRequestId, requestHash, command: input,
        failureCode, failureMessage: validation.message, createdAt: new Date().toISOString(), createdBy: actorId });
      return { status: 'rejected' as const, failureCode, failureMessage: validation.message };
    }
  });
  if (outcome.status === 'rejected') throw new HttpsError(outcome.failureCode, outcome.failureMessage, {
    operationStatus: 'rejected', operationId: input.operationId, returnRequestId: input.returnRequestId,
    companyId, requestHash,
  });
  return outcome;
}

export const processGeneralStockReturnCommand = onCall({ region: 'asia-northeast3' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const companyId = request.auth.token.companyId;
  if (!request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe'))
    throw new HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
  return processGeneralStockReturn(admin.firestore(), companyId, request.auth.uid, request.data as Input);
});
