import {tradeRequestKey,verifyTradeServerRejection,withTradeStatementLock,listTradePendings,findTradePendingConflicts,tradePendingMatchesRequest,tradePendingConflictMessage} from './tradeStatementPending';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, db, functions } from '../../../shared/firebase';
import { companyScopedWriteData } from '../../../shared/services/firebaseService';
import type { CashEntry, IssuedStatement } from '../../../shared/types';

export type TradeStatementIssueInput = {
  operationId: string;
  statement: IssuedStatement;
  orderIds: string[];
  poIds: string[];
  newPo?: { id: string; cardNo: string; items: Record<string, unknown>[] };
  costUpdates: { itemId: string; price: number; beforeCost: number; sourceLineIndex: number }[];
};

const completedTradeRequests=new Map<string,string>();
const requestComparable=(r:TradeStatementIssueInput)=>JSON.stringify({...r,statement:{...r.statement,createdBy:undefined},newPo:r.newPo?{...r.newPo,cardNo:undefined}:undefined,releaseId:undefined});
function savedTradeRequests(companyId:'taebaek'|'punghoe',uid:string):{key:string;text:string;request:TradeStatementIssueInput&{releaseId:string}}[]{
 const legacy=tradeRequestKey(companyId,uid);
 return Object.keys(localStorage).filter(key=>key===legacy||key.startsWith(tradeRequestKey(companyId,uid,''))).sort().map(key=>{
  const text=localStorage.getItem(key)!;
  try{const request=JSON.parse(text);
   if(!request||typeof request.operationId!=='string'||!request.operationId||request.operationId.includes('/')
    ||!request.statement||request.statement.companyId!==companyId||typeof request.statement.id!=='string'||!request.statement.id||request.statement.id.includes('/')
    ||typeof request.releaseId!=='string'||!request.releaseId||!Array.isArray(request.orderIds)||request.orderIds.some((id:unknown)=>typeof id!=='string')
    ||!Array.isArray(request.poIds)||request.poIds.some((id:unknown)=>typeof id!=='string')||!Array.isArray(request.costUpdates)
    ||key!==legacy&&key!==tradeRequestKey(companyId,uid,request.operationId))throw Error();
   return {key,text,request};
  }catch{throw new Error('저장된 전표 송신 원문이 손상되었습니다. 원문을 보존했습니다.');}
 });
}
/** 발행과 연관 기록을 서버 한 거래로 저장한다. */
export async function issueTradeStatementCommand(input: TradeStatementIssueInput): Promise<{status:'applied'|'duplicate';id:string;docNo:string}> {
 const uid=auth.currentUser?.uid,companyId=input.statement.companyId;
 const assertActor=()=>{if(!uid||auth.currentUser?.uid!==uid)throw new Error('로그인 사용자가 변경되었습니다. 전표를 보내지 않았습니다.');};
 let request!:TradeStatementIssueInput&{releaseId:string};let key='';let old:string|null=null;let encoded='';let saved=false;let hadPrior=false;
 const refreshPrior=()=>{
  if(!uid||(companyId!=='taebaek'&&companyId!=='punghoe'))return;
  hadPrior=hadPrior||localStorage.getItem(tradeRequestKey(companyId,uid,input.operationId))!==null;
  const legacyText=localStorage.getItem(tradeRequestKey(companyId,uid));
  if(legacyText!==null){try{hadPrior=hadPrior||JSON.parse(legacyText)?.operationId===input.operationId;}catch{hadPrior=true;}}
 };
 refreshPrior();
 try {
  await authReady;assertActor();
  if(companyId!=='taebaek'&&companyId!=='punghoe')throw new Error('전표 회사를 확인해 주세요.');
  const gate=(await getDoc(doc(db,'appMeta','releaseCutover'))).data();assertActor();
  if(gate?.status!=='active'||typeof gate.releaseId!=='string')throw new Error('전표 발행 서버가 준비되지 않았습니다. 관리자에게 문의해 주세요.');
  const scoped=await companyScopedWriteData('issuedStatements',input.statement as unknown as Record<string,unknown>);assertActor();
  if(scoped.companyId!==companyId)throw new Error('전표 회사 권한이 변경되었습니다.');
  const fresh={...input,statement:JSON.parse(JSON.stringify(scoped)),releaseId:gate.releaseId};
  await withTradeStatementLock(companyId,uid!,()=>{
   assertActor();refreshPrior();key=tradeRequestKey(companyId,uid!,input.operationId);
   const pendings=listTradePendings(companyId,uid!);
   const conflicts=findTradePendingConflicts(pendings,{statementId:input.statement.id,operationId:input.operationId,orderIds:input.orderIds,poIds:input.poIds});
   if(conflicts.length)throw new Error(tradePendingConflictMessage(conflicts[0]));
   if(pendings.some(row=>row.pending?.input.command.operationId===input.operationId&&!tradePendingMatchesRequest(row.pending,fresh)))
    throw new Error('저장된 전표 최초 원문과 송신할 내용이 다릅니다. 원문을 보존했습니다.');
   const requests=savedTradeRequests(companyId,uid!);
   const same=requests.filter(row=>row.request.operationId===input.operationId);
   if(same.some(row=>requestComparable(row.request)!==requestComparable(fresh)))throw new Error('이전에 저장 중이던 전표 원문을 먼저 재시도해 주세요.');
   for(const row of requests.filter(row=>row.request.operationId!==input.operationId)){
    if(row.request.statement.id===input.statement.id||row.request.orderIds.some(id=>input.orderIds.includes(id))||row.request.poIds.some(id=>input.poIds.includes(id)))
     throw new Error(`${row.request.statement.partnerName??'이전 거래처'} · ${row.request.statement.tradeDate??''} 전표의 같은 주문·발주 송신 원문이 남아 있습니다. 실패 작업에서 기존 요청을 확인해 주세요.`);
   }
   const own=same.find(row=>row.key===key)??same[0];old=localStorage.getItem(key);
   request=own?.request??fresh;encoded=own?.text??JSON.stringify(request);
   if(localStorage.getItem(key)!==old)throw new Error('다른 창에서 저장 중인 전표를 확인해 주세요.');
   localStorage.setItem(key,encoded);saved=true;
   if(localStorage.getItem(key)!==encoded)throw new Error('최초 전표 송신 원문 저장을 확인하지 못했습니다.');assertActor();
  },()=>auth.currentUser?.uid===uid);
 }catch(error){
  // 전송 전 거절이어도 기존 사본과 창 간 충돌은 지우지 않는다.
  if(!hadPrior&&!old&&!saved&&(companyId==='taebaek'||companyId==='punghoe'))throw Object.assign(new Error(error instanceof Error?error.message:String(error)),{details:{operationStatus:'rejected',version:1,financialWrites:false,companyId,operationId:input.operationId}});throw error;
 }
 try {
  const call=httpsCallable<unknown,{status:'applied'|'duplicate';id:string;docNo:string}>(functions,'issueTradeStatementCommand');
  assertActor();const result=await call({...request,requestText:encoded});assertActor();
  if(result.data.id!==request.statement.id||!['applied','duplicate'].includes(result.data.status)||typeof result.data.docNo!=='string'||!result.data.docNo)throw new Error('전표 발행 응답을 확인할 수 없습니다. 원문을 보존했습니다.');
  completedTradeRequests.set(key,encoded);return result.data;
 }catch(error){
  if(await verifyTradeServerRejection(error,request as unknown as Parameters<typeof verifyTradeServerRejection>[1],encoded,companyId!,uid!,()=>auth.currentUser?.uid===uid&&localStorage.getItem(key)===encoded)){
   await withTradeStatementLock(companyId as 'taebaek'|'punghoe',uid!,()=>{
    if(auth.currentUser?.uid!==uid||localStorage.getItem(key)!==encoded)return;
    for(const row of savedTradeRequests(companyId as 'taebaek'|'punghoe',uid!))if(row.request.operationId===input.operationId&&row.text===encoded&&localStorage.getItem(row.key)===row.text)localStorage.removeItem(row.key);
   },()=>auth.currentUser?.uid===uid);
  }
  if((error as {details?:{version?:number}})?.details?.version===1)throw new Error(error instanceof Error?error.message:String(error));
  throw error;
 }
}
/** 즉시 지급까지 완료한 화면만 원 요청을 정리한다. */
export async function completeTradeStatementRequest(companyId:string,uid:string,operationId:string):Promise<void> {
 if(auth.currentUser?.uid!==uid||(companyId!=='taebaek'&&companyId!=='punghoe'))return;
 const key=tradeRequestKey(companyId,uid,operationId),completed=completedTradeRequests.get(key);if(!completed)return;
 await withTradeStatementLock(companyId,uid,()=>{
  if(auth.currentUser?.uid!==uid||localStorage.getItem(key)!==completed)return;
  for(const row of savedTradeRequests(companyId,uid))if(row.request.operationId===operationId&&row.text===completed&&localStorage.getItem(row.key)===row.text)localStorage.removeItem(row.key);
  completedTradeRequests.delete(key);
 },()=>auth.currentUser?.uid===uid);
}
/** 주문 연결이 없는 일반 대체전표도 번호와 본문을 서버에서 함께 확정한다. */
export async function issueNumberedStatement(statement: IssuedStatement): Promise<{ id: string; docNo: string }> {
  const actorId=auth.currentUser?.uid;
  const assertActor=()=>{if(!actorId||auth.currentUser?.uid!==actorId)throw new Error('로그인 사용자가 변경되었습니다. 전표를 보내지 않았습니다.');};
  let submit!: () => Promise<{data:{id:string;docNo:string}}>;
  try {
  await authReady;assertActor();
  const gate = (await getDoc(doc(db, 'appMeta', 'releaseCutover'))).data();assertActor();
  if (gate?.status !== 'active' || typeof gate.releaseId !== 'string') {
    throw new Error('전표 발행 서버가 준비되지 않았습니다. 관리자에게 문의해 주세요.');
  }
  const scoped = await companyScopedWriteData('issuedStatements', statement as unknown as Record<string, unknown>);
  assertActor();
  const call = httpsCallable<unknown, { id: string; docNo: string }>(functions, 'issueNumberedVoucher');
  const request = {
    kind: 'issuedStatements', operationId: statement.id, tradeDate: statement.tradeDate,
    prefix: statement.type === '비용' ? '대체' : '',
    document: JSON.parse(JSON.stringify(scoped)), releaseId: gate.releaseId,
  };
  submit = () => {assertActor();return call(request);};
  } catch(error) {
    if (statement.companyId === 'taebaek' || statement.companyId === 'punghoe')
      throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), {
        details:{operationStatus:'rejected',version:1,financialWrites:false,companyId:statement.companyId,operationId:statement.id}});
    throw error;
  }
  return (await submit()).data;
}

