import * as admin from 'firebase-admin';
import {onCall,HttpsError} from 'firebase-functions/v2/https';
import {cashOriginalHash} from './cashMutationReceipt';
import {openingPartnerStatement,loanOpeningStatement,cashOpeningStatement,loanOpeningPrincipalForBalance,cashOpeningBalanceForCurrent,openingCashAccountCode,openingDocumentId as openingDocId,openingCompanyOf as companyOf,openingCalendarDay as isCalendarDay,type OpeningCompany,type OpeningPartnerCode,type FinancialLoan,type FinancialAccount,type FinancialCash,type FinancialPartner,type OpeningStatement} from './shared/financialOpening';
import {assertReleaseActive,releaseGateRef} from './releaseGate';
import {kstDateOf} from './shared/calculation';
import { normalizeFinancialOpeningRecoveryReference, normalizeFinancialOpeningRecoveryResult,
  type FinancialOpeningRecoveryCommand, type FinancialOpeningRecoveryReference, type FinancialOpeningRecoveryResult } from './shared/financialOpeningRecovery';
const today=()=>kstDateOf(new Date());
export type FinancialOpeningInput={companyId:OpeningCompany;operationId:string;releaseId:string}&(
 {kind:'partner-create';date:string;partnerId:string;code:OpeningPartnerCode;amount:number}|
 {kind:'loan-create';loan:FinancialLoan}|
 {kind:'loan-update';original:FinancialLoan;newDate:string;targetBalance:number}|
 {kind:'account-create';account:FinancialAccount}|
 {kind:'account-update';original:FinancialAccount;name:string;newDate:string;targetBalance:number;asOf:string});
type Row=Record<string,any>;
type Snapshot={id:string;ref:admin.firestore.DocumentReference;exists:()=>boolean;data:()=>Row};
type QuerySnapshot={docs:Snapshot[]};
type OpeningTx={get:{(ref:admin.firestore.DocumentReference):Promise<Snapshot>;(ref:admin.firestore.Query):Promise<QuerySnapshot>}} & Omit<admin.firestore.Transaction,'get'>;
type OpeningStore={collection:admin.firestore.Firestore['collection'];runTransaction:<T>(run:(tx:OpeningTx)=>Promise<T>)=>Promise<T>};
const doc=(db:OpeningStore,collection:string,id:string)=>db.collection(collection).doc(id);
const collection=(db:OpeningStore,name:string)=>db.collection(name);
const where=(field:string,_op:string,value:unknown)=>({field,value});
const query=(collection:admin.firestore.CollectionReference,...clauses:{field:string;value:unknown}[])=>clauses.reduce<admin.firestore.Query>((result,clause)=>result.where(clause.field,'==',clause.value),collection);
const runTransaction=<T>(store:OpeningStore,run:(tx:OpeningTx)=>Promise<T>)=>store.runTransaction(run);
async function createOpeningPartnerBalanceWithDb(
  store: OpeningStore, companyId: OpeningCompany, date: string, partnerId: string, code: OpeningPartnerCode, amount: number,
): Promise<'created' | 'unchanged'> {
  const partnerRef = doc(store, 'partners', partnerId);
  const openingRef = doc(store, 'openingBalances', openingDocId(companyId));
  const id = `opening-partner-${companyId}-${date}-${partnerId}-${code}`;
  const voucherRef = doc(store, 'issuedStatements', id);
  return runTransaction(store, async tx => {
    const [partnerSnap, openingSnap, voucherSnap] = await Promise.all([
      tx.get(partnerRef), tx.get(openingRef), tx.get(voucherRef),
    ]);
    if (!partnerSnap.exists()) throw new HttpsError('failed-precondition','거래처가 없습니다.');
    const partner = { id: partnerSnap.id, ...partnerSnap.data() } as FinancialPartner;
    if (companyOf(partner) !== companyId) throw new HttpsError('failed-precondition','다른 회사 거래처입니다.');
    if (!openingSnap.exists() || openingSnap.data().companyId !== companyId || openingSnap.data().date !== date) {
      throw new HttpsError('failed-precondition','먼저 해당 날짜의 회계 기초잔액을 저장하세요.');
    }
    if (Number(openingSnap.data().amounts?.[code] ?? 0) !== 0) {
      throw new HttpsError('failed-precondition',`${code} 계정에 합계 기초잔액이 있어 이중계상됩니다. 기존 금액을 확인하세요.`);
    }
    const voucher = openingPartnerStatement(companyId, date, partner, code, amount);
    if (voucherSnap.exists()) {
      const saved = voucherSnap.data();
      if (saved.companyId === companyId && saved.partnerId === partnerId && saved.tradeDate === date &&
          saved.items?.find((i: { accountCode: string }) => i.accountCode === code)?.total === amount) return 'unchanged';
      throw new HttpsError('failed-precondition','같은 기초 전표번호에 다른 내용이 저장되어 있습니다.');
    }
    tx.update(openingRef, { hasPartnerOpening: true });
    tx.set(voucherRef, voucher);
    return 'created';
  });
}

