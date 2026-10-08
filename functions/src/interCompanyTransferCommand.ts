import { readClaimsAfterReturns } from './returnClaimReader';
import * as admin from 'firebase-admin';
import { readCashCreationMutation } from './cashMutationReceipt';
import { readVoucherCounter, writeVoucherCounter } from './newScopeCounter';
import { createHash } from 'crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { assertInterCompanyAuthority } from './interCompanyAuthority';
import { formatVoucherNo, voucherSequenceKey } from './voucherIssue';
import { cashFromEntry, claimFromStatement } from './partnerPaymentCommand';
import { PartnerPaymentValidationError, planPartnerPayment, type Claim, type PaymentCash, type PaymentSettlement } from './partnerPaymentPlan';
import { assertReleaseActive, assertVoucherDateAllowed, releaseGateRef } from './releaseGate';

type Row = Record<string, any>;
type Claims = { employeeId?: unknown; companyId?: unknown; isAdmin?: unknown };
type Input = {
  operationId: string; from: 'taebaek' | 'punghoe'; to: 'taebaek' | 'punghoe';
  tradeDate: string; amount: number; overKind: '선급금' | '대여금';
  fromAccountId: string; toAccountId: string; fromPartnerId: string; toPartnerId: string;
  expectedFromRevision: number; expectedToRevision: number; releaseId: string; note?: string;
};
const bad = (message: string): never => { throw new HttpsError('invalid-argument', message); };
const fail = (message: string): never => { throw new HttpsError('failed-precondition', message); };
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  && !Number.isNaN(new Date(`${date}T00:00:00Z`).valueOf())
  && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value as Row).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
    : value;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const companyName = (id: string) => id === 'taebaek' ? '태백푸드' : '풍회유통';

