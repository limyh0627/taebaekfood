import {runInventoryWriterTransaction,captureInventoryWriterContext} from '../inventoryWriterProtocol';
import {readOemReceiptEntry,pinOemReceiptPacket,acknowledgeOemReceiptPacket,markOemReceiptPreCallFailure,
 withOemReceiptLock,type OemReceiptScope} from '../oemReceiptPending';
import {advanceOrderInventoryStage,assertOrderInventoryGeneration,generationFromOrder,hasOrderInventoryGenerationCompletion,validateOrderInventoryGeneration,type OrderInventoryGeneration} from '../orderInventoryGeneration';
import { itemWritePayload } from '../itemWritePayload';
import {advanceInventoryWriterProtocol,preserveInventoryWriterProtocol,protectInventoryWriterPatch,protectItemInventoryPatch,ITEM_INVENTORY_FIELDS,inventoryWriterSame} from '../inventoryWriterProtocol';
import { readPurchaseUnitSnapshot } from '../purchaseUnit';
import {runFinancialOpening} from './financialOpeningCommands';
/**
 * @shared-move  shared/src/services/firebaseService.ts
 * Firebase CRUD 공통 서비스 — 직원 앱·관리자 앱 양쪽에서 동일하게 사용합니다.
 * Phase 2 분리 시 shared/ 로 이동하고 각 앱에서 import합니다.
 */
import {
  Timestamp, DocumentReference, GeoPoint, Bytes, FieldValue, VectorValue,
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  setDoc,
  query,
  where,
  getDocs,
  getDoc,
  writeBatch,
  runTransaction,
  DocumentData,
  type Firestore,
  QuerySnapshot,
  QueryConstraint,
  documentId,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import { auth, authReady, db, functions } from "../firebase";
import { httpsCallable } from 'firebase/functions';
import { today, isCalendarDay } from '../day';
import type { Order, OrderStatus, PurchaseOrder, IssuedStatement, PendingStatementEdit, OemCostEvidence } from "../types";
import { requireActiveReleaseId } from '../releaseGate';
import { buildProductLot, withCarryOverProductLot, lotQtyRemaining } from "../lotUtils";
import { companyOf, poLines, type Item, type CompanyId } from '../types';
import { canConfirmPurchaseOrderReceiptItem, tracksQuantityLots, quantityLotUnitKg } from '../itemTaxonomy';
import { itemKg, type OrderUnitInputs } from '../orderUnits';
import { getBomIndex } from '../bomIndex';
import { getPackIndex } from '../packIndex';
import { anchorLotsByQty } from '../lotAnchor';
import { DENSITY, baseRawName, parsePackageKg } from '../../constants/formula';
import { receiptToKg } from '../lotUtils';
import { isRawHolder } from '../rawHolder';
import { rawLotTarget } from '../rawReceipt';
import { readRawCommandInTransaction, prepareRawCommand, writePreparedRawCommand } from './rawInventoryService';
import type { RawInventoryCommand } from '../rawInventoryCore';
import type { ItemReceipt } from '../receipt';
import { statementBlockReason } from "../statementGuard";
//  컬렉션 이름을 **글자가 아니라 목록에서** 받는다 — 오타가 컴파일에서 걸린다(2026-09-06)
import type { CollectionName } from '../collections';
import { COL } from '../collections';
import { withClaimCompany } from '../companyWriteBoundary';
import { openingDocId } from '../types';
import type { OpeningPartnerCode } from '../openingPartnerBalance';
import { AR, AP, BANK, INVENTORY } from '../autoJournal';
import { STANDARD_ACCOUNT } from '../accountChart';
import type { LoanContract } from '../loanLedger';
import type { CashAccount, AccountCode } from '../types';

const protocolCollections=new Set<string>(['items','orders','rawInventories','rawMaterialLedger','rawInventoryJobs','rawInventoryReversalGuards','productionRecords']);
const orderInventoryFields=['status','items','inventoryOperation','inventoryGenerationCompletion','productionRecordIndex','producedAt','shippedOut','productConsumedLots','rawConsumedLots','itemInventory','inventorySnapshots','rawInventoryAttempt','deliveredAt'];
const tombstoneRef=(store:Firestore,companyId:string,itemId:string)=>doc(store,COL.inventoryWriterDeletions,companyId+'__'+itemId);
function assertTombstone(data:Record<string,any>|undefined,companyId:string,itemId:string):void{
 if(data&&(data.companyId!==companyId||data.itemId!==itemId||data.inventoryWriterProtocolVersion!==1||!Number.isSafeInteger(data.deletionRevision)||data.deletionRevision<1||!Number.isSafeInteger(data.lastDeletedItemRevision)||data.lastDeletedItemRevision<0||data.beforeRevision!==data.lastDeletedItemRevision))throw Error('품목 삭제의 회사·버전 기록이 다릅니다.');
}
function protocolWriteData(name:string,before:Record<string,any>|undefined,data:Record<string,any>,tombstone?:Record<string,any>):Record<string,any>{
 if(name==='items'){
  if(before){
   // 품목 전체 사본의 재고는 편집창을 열 때 값이다. 새 revision을 붙여 낡은 재고를 다시 쓰지 않는다.
   const whole='name' in data||'type' in data||'id' in data;
   if(whole&&ITEM_INVENTORY_FIELDS.some(field=>field in data&&!inventoryWriterSame(before[field],data[field])))throw Error('품목 사본의 재고·로트·예약이 현재와 다릅니다. 재고 작업 결과를 확인한 뒤 다시 열어 주세요.');
   const next={...data};
   // 전체 저장도 재고 필드가 생략됐다는 이유로 현재 로트·예약을 삭제하지 않는다.
   for(const field of ITEM_INVENTORY_FIELDS)if(!(field in next)&&field in before)next[field]=before[field];
   return protectItemInventoryPatch(before,next);
  }
  const floor=tombstone?.lastDeletedItemRevision;
  return advanceInventoryWriterProtocol(floor===undefined?undefined:{inventoryWriterProtocolVersion:1,inventoryWriteRevision:floor},data);
 }
 if(name==='orders'){
  for(const field of ['retirementId','retirementClaimPending']){
   if(Object.keys(data).some(key=>key===field||key.startsWith(field+'.'))&&!inventoryWriterSame(data[field],before?.[field]))throw Error('주문 해제 영수증은 서버에서만 변경합니다.');
  }
  const next={...data};
  for(const field of ['retirementId','retirementClaimPending'])if(before&&field in before)next[field]=before[field];
  return protectInventoryWriterPatch(before,next,orderInventoryFields.filter(field=>Object.keys(data).some(key=>key===field||key.startsWith(field+'.'))).flatMap(field=>Object.keys(data).filter(key=>key===field||key.startsWith(field+'.'))));
 }
 return protectInventoryWriterPatch(before,data);
}
export type ItemSaveOptions = { reconcileSmartStoreMarker?: true };
async function protocolGatewayWrite(store:Firestore,name:CollectionName,ref:ReturnType<typeof doc>,data:Record<string,any>,mode:'set'|'merge'|'update',options?:ItemSaveOptions):Promise<void>{
 await runInventoryWriterTransaction(store,await captureInventoryWriterContext(store,{requestIdentity:JSON.stringify({name,id:ref.id,data,mode,options}),companyId:String(data.companyId),getCurrentUser:()=>auth?.currentUser,ready:authReady}),async tx=>{
  const snap=await tx.get(ref),before=snap.exists()?snap.data():undefined;
  const tomb=name==='items'&&!snap.exists()?await tx.get(tombstoneRef(store,String(data.companyId),ref.id)):undefined;
  if(before&&companyOf(before)!==data.companyId)throw Error('다른 회사 문서를 수정할 수 없습니다.');
  if(tomb)assertTombstone(tomb.exists()?tomb.data():undefined,String(data.companyId),ref.id);
  if(mode==='update'&&!snap.exists())throw Error('수정할 문서를 찾을 수 없습니다.');
  const scoped=protocolWriteData(name,before,data,tomb?.exists()?tomb.data():undefined);
  // 사용자가 저장한 체크값을 옛 채널 표식이 다시 켜지 않게 한다. 최신 배열의 다른 연결은 보존한다.
  if(options?.reconcileSmartStoreMarker===true&&name==='items'&&mode==='update'&&before?.type==='product'
    &&Object.hasOwn(data,'isSmartStore')&&typeof data.isSmartStore==='boolean'
    &&Array.isArray(before.partnerIds)&&before.partnerIds.every(value=>typeof value==='string')&&before.partnerIds.includes('SMARTSTORE')){
    scoped.partnerIds=arrayRemove('SMARTSTORE');
  }
  if(mode==='update')tx.update(ref,scoped);else tx.set(ref,scoped,mode==='merge'?{merge:true}:{});
 });
}

/**
 * 업무문서를 만드는 모든 화면이 같은 회사 판정을 쓴다. 화면의 currentUser/companyId는
 * 조작 가능한 상태값이므로 Firebase Auth가 서명한 custom claim을 기준으로 삼는다.
 */
export const companyScopedWriteData = async (
  collectionName: CollectionName,
  data: Record<string, unknown>,
) => {
  await authReady;
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 만료되어 저장하지 않았습니다. 다시 로그인해 주세요.');
  const token = await user.getIdTokenResult();
  return withClaimCompany(collectionName, data, { companyId: token.claims.companyId });
};

/** 명시적으로 추가한 기초 계정만 저장하며 기존 계정은 덮어쓰지 않는다. */
export async function createOpeningAccountCodeWithDb(store: Firestore, companyId: CompanyId, account: AccountCode): Promise<'created' | 'unchanged'> {
  if (!['taebaek', 'punghoe'].includes(companyId) || !account ||
      !['자산', '부채', '자본'].includes(account.type ?? '') ||
      !['debit', 'credit'].includes(account.normalBalance ?? '') ||
      typeof account.code !== 'string' || account.code === '331' || !account.code.trim() || account.code !== account.code.trim() ||
      typeof account.name !== 'string' || !account.name.trim() || account.name !== account.name.trim() ||
      account.id !== `opening-account-${companyId}-${encodeURIComponent(account.code)}`) {
    throw new Error('기초 계정의 코드·이름·분류·차대 정보를 확인해 주세요.');
  }
  const data = stripUndefined({ ...account, companyId });
  return runTransaction(store, async tx => {
    const ref = doc(store, 'accountCodes', account.id);
    const snapshot = await tx.get(ref);
    if (snapshot.exists()) {
      const original = snapshot.data();
      if (Object.keys(data).some(key => original[key] !== data[key])) {
        throw new Error('이미 다른 회사 또는 내용으로 등록된 기초 계정입니다.');
      }
      return 'unchanged';
    }
    tx.set(ref, data);
    return 'created';
  });
}

export async function createOpeningAccountCode(companyId: CompanyId, account: AccountCode): Promise<void> {
  const scoped = await companyScopedWriteData('accountCodes', { companyId });
  if (scoped.companyId !== companyId) throw new Error('다른 회사 계정은 등록할 수 없습니다.');
  await createOpeningAccountCodeWithDb(db, companyId, account);
}

export async function activeReleaseId(): Promise<string> {
  await authReady;
  return requireActiveReleaseId((await getDoc(doc(db, 'appMeta', 'releaseCutover'))).data());
}

export async function editIssuedStatementCommand(id: string, patch: Partial<IssuedStatement>, expectedRevision: number, operationId: string, pendingEdit?: PendingStatementEdit): Promise<void> {
  await authReady;
  if (!auth.currentUser) throw new Error('로그인이 만료됐습니다. 다시 로그인해 주세요.');
  const releaseId = await activeReleaseId();
  const call = httpsCallable(functions, 'editIssuedStatementCommand');
  let approval: { pendingEditRequestId: string; pendingEditRequestHash: string } | undefined;
  if (pendingEdit) {
    const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key,canonical(item)])) : value;
    const snapshot = Object.fromEntries(Object.entries(stripUndefined(pendingEdit)).filter(([key]) => key !== 'id'));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(snapshot))));
    approval = { pendingEditRequestId: pendingEdit.id, pendingEditRequestHash: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('') };
  }
  await call({ statementId: id, patch: stripUndefined(patch), expectedRevision, operationId, releaseId, ...(approval ?? {}) });
}