async function createLoanWithOpeningWithDb(store: OpeningStore, companyId: OpeningCompany, loan: FinancialLoan): Promise<'created' | 'unchanged'> {
  if (loan.companyId !== companyId || !loan.id || !loan.name?.trim() || !loan.lenderName?.trim() ||
      !isCalendarDay(loan.openingDate) || !Number.isInteger(loan.openingPrincipal) || loan.openingPrincipal < 0 ||
      (loan.accountCode !== '260' && loan.accountCode !== '293')) throw new HttpsError('failed-precondition','대출 회사·계정·기초일·원금을 확인하세요.');
  const loanRef = doc(store, 'loanContracts', loan.id);
  const openingRef = doc(store, 'openingBalances', openingDocId(companyId));
  const voucherRef = doc(store, 'issuedStatements', `opening-loan-${companyId}-${loan.id}`);
  const partnerRef = loan.partnerId ? doc(store, 'partners', loan.partnerId) : null;
  return runTransaction(store, async tx => {
    const [loanSnap, openingSnap, voucherSnap, partnerSnap] = await Promise.all([
      tx.get(loanRef), tx.get(openingRef), tx.get(voucherRef), partnerRef ? tx.get(partnerRef) : Promise.resolve(null),
    ]);
    if (partnerRef && (!partnerSnap?.exists() || companyOf(partnerSnap.data()) !== companyId)) throw new HttpsError('failed-precondition','다른 회사 금융기관이거나 없는 거래처입니다.');
    const hasOpening = loan.openingPrincipal > 0;
    const openingData = openingSnap.data();
    if (hasOpening && (!openingData || openingData.companyId !== companyId || openingData.date !== loan.openingDate)) {
      throw new HttpsError('failed-precondition','시작 원금은 회계 기초잔액 기준일과 같을 때만 등록할 수 있습니다. 기초잔액을 먼저 저장하거나 시작 원금 0원으로 등록 후 차입 전표를 발행하세요.');
    }
    if (hasOpening && Number(openingData?.amounts?.[loan.accountCode] ?? 0) !== 0) {
      throw new HttpsError('failed-precondition','대출 계정에 합계 기초잔액이 있어 이중계상됩니다. 기존 금액을 확인하세요.');
    }
    const sameLoan = loanSnap.exists() && ['companyId', 'name', 'lenderName', 'partnerId', 'accountCode', 'openingDate', 'openingPrincipal', 'maturityDate']
      .every(key => (loanSnap.data()[key] ?? '') === ((loan as unknown as Record<string, unknown>)[key] ?? ''));
    if (loanSnap.exists() || voucherSnap.exists()) {
      if (sameLoan && (hasOpening ? voucherSnap.exists() && voucherSnap.data().companyId === companyId && voucherSnap.data().totalAmount === loan.openingPrincipal : !voucherSnap.exists())) return 'unchanged';
      throw new HttpsError('failed-precondition','같은 대출 요청에 다른 내용이 저장되어 있습니다. 새로 열어 다시 등록하세요.');
    }
    tx.set(loanRef, loan);
    if (hasOpening) {
      tx.update(openingRef, { hasLoanOpening: true });
      tx.set(voucherRef, loanOpeningStatement(loan));
    }
    return 'created';
  });
}