/** 일반 입출금 전표도 운영의 서버 소유 번호·장부 경계를 통과한다. */
export async function issueNumberedCashEntry(entry: CashEntry): Promise<{ id: string; docNo: string }> {
  const actorId=auth.currentUser?.uid;
  const assertActor=()=>{if(!actorId||auth.currentUser?.uid!==actorId)throw new Error('로그인 사용자가 변경되었습니다. 전표를 보내지 않았습니다.');};
  let submit!: () => Promise<{ data: { id: string; docNo: string } }>;
  try {
  await authReady;assertActor();
  const gate = (await getDoc(doc(db, 'appMeta', 'releaseCutover'))).data();assertActor();
  if (gate?.status !== 'active' || typeof gate.releaseId !== 'string') {
    throw new Error('전표 발행 서버가 준비되지 않았습니다. 관리자에게 문의해 주세요.');
  }
  const scoped = await companyScopedWriteData('cashEntries', entry as unknown as Record<string, unknown>);
  assertActor();
  const call = httpsCallable<unknown, { id: string; docNo: string }>(functions, 'issueNumberedVoucher');
  const request = {
    kind: 'cashEntries', operationId: entry.id, tradeDate: entry.date, prefix: '',
    document: JSON.parse(JSON.stringify(scoped)), releaseId: gate.releaseId,
  };
  submit = () => {assertActor();return call(request);};
  } catch (error) {
    // callable을 아직 보내지 않은 실패만 입력 수정 가능한 쓰기0 증거로 전달한다.
    if (entry.companyId === 'taebaek' || entry.companyId === 'punghoe')
      throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), {
        details: { operationStatus: 'rejected', version: 1, financialWrites: false,
          companyId: entry.companyId, operationId: entry.id } });
    throw error;
  }
  return (await submit()).data;
}