export async function issueOemFeeVoucherCommand(input: { poId: string; perKg: number; statement: IssuedStatement }): Promise<string> {
  const releaseId = await activeReleaseId();
  const scoped = await companyScopedWriteData('issuedStatements', stripUndefined(input.statement) as Record<string, unknown>);
  const reason = statementBlockReason(scoped as Partial<IssuedStatement>);
  if (reason) throw new Error(`가공비 전표를 만들 수 없습니다 — ${reason}`);
  const call = httpsCallable<typeof input & { releaseId: string }, string>(functions, 'issueOemFeeVoucherCommand');
  return (await call({ ...input, releaseId, statement: scoped as unknown as IssuedStatement })).data;
}

export async function getOemReceiptRecoveryContext(companyId:CompanyId,poId:string,expectedActorUid?:string){
 await authReady;const user=auth.currentUser;if(!user)throw Error('로그인을 확인한 뒤 입고 요청을 처리해 주세요.');
 const uid=user.uid;if(expectedActorUid&&uid!==expectedActorUid)throw Error('입고 요청의 로그인 계정이 변경되었습니다.');
 const token=await user.getIdTokenResult();
 const isCurrent=()=>auth.currentUser?.uid===uid;
 if(!isCurrent()||token.claims.companyId!==companyId||token.claims.isAdmin!==true||typeof token.claims.employeeId!=='string')throw Error('현재 회사의 관리자 계정을 확인해 주세요.');
 const scope:OemReceiptScope={companyId,actorUid:uid,poId};return {scope,entry:readOemReceiptEntry(scope),isCurrent};
}
export async function receiveOemFinishedGoodsCommand(input: {
  poId: string; operationId: string; date: string; returns: { itemId: string; qty: number }[]; unitPricePerKg?: number;
  oemCostEvidence?: OemCostEvidence;
  bulk?: { material: string; kg: number; rawItemId?: string }[];
  releaseId?:string;
},expectedCompanyId?:CompanyId,expectedActorUid?:string): Promise<{ status: 'applied' | 'duplicate'; receivedKg: number; loss: number; lotNos: Record<string, string> }> {
 let scope:OemReceiptScope|undefined,hadPrior=false,entered=false;
 try{
 await authReady;const user=auth.currentUser;if(!user)throw Error('로그인을 확인한 뒤 입고 요청을 처리해 주세요.');
 const uid=user.uid;
 if(expectedActorUid&&uid!==expectedActorUid)throw Error('입고 요청의 로그인 계정이 변경되었습니다. 원문을 보존했습니다.');
 const token=await user.getIdTokenResult(),companyId=token.claims.companyId;
 if((companyId!=='taebaek'&&companyId!=='punghoe')||expectedCompanyId&&companyId!==expectedCompanyId
  ||token.claims.isAdmin!==true||typeof token.claims.employeeId!=='string'||auth.currentUser?.uid!==uid)throw Error('현재 회사의 관리자 계정을 확인해 주세요.');
 scope={companyId,actorUid:uid,poId:input.poId};
 const current=()=>auth.currentUser?.uid===uid;
 const before=readOemReceiptEntry(scope);hadPrior=before.packet!==null||before.legacy;
 if(before.legacy)throw Error('과거 입고 요청의 최초 계정과 송신 원문을 확인할 수 없습니다. 배치 입고 이력과 재고를 확인해 주세요.');
 if(before.deleted&&(!before.packet||JSON.stringify(input)!==JSON.stringify(before.packet.request)))throw Error('이 배치의 이전 입고 결과가 미확인이라 새 입고를 막았습니다. 최초 송신 요청으로 배치 입고 결과를 확인해 주세요.');
 const {releaseId:_release,...business}=input;
 let entry=before;
 if(before.packet){const {releaseId:_oldRelease,...oldBusiness}=before.packet.request;
  if(JSON.stringify(oldBusiness)!==JSON.stringify(business))throw Error('이 배치의 최초 입고 송신 원문이 다릅니다. 실패 작업에서 같은 요청을 확인해 주세요.');
 }else{
  const releaseId=await activeReleaseId();if(!current())throw Error('입고 요청의 로그인 계정이 변경되었습니다.');
  entry=await pinOemReceiptPacket(scope,{...business,releaseId},current);
 }
 const request=entry.packet!.request;
 const assertActor=async()=>{const latest=await user.getIdTokenResult();if(!current()||latest.claims.companyId!==companyId||latest.claims.isAdmin!==true)throw Error('입고 요청의 계정이나 회사 권한이 변경되었습니다. 원문을 보존했습니다.');};
 await assertActor();
  const call = httpsCallable<typeof input & { releaseId: string },
    { status: 'applied' | 'duplicate'; receivedKg: number; loss: number; lotNos: Record<string, string> }>(functions, 'receiveOemFinishedGoodsCommand');
 entered=true;const result=(await call(request)).data;await assertActor();
 if(!result||!['applied','duplicate'].includes(result.status)||!Number.isFinite(result.receivedKg)||!Number.isFinite(result.loss)
  ||!result.lotNos||typeof result.lotNos!=='object'||Object.values(result.lotNos).some(value=>typeof value!=='string'))throw Error('가공입고 응답을 확인할 수 없습니다. 같은 요청의 처리 결과를 확인해 주세요.');
 await withOemReceiptLock(scope,()=>{const saved=readOemReceiptEntry(scope!);if(saved.packetText!==entry.packetText)throw Error('다른 창의 입고 송신 원문이 변경되었습니다. 원문을 보존했습니다.');acknowledgeOemReceiptPacket(entry);},current);
 return result;
 }catch(error){
  if(scope&&!entered&&!hadPrior){
   try{const now=readOemReceiptEntry(scope);if(!now.packet&&!now.legacy)markOemReceiptPreCallFailure(error,scope);}catch{/* 손상되거나 기존 원문이 있으면 미확인 상태로 보존한다. */}
  }
  throw error;
 }
}