async function updateLoanOpeningWithDb(store: OpeningStore, companyId: OpeningCompany, originalLoan: FinancialLoan, newDate: string, targetCurrentBalance: number): Promise<void> {
  if (originalLoan.companyId !== companyId || !originalLoan.id ||
      (originalLoan.accountCode !== '260' && originalLoan.accountCode !== '293') ||
      !isCalendarDay(newDate) || !Number.isSafeInteger(targetCurrentBalance) || targetCurrentBalance < 0) {
    throw new HttpsError('failed-precondition','대출 회사·시작일·현재 원금 잔액을 확인하세요.');
  }

  const loanRef = doc(store, 'loanContracts', originalLoan.id);
  const voucherRef = doc(store, 'issuedStatements', `opening-loan-${companyId}-${originalLoan.id}`);
  await runTransaction(store, async tx => {
  const entries = await tx.get(query(collection(store, 'cashEntries'), where('companyId', '==', companyId), where('loanId', '==', originalLoan.id)));
    const [loanSnap, voucherSnap, cashSnaps] = await Promise.all([
      tx.get(loanRef), tx.get(voucherRef), Promise.all(entries.docs.map(row => tx.get(row.ref))),
    ]);
    const latest = loanSnap.data();
    const original = originalLoan as unknown as Record<string, unknown>;
    const fields = ['companyId', 'name', 'lenderName', 'partnerId', 'accountCode', 'openingDate', 'openingPrincipal', 'maturityDate', 'note', 'createdAt', 'movementRevision', 'principalBalance'];
    if (!loanSnap.exists() || loanSnap.id !== originalLoan.id || latest?.companyId !== companyId || fields.some(key => (latest?.[key] ?? '') !== (original[key] ?? ''))) {
      throw new HttpsError('failed-precondition','대출 계약이 변경되었습니다. 새로 조회한 뒤 다시 저장하세요.');
    }
    const movements = cashSnaps.filter(snap => snap.exists()).map(snap => ({ ...snap.data(), id: snap.id })) as FinancialCash[];
    if (movements.some(row => companyOf(row) !== companyId || row.loanId !== originalLoan.id)) {
      throw new HttpsError('failed-precondition','대출 연결 전표가 변경되었습니다. 다시 조회하세요.');
    }
    const openingPrincipal = loanOpeningPrincipalForBalance(originalLoan, movements, newDate, targetCurrentBalance);
    let voucherPatch: Record<string, unknown> | undefined;
    if (voucherSnap.exists()) {
      const voucher = voucherSnap.data() as OpeningStatement;
      const accountingDate = voucher.tradeDate || voucher.issuedAt?.slice(0, 10);
      if (voucher.companyId !== companyId || voucher.id !== voucherRef.id || voucher.docNo !== `기초대출-${originalLoan.id}` || !isCalendarDay(accountingDate) ||
          voucher.type !== '비용' || voucher.orderId !== '' || voucher.partnerId !== (originalLoan.partnerId ?? '') ||
          voucher.partnerName !== originalLoan.lenderName || !Array.isArray(voucher.items) || voucher.items.length !== 2 ||
          !Number.isSafeInteger(voucher.totalAmount) || voucher.totalAmount < 0 || voucher.totalSupply !== voucher.totalAmount || voucher.totalTax !== 0 ||
          voucher.items[0].accountCode !== '375' || voucher.items[0].side !== '차변' ||
          voucher.items[1].accountCode !== originalLoan.accountCode || voucher.items[1].side !== '대변' ||
          voucher.items.some(line => line.qty !== 1 || line.tax !== 0 || line.lineKind !== 'account' || line.price !== voucher.totalAmount || line.supply !== voucher.totalAmount || line.total !== voucher.totalAmount)) {
        throw new HttpsError('failed-precondition','대출 기초 전표의 회사·일자·분개를 확인하세요.');
      }
      const amount = loanOpeningPrincipalForBalance(originalLoan, movements, accountingDate, targetCurrentBalance);
      voucherPatch = { totalSupply: amount, totalTax: 0, totalAmount: amount,
        items: voucher.items.map(line => ({ ...line, price: amount, supply: amount, total: amount })) };
    }
    const revision = latest?.movementRevision;
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0 || !Number.isSafeInteger(revision + 1))) throw new HttpsError('failed-precondition','대출 원금 변경 버전을 확인하세요.');
    tx.update(loanRef, { openingDate: newDate, openingPrincipal,
      ...(revision !== undefined && { movementRevision: revision + 1 }),
      ...((revision !== undefined || latest?.principalBalance !== undefined) && { principalBalance: targetCurrentBalance }) });
    if (voucherPatch) tx.update(voucherRef, voucherPatch);
  });
}