type PartnerPaymentInput = {
  tradeDate: string; partnerId: string; direction: '입금' | '출금'; amount: number;
  cashAccountId: string; pin: boolean; allocations: { statementId: string; amount: number }[]; note?: string;
};

const partnerPaymentRunning = new Set<string>();

/** 번호·정산·자금 전표는 한 서버 거래로 확정하며 불확실 요청 전체를 보존한다. */
export async function recordPartnerPayment(companyId: string, input: PartnerPaymentInput): Promise<void> {
  const validDay = /^\d{4}-\d{2}-\d{2}$/.test(input.tradeDate)
    && Number.isFinite(Date.parse(`${input.tradeDate}T00:00:00Z`))
    && new Date(`${input.tradeDate}T00:00:00Z`).toISOString().slice(0, 10) === input.tradeDate;
  if (!validDay || !input.partnerId || input.partnerId.includes('/') || !input.cashAccountId || input.cashAccountId.includes('/')
    || !['입금', '출금'].includes(input.direction) || !Number.isSafeInteger(input.amount) || input.amount <= 0
    || typeof input.pin !== 'boolean' || !Array.isArray(input.allocations)
    || input.allocations.some(row => !row || !row.statementId || row.statementId.includes('/') || !Number.isSafeInteger(row.amount) || row.amount <= 0)
    || new Set(input.allocations.map(row => row.statementId)).size !== input.allocations.length
    || input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 500))
    throw new Error('수금·지불 날짜·금액·대상·입력을 확인해 주세요.');
  await authReady;
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
  const assertCompany = async () => {
    const { claims } = await user.getIdTokenResult();
    if (auth.currentUser?.uid !== user.uid || claims.companyId !== companyId || claims.isAdmin !== true)
      throw new Error('관리자 회사 권한이 바뀌었습니다.');
  };
  await assertCompany();
  const normalized: PartnerPaymentInput = { tradeDate: input.tradeDate, partnerId: input.partnerId, direction: input.direction,
    amount: input.amount, cashAccountId: input.cashAccountId, pin: input.pin,
    allocations: input.allocations.map(row => ({ statementId: row.statementId, amount: row.amount })), note: input.note?.trim() ?? '' };
  const fingerprint = JSON.stringify(normalized);
  type Request = PartnerPaymentInput & { operationId: string; expectedRevision: number; releaseId: string };
  const key = `partner-payment-pending:${companyId}:${input.partnerId}:${user.uid}`;
  if (partnerPaymentRunning.has(key)) throw new Error('이 거래처의 수금·지불 요청을 처리 중입니다.');
  partnerPaymentRunning.add(key);
  try {
    let pending: { version: 2; fingerprint: string; request: Request } | undefined;
    const saved = localStorage.getItem(key);
    if (saved) {
      try { pending = JSON.parse(saved); } catch { throw new Error('이전 수금 요청 기록을 확인할 수 없습니다.'); }
      if (pending?.version !== 2) {
        const legacy = pending as unknown as { fingerprint?: string; operationId?: string; revision?: number };
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)));
        const oldFingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (legacy?.fingerprint !== oldFingerprint || !Number.isSafeInteger(legacy.revision) || legacy.revision! < 0
          || !/^[A-Za-z0-9_-]{1,160}$/.test(legacy.operationId ?? ''))
          throw new Error('이 거래처의 이전 수금 결과가 불확실합니다. 같은 내용으로 다시 시도해 주세요.');
        // 원래 release를 추정하지 않는다. 기존 방식의 현재 release 확인 요청을 같은 작업으로 고정한다.
        const gate = (await getDoc(doc(db, 'appMeta', 'releaseCutover'))).data();
        if (gate?.status !== 'active' || !/^[A-Za-z0-9_-]{1,100}$/.test(gate?.releaseId ?? '')) throw new Error('수금 서버가 준비되지 않았습니다.');
        pending = { version: 2, fingerprint, request: { ...normalized, operationId: legacy.operationId!,
          expectedRevision: legacy.revision!, releaseId: gate.releaseId } };
        localStorage.setItem(key, JSON.stringify(pending));
      }
      const request = pending?.request;
      if (!request || pending.fingerprint !== fingerprint || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0
        || !/^[A-Za-z0-9_-]{1,160}$/.test(request.operationId) || !/^[A-Za-z0-9_-]{1,100}$/.test(request.releaseId)
        || JSON.stringify({ tradeDate: request.tradeDate, partnerId: request.partnerId, direction: request.direction,
          amount: request.amount, cashAccountId: request.cashAccountId, pin: request.pin, allocations: request.allocations, note: request.note }) !== fingerprint)
        throw new Error('이 거래처의 이전 수금 결과가 불확실합니다. 같은 내용으로 다시 시도해 주세요.');
    }
    if (!pending) {
      const [gate, state] = await Promise.all([
        getDoc(doc(db, 'appMeta', 'releaseCutover')),
        getDoc(doc(db, 'appMeta', `partnerPaymentState_${companyId}_${input.partnerId}`)),
      ]);
      const release = gate.data(), revision = state.exists() ? state.data().revision : 0;
      if (release?.status !== 'active' || !/^[A-Za-z0-9_-]{1,100}$/.test(release?.releaseId ?? '')) throw new Error('수금 서버가 준비되지 않았습니다.');
      if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('거래처 정산 상태가 잘못되었습니다.');
      pending = { version: 2, fingerprint, request: { ...normalized, operationId: `partner-payment-${crypto.randomUUID()}`,
        expectedRevision: revision, releaseId: release.releaseId } };
      localStorage.setItem(key, JSON.stringify(pending));
    }
    await assertCompany();
    const call = httpsCallable<Request, { status: 'applied' | 'duplicate'; id: string }>(functions, 'recordPartnerPaymentCommand');
    let result;
    try { result = await call(pending.request); }
    catch (error) {
      const failure = (error as { details?: { partnerPaymentFailure?: Record<string, unknown> } })?.details?.partnerPaymentFailure;
      if (failure?.version === 1 && failure.companyId === companyId && failure.partnerId === input.partnerId
        && failure.operationId === pending.request.operationId && failure.operationRejected === true && failure.financialWrites === false)
        localStorage.removeItem(key);
      throw error;
    }
    if (result.data.id !== pending.request.operationId || !['applied', 'duplicate'].includes(result.data.status))
      throw new Error('수금·지불 응답을 확인할 수 없습니다. 같은 내용으로 재시도해 주세요.');
    localStorage.removeItem(key);
  } finally { partnerPaymentRunning.delete(key); }
}