export const subscribeToDocument = <T>(
  collectionName: CollectionName,
  docId: string,
  callback: (data: T | null) => void
) => {
  return onSnapshot(doc(db, collectionName, docId), (snap) => {
    callback(snap.exists() ? (snap.data() as T) : null);
  });
};

export const setDocument = async (collectionName: CollectionName, docId: string, data: any) => {
  const scoped = await companyScopedWriteData(collectionName, itemWritePayload(collectionName, stripUndefined(data)));
  if(protocolCollections.has(collectionName)){await protocolGatewayWrite(db,collectionName,doc(db,collectionName,docId),scoped,'merge');return;}
  await setDoc(doc(db, collectionName, docId), scoped, { merge: true });
};

/** Existing 108/251 aggregates are frozen; new partner balances live in vouchers. */
export async function saveOpeningBalancesWithDb(
  store: Firestore, companyId: CompanyId, date: string, amounts: Record<string, number>,
) {
  const ref = doc(store, 'openingBalances', openingDocId(companyId));
  await runTransaction(store, async tx => {
    const snap = await tx.get(ref);
    if (snap.exists() && snap.data().companyId !== companyId) throw new Error('다른 회사 기초잔액입니다.');
    if ((snap.data()?.hasPartnerOpening || snap.data()?.hasLoanOpening || snap.data()?.hasCashOpening || snap.data()?.hasInventoryOpening) && snap.data()?.date !== date) {
      throw new Error('연결된 기초 전표가 있어 기준일을 변경할 수 없습니다.');
    }
    for (const code of [AR, AP]) {
      const before = Number(snap.data()?.amounts?.[code] ?? 0);
      const after = Number(amounts[code] ?? 0);
      if (before !== after) throw new Error(`${code} 기초 합계는 직접 변경할 수 없습니다. 거래처별 기초 전표를 등록하세요.`);
    }
    if (snap.data()?.hasLoanOpening) for (const code of ['260', '293']) {
      if (Number(snap.data()?.amounts?.[code] ?? 0) !== Number(amounts[code] ?? 0)) {
        throw new Error(`${code} 기초 합계는 직접 변경할 수 없습니다. 대출 기초 전표를 확인하세요.`);
      }
    }
    if (snap.data()?.hasCashOpening) for (const code of [BANK, STANDARD_ACCOUNT.CASH]) {
      if (Number(snap.data()?.amounts?.[code] ?? 0) !== Number(amounts[code] ?? 0)) {
        throw new Error(`${code} 기초 합계는 직접 변경할 수 없습니다. 계좌 기초 전표를 확인하세요.`);
      }
    }
    if (snap.data()?.hasInventoryOpening && Number(snap.data()?.amounts?.[INVENTORY] ?? 0) !== Number(amounts[INVENTORY] ?? 0)) {
      throw new Error('146 재고자산 기초 합계는 직접 변경할 수 없습니다. 품목별 기초 전표를 확인하세요.');
    }
    if (!isCalendarDay(date) || Object.values(amounts).some(v => !Number.isFinite(v) || v < 0)) {
      throw new Error('기초일과 계정별 금액을 확인하세요.');
    }
    // Replace the amounts map: merge would silently retain an account the user cleared.
    tx.set(ref, { id: openingDocId(companyId), companyId, date, amounts,
      ...(snap.data()?.hasPartnerOpening ? { hasPartnerOpening: true } : {}),
      ...(snap.data()?.hasLoanOpening ? { hasLoanOpening: true } : {}),
      ...(snap.data()?.hasCashOpening ? { hasCashOpening: true } : {}),
      ...(snap.data()?.hasInventoryOpening ? { hasInventoryOpening: true } : {}) });
  });
}

export async function saveOpeningBalances(companyId: CompanyId, date: string, amounts: Record<string, number>) {
  await authReady;
  const token = await auth.currentUser?.getIdTokenResult();
  if (token?.claims.companyId !== companyId) throw new Error('현재 로그인한 회사와 다른 회사에는 저장할 수 없습니다.');
  return saveOpeningBalancesWithDb(db, companyId, date, amounts);
}

/** Save one opening partner balance without overwriting an existing voucher on retry. */
export async function createOpeningPartnerBalance(companyId: CompanyId, date: string, partnerId: string, code: OpeningPartnerCode, amount: number) {
  return runFinancialOpening(companyId,{kind:'partner-create',date,partnerId,code,amount});
}

/** Register the loan and its opening liability together; ordinary borrowing uses a zero opening principal. */
export async function createLoanWithOpening(companyId: CompanyId, loan: LoanContract) {
  return runFinancialOpening(companyId,{kind:'loan-create',loan});
}

/** 기존 계약의 시작일과 현재 원금 잔액을 함께 정정한다. 전표 없는 옛 계약은 보조원장만 갱신한다. */
export async function updateLoanOpening(companyId: CompanyId, originalLoan: LoanContract, newDate: string, targetCurrentBalance: number) {
  await runFinancialOpening(companyId,{kind:'loan-update',original:originalLoan,newDate,targetBalance:targetCurrentBalance});
}

/** The account ledger and the accounting opening voucher are one operation. */
export async function createCashAccountWithOpening(companyId: CompanyId, account: CashAccount) {
  return runFinancialOpening(companyId,{kind:'account-create',account});
}

/** 최초 품목 재고와 146 재고자산 기초 전표를 하나의 작업으로 등록한다. */
export async function createOpeningInventory(companyId: CompanyId, date: string, itemId: string, quantity: number, value: number, _inputs?: OrderUnitInputs): Promise<'created' | 'unchanged'> {
  const uid = auth.currentUser?.uid;
  const assertActor = () => { if (!uid || auth.currentUser?.uid !== uid) throw new Error('로그인 사용자가 변경되었습니다. 기초 재고를 보내지 않았습니다.'); };
  await authReady; assertActor();
  const token = await auth.currentUser!.getIdTokenResult(); assertActor();
  if (token.claims.companyId !== companyId || token.claims.isAdmin !== true) throw new Error('현재 회사 관리자만 기초 재고를 등록할 수 있습니다.');
  const releaseId = await activeReleaseId(); assertActor();
  const call = httpsCallable<unknown, 'created' | 'unchanged'>(functions, 'createOpeningInventoryCommand');
  const result = await call({ companyId, date, itemId, quantity, value, releaseId }); assertActor();
  return result.data;
}

export const subscribeToCollection = <T extends { id: string }>(
  collectionName: CollectionName,
  callback: (data: T[]) => void,
  constraints: QueryConstraint[] = [],
  onError: (error: Error) => void = error => console.error(`[Firestore 구독 실패] ${collectionName}`, error),
) => {
  const q = query(collection(db, collectionName), ...constraints);
  const cache = new Map<string, T>();

  return onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
    const changes = snapshot.docChanges();
    for (const change of changes) {
      if (change.type === 'added' || change.type === 'modified') {
        cache.set(change.doc.id, { id: change.doc.id, ...change.doc.data() } as T);
      } else if (change.type === 'removed') {
        cache.delete(change.doc.id);
      }
    }
    callback(Array.from(cache.values()));
  }, onError);
};

// 1회 읽기 (정적 데이터용)
export const fetchCollection = async <T extends { id: string }>(
  collectionName: CollectionName,
  constraints: QueryConstraint[] = []
): Promise<T[]> => {
  const q = query(collection(db, collectionName), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as T));
};

// 날짜 기준 과거 N일치 구독
export const subscribeToRecentCollection = <T extends { id: string }>(
  collectionName: CollectionName,
  dateField: string,
  daysBack: number,
  callback: (data: T[]) => void,
  extraConstraints: QueryConstraint[] = [],
) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  // dateField이 ISO string이면 toISOString(), YYYY-MM-DD면 slice
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  // 회사 분리용 복합 인덱스가 생성되는 동안에도 목록이 비지 않도록 회사 조건으로
  // 먼저 구독하고 최근 날짜는 클라이언트에서 거른다.
  return subscribeToCollection<T>(
    collectionName,
    rows => callback(rows.filter(row => String((row as Record<string, unknown>)[dateField] ?? '') >= cutoffStr)),
    extraConstraints,
  );
};

// 특정 날짜 범위 one-time fetch (과거 데이터 온디맨드)
export const fetchDateRange = async <T extends { id: string }>(
  collectionName: CollectionName,
  dateField: string,
  startDate: string,
  endDate: string,
  extraConstraints: QueryConstraint[] = [],
): Promise<T[]> => {
  const q = query(
    collection(db, collectionName),
    where(dateField, '>=', startDate),
    where(dateField, '<=', endDate),
    ...extraConstraints,
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as T));
};

const stripUndefined = (obj: any): any => {
  if (Array.isArray(obj)) return obj.map(v => stripUndefined(v));
  if (obj !== null && typeof obj === 'object') {
    // SDK 값은 내부 참조를 순회하면 손상되거나 순환한다. 공식 공개 클래스만 원문으로 전달한다.
    const prototype = Object.getPrototypeOf(obj);
    if (prototype !== Object.prototype && prototype !== null
      && (obj instanceof Date || obj instanceof Timestamp || obj instanceof DocumentReference
        || obj instanceof GeoPoint || obj instanceof Bytes || obj instanceof FieldValue || obj instanceof VectorValue)) return obj;
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefined(v)])
    );
  }
  return obj;
};