async function createCashAccountWithOpeningWithDb(store: OpeningStore, companyId: OpeningCompany, account: FinancialAccount): Promise<'created' | 'unchanged'> {
  if (account.companyId !== companyId || !account.id || !account.name?.trim() ||
      !isCalendarDay(account.openingDate) || !Number.isInteger(account.openingBalance) || account.openingBalance < 0 ||
      !['통장', '현금', '카드'].includes(account.type)) throw new HttpsError('failed-precondition','계좌 회사·이름·기초일·잔액을 확인하세요.');
  if (account.type === '카드' && account.openingBalance > 0) throw new HttpsError('failed-precondition','카드 기초잔액은 계좌 자산과 다릅니다. 카드 계좌는 0원으로 등록하세요.');

  const accountRef = doc(store, 'cashAccounts', account.id);
  const openingRef = doc(store, 'openingBalances', openingDocId(companyId));
  const voucherRef = doc(store, 'issuedStatements', `opening-cash-${companyId}-${account.id}`);
  return runTransaction(store, async tx => {
  const existing = await tx.get(query(collection(store, 'cashAccounts'), where('companyId', '==', companyId)));
  const prior = existing.docs.map(row => ({ id: row.id, ...row.data() } as FinancialAccount));
    const [accountSnap, openingSnap, voucherSnap] = await Promise.all([
      tx.get(accountRef), tx.get(openingRef), tx.get(voucherRef),
    ]);
    const hasOpening = account.openingBalance > 0;
    const sameAccount = accountSnap.exists() && ['companyId', 'name', 'type', 'openingDate', 'openingBalance']
      .every(key => (accountSnap.data()[key] ?? '') === ((account as unknown as Record<string, unknown>)[key] ?? ''));
    if (accountSnap.exists() || voucherSnap.exists()) {
      if (sameAccount && (hasOpening ? voucherSnap.exists() && voucherSnap.data().companyId === companyId && voucherSnap.data().totalAmount === account.openingBalance : !voucherSnap.exists())) return 'unchanged';
      throw new HttpsError('failed-precondition','같은 계좌 요청에 다른 내용이 저장되어 있습니다. 새로 열어 다시 등록하세요.');
    }
    const openingData = openingSnap.data();
    if (openingData && openingData.companyId !== companyId) throw new HttpsError('failed-precondition','다른 회사 기초잔액입니다.');
    if (hasOpening && openingData?.date && openingData.date !== account.openingDate) {
      throw new HttpsError('failed-precondition','계좌 기초일은 회계 기초잔액 기준일과 같아야 합니다.');
    }
    if (hasOpening && !openingData && prior.some(row => row.openingBalance > 0)) {
      throw new HttpsError('failed-precondition','기존 계좌 기초잔액이 있어 먼저 회계 기초잔액을 저장·대조해야 합니다.');
    }
    if (hasOpening && openingData && !openingData.hasCashOpening) {
      const code = openingCashAccountCode(account);
      const priorTotal = prior.filter(row => row.type === account.type).reduce((sum, row) => sum + (row.openingBalance || 0), 0);
      if (Number(openingData.amounts?.[code] ?? 0) !== priorTotal) {
        throw new HttpsError('failed-precondition','기존 계좌 잔액과 회계 기초 합계가 다릅니다. 먼저 기초잔액을 대조하세요.');
      }
    }
    tx.set(accountRef, account);
    if (hasOpening) {
      if (openingData) tx.update(openingRef, { hasCashOpening: true });
      else tx.set(openingRef, { id: openingDocId(companyId), companyId, date: account.openingDate, amounts: {}, hasCashOpening: true });
      tx.set(voucherRef, cashOpeningStatement(account));
    }
    return 'created';
  });
}