/** Inactive until both server-only cutover documents and a per-UID grant are reviewed and seeded. */
export async function recordInterCompanyTransfer(db: admin.firestore.Firestore, authUid: string, claims: Claims, input: Input) {
  if (!input || typeof input !== 'object' || !/^[A-Za-z0-9_-]{1,150}$/.test(input.operationId)
    || !/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId)
    || !validDate(input.tradeDate) || !Number.isSafeInteger(input.amount) || input.amount <= 0
    || !['선급금', '대여금'].includes(input.overKind) || !input.fromAccountId || !input.toAccountId
    || !input.fromPartnerId || !input.toPartnerId || input.fromPartnerId === input.toPartnerId
    || !Number.isSafeInteger(input.expectedFromRevision) || input.expectedFromRevision < 0
    || !Number.isSafeInteger(input.expectedToRevision) || input.expectedToRevision < 0
    || (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 500))) bad('회사이체 입력이 잘못되었습니다.');
  if (!authUid || typeof claims.employeeId !== 'string') fail('직원 인증이 필요합니다.');
  const employeeId = claims.employeeId as string;
  const requestHash = hash({ ...input, note: input.note?.trim() ?? '' });
  const operation = db.collection('companyTransferOperations').doc(input.operationId);
  const out = db.collection('cashEntries').doc(`${input.operationId}-out`);
  const incoming = db.collection('cashEntries').doc(`${input.operationId}-in`);
  const otherOut = db.collection('issuedStatements').doc(out.id);
  const otherIn = db.collection('issuedStatements').doc(incoming.id);
  const grantRef = db.collection('companyTransferGrants').doc(authUid);
  const employeeRef = db.collection('employees').doc(employeeId);
  const fromAccount = db.collection('cashAccounts').doc(input.fromAccountId);
  const toAccount = db.collection('cashAccounts').doc(input.toAccountId);
  const fromPartner = db.collection('partners').doc(input.fromPartnerId);
  const toPartner = db.collection('partners').doc(input.toPartnerId);
  const fromCounter = db.collection('appMeta').doc(voucherSequenceKey(input.from, input.tradeDate));
  const toCounter = db.collection('appMeta').doc(voucherSequenceKey(input.to, input.tradeDate));
  const fromState = db.collection('appMeta').doc(`partnerPaymentState_${input.from}_${input.fromPartnerId}`);
  const toState = db.collection('appMeta').doc(`partnerPaymentState_${input.to}_${input.toPartnerId}`);
  const fromCutover = db.collection('appMeta').doc(`companyTransferCutover_${input.from}`);
  const toCutover = db.collection('appMeta').doc(`companyTransferCutover_${input.to}`);
  const releaseGate = releaseGateRef(db);
  const result = await db.runTransaction(async tx => {
    const [operationSnap, outSnap, inSnap, otherOutSnap, otherInSnap, grantSnap, employeeSnap,
      fromAccountSnap, toAccountSnap, fromPartnerSnap, toPartnerSnap, fromCounterSnap, toCounterSnap,
      fromStateSnap, toStateSnap, fromCutoverSnap, toCutoverSnap, releaseSnap] = await Promise.all([
      tx.get(operation), tx.get(out), tx.get(incoming), tx.get(otherOut), tx.get(otherIn),
      tx.get(grantRef), tx.get(employeeRef), tx.get(fromAccount), tx.get(toAccount),
      tx.get(fromPartner), tx.get(toPartner), tx.get(fromCounter), tx.get(toCounter),
      tx.get(fromState), tx.get(toState), tx.get(fromCutover), tx.get(toCutover), tx.get(releaseGate),
    ]);
    const settlementRows = await tx.get(db.collection('settlements'));
    if(operationSnap.data()?.status==='rejected'){
      const prior=operationSnap.data()!;
      if(prior.companyId!==input.from||prior.authUid!==authUid||prior.from!==input.from||prior.to!==input.to||prior.requestHash!==requestHash
        ||hash(prior.command)!==hash(input)||outSnap.exists||inSnap.exists||otherOutSnap.exists||otherInSnap.exists
        ||settlementRows.docs.some(doc=>doc.data().operationId===input.operationId)
        ||!['invalid-argument','failed-precondition'].includes(prior.failureCode)||typeof prior.failureMessage!=='string')fail('기존 이체 거절 감사와 요청·출력이 다릅니다.');
      return {status:'rejected' as const,failureCode:prior.failureCode as 'invalid-argument'|'failed-precondition',failureMessage:prior.failureMessage as string};
    }
    let writesStarted=false;
    try{
    assertReleaseActive(releaseSnap, input.releaseId);
    assertVoucherDateAllowed(releaseSnap, input.from, input.tradeDate);
    assertVoucherDateAllowed(releaseSnap, input.to, input.tradeDate);
    let grantRevision = 0;
    try {
      grantRevision = assertInterCompanyAuthority(claims, input.from, input.to, grantSnap.data(), authUid);
    } catch { fail('양사 관리자 권한을 증명할 수 없습니다.'); }
    const employee = employeeSnap.data();
    if (!employeeSnap.exists || employee?.authUid !== authUid || employee?.companyId !== input.from
      || employee?.adminAccess !== true || employee?.status === 'out') fail('현재 직원 관리자 권한이 없습니다.');
    if (operationSnap.exists) {
      const prior = operationSnap.data()!, storedOut = outSnap.data(), storedIn = inSnap.data();
      if (prior.authUid === authUid && prior.requestHash === requestHash && prior.grantRevision === grantRevision
        && (!outSnap.exists || !inSnap.exists || (storedOut?.mutationRevision ?? 0) > 0 || (storedIn?.mutationRevision ?? 0) > 0)) {
        const validates = (row: Row, company: string, direction: string, docNo: string, expectedHash: string) =>
          row.companyId === company && row.dir === direction && row.transferOperationId === input.operationId
          && row.issuePayloadHash === requestHash && row.docNo === docNo
          && hash({ companyId: row.companyId, partnerId: row.partnerId, date: row.date, amount: row.amount,
            note: row.note, cashAccountId: row.cashAccountId, dir: row.dir, lines: row.lines }) === expectedHash;
        const originalOut = await readCashCreationMutation(db, tx, input.from, out.id, outSnap,
          row => validates(row, input.from, '출금', prior.outDocNo, prior.outHash));
        const originalIn = await readCashCreationMutation(db, tx, input.to, incoming.id, inSnap,
          row => validates(row, input.to, '입금', prior.inDocNo, prior.inHash));
        if (originalOut && originalIn) return { status: 'duplicate' as const, outDocNo: prior.outDocNo, inDocNo: prior.inDocNo };
        fail('회사이체 양쪽 변경 감사 사슬을 확인해야 합니다.');
      }
      const storedOutBusiness = storedOut && { companyId: storedOut.companyId, partnerId: storedOut.partnerId,
        date: storedOut.date, amount: storedOut.amount, note: storedOut.note,
        cashAccountId: storedOut.cashAccountId, dir: storedOut.dir, lines: storedOut.lines };
      const storedInBusiness = storedIn && { companyId: storedIn.companyId, partnerId: storedIn.partnerId,
        date: storedIn.date, amount: storedIn.amount, note: storedIn.note,
        cashAccountId: storedIn.cashAccountId, dir: storedIn.dir, lines: storedIn.lines };
      const expectedSettlements = [...(prior.outApplications ?? []).map((row: Row) => ({ ...row, side: 'out', cashId: out.id, companyId: input.from })),
        ...(prior.inApplications ?? []).map((row: Row) => ({ ...row, side: 'in', cashId: incoming.id, companyId: input.to }))];
      const existingSettlements = settlementRows.docs.filter(doc => doc.data().operationId === input.operationId);
      if (prior.authUid !== authUid || prior.requestHash !== requestHash || prior.grantRevision !== grantRevision
        || !outSnap.exists || !inSnap.exists
        || storedOut?.docNo !== prior.outDocNo || storedIn?.docNo !== prior.inDocNo
        || storedOut?.issuePayloadHash !== requestHash || storedIn?.issuePayloadHash !== requestHash
        || hash(storedOutBusiness) !== prior.outHash || hash(storedInBusiness) !== prior.inHash
        || existingSettlements.length !== expectedSettlements.length
        || expectedSettlements.some(row => {
          const stored = existingSettlements.find(doc => doc.id === `st-${input.operationId}-${row.side}-${row.statementId}`)?.data();
          return !stored || stored.companyId !== row.companyId || stored.cashEntryId !== row.cashId
            || stored.statementId !== row.statementId || stored.amount !== row.amount;
        }))
        fail('기존 회사이체 작업과 요청이 다릅니다.');
      return { status: 'duplicate' as const, outDocNo: prior.outDocNo, inDocNo: prior.inDocNo };
    }
    if (outSnap.exists || inSnap.exists || otherOutSnap.exists || otherInSnap.exists)
      fail('회사이체 한쪽 전표 또는 작업 ID가 이미 있습니다.');
    const fromStatements = await tx.get(db.collection('issuedStatements').where('partnerId', '==', input.fromPartnerId));
    const toStatements = await tx.get(db.collection('issuedStatements').where('partnerId', '==', input.toPartnerId));
    const fromCash = await tx.get(db.collection('cashEntries').where('partnerId', '==', input.fromPartnerId));
    const toCash = await tx.get(db.collection('cashEntries').where('partnerId', '==', input.toPartnerId));
    const returnRows = await Promise.all([input.fromPartnerId, input.toPartnerId].map(partnerId => tx.get(db.collection('returnApplications').where('partnerId', '==', partnerId))));
    const accountCodes = await tx.get(db.collection('accountCodes'));
    for (const [snap, company] of [[fromCutoverSnap, input.from], [toCutoverSnap, input.to]] as const) {
      const gate = snap.data();
      if (!snap.exists || gate?.companyId !== company || gate?.enabled !== true
        || gate?.legacyWritersBlocked !== true || gate?.auditPassed !== true) fail('회사이체 writer 전환이 준비되지 않았습니다.');
    }
    for (const [snap, company] of [[fromAccountSnap, input.from], [toAccountSnap, input.to]] as const) {
      const row = snap.data();
      if (!snap.exists || row?.companyId !== company || row?.active !== true || row?.type !== '통장')
        fail('각 회사 통장 계좌가 맞지 않습니다.');
    }
    for (const [snap, company, name] of [[fromPartnerSnap, input.from, companyName(input.to)],
      [toPartnerSnap, input.to, companyName(input.from)]] as const) {
      const row = snap.data();
      if (!snap.exists || row?.companyId !== company || row?.name !== name) fail('상대 회사 거래처가 맞지 않습니다.');
    }
    const nextNumbers: number[] = [];
    const counterStates: admin.firestore.DocumentData[] = [];
    for (const [snap, company] of [[fromCounterSnap, input.from], [toCounterSnap, input.to]] as const) {
      const row = await readVoucherCounter(db, tx, snap, releaseSnap, company, input.tradeDate, '');
      counterStates.push(row);
      if (row?.companyId !== company || row?.tradeDate !== input.tradeDate || row?.prefix !== ''
        || !Number.isSafeInteger(row?.last) || row.last < 0 || !Number.isSafeInteger(row.last + 1))
        fail('양사 전표 번호 카운터가 준비되지 않았습니다.');
      nextNumbers.push(row!.last + 1);
    }
    const currentRevisions = [fromStateSnap, toStateSnap].map(snap => snap.exists ? snap.data()?.revision : 0);
    if (currentRevisions.some(value => !Number.isSafeInteger(value))
      || currentRevisions[0] !== input.expectedFromRevision || currentRevisions[1] !== input.expectedToRevision)
      fail('양사 정산 상태가 변경되었습니다.');
    const statementData = [...fromStatements.docs, ...toStatements.docs].map(doc => ({ ...doc.data(), id: doc.id }));
    const statements = await readClaimsAfterReturns(db, tx, statementData.map(row => claimFromStatement(row.id, row)).filter((row): row is Claim => row !== null),
      returnRows.flatMap(rows => rows.docs.map(doc => ({ ...doc.data(), id: doc.id }))).filter((row: any) =>
        row.companyId === input.from && row.partnerId === input.fromPartnerId || row.companyId === input.to && row.partnerId === input.toPartnerId) as any, statementData);
    const cashEntries = [...fromCash.docs, ...toCash.docs]
      .map(doc => cashFromEntry(doc.id, doc.data())).filter((row): row is PaymentCash => row !== null);
    const settlements: PaymentSettlement[] = settlementRows.docs.map(doc => ({ id: doc.id, ...doc.data() } as PaymentSettlement));
    const outPlan = planPartnerPayment({ companyId: input.from, partnerId: input.fromPartnerId,
      direction: '출금', amount: input.amount, pin: false, allocations: [], claims: statements, cashEntries, settlements });
    const inPlan = planPartnerPayment({ companyId: input.to, partnerId: input.toPartnerId,
      direction: '입금', amount: input.amount, pin: false, allocations: [], claims: statements, cashEntries, settlements });
    if (outPlan.ignoredOrphanSettlementIds.length || inPlan.ignoredOrphanSettlementIds.length)
      fail('양사 정산 원본이 불완전합니다.');
    const offsetOut = outPlan.applications.reduce((sum, row) => sum + row.amount, 0);
    const offsetIn = inPlan.applications.reduce((sum, row) => sum + row.amount, 0);
    if (offsetOut !== offsetIn) fail('양사 채권·채무 상계액이 다릅니다.');
    const over = input.amount - offsetOut;
    const outLines = outPlan.lines.map(row => ({ ...row,
      accountCode: row.accountCode === '133' && input.overKind === '대여금' ? '137' : row.accountCode }));
    const inLines = inPlan.lines.map(row => ({ ...row,
      accountCode: row.accountCode === '254' && input.overKind === '대여금' ? '267' : row.accountCode }));
    if (outLines.reduce((sum, row) => sum + row.amount, 0) !== input.amount
      || inLines.reduce((sum, row) => sum + row.amount, 0) !== input.amount
      || (outLines.find(row => row.accountCode === (input.overKind === '대여금' ? '137' : '133'))?.amount ?? 0) !== over
      || (inLines.find(row => row.accountCode === (input.overKind === '대여금' ? '267' : '254'))?.amount ?? 0) !== over)
      fail('양사 이체 분개 합계가 맞지 않습니다.');
    for (const [company, lines] of [[input.from, outLines], [input.to, inLines]] as const) {
      const codes = new Set(accountCodes.docs.filter(doc => doc.data().companyId === company).map(doc => doc.data().code));
      if (lines.some(line => !codes.has(line.accountCode))) fail('회사별 회계 계정이 준비되지 않았습니다.');
    }
    const createdAt = new Date().toISOString();
    const outDocNo = formatVoucherNo(input.tradeDate, nextNumbers[0]);
    const inDocNo = formatVoucherNo(input.tradeDate, nextNumbers[1]);
    const common = { date: input.tradeDate, amount: input.amount, note: input.note?.trim() ?? '' };
    const outBusiness = { ...common, companyId: input.from, partnerId: input.fromPartnerId,
      cashAccountId: input.fromAccountId, dir: '출금', lines: outLines };
    const inBusiness = { ...common, companyId: input.to, partnerId: input.toPartnerId,
      cashAccountId: input.toAccountId, dir: '입금', lines: inLines };
    writesStarted=true;
    writeVoucherCounter(tx, fromCounterSnap, counterStates[0], nextNumbers[0]);
    writeVoucherCounter(tx, toCounterSnap, counterStates[1], nextNumbers[1]);
    tx.create(out, { ...outBusiness, id: out.id, partnerName: fromPartnerSnap.data()!.name,
      docNo: outDocNo, createdAt, createdBy: claims.employeeId, transferOperationId: input.operationId,
      issuePayloadHash: requestHash });
    tx.create(incoming, { ...inBusiness, id: incoming.id, partnerName: toPartnerSnap.data()!.name,
      docNo: inDocNo, createdAt, createdBy: claims.employeeId, transferOperationId: input.operationId,
      issuePayloadHash: requestHash });
    for (const [side, company, cashId, applications] of [
      ['out', input.from, out.id, outPlan.applications], ['in', input.to, incoming.id, inPlan.applications],
    ] as const) for (const row of applications)
      tx.create(db.collection('settlements').doc(`st-${input.operationId}-${side}-${row.statementId}`), {
        companyId: company, operationId: input.operationId, cashEntryId: cashId,
        statementId: row.statementId, amount: row.amount, createdAt,
      });
    for (const [ref, snap, company, partnerId] of [[fromState, fromStateSnap, input.from, input.fromPartnerId],
      [toState, toStateSnap, input.to, input.toPartnerId]] as const) {
      if (snap.exists) tx.update(ref, { revision: snap.data()!.revision + 1 });
      else tx.create(ref, { companyId: company, partnerId, revision: 1 });
    }
    tx.create(operation, { companyId:input.from,status:'applied',command:input,authUid, from: input.from, to: input.to, requestHash, grantRevision,
      outDocNo, inDocNo, outCashEntryId: out.id, inCashEntryId: incoming.id,
      outHash: hash(outBusiness), inHash: hash(inBusiness), offset: offsetOut, over,
      outApplications: outPlan.applications, inApplications: inPlan.applications,
      createdAt, createdBy: claims.employeeId });
    return { status: 'applied' as const, outDocNo, inDocNo };
    }catch(error){
      if (error instanceof PartnerPaymentValidationError) error = new HttpsError('failed-precondition', error.message);
      if(operationSnap.exists||writesStarted||outSnap.exists||inSnap.exists||otherOutSnap.exists||otherInSnap.exists
        ||settlementRows.docs.some(doc=>doc.data().operationId===input.operationId)||!(error instanceof HttpsError)
        ||!['invalid-argument','failed-precondition'].includes(error.code))throw error;
      tx.create(operation,{companyId:input.from,status:'rejected',authUid,from:input.from,to:input.to,command:input,requestHash,
        createdBy:claims.employeeId,createdAt:new Date().toISOString(),failureCode:error.code,failureMessage:error.message});
      return {status:'rejected' as const,failureCode:error.code as 'invalid-argument'|'failed-precondition',failureMessage:error.message};
    }
  });
  if(result.status==='rejected')throw new HttpsError(result.failureCode,result.failureMessage,{operationStatus:'rejected',operationId:input.operationId,companyId:input.from,requestHash});
  return result;
}

export const recordInterCompanyTransferCommand = onCall({ region: 'asia-northeast3' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  return recordInterCompanyTransfer(admin.firestore(), request.auth.uid, request.auth.token as Claims, request.data as Input);
});