/**
 * items 컬렉션의 분류 3단은 DB 필드 이름과 코드 이름이 같다(type/category/subtype).
 * 예전엔 코드가 옛 이름(category=타입·subtype=카테고리·subtype2=서브타입)을 써서
 * 쓰기 직전에 뒤집어 줬는데, 2026-08-23에 코드를 DB 이름으로 맞추고 그 변환을 없앴다.
 */

export const addItem = async (collectionName: CollectionName, item: any) => {
  /**
   * **차·대를 못 채우는 전표는 안 만든다.** 만드는 길이 여러 갈래(전표화면·확인사항·반품·임가공)라
   * 화면마다 막으면 한 곳은 반드시 새다. 쓰는 문 하나에서 막는다.
   * (스크립트는 raw Firestore를 쓰므로 여기 안 걸린다 — 일부러 하는 정정은 막을 이유가 없다)
   */
  if (collectionName === 'issuedStatements') {
    const reason = statementBlockReason(item);
    if (reason) throw new Error(`전표를 만들 수 없습니다 — ${reason}`);
  }
  const { id, ...raw } = item;
  const data = await companyScopedWriteData(collectionName, itemWritePayload(collectionName, stripUndefined(raw)));
  if(protocolCollections.has(collectionName)){
    const ref=id?doc(db,collectionName,id):doc(collection(db,collectionName));
    await protocolGatewayWrite(db,collectionName,ref,data,'set');return ref.id;
  }
  if (collectionName === 'settlements') {
    const settlementRef = id ? doc(db, collectionName, id) : doc(collection(db, collectionName));
    await runTransaction(db, async tx => {
      const [cash, statement] = await Promise.all([
        tx.get(doc(db, 'cashEntries', String(data.cashEntryId || 'missing'))),
        tx.get(doc(db, 'issuedStatements', String(data.statementId || 'missing'))),
      ]);
      if (!statement.exists() || companyOf(statement.data()) !== data.companyId) throw new Error('연결할 전표를 확인해 주세요.');
      if (!cash.exists() || companyOf(cash.data()) !== data.companyId) throw new Error('연결할 자금 내역을 확인해 주세요.');
      if (cash.data().balanceAdjustment) throw new Error('잔액 조정은 거래처 전표와 매칭할 수 없습니다.');
      const partnerId = statement.data().partnerId;
      if (typeof partnerId !== 'string' || !partnerId) throw new Error('연결할 전표의 거래처를 확인해 주세요.');
      const stateRef = doc(db, 'appMeta', `partnerPaymentState_${data.companyId}_${partnerId}`);
      const state = await tx.get(stateRef);
      const revision = state.exists() ? state.data().revision : 0;
      if (state.exists() && (state.data().companyId !== data.companyId || state.data().partnerId !== partnerId)) throw new Error('거래처 정산 회사가 일치하지 않습니다.');
      if (!Number.isSafeInteger(revision) || revision < 0 || !Number.isSafeInteger(revision + 1)) throw new Error('거래처 정산 상태가 손상되었습니다.');
      if (state.exists()) tx.update(stateRef, { revision: revision + 1 });
      else tx.set(stateRef, { companyId: data.companyId, partnerId, revision: revision + 1 });
      tx.set(settlementRef, data);
    });
    return settlementRef.id;
  }
  if (id) {
    await setDoc(doc(db, collectionName, id), data);
    return id;
  } else {
    const docRef = await addDoc(collection(db, collectionName), data);
    return docRef.id;
  }
};

export const updateItem = async (collectionName: CollectionName, id: string, data: any, options?:ItemSaveOptions) => {
  if(options?.reconcileSmartStoreMarker===true&&Object.keys(data).some(key=>key==='partnerIds'||key.startsWith('partnerIds.')))
    throw Error('품목 저장 호출에 거래처 연결 배열을 함께 보낼 수 없습니다.');
  const docRef = doc(db, collectionName, id);
  // getFirestore는 ignoreUndefinedProperties가 꺼져 있어 undefined가 있으면 updateDoc이 throw한다.
  // (예: 전표 items[].accountCode가 빈 값이면 undefined로 들어와 저장이 통째로 실패) → 깊게 제거.
  // 수정도 로그인 claim의 회사를 함께 보낸다. 생성만 회사 경계를 지나고 수정은 화면값에 맡기면
  // 오피스톡 초대처럼 강화된 규칙에서 저장 경로마다 동작이 갈린다.
  const scoped = await companyScopedWriteData(collectionName, itemWritePayload(collectionName, stripUndefined(data)));
  if(protocolCollections.has(collectionName)){await protocolGatewayWrite(db,collectionName,docRef,scoped,'update',options);return;}
  await updateDoc(docRef, scoped);
};

export const deleteItem = async (collectionName: CollectionName, id: string) => {
  if(collectionName==='items'){await commitCompanyWrites([{kind:'delete',collection:collectionName,id}]);return;}
  const docRef = doc(db, collectionName, id);
  await deleteDoc(docRef);
};

/**
 * 알림의 읽음·숨김은 여러 직원이 같은 문서에 자기 ID를 보탠다.
 * 화면 배열을 다시 써버리면 동시 처리 때 다른 직원 ID가 사라지므로 arrayUnion만 쓴다.
 */
export const markNotificationForUser = async (
  id: string,
  field: 'readBy' | 'dismissedBy',
  userId: string,
) => {
  await updateDoc(doc(db, 'notifications', id), { [field]: arrayUnion(userId) });
};

export const subscribeToSubcollection = <T extends { id: string }>(
  parentCollection: string,
  parentId: string,
  subCollectionName: string,
  callback: (data: T[]) => void
) => {
  const q = query(collection(db, parentCollection, parentId, subCollectionName));
  return onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
    const items = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as T));
    callback(items);
  });
};

export const addSubItem = async (
  parentCollection: CollectionName,
  parentId: string,
  subCollectionName: string,
  item: any
) => {
  const { id, ...raw } = item;
  const data = await companyScopedWriteData(parentCollection, stripUndefined(raw));
  if (id) {
    await setDoc(doc(db, parentCollection, parentId, subCollectionName, id), data);
    return id;
  } else {
    const docRef = await addDoc(collection(db, parentCollection, parentId, subCollectionName), data);
    return docRef.id;
  }
};

export const updateSubItem = async (
  parentCollection: string,
  parentId: string,
  subCollectionName: string,
  id: string,
  data: any
) => {
  const docRef = doc(db, parentCollection, parentId, subCollectionName, id);
  await updateDoc(docRef, data);
};

export const deleteSubItem = async (
  parentCollection: string,
  parentId: string,
  subCollectionName: string,
  id: string
) => {
  const docRef = doc(db, parentCollection, parentId, subCollectionName, id);
  await deleteDoc(docRef);
};

// partner_item 컬렉션에 품목-거래처(Direction='out') 매핑 저장 — 기존 box/tape 설정 보존
export const setProductClients = async (itemId: string, partnerIds: string[]) => {
  const { getDocs, query: q, collection: col, where } = await import('firebase/firestore');

  // 회사별 보안 규칙은 목록 질의 자체에 companyId 조건이 있어야 허용한다.
  // 화면에서 이미 태백 품목만 보고 있어도 여기서 전체 회사를 조회하면 permission-denied가 난다.
  const scoped = await companyScopedWriteData('partner_item', {});
  const companyId = scoped.companyId as string;

  // 기존 레코드 조회 (Direction='out' 필터)
  const existing = await getDocs(q(
    col(db, 'partner_item'),
    where('companyId', '==', companyId),
    where('itemId', '==', itemId),
    where('Direction', '==', 'out'),
  ));
  const existingMap = new Map(existing.docs.map(d => [(d.data().partnerId ?? d.data().partnerId) as string, d.ref]));

  const ops: CompanyWriteOperation[] = [];

  // 연결 해제된 거래처 삭제
  existingMap.forEach((ref, partnerId) => {
    if (!partnerIds.includes(partnerId)) ops.push({ kind: 'delete', collection: 'partner_item', id: ref.id });
  });

  // 새로 연결된 거래처만 추가 (기존 레코드는 건드리지 않아 박스/테이프 설정 보존)
  for (const partnerId of partnerIds) {
    if (!existingMap.has(partnerId)) {
      const id = `${itemId}_${partnerId}_out`;
      ops.push({ kind: 'set', collection: 'partner_item', id, data: { id, itemId, partnerId, Direction: 'out' } });
    }
  }

  await commitCompanyWrites(ops);
};