async function updateCashAccountOpeningWithDb(store: OpeningStore, companyId: OpeningCompany, original: FinancialAccount, name: string, newDate: string, targetBalance: number, asOf = today()): Promise<void> {
  if (original.companyId !== companyId || !original.id || !name.trim() || !isCalendarDay(newDate) || !isCalendarDay(asOf) || !Number.isSafeInteger(targetBalance)) throw new HttpsError('failed-precondition','계좌 회사·이름·기준일·잔액을 확인하세요.');

  const accountRef = doc(store, 'cashAccounts', original.id);
  const voucherRef = doc(store, 'issuedStatements', `opening-cash-${companyId}-${original.id}`);
  await runTransaction(store, async tx => {
  const entries = await tx.get(query(collection(store, 'cashEntries'), where('companyId', '==', companyId), where('cashAccountId', '==', original.id)));
    const [accountSnap, voucherSnap, cashSnaps] = await Promise.all([tx.get(accountRef), tx.get(voucherRef), Promise.all(entries.docs.map(row => tx.get(row.ref)))]);
    const latest = accountSnap.data() as FinancialAccount | undefined;
    const fields = ['companyId', 'name', 'type', 'openingDate', 'openingBalance', 'active', 'createdAt'] as const;
    if (!accountSnap.exists() || latest?.companyId !== companyId || fields.some(key => (latest?.[key] ?? '') !== (original[key] ?? ''))) throw new HttpsError('failed-precondition','계좌 정보가 변경되었습니다. 다시 열어 저장하세요.');
    const movements = cashSnaps.filter(snap => snap.exists()).map(snap => ({ ...snap.data(), id: snap.id })) as FinancialCash[];
    if (movements.some(entry => companyOf(entry) !== companyId || entry.cashAccountId !== original.id)) throw new HttpsError('failed-precondition','계좌 연결 전표가 변경되었습니다. 다시 조회하세요.');
    const openingBalance = cashOpeningBalanceForCurrent({ ...latest!, id: original.id }, movements, newDate, targetBalance, asOf);
    let voucherPatch: Record<string, unknown> | undefined;
    if (voucherSnap.exists()) {
      const voucher = voucherSnap.data() as OpeningStatement;
      const date = voucher.tradeDate || voucher.issuedAt?.slice(0, 10);
      const [asset, equity] = voucher.items || [];
      if (original.type === '카드' || voucher.companyId !== companyId || voucher.id !== voucherRef.id || voucher.docNo !== `기초계좌-${original.id}` || voucher.type !== '비용' || voucher.orderId !== '' || !isCalendarDay(date) || voucher.items?.length !== 2 ||
          asset.accountCode !== openingCashAccountCode(original) || equity.accountCode !== '375' || !['차변', '대변'].includes(asset.side || '') || equity.side === asset.side || !['차변', '대변'].includes(equity.side || '') ||
          !Number.isSafeInteger(voucher.totalAmount) || voucher.totalAmount < 0 || voucher.totalSupply !== voucher.totalAmount || voucher.totalTax !== 0 || voucher.items.some(line => line.qty !== 1 || line.tax !== 0 || line.lineKind !== 'account' || line.price !== voucher.totalAmount || line.supply !== voucher.totalAmount || line.total !== voucher.totalAmount)) throw new HttpsError('failed-precondition','계좌 기초 전표의 회사·일자·분개를 확인하세요.');
      const signed = cashOpeningBalanceForCurrent({ ...latest!, id: original.id }, movements, date, targetBalance, asOf);
      const amount = Math.abs(signed);
      voucherPatch = { totalSupply: amount, totalTax: 0, totalAmount: amount, items: voucher.items.map((line, index) => ({ ...line, ...(index === 0 ? { name: name.trim() } : {}), side: (index === 0) === (signed >= 0) ? '차변' : '대변', price: amount, supply: amount, total: amount })) };
    }
    tx.update(accountRef, { name: name.trim(), openingDate: newDate, openingBalance });
    if (voucherPatch) tx.update(voucherRef, voucherPatch);
  });
}