// partner_item 컬렉션에 품목-거래처(Direction='in') 매핑 저장
export const setProductSuppliers = async (itemId: string, inboundPartnerIds: string[]) => {
  const { getDocs, query: q, collection: col, where } = await import('firebase/firestore');

  const scoped = await companyScopedWriteData('partner_item', {});
  const companyId = scoped.companyId as string;

  const existing = await getDocs(q(
    col(db, 'partner_item'),
    where('companyId', '==', companyId),
    where('itemId', '==', itemId),
    where('Direction', '==', 'in'),
  ));
  const existingMap = new Map(existing.docs.map(d => [(d.data().partnerId ?? d.data().partnerId) as string, d.ref]));

  const ops: CompanyWriteOperation[] = [];

  existingMap.forEach((ref, partnerId) => {
    if (!inboundPartnerIds.includes(partnerId)) ops.push({ kind: 'delete', collection: 'partner_item', id: ref.id });
  });

  for (const partnerId of inboundPartnerIds) {
    if (!existingMap.has(partnerId)) {
      const id = `${itemId}_${partnerId}_in`;
      ops.push({ kind: 'set', collection: 'partner_item', id, data: { id, itemId, partnerId, Direction: 'in' } });
    }
  }

  await commitCompanyWrites(ops);
};

/* ────────────────────────────────────────────────────────────────────────────
 * 아래 셋은 **문을 넓히려고** 더한 것이다.
 *
 * 예전엔 이 파일에 없는 기능(조건 조회·트랜잭션·배치)이 필요하면 화면이 firebase를
 * 직접 불렀다. 그렇게 8개 파일이 밖으로 샜다. 나중에 다른 DB로 옮기든 회사 격리를
 * 한 곳에서 강제하든, **Firestore를 부르는 자리가 이 파일 하나여야** 손을 댈 수 있다.
 *
 * 여기 있는 것들은 일부러 **Firestore 타입을 밖으로 안 내보낸다** — 받는 것도 주는 것도
 * 평범한 객체다. 그래야 부르는 쪽이 Firestore를 몰라도 된다.
 * ──────────────────────────────────────────────────────────────────────────── */

/** 한 필드가 어떤 값인 문서만. 컬렉션 전체를 읽어 거르는 것보다 싸다. */
export const fetchWhere = async <T extends { id: string }>(
  collectionName: CollectionName,
  field: string,
  value: unknown,
): Promise<T[]> => {
  const snap = await getDocs(query(collection(db, collectionName), where(field, '==', value)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as T));
};

/** 한 필드가 주어진 값들 중 하나인 문서. Firestore의 in 한도에 맞춰 30개씩 나눠 읽는다. */
export const fetchWhereIn = async <T extends { id: string }>(
  collectionName: CollectionName,
  field: string,
  values: readonly unknown[],
  companyId: CompanyId,
): Promise<T[]> => {
  const uniq = [...new Set(values)];
  if (uniq.length === 0) return [];
  const rows = new Map<string, T>();
  for (let i = 0; i < uniq.length; i += 30) {
    const snap = await getDocs(query(collection(db, collectionName), where('companyId', '==', companyId), where(field, 'in', uniq.slice(i, i + 30))));
    for (const d of snap.docs) rows.set(d.id, { id: d.id, ...d.data() } as T);
  }
  return [...rows.values()];
};

/** 한 필드가 어떤 값인 문서를 계속 지켜본다. 해지 함수를 돌려준다. */
/**
 * **id로 콕 집어 온다** — 앵커가 짚어 준 미결 전표처럼 몇 장만 필요할 때.
 *
 * Firestore `in`은 한 번에 30개까지라 30개씩 끊어 던진다. 없는 id는 그냥 안 온다.
 * 날짜 범위로 훑는 것과 달리 **읽는 양이 요청한 개수만큼**이라, 앵커가 값을 하는 자리다.
 */
export const fetchByIds = async <T extends { id: string }>(
  collectionName: CollectionName,
  ids: string[],
  companyId?: CompanyId,
): Promise<T[]> => {
  const uniq = [...new Set(ids.filter(Boolean))];
  const out: T[] = [];
  for (let i = 0; i < uniq.length; i += 30) {
    const snap = await getDocs(query(collection(db, collectionName), where(documentId(), 'in', uniq.slice(i, i + 30)), ...(companyId ? [where('companyId', '==', companyId)] : [])));
    for (const d of snap.docs) out.push({ id: d.id, ...d.data() } as T);
  }
  return out;
};

export const subscribeWhere = <T extends { id: string }>(
  collectionName: CollectionName,
  field: string,
  value: unknown,
  cb: (_rows: T[]) => void,
): (() => void) =>
  onSnapshot(
    query(collection(db, collectionName), where(field, '==', value)),
    (snap: QuerySnapshot<DocumentData>) => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as T))),
    () => cb([]),
  );

/**
 * 여러 문서를 **한꺼번에** 쓴다 — 중간에 끊겨 반만 쓰이는 일이 없다.
 * 재고 차감처럼 여러 품목이 같이 움직일 때 쓴다.
 */
export type CompanyWriteOperation =
  | { kind: 'set'; collection: CollectionName; id: string; data: Record<string, unknown>; merge?: boolean }
  | { kind: 'delete'; collection: CollectionName; id: string };

/** 배치 생성도 단건 생성과 같은 claim 회사 경계를 반드시 통과한다. */
export const commitCompanyWrites = async (ops: CompanyWriteOperation[]): Promise<void> => {
  if (!ops.length) return;
  if(ops.some(op=>protocolCollections.has(op.collection))){
    if(new Set(ops.map(op=>op.collection+'/'+op.id)).size!==ops.length)throw Error('같은 문서의 중복 저장은 한 원자 요청으로 합쳐 주세요.');
    const scoped=await Promise.all(ops.map(op=>companyScopedWriteData(op.collection,op.kind==='set'?itemWritePayload(op.collection,stripUndefined(op.data)):{})));
    if(ops.length+ops.filter(op=>op.kind==='delete'&&op.collection==='items').length>500)throw Error('연결 품목 삭제·저장은 한 거래의 저장 한도를 초과합니다.');
    await runInventoryWriterTransaction(db,await captureInventoryWriterContext(db,{requestIdentity:JSON.stringify({ops,scoped}),companyId:String(scoped[0].companyId),getCurrentUser:()=>auth?.currentUser,ready:authReady}),async tx=>{
      const refs=ops.map(op=>doc(db,op.collection,op.id));
      const snaps=await Promise.all(refs.map(ref=>tx.get(ref)));
      const tombs=await Promise.all(ops.map((op,index)=>op.collection==='items'&&(op.kind==='delete'||!snaps[index].exists())?tx.get(tombstoneRef(db,String(scoped[index].companyId),op.id)):Promise.resolve(undefined)));
      ops.forEach((op,index)=>{
        const before=snaps[index].exists()?snaps[index].data():undefined;
        if(before&&companyOf(before)!==scoped[index].companyId)throw Error('다른 회사 문서를 수정할 수 없습니다.');
        const tomb=tombs[index]?.exists()?tombs[index]!.data():undefined;
        if(op.collection==='items')assertTombstone(tomb,String(scoped[index].companyId),op.id);
        if(op.kind==='delete'){
          if(!before)return;
          if(op.collection==='items'&&before){
            const checked=advanceInventoryWriterProtocol(before,{}),beforeRevision=checked.inventoryWriteRevision-1;
            const deletionRevision=(tomb?.deletionRevision??0)+1;
            if(!Number.isSafeInteger(deletionRevision))throw Error('품목 삭제 기록 버전 한도를 초과했습니다.');
            tx.set(tombstoneRef(db,String(scoped[index].companyId),op.id),{companyId:scoped[index].companyId,itemId:op.id,inventoryWriterProtocolVersion:1,deletionRevision,beforeRevision,lastDeletedItemRevision:beforeRevision,deletedAt:new Date().toISOString()});
          }
          tx.delete(refs[index]);
        }else tx.set(refs[index],protocolCollections.has(op.collection)?protocolWriteData(op.collection,before,scoped[index],tomb):scoped[index],{merge:op.merge??false});
      });
    });
    return;
  }
  //  Firestore 배치는 한 번에 500건까지다. 넘으면 나눠 보낸다.
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + 400)) {
      const ref = doc(db, op.collection, op.id);
      if (op.kind === 'delete') {
        batch.delete(ref);
      } else {
        const data = await companyScopedWriteData(op.collection, itemWritePayload(op.collection, stripUndefined(op.data)));
        batch.set(ref, data, { merge: op.merge ?? false });
      }
    }
    await batch.commit();
  }
};

/** 캔 입고31개가 stock에만 남았던 사고: 품목·로트·입고근거를 같이 확정한다. */
export async function receiveUnitStock(receipt: ItemReceipt, inputs?: OrderUnitInputs): Promise<boolean> {
  const fixedInputs = inputs ?? { bom: getBomIndex(), pack: getPackIndex() };
  if (!Number.isFinite(receipt.quantity) || receipt.quantity <= 0) throw new Error('입고 수량은 0보다 커야 합니다.');
  const data = await companyScopedWriteData('itemReceipts', stripUndefined(receipt));
  return receiveUnitStockWithDb(db, data as unknown as ItemReceipt, fixedInputs);
}