function recoveryResult(row: Row, reference: FinancialOpeningRecoveryReference, actorUid: string): FinancialOpeningRecoveryResult {
  if (row.companyId !== reference.companyId || row.createdBy !== actorUid || row.kind !== reference.kind
    || !['applied', 'cancelled'].includes(row.status)) {
    throw new HttpsError('failed-precondition', '기초 금융 처리 기록의 회사·사용자·종류가 다릅니다.');
  }
  try {
    return normalizeFinancialOpeningRecoveryResult({ version: 1, reference, actorUid, status: row.status, requestHash: row.requestHash,
      ...(row.result !== undefined ? { result: row.result } : {}),
      message: row.status === 'applied'
        ? '이 요청은 이미 적용됐습니다. 이후 대상의 수정·삭제 여부는 확인하지 않았습니다.'
        : '이 요청의 미처리 작업을 중단했습니다. 이미 적용된 업무를 되돌린 것이 아닙니다.' }, reference, actorUid);
  } catch {
    throw new HttpsError('failed-precondition', '기초 금융 처리 기록이 손상됐습니다. 원문을 보존하고 다시 확인해 주세요.');
  }
}
function cancelledError(result: FinancialOpeningRecoveryResult): HttpsError {
  return new HttpsError('failed-precondition', '중단한 기초 금융 요청은 다시 저장할 수 없습니다.', {
    version: 1, companyId: result.reference.companyId, operationId: result.reference.operationId,
    operationStatus: 'cancelled', financialWrites: false, financialOpeningRecovery: result,
  });
}
export async function recoverFinancialOpening(db: admin.firestore.Firestore, companyId: OpeningCompany, uid: string, input: FinancialOpeningRecoveryCommand): Promise<FinancialOpeningRecoveryResult> {
  let reference: FinancialOpeningRecoveryReference;
  try {
    if (!input || Object.keys(input).some(key => !['mode', 'reference'].includes(key)) || !['inspect', 'cancel'].includes(input.mode)) throw Error();
    reference = normalizeFinancialOpeningRecoveryReference(input.reference);
  } catch { throw new HttpsError('invalid-argument', '기초 금융 조회·중단 요청을 확인해 주세요.'); }
  if (!uid || reference.companyId !== companyId) throw new HttpsError('permission-denied', '현재 회사의 기초 금융 요청만 확인할 수 있습니다.');
  const operation = db.collection('financialOpeningOperations').doc(reference.operationId);
  return db.runTransaction(async tx => {
    const prior = await tx.get(operation);
    if (prior.exists) return recoveryResult(prior.data()!, reference, uid);
    if (input.mode === 'inspect') return { version: 1, reference, actorUid: uid, status: 'unknown', requestHash: null,
      message: '서버에 이 요청의 처리 기록이 아직 없습니다. 늦게 도착할 수 있으니 다시 확인하거나 미처리 요청을 중단해 주세요.' };
    // 적용과 같은 문서에서 경합해야 중단 이후 늦은 writer가 금융 문서를 만들지 못한다.
    tx.create(operation, { companyId, createdBy: uid, kind: reference.kind, status: 'cancelled', requestHash: null, createdAt: new Date().toISOString() });
    return recoveryResult({ companyId, createdBy: uid, kind: reference.kind, status: 'cancelled', requestHash: null }, reference, uid);
  });
}

export async function executeFinancialOpening(db:admin.firestore.Firestore,companyId:OpeningCompany,uid:string,input:FinancialOpeningInput):Promise<'created'|'unchanged'|'updated'> {
 if(!uid||!['taebaek','punghoe'].includes(companyId)||!input||input.companyId!==companyId||!/^[-A-Za-z0-9_:]{1,160}$/.test(input.operationId)||!['partner-create','loan-create','loan-update','account-create','account-update'].includes(input.kind))throw new HttpsError('invalid-argument','기초 금융 요청을 확인하세요.');
 if(input.kind==='partner-create'&&!['108','251'].includes(input.code))throw new HttpsError('invalid-argument','기초 거래처 계정을 확인하세요.');
 const operation=db.collection('financialOpeningOperations').doc(input.operationId),requestHash=cashOriginalHash(input);
 const store:OpeningStore={collection:db.collection.bind(db),runTransaction:async<T>(run:(tx:OpeningTx)=>Promise<T>)=>db.runTransaction(async tx=>{
  const prior=await tx.get(operation);
  if(prior.exists){
   const result=recoveryResult(prior.data()!,{companyId,operationId:input.operationId,kind:input.kind},uid);
   if(result.status==='cancelled')throw cancelledError(result);
   if(result.requestHash!==requestHash)throw new HttpsError('failed-precondition','기존 기초 금융 요청과 원문이 다릅니다.');
   return result.result as T;
  }
  const release=await tx.get(releaseGateRef(db));assertReleaseActive(release,input.releaseId);
  const wrap=(snap:admin.firestore.DocumentSnapshot):Snapshot=>({id:snap.id,ref:snap.ref,exists:()=>snap.exists,data:()=>snap.data()!});
  const get=async(ref:admin.firestore.DocumentReference|admin.firestore.Query)=>{
   if('path' in ref)return wrap(await tx.get(ref));
   const rows=await tx.get(ref);return {docs:rows.docs.map(wrap)};
  };
  const proxy:OpeningTx={get:get as OpeningTx['get'],set:tx.set.bind(tx),create:tx.create.bind(tx),update:tx.update.bind(tx),delete:tx.delete.bind(tx),getAll:tx.getAll.bind(tx)};
  const result=await run(proxy);tx.create(operation,{companyId,createdBy:uid,kind:input.kind,status:'applied',requestHash,result:result??'updated',createdAt:new Date().toISOString()});return result;
 })};
 try {switch(input.kind){
 case 'partner-create':return await createOpeningPartnerBalanceWithDb(store,companyId,input.date,input.partnerId,input.code,input.amount);
 case 'loan-create':return await createLoanWithOpeningWithDb(store,companyId,input.loan);
 case 'loan-update':await updateLoanOpeningWithDb(store,companyId,input.original,input.newDate,input.targetBalance);return 'updated';
 case 'account-create':return await createCashAccountWithOpeningWithDb(store,companyId,input.account);
 case 'account-update':await updateCashAccountOpeningWithDb(store,companyId,input.original,input.name,input.newDate,input.targetBalance,input.asOf);return 'updated';
 }}catch(error){if(error instanceof HttpsError){if((error.details as {operationStatus?:string})?.operationStatus==='cancelled')throw error;throw new HttpsError(error.code,error.message,{operationStatus:'rejected',version:1,financialWrites:false,companyId,operationId:input.operationId});}throw error;}
}
export async function executeFinancialOpeningForActor(db:admin.firestore.Firestore,actor:{uid:string;token:Record<string,unknown>}|undefined,input:FinancialOpeningInput|FinancialOpeningRecoveryCommand) {
 const company=actor?.token.companyId;
 if(!actor?.uid||actor.token.isAdmin!==true||!['taebaek','punghoe'].includes(String(company)))throw new HttpsError('permission-denied','현재 회사 관리자만 기초 금융을 저장할 수 있습니다.');
 if(input&&typeof input==='object'&&'mode' in input)return recoverFinancialOpening(db,company as OpeningCompany,actor.uid,input as FinancialOpeningRecoveryCommand);
 return executeFinancialOpening(db,company as OpeningCompany,actor.uid,input as FinancialOpeningInput);
}
export const financialOpeningCommand=onCall({region:'asia-northeast3'},async request=>{
 const result=await executeFinancialOpeningForActor(admin.firestore(),request.auth,request.data);
 return typeof result==='string'?{result}:result;
});