export async function receiveUnitStockWithDb(store: Firestore, receipt: ItemReceipt, inputs?: OrderUnitInputs): Promise<boolean> {
  const fixedInputs = inputs ?? { bom: getBomIndex(), pack: getPackIndex() };
  if (!Number.isFinite(receipt.quantity) || receipt.quantity <= 0) throw new Error('입고 수량은 0보다 커야 합니다.');
  const data = stripUndefined(receipt);
  return runInventoryWriterTransaction(store,await captureInventoryWriterContext(store,{requestIdentity:JSON.stringify(receipt),companyId:receipt.companyId}), async tx => {
    const itemRef = doc(store, 'items', receipt.itemId);
    const receiptRef = doc(store, 'itemReceipts', receipt.id);
    const [itemSnap, receiptSnap] = await Promise.all([tx.get(itemRef), tx.get(receiptRef)]);
    if (!itemSnap.exists()) throw new Error('입고 품목이 없습니다.');
    const item = { ...itemSnap.data(), id: receipt.itemId } as Item;
    if (companyOf(item) !== data.companyId || !tracksQuantityLots(item)) throw new Error('입고 회사 또는 품목 분류가 변경되었습니다.');
    if (receiptSnap.exists()) {
      const saved = receiptSnap.data();
      if (['itemId', 'companyId', 'quantity', 'date', 'poId'].some(k => saved[k] !== data[k])) throw new Error('같은 입고번호의 내용이 다릅니다.');
      return false;
    }
    const stock = Number(item.stock ?? 0);
    if (!Number.isFinite(stock) || stock < 0) throw new Error('현재 재고를 먼저 확인해 주세요.');
    const unitKg = quantityLotUnitKg(item,itemKg(item, fixedInputs) || 0);
    const lots = withCarryOverProductLot(item.lots ?? [], stock, item.rawMaterialName || item.name, unitKg,
      { id: `carry:${receipt.id}`, receivedDate: receipt.date, createdAt: receipt.createdAt });
    if (Math.abs(lotQtyRemaining(lots) - stock) > 0.0001) throw new Error('품목 재고와 로트 잔량이 다릅니다. 기존 누락을 확인한 뒤 입고해 주세요.');
    const lot = { ...buildProductLot({ material: item.rawMaterialName || item.name, itemId: item.id,
      supplierName: receipt.partnerName, supplierId: receipt.partnerId, qtyIn: receipt.quantity, unitKg,
      receivedDate: receipt.date, poId: receipt.poId }), id: `receipt:${receipt.id}`, createdAt: receipt.createdAt };
    tx.update(itemRef, protectItemInventoryPatch(itemSnap.data(),{ stock: Math.round((stock + receipt.quantity) * 1000) / 1000, lots: stripUndefined([...lots, lot]) }));
    tx.set(receiptRef, data);
    return true;
  });
}

/** 발주 상태와 품목·원료 입고를 한 트랜잭션에서 확정한다. */
export async function confirmUnitPurchaseOrderReceipt(poId: string, addedBy?: string, allItems: Item[] = [], inputs?: OrderUnitInputs): Promise<boolean> {
  const fixedInputs = inputs ?? { bom: getBomIndex(), pack: getPackIndex() };
  await authReady;
  if (!auth.currentUser) throw new Error('로그인이 만료되었습니다.');
  const claim = (await auth.currentUser.getIdTokenResult()).claims.companyId as CompanyId;
  if (!claim) throw new Error('회사 권한이 없습니다.');
  return confirmUnitPurchaseOrderReceiptWithDb(db, claim, poId, addedBy, allItems, fixedInputs);
}

/** 에뮬레이터에서 같은 트랜잭션을 실제 보안 규칙으로 검증한다. */
export async function confirmUnitPurchaseOrderReceiptWithDb(store: Firestore, claim: CompanyId, poId: string, addedBy?: string, allItems: Item[] = [], inputs?: OrderUnitInputs): Promise<boolean> {
  // 조회 대기나 트랜잭션 재시도 중 다른 회사의 전역 색인을 읽지 않는다.
  const fixedInputs = inputs ?? { bom: getBomIndex(), pack: getPackIndex() };
  const now = new Date().toISOString();
  const date = today();
  const poRef = doc(store, 'purchaseOrders', poId);
  const currentPo = (await getDoc(poRef)).data();
  if (currentPo?.status === 'cancelled') throw new Error('취소된 발주는 다시 입고할 수 없습니다.');
  if (currentPo?.status === 'received') return false;
  // 옛 입고 방식으로 일부만 반영된 발주는 자동 재시도하면 중복 재고가 된다.
  const oldReceipts = await getDocs(query(collection(store, 'itemReceipts'), where('companyId', '==', claim), where('poId', '==', poId)));
  if (!oldReceipts.empty) throw new Error('이 발주에 이미 입고 기록이 있습니다. 기존 반영 내역을 먼저 확인해 주세요.');
  const oldRawReceipts = await getDocs(query(collection(store, 'rawMaterialLedger'), where('companyId', '==', claim), where('source.id', '==', poId)));
  if (!oldRawReceipts.empty) throw new Error('이 발주에 이미 원료 입고 기록이 있습니다. 기존 로트와 수불부를 먼저 확인해 주세요.');
  return runInventoryWriterTransaction(store,await captureInventoryWriterContext(store,{requestIdentity:JSON.stringify({poId,claim,now,addedBy}),companyId:claim}), async tx => {
    const poSnap = await tx.get(poRef);
    if (!poSnap.exists()) throw new Error('발주가 없습니다.');
    const po = { id: poId, ...poSnap.data() } as PurchaseOrder;
    if (companyOf(po) !== claim) throw new Error('발주 회사가 로그인 회사와 다릅니다.');
    if (po.poType === 'oem') throw new Error('외주 발주는 이 버튼으로 입고할 수 없습니다.');
    if (po.status === 'cancelled') throw new Error('취소된 발주는 다시 입고할 수 없습니다.');
    if (po.status === 'received') return false;
    if (po.status !== 'invoiced') throw new Error('입고대기 발주만 확정할 수 있습니다.');
    const lines = poLines(po);
    const lineKeys = lines.map(line => {
      const snapshot = readPurchaseUnitSnapshot(line);
      if (snapshot && (!Number.isSafeInteger(line.sourceLineIndex) || Number(line.sourceLineIndex) < 0))
        throw new Error('매입 단위 원전표 행번호가 없습니다.');
      return snapshot ? `${line.itemId}:line:${line.sourceLineIndex}` : line.itemId;
    });
    if (!lines.length || lines.length > 100 || new Set(lineKeys).size !== lines.length
      || lines.some(line => lines.filter(row => row.itemId === line.itemId).length > 1 && !readPurchaseUnitSnapshot(line)))
      throw new Error('발주 품목 구성을 먼저 확인해 주세요.');
    const refs = lines.map(line => ({ item: doc(store, 'items', line.itemId), receipt: doc(store, 'itemReceipts', `rcv-po-${encodeURIComponent(poId)}-${encodeURIComponent(line.itemId)}`) }));
    const itemSnaps = await Promise.all(refs.map(ref => tx.get(ref.item)));
    const receiptSnaps = await Promise.all(refs.map(ref => tx.get(ref.receipt)));
    const rawCommands: { command: RawInventoryCommand; legacy: Record<string, unknown> }[] = [];
    const writes = lines.map((line, i) => {
      if (!Number.isFinite(line.quantity) || line.quantity <= 0 || Math.abs(Math.round(line.quantity * 1000) - line.quantity * 1000) > 1e-6)
        throw new Error('발주 수량을 먼저 확인해 주세요.');
      if (!itemSnaps[i].exists()) throw new Error(`입고 품목이 없습니다: ${line.itemId}`);
      if (receiptSnaps[i].exists()) throw new Error('기존 입고 기록이 있어 중복 입고를 막았습니다.');
      const item = { id: line.itemId, ...itemSnaps[i].data() } as Item;
      if (companyOf(item) !== claim) throw new Error(`품목 회사가 다릅니다: ${item.name}`);
      const purchaseUnit = readPurchaseUnitSnapshot(line);
      if (purchaseUnit && (!isRawHolder(item) || purchaseUnit.purchaseQty !== line.quantity))
        throw new Error('매입 단위 스냅샷의 원료 품목·거래 수량이 다릅니다.');
      const unitStock = tracksQuantityLots(item);
      if (!canConfirmPurchaseOrderReceiptItem(item)) {
        const target = isRawHolder(item) ? { rawItem: item, baseName: item.rawMaterialName || baseRawName(item.name) }
          : rawLotTarget(allItems, item, item.name, claim);
        if (!target) throw new Error(`원료 로트 홀더가 없습니다: ${item.name}`);
        const unit = String(item.unit ?? line.unit ?? '').toLowerCase();
        const packaged = unit !== 'kg' && unit !== 'l';
        const packageKg = packaged ? itemKg(item, fixedInputs) || parsePackageKg(item.name) : undefined;
        if (!purchaseUnit && packaged && (!packageKg || !Number.isFinite(packageKg) || packageKg <= 0))
          throw new Error(`원료 포장 단위의 kg 환산값이 없습니다: ${item.name}`);
        const density = DENSITY[target.baseName] ?? item.density ?? 1;
        const kg = purchaseUnit ? purchaseUnit.inventoryQty : receiptToKg({ quantity: line.quantity, unit, density, packageKg });
        if (!Number.isFinite(kg) || kg <= 0) throw new Error(`원료 입고 kg을 확인해 주세요: ${item.name}`);
        rawCommands.push({ command: {
          companyId: claim, rawItemId: target.rawItem.id, materialSnapshot: target.baseName,
          operationId: purchaseUnit ? `po-receive:${poId}:${line.itemId}:line:${line.sourceLineIndex}` : `po-receive:${poId}:${line.itemId}`,
          effectiveAt: now.slice(0, 10) === date ? now : `${date}T12:00:00+09:00`,
          source: { type: 'purchase', id: poId }, actorName: addedBy,
          kind: 'receive', kg,
          lot: { supplierId: po.partnerId, supplierName: po.partnerName || '거래처',
            packageType: purchaseUnit?.purchaseUnit ?? (packaged ? item.packageType ?? (packageKg ? '캔' : undefined) : undefined),
            packageKg: purchaseUnit?.unitKg ?? packageKg, qtyIn: purchaseUnit?.purchaseQty ?? (packaged ? line.quantity : undefined), poId },
        }, legacy: { note: `${po.partnerName || '거래처'} 입고`, type: 'manual', addedBy,
          ...(purchaseUnit ? {} : {originalAmount: line.quantity, originalUnit: unit === 'l' ? 'L' : 'kg'}),
          ...(purchaseUnit ? {...purchaseUnit,sourceLineIndex:line.sourceLineIndex} : {}),
          ...(purchaseUnit ? { canSize: purchaseUnit.unitKg, canCount: purchaseUnit.purchaseQty } : packaged && packageKg ? { canSize: packageKg, canCount: line.quantity } : {}) } });
        return null;
      }
      const stock = Number(item.stock ?? 0);
      if (!Number.isFinite(stock) || stock < 0) throw new Error(`현재 재고를 확인해 주세요: ${item.name}`);
      if (!unitStock) return { item, stock, lots: item.lots ?? [], line };
      const unitKg = quantityLotUnitKg(item,itemKg(item, fixedInputs) || 0);
      const lots = withCarryOverProductLot(item.lots ?? [], stock, item.rawMaterialName || item.name, unitKg,
        { id: `carry:${refs[i].receipt.id}`, receivedDate: date, createdAt: now });
      if (Math.abs(lotQtyRemaining(lots) - stock) > 0.0001) throw new Error(`재고와 로트 잔량이 다릅니다: ${item.name}`);
      const lot = { ...buildProductLot({ material: item.rawMaterialName || item.name, itemId: item.id,
        supplierName: po.partnerName || '거래처', supplierId: po.partnerId, qtyIn: line.quantity, unitKg,
        receivedDate: date, poId }), id: `receipt:${refs[i].receipt.id}`, createdAt: now };
      return { item, stock, lots: [...lots, lot], line };
    });
    const rawReads = await Promise.all(rawCommands.map(row => readRawCommandInTransaction(tx, store, row.command)));
    rawCommands.forEach((row, i) => {
      const holder = rawReads[i].itemSnap.exists() ? { id: row.command.rawItemId, ...rawReads[i].itemSnap.data() } as Item : undefined;
      if (!holder || !isRawHolder(holder) || companyOf(holder) !== claim || baseRawName(holder.name) !== baseRawName(row.command.materialSnapshot))
        throw new Error(`원료 로트 홀더 연결이 변경됐습니다: ${row.command.materialSnapshot}`);
    });
    // 같은 홀더의 포장 SKU 여러 줄은 앞줄의 로트·재고를 다음 줄의 가상 입력으로 쓴다.
    // Firestore 읽기는 모두 끝낸 상태이며 쓰기는 각 원장 줄과 최종 홀더 상태를 한 거래로 묶는다.
    const virtualByHolder = new Map<string, { state: Extract<ReturnType<typeof prepareRawCommand>, { status: 'applied' }>['state']; itemData: Record<string, any> }>();
    const rawResults = rawCommands.map((row, i) => {
      const result = prepareRawCommand(row.command, rawReads[i], { now }, virtualByHolder.get(row.command.rawItemId));
      if (result.status !== 'applied') throw new Error(result.status === 'rejected' ? result.message : '기존 원료 입고 이력과 충돌합니다. 로트·수불부를 확인해 주세요.');
      virtualByHolder.set(row.command.rawItemId, {
        state: result.state,
        itemData: { ...rawReads[i].itemSnap.data(), stock: result.state.stockKg,
          lots: [...result.state.activeLots, ...result.state.recentDepletedLots] },
      });
      return result;
    });
    const receipts = writes.map((write, i) => write && stripUndefined({
      itemId: write.item.id, itemName: write.item.name, quantity: write.line.quantity,
      unit: write.item.unit, partnerId: po.partnerId, partnerName: po.partnerName || '거래처',
      date, poId, addedBy, createdAt: now, companyId: claim,
      id: refs[i].receipt.id,
    }));
    writes.forEach((write, i) => {
      if (!write) return;
      tx.update(refs[i].item, protectItemInventoryPatch(itemSnaps[i].data(),tracksQuantityLots(write.item)
        ? { stock: Math.round((write.stock + write.line.quantity) * 1000) / 1000, lots: stripUndefined(write.lots) }
        : { stock: Math.round((write.stock + write.line.quantity) * 1000) / 1000 }));
      tx.set(refs[i].receipt, receipts[i]);
    });
    rawCommands.forEach((row, i) => writePreparedRawCommand(tx, row.command, rawReads[i], rawResults[i], { now, legacy: row.legacy }));
    tx.update(poRef, { status: 'received', receivedAt: now });
    return true;
  });
}

/** 아직 입고되지 않은 일반 발주만 지운다. 전표와 재고 근거는 절대 함께 삭제하지 않는다. */
export async function deletePendingPurchaseOrder(poId: string): Promise<void> {
  await authReady;
  if (!auth.currentUser) throw new Error('로그인이 만료되었습니다.');
  const claim = (await auth.currentUser.getIdTokenResult()).claims.companyId as CompanyId;
  if (!claim) throw new Error('회사 권한이 없습니다.');
  await deletePendingPurchaseOrderWithDb(db, claim, poId);
}

export async function deletePendingPurchaseOrderWithDb(store: Firestore, claim: CompanyId, poId: string): Promise<void> {
  const receiptSnap = await getDocs(query(collection(store, 'itemReceipts'), where('companyId', '==', claim), where('poId', '==', poId)));
  if (!receiptSnap.empty) throw new Error('이미 입고 기록이 있어 발주를 삭제할 수 없습니다.');
  const rawReceiptSnap = await getDocs(query(collection(store, 'rawMaterialLedger'), where('companyId', '==', claim), where('source.id', '==', poId)));
  if (!rawReceiptSnap.empty) throw new Error('이미 원료 입고 기록이 있어 발주를 삭제할 수 없습니다.');
  await runTransaction(store, async tx => {
    const poRef = doc(store, 'purchaseOrders', poId);
    const poSnap = await tx.get(poRef);
    if (!poSnap.exists()) throw new Error('발주가 없거나 이미 삭제됐습니다.');
    const po = { id: poId, ...poSnap.data() } as PurchaseOrder;
    if (companyOf(po) !== claim) throw new Error('다른 회사 발주는 삭제할 수 없습니다.');
    if (po.status !== 'pending' && po.status !== 'invoiced') throw new Error('입고 완료된 발주는 삭제할 수 없습니다.');
    if (po.linkedStatementId) throw new Error('연결 전표가 있는 발주는 전표를 먼저 확인해 주세요.');
    if (po.poType === 'oem') throw new Error('외주 발주는 이 화면에서 삭제할 수 없습니다.');
    const lines = poLines(po);
    if (!lines.length) throw new Error('품목이 없는 발주는 내용을 먼저 확인해 주세요.');
    const items = await Promise.all(lines.map(line => tx.get(doc(store, 'items', line.itemId))));
    if (items.some(snap => !snap.exists() || companyOf(snap.data() as Item) !== claim))
      throw new Error('품목이 없거나 회사가 다른 발주는 이 화면에서 삭제할 수 없습니다.');
    tx.delete(poRef);
  });
}

export const writeMany = async (
  ops: { collection: CollectionName; id: string; data: Record<string, unknown>; merge?: boolean }[],
): Promise<void> => commitCompanyWrites(ops.map(op => ({ kind: 'set' as const, ...op })));

/**
 * 주문 상태·재고 작업을 DB에서 선점한다. 화면별 메모리 잠금만으로는 다른 탭의 동시 승인을
 * 막지 못하므로, 주문 문서의 현재 상태를 확인하고 작업 표식을 같은 트랜잭션에 기록한다.
 */
/** 표시명 대신 최초 로그인 UID와 명시 회사를 검증한다. await 뒤에도 같은 계정이어야 한다. */
export async function assertOrderInventoryGenerationActor(generation:OrderInventoryGeneration):Promise<void>{
 validateOrderInventoryGeneration(generation);await authReady;
 const user=auth.currentUser;if(!user||user.uid!==generation.actorUid)throw Error('주문 재고 작업 로그인 계정이 바뀌었습니다.');
 const token=await user.getIdTokenResult();
 if(typeof token.claims.employeeId!=='string'||!token.claims.employeeId.trim())throw Error('직원 계정의 주문 재고 작업만 처리할 수 있습니다.');
 withClaimCompany('orders',{companyId:generation.companyId},{companyId:token.claims.companyId});
 if(auth.currentUser?.uid!==generation.actorUid)throw Error('주문 재고 작업 로그인 계정이 바뀌었습니다.');
}
export const claimOrderInventoryOperation = async (
 orderId:string,expectedStatus:OrderStatus,operation:NonNullable<Order['inventoryOperation']>,
):Promise<Order>=>{
 await authReady;const actorUid=auth.currentUser?.uid;
 if(!actorUid)throw Error('주문 재고 작업은 직원 로그인이 필요합니다.');
 if(operation.contractVersion!==undefined&&operation.contractVersion!==1)throw Error('주문 재고 세대 계약 버전이 잘못되었습니다.');
 if(operation.productionRecordContractVersion!==undefined&&operation.productionRecordContractVersion!==1)throw Error('생산기록 최초 원문 계약 버전이 잘못되었습니다.');
 if(!['line','status'].includes(operation.kind??'')||operation.kind==='line'&&(typeof operation.lineId!=='string'||!operation.lineId.trim()))throw Error('주문 재고 작업 종류·줄 번호를 확인해 주세요.');
 if(operation.contractVersion===1&&operation.actorUid!==actorUid)throw Error('최초 요청의 로그인 계정이 다릅니다.');
 const requestedOperation:NonNullable<Order['inventoryOperation']>={...operation,contractVersion:1,productionRecordContractVersion:1,actorUid};
 const service=await import('./orderRequestRetirementService');
 const needsRetiredClaim=(current:Record<string,any>):boolean=>{
  if(auth.currentUser?.uid!==actorUid)throw Error('주문 재고 작업 로그인 계정이 바뀌었습니다.');
  if(current.retirementClaimPending===true)return true;
  if(typeof current.companyId!=='string')return false;
  const retained=service.hasRetainedRetirementClaim(orderId,current.companyId,actorUid);
  if(!retained)return false;
  if(!service.hasRetainedRetirementClaim(orderId,current.companyId,actorUid,current.retirementId))throw Error('저장된 첫 claim 해제 영수증이 현재 주문과 다릅니다. 원문을 보존했습니다.');
  return true;
 };
 const claimRetired=async()=>{
  return service.claimRetiredOrderInventoryOperation(orderId,expectedStatus,requestedOperation);
 };
 const entry=await getDoc(doc(db,'orders',orderId));
 if(entry.exists()&&needsRetiredClaim(entry.data()))return claimRetired();
 const result=await runInventoryWriterTransaction(db,await captureInventoryWriterContext(db,{requestIdentity:JSON.stringify({orderId,expectedStatus,requestedOperation}),getCurrentUser:()=>auth?.currentUser,ready:authReady}),async tx=>{
 const ref=doc(db,'orders',orderId),snap=await tx.get(ref);
 if(!snap.exists())throw Error('주문을 찾을 수 없습니다.');
 if(needsRetiredClaim(snap.data()))return null;
 const current={...snap.data(),id:snap.id??orderId} as Order;
 if(current.status!==expectedStatus)throw Error('주문 상태가 이미 변경되었습니다. 새로고침 후 다시 확인해 주세요.');
 if(current.inventoryOperation?.state==='processing')throw Error('이 주문의 재고 작업이 이미 진행 중입니다.');
 let selected=requestedOperation;
 const previous=current.inventoryOperation;
 if(requestedOperation.contractVersion===1){
  const requested=generationFromOrder({...current,inventoryOperation:requestedOperation})!;await assertOrderInventoryGenerationActor(requested);
  if(previous?.state==='failed'){
   if(previous.contractVersion!==1)throw Error('옛 실패 작업은 새 세대로 자동 재개할 수 없습니다. 최초 원문을 확인해 주세요.');
   if(previous.productionRecordContractVersion!==1)throw Error('이전 실패에는 최초 생산기록 계획이 없어 자동 재개하지 않았습니다. 원문을 확인해 주세요.');
   const original=generationFromOrder(current)!;
   if(original.actorUid!==requested.actorUid||previous.kind!==requestedOperation.kind||previous.lineId!==requestedOperation.lineId||previous.targetStatus!==requestedOperation.targetStatus)throw Error('이전 작업의 최초 계정·대상과 다른 재개입니다.');
   selected={...previous,state:'processing'}; // ID·시각·실패 원문은 최초 세대 그대로다.
  }else selected={...requestedOperation,stage:'claim'};
 }
 if(selected.contractVersion===1)await assertOrderInventoryGenerationActor(generationFromOrder({...current,inventoryOperation:selected})!);
 const patch=protectInventoryWriterPatch(snap.data(),{inventoryOperation:selected});tx.update(ref,patch);return {...current,...patch} as Order;
});
 return result??claimRetired();
};
/** 세대 표식이나 완료 증거는 호출자 패치로 만들거나 지우지 않는다. */
export async function guardedUpdateOrderInventoryGeneration(generation:OrderInventoryGeneration,patch:Record<string,unknown>):Promise<void>{
 if(Object.keys(patch).some(key=>['inventoryOperation','inventoryGenerationCompletion','productionRecordIndex','id','companyId'].some(prefix=>key===prefix||key.startsWith(prefix+'.'))))throw Error('재고 작업 표식은 임의 패치할 수 없습니다.');
 await assertOrderInventoryGenerationActor(generation);
 await runInventoryWriterTransaction(db,await captureInventoryWriterContext(db,{requestIdentity:JSON.stringify(generation),companyId:generation.companyId,getCurrentUser:()=>auth?.currentUser,ready:authReady,isStillCurrent:async()=>{await assertOrderInventoryGenerationActor(generation);return true;}}),async tx=>{const ref=doc(db,'orders',generation.orderId),snap=await tx.get(ref);if(!snap.exists())throw Error('주문을 찾을 수 없습니다.');assertOrderInventoryGeneration({...snap.data(),id:generation.orderId} as Order,generation);await assertOrderInventoryGenerationActor(generation);tx.update(ref,protectInventoryWriterPatch(snap.data(),patch,Object.keys(patch)));});
 await assertOrderInventoryGenerationActor(generation);
}
export async function markOrderInventoryGenerationFailed(generation:OrderInventoryGeneration,error:string,stage:NonNullable<Order['inventoryOperation']>['stage']):Promise<void>{
 await assertOrderInventoryGenerationActor(generation);
 await runInventoryWriterTransaction(db,await captureInventoryWriterContext(db,{requestIdentity:JSON.stringify(generation),companyId:generation.companyId,getCurrentUser:()=>auth?.currentUser,ready:authReady,isStillCurrent:async()=>{await assertOrderInventoryGenerationActor(generation);return true;}}),async tx=>{const ref=doc(db,'orders',generation.orderId),snap=await tx.get(ref);if(!snap.exists())throw Error('주문을 찾을 수 없습니다.');const order={...snap.data(),id:generation.orderId} as Order;assertOrderInventoryGeneration(order,generation,{allowFailed:true});await assertOrderInventoryGenerationActor(generation);const patch={inventoryOperation:{...order.inventoryOperation!,state:'failed' as const,error:order.inventoryOperation?.error??error,stage:advanceOrderInventoryStage(order.inventoryOperation?.stage,stage)}};tx.update(ref,protectInventoryWriterPatch(snap.data(),patch,Object.keys(patch)));});
 await assertOrderInventoryGenerationActor(generation);
}
/** 원료 거절·unknown은 해제 근거가 아니다. 시작 전 no-op과 이미 확정된 final marker만 확인한다. */
export async function clearOrderInventoryGeneration(generation:OrderInventoryGeneration,options:{mode:'pre-reservation-noop'|'completed'}):Promise<void>{
 await assertOrderInventoryGenerationActor(generation);
 await runInventoryWriterTransaction(db,await captureInventoryWriterContext(db,{requestIdentity:JSON.stringify(generation),companyId:generation.companyId,getCurrentUser:()=>auth?.currentUser,ready:authReady,isStillCurrent:async()=>{await assertOrderInventoryGenerationActor(generation);return true;}}),async tx=>{const ref=doc(db,'orders',generation.orderId),snap=await tx.get(ref);if(!snap.exists())throw Error('주문을 찾을 수 없습니다.');const order={...snap.data(),id:generation.orderId} as Order;
  if(options.mode==='completed'){if(order.inventoryOperation!=null||!hasOrderInventoryGenerationCompletion(order,generation))throw Error('동일 세대 최종 완료를 확인하지 못했습니다.');await assertOrderInventoryGenerationActor(generation);return;}
  if(options.mode!=='pre-reservation-noop')throw Error('잠금 해제 방식이 잘못되었습니다.');
  assertOrderInventoryGeneration(order,generation);if(order.inventoryOperation?.stage!=='claim')throw Error('예약 이후 작업은 자동 해제하지 않습니다.');await assertOrderInventoryGenerationActor(generation);tx.update(ref,protectInventoryWriterPatch(snap.data(),{inventoryOperation:null}));
 });
 await assertOrderInventoryGenerationActor(generation);
}
