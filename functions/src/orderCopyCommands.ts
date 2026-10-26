import {withOrderListProjection} from './shared/orderListProjectionWrite';
import * as admin from 'firebase-admin';
import {createHash} from 'crypto';
import {HttpsError,onCall} from 'firebase-functions/v2/https';
import {assertReleaseActive,releaseGateRef} from './releaseGate';
import {canonicalOrderInterpretation,validateOrderInterpretation,orderInterpretationAliasCandidates,normalizeOrderInterpretationAlias,validOrderInterpretationIso,orderInterpretationExpressionCandidates,type OrderExpressionRule,type OrderInterpretationScope} from './shared/orderInterpretation';

export const ORDER_COPY_OPERATIONS='orderCopyOperations';
export const ORDER_INTERPRETATION_RULES='orderInterpretationRules';
export const orderCopyHash=(text:string)=>createHash('sha256').update(text).digest('hex');
export const orderInterpretationRuleId=(companyId:string,partnerId:string,alias:string,itemId:string)=>orderCopyHash(JSON.stringify([companyId,partnerId,normalizeOrderInterpretationAlias(alias),itemId]));
export interface InterpretationRule extends OrderExpressionRule{ruleId:string;companyId:string;partnerId:string;alias:string;itemId:string;status:'proposed'|'approved'|'stopped';revision:number;captureIds:string[];orderIds:string[]}
const fail=(message:string):never=>{throw new HttpsError('invalid-argument',message);};
const id=(value:unknown):value is string=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=200&&!value.includes('/');
export const candidateRuleId=(companyId:string,row:Pick<OrderExpressionRule,'partnerId'|'alias'|'itemId'|'kind'|'scope'|'target'|'value'>)=>(row.kind==='expression')?orderCopyHash(JSON.stringify([companyId,'expression',row.scope,row.partnerId,normalizeOrderInterpretationAlias(row.alias),row.target,row.value])):orderInterpretationRuleId(companyId,row.partnerId,row.alias,row.itemId);
const validRule=(row:InterpretationRule)=>typeof row.alias==='string'&&row.alias.trim().length>0&&(row.kind==='expression'?(['partner','company'].includes(row.scope??'')&&(row.scope==='company'?row.partnerId==='':id(row.partnerId))&&row.itemId===''&&row.target==='note'&&typeof row.value==='string'&&!!row.value.trim()):((row.kind===undefined||row.kind==='alias')&&id(row.partnerId)&&id(row.itemId)));
const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value);
const object=(value:any)=>value&&typeof value==='object'&&!Array.isArray(value);
const allowed=(value:any,keys:string[])=>{if(!object(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('주문 저장 허용 필드가 다릅니다.');};
/** 판독 증거 전체는 보관하되 생산·재고·상태 권한 필드는 주문으로 펼치지 않는다. */
export function selectOrderCopyDraft(value:any):Record<string,any>{
 allowed(value,['id','cardNo','partnerId','partnerName','email','shipToId','createdAt','deliveryDate','items','totalAmount','note','noteImportant','source','shipMethod','region','pallets','deliveryBoxes','sourceChatMessageId']);
 if(!id(value.id)||!id(value.cardNo)||!id(value.partnerId)||typeof value.partnerName!=='string'||!Array.isArray(value.items)||!value.items.length||value.items.length>200||!finite(value.totalAmount)||value.totalAmount<0)fail('주문 ID·거래처·주문줄·금액을 확인해 주세요.');
 if(!['일반','택배','스마트스토어'].includes(value.source)||!['배송','화물','수령','택배'].includes(value.shipMethod)||!validOrderInterpretationIso(value.createdAt)||!validOrderInterpretationIso(value.deliveryDate))fail('주문 날짜와 배송 방식을 확인해 주세요.');
 const lines=new Set<string>();
 for(const row of value.items){
  allowed(row,['lineId','itemId','name','orderedAs','quantity','price','isBoxUnit','boxQuantity','unitsPerBox','boxType','boxSubId','displaySize']);
  if(!id(row.lineId)||lines.has(row.lineId)||!id(row.itemId)||typeof row.name!=='string'||!finite(row.quantity)||row.quantity<=0||!finite(row.price)||row.price<0)fail('주문줄 ID·품목·수량·가격을 확인해 주세요.');lines.add(row.lineId);
  for(const key of ['boxQuantity','unitsPerBox'])if(row[key]!==undefined&&(!finite(row[key])||row[key]<=0))fail('박스 입력 근거를 확인해 주세요.');
  if(row.isBoxUnit!==undefined&&typeof row.isBoxUnit!=='boolean')fail('박스 입력 근거를 확인해 주세요.');
  for(const key of ['orderedAs','boxType','boxSubId','displaySize'])if(row[key]!==undefined&&typeof row[key]!=='string')fail('주문줄 표시 원문을 확인해 주세요.');
 }
 for(const key of ['email','shipToId','note','region','sourceChatMessageId'])if(value[key]!==undefined&&typeof value[key]!=='string')fail('주문 표시 필드를 확인해 주세요.');
 if(value.noteImportant!==undefined&&typeof value.noteImportant!=='boolean')fail('주문 중요 표시를 확인해 주세요.');
 for(const key of ['pallets','deliveryBoxes'])if(value[key]!==undefined&&!Array.isArray(value[key]))fail('포장·배송 명세를 확인해 주세요.');
 for(const pallet of value.pallets??[]){allowed(pallet,['type','quantity','isExchange']);if(typeof pallet.type!=='string'||!finite(pallet.quantity)||pallet.quantity<=0||pallet.isExchange!==undefined&&typeof pallet.isExchange!=='boolean')fail('팔레트 명세를 확인해 주세요.');}
 for(const box of value.deliveryBoxes??[]){allowed(box,['itemId','name','quantity']);if(!id(box.itemId)||typeof box.name!=='string'||!finite(box.quantity)||box.quantity<=0)fail('배송 박스 명세를 확인해 주세요.');}
 return JSON.parse(JSON.stringify(value));
}
export interface OrderCopyInput{action:'submit'|'inspect';requestText:string;requestHash:string;releaseId?:string}
export interface OrderCopyResult{status:'applied'|'duplicate'|'rejected'|'unknown';requestId:string;orderId:string;requestHash:string;reason?:string}
export function authorizeOrderCopy(auth:any,adminOnly=false):OrderInterpretationScope&{employeeId:string}{
 if(!auth)throw new HttpsError('unauthenticated','로그인이 필요합니다.');
 const token=auth.token;if(!['taebaek','punghoe'].includes(token?.companyId)||typeof token.employeeId!=='string'||!token.employeeId.trim()||!id(auth.uid)||adminOnly&&token.isAdmin!==true)throw new HttpsError('permission-denied','현재 회사의 직원 권한을 확인해 주세요.');
 return {companyId:token.companyId,actorUid:auth.uid,employeeId:token.employeeId};
}
export async function submitOrderCopy(db:admin.firestore.Firestore,scope:OrderInterpretationScope&{employeeId:string},input:OrderCopyInput):Promise<OrderCopyResult>{
 if(!input||!['submit','inspect'].includes(input.action)||typeof input.requestText!=='string'||Buffer.byteLength(input.requestText)>600000||orderCopyHash(input.requestText)!==input.requestHash)fail('최초 주문 원문과 해시를 확인해 주세요.');
 let raw:any;try{raw=JSON.parse(input.requestText);}catch{return fail('최초 주문 원문을 읽을 수 없습니다.');}
 const request=validateOrderInterpretation(raw,scope);if(canonicalOrderInterpretation(request,scope)!==input.requestText||!id(request.requestId))fail('최초 주문 요청의 정규 원문이 다릅니다.');
 let draft:Record<string,any>=request.confirmed.orderDraft,validationReason='';try{draft=selectOrderCopyDraft(draft);}catch(error){validationReason=error instanceof Error?error.message:'주문 저장 필드를 확인해 주세요.';}
 if(!validationReason&&Buffer.byteLength(input.requestText)+Buffer.byteLength(JSON.stringify(draft))>850000)validationReason='최초 주문과 분석 원문의 저장 크기를 줄여 다시 확인해 주세요.';
 const operation=db.collection(ORDER_COPY_OPERATIONS).doc(orderCopyHash(`${scope.companyId}:${request.requestId}`)),orderId=id(draft.id)?draft.id:'';
 const order=orderId?db.collection('orders').doc(orderId):null;
 const candidates=[...orderInterpretationAliasCandidates(request),...orderInterpretationExpressionCandidates(request)],ruleRefs=candidates.map(row=>db.collection(ORDER_INTERPRETATION_RULES).doc(candidateRuleId(scope.companyId,row)));
 const base={requestId:request.requestId,orderId,requestHash:input.requestHash};
 return db.runTransaction(async tx=>{
  const gate=await tx.get(releaseGateRef(db));const saved=await tx.get(operation);
  if(saved.exists){const row=saved.data()!;if(row.status==='stopped'&&row.recoveryFence===true){if(row.companyId!==scope.companyId||row.actorUid!==scope.actorUid||row.requestId!==request.requestId)throw new HttpsError('permission-denied','다른 작성자의 주문 요청입니다.');return {...base,status:'rejected' as const,reason:'미처리 요청이 중단되어 주문을 만들지 않았습니다.'};}if(row.companyId!==scope.companyId||row.actorUid!==scope.actorUid||row.requestText!==input.requestText||row.requestHash!==input.requestHash||row.orderId!==orderId||!['applied','rejected'].includes(row.status))throw new HttpsError('already-exists','같은 주문 요청 ID의 최초 원문이나 계정이 다릅니다.');
   return {...base,status:row.status==='applied'?'duplicate' as const:'rejected' as const,...(row.reason?{reason:row.reason}:{})};}
  if(input.action==='inspect')return {...base,status:'unknown' as const,reason:'최초 요청의 처리 결과가 아직 확인되지 않았습니다.'};
  assertReleaseActive(gate,input.releaseId??'');
  if(validationReason){tx.create(operation,{version:1,...base,companyId:scope.companyId,actorUid:scope.actorUid,requestText:input.requestText,status:'rejected',reason:validationReason});return {...base,status:'rejected' as const,reason:validationReason};}
  const [existing,partner,...items]=await tx.getAll(order!,db.collection('partners').doc(draft.partnerId),...draft.items.map((row:any)=>db.collection('items').doc(row.itemId)));
  const ruleSnapshots=ruleRefs.length?await tx.getAll(...ruleRefs):[];
  const owner=(row:admin.firestore.DocumentSnapshot)=>row.exists&&(row.data()?.companyId??'taebaek')===scope.companyId;
  const reason=existing.exists?'같은 주문 ID가 이미 사용되었습니다.':!owner(partner)?'현재 회사의 거래처를 확인해 주세요.':items.some(row=>!owner(row)||row.data()?.archived)?'현재 회사의 판매 품목을 확인해 주세요.':'';
  const capture={version:1,...base,companyId:scope.companyId,actorUid:scope.actorUid,requestText:input.requestText,status:reason?'rejected':'applied',...(reason?{reason}:{})};
  if(reason){tx.create(operation,capture);return {...base,status:'rejected' as const,reason};}
  const approved={...draft,companyId:scope.companyId,createdBy:scope.employeeId,status:'PENDING'};
  tx.create(order!,withOrderListProjection(undefined,approved,'create'));tx.create(operation,{...capture,orderText:JSON.stringify(approved)});
  for(let index=0;index<candidates.length;index++){
   const candidate=candidates[index],ref=ruleRefs[index],old=ruleSnapshots[index].data() as InterpretationRule|undefined;
   if(old&&(old.companyId!==scope.companyId||old.partnerId!==candidate.partnerId||old.alias!==candidate.alias||old.itemId!==candidate.itemId||candidateRuleId(scope.companyId,old)!==ref.id||!Number.isSafeInteger(old.revision)||!['proposed','approved','stopped'].includes(old.status)||!Array.isArray(old.captureIds)||!Array.isArray(old.orderIds)))throw new HttpsError('failed-precondition','기존 별칭 제안 근거를 확인해 주세요.');
   // 승인·중단 뒤 새 capture가 기존 관리 결정을 자동으로 바꾸지 않는다.
   if(old&&old.status!=='proposed')continue;
   const captureIds=[...new Set([...(old?.captureIds??[]),operation.id])],orderIds=[...new Set([...(old?.orderIds??[]),draft.id as string])];
   if(captureIds.length>100)continue;
   tx.set(ref,{ruleId:ref.id,companyId:scope.companyId,...candidate,status:'proposed',revision:(old?.revision??0)+1,captureIds,orderIds});
  }
  return {...base,status:'applied' as const};
 });
}
export const submitOrderCopyCommand=onCall({region:'asia-northeast3'},request=>{const scope=authorizeOrderCopy(request.auth);return request.data?.action==='stop'||request.data?.action==='listHistory'||request.data?.action==='inspect'&&request.data?.reference?recoverOrderCopy(admin.firestore(),scope,request.data):submitOrderCopy(admin.firestore(),scope,request.data);});
export async function listOrderInterpretationRules(db:admin.firestore.Firestore,scope:OrderInterpretationScope,includeAll=false):Promise<InterpretationRule[]>{
 const snapshot=await db.collection(ORDER_INTERPRETATION_RULES).where('companyId','==',scope.companyId).get();return snapshot.docs.map(row=>row.data() as InterpretationRule).filter(row=>includeAll||row.status==='approved');
}
export async function reviewOrderInterpretationRule(db:admin.firestore.Firestore,scope:OrderInterpretationScope,input:{companyId:string;ruleId:string;expectedRevision:number;action:'approve'|'stop';releaseId:string}):Promise<InterpretationRule>{
 if(input?.companyId!==scope.companyId||!id(input.ruleId)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1||!['approve','stop'].includes(input.action))fail('별칭 승인 회사·명세·revision을 확인해 주세요.');
 return db.runTransaction(async tx=>{
  const gate=await tx.get(releaseGateRef(db));assertReleaseActive(gate,input.releaseId);const ref=db.collection(ORDER_INTERPRETATION_RULES).doc(input.ruleId),snap=await tx.get(ref),row=snap.data() as InterpretationRule|undefined;
  if(!row||row.companyId!==scope.companyId||row.ruleId!==input.ruleId||row.revision!==input.expectedRevision||!['proposed','approved','stopped'].includes(row.status)||!validRule(row)||candidateRuleId(row.companyId,row)!==ref.id)throw new HttpsError('failed-precondition','별칭 제안 원문 또는 revision이 변경되었습니다. 다시 조회해 주세요.');
  if(input.action==='approve'){
   if(!Array.isArray(row.captureIds)||new Set(row.captureIds).size!==row.captureIds.length||row.captureIds.length<3||row.captureIds.length>100||row.captureIds.some(value=>!id(value)))throw new HttpsError('failed-precondition','서로 다른 확정 주문 3건의 원문 근거가 필요합니다.');
   const captures=await tx.getAll(...row.captureIds.map(value=>db.collection(ORDER_COPY_OPERATIONS).doc(value)));const orders=new Set<string>();
   for(const capture of captures){const saved=capture.data();if(!saved||saved.status!=='applied'||saved.companyId!==scope.companyId||typeof saved.actorUid!=='string'||typeof saved.requestText!=='string'||orderCopyHash(saved.requestText)!==saved.requestHash)throw new HttpsError('failed-precondition','최초 주문 capture의 원문과 해시가 다릅니다.');
    let request:any;try{request=validateOrderInterpretation(JSON.parse(saved.requestText),{companyId:scope.companyId,actorUid:saved.actorUid});}catch{throw new HttpsError('failed-precondition','최초 주문 capture를 읽을 수 없습니다.');}
    if(canonicalOrderInterpretation(request,request)!==saved.requestText||capture.id!==orderCopyHash(`${scope.companyId}:${request.requestId}`)||saved.orderId!==request.confirmed.orderDraft.id||![...orderInterpretationAliasCandidates(request),...orderInterpretationExpressionCandidates(request)].some(candidate=>candidateRuleId(scope.companyId,candidate)===row.ruleId))throw new HttpsError('failed-precondition','제안 별칭과 최초 확정 주문줄이 다릅니다.');orders.add(saved.orderId);
   }
   if(orders.size<3)throw new HttpsError('failed-precondition','서로 다른 확정 주문 3건이 필요합니다.');
   const refs=row.kind==='expression'?(row.scope==='partner'?[db.collection('partners').doc(row.partnerId)]:[]):[db.collection('partners').doc(row.partnerId),db.collection('items').doc(row.itemId)];const linked=refs.length?await tx.getAll(...refs):[];if(linked.some(doc=>!doc.exists||(doc.data()?.companyId??'taebaek')!==scope.companyId||doc.data()?.archived))throw new HttpsError('failed-precondition','현재 회사의 거래처와 판매 품목 연결을 확인해 주세요.');
  }
  const next={...row,status:input.action==='approve'?'approved' as const:'stopped' as const,revision:row.revision+1};tx.update(ref,{status:next.status,revision:next.revision,reviewedBy:scope.actorUid});return next;
 });
}
export const listOrderInterpretationRulesCommand=onCall({region:'asia-northeast3'},request=>{const scope=authorizeOrderCopy(request.auth,request.data?.includeAll===true);if(request.data?.companyId!==scope.companyId)throw new HttpsError('permission-denied','다른 회사의 별칭 규칙은 조회하지 않습니다.');return listOrderInterpretationRules(admin.firestore(),scope,request.data?.includeAll===true);});
export const reviewOrderInterpretationRuleCommand=onCall({region:'asia-northeast3'},request=>reviewOrderInterpretationRule(admin.firestore(),authorizeOrderCopy(request.auth,true),request.data));
import { normalizeOrderCopyRecoveryReference, type OrderCopyRecoveryCommand, type OrderCopyRecoveryReference, type OrderCopyRecoveryResult, type OrderCopyRecoveryHistoryResult } from './shared/orderCopyRecovery';
/** 최초 영수증을 확인한다. 이후 주문 편집·삭제는 과거 저장 성공을 되돌리지 않는다. */
async function readOrderCopyRecovery(tx: admin.firestore.Transaction, db: admin.firestore.Firestore, scope: OrderInterpretationScope, reference: OrderCopyRecoveryReference, saved?: admin.firestore.DocumentSnapshot): Promise<OrderCopyRecoveryResult> {
    const base = { version: 1 as const, reference, actorUid: scope.actorUid };
    const operation = saved ?? await tx.get(db.collection(ORDER_COPY_OPERATIONS).doc(orderCopyHash(`${reference.companyId}:${reference.requestId}`)));
    const unknown = (message = '보관된 주문의 원문 증거를 확인하지 못했습니다. 처리 기록과 현재 주문을 확인해 주세요.'): OrderCopyRecoveryResult => ({ ...base, status: 'unknown', requestHash: null, message });
    if (!operation.exists)
        return unknown('이 요청의 처리 기록이 아직 없습니다. 늦게 도착할 수 있으니 결과를 다시 확인하거나 미처리 요청을 중단해 주세요.');
    const row = operation.data()!;
    if (row.companyId !== scope.companyId || row.actorUid !== scope.actorUid)
        throw new HttpsError('permission-denied', '다른 회사·작성자의 복사 주문은 확인할 수 없습니다.');
    if (row.requestId !== reference.requestId || operation.id !== orderCopyHash(`${scope.companyId}:${reference.requestId}`))
        return unknown();
    if (row.status === 'stopped' && row.recoveryFence === true && row.requestHash === null)
        return { ...base, status: 'stopped', requestHash: null, message: '미처리 복사 주문 요청을 중단했습니다. 이미 만들어진 주문은 삭제하지 않았습니다.' };
    if (!['applied', 'rejected'].includes(row.status) || typeof row.requestText !== 'string' || orderCopyHash(row.requestText) !== row.requestHash)
        return unknown();
    try {
        const request = validateOrderInterpretation(JSON.parse(row.requestText), scope);
        if (canonicalOrderInterpretation(request, scope) !== row.requestText || request.requestId !== reference.requestId)
            return unknown();
        const draft = request.confirmed.orderDraft;
        if (row.orderId !== (id(draft.id) ? draft.id : ''))
            return unknown();
        if (row.status === 'rejected')
            return typeof row.reason === 'string' ? { ...base, status: 'rejected', requestHash: row.requestHash, message: `이 요청은 주문을 만들지 않았습니다. ${row.reason}` } : unknown();
        const approved = JSON.parse(row.orderText);
        const selected = selectOrderCopyDraft(draft);
        if (typeof approved.createdBy !== 'string' || !approved.createdBy || JSON.stringify(approved) !== JSON.stringify({ ...selected, companyId: scope.companyId, createdBy: approved.createdBy, status: 'PENDING' }))
            return unknown();
        return { ...base, status: 'applied', requestHash: row.requestHash, orderId: row.orderId, cardNo: selected.cardNo, partnerName: selected.partnerName, createdAt: selected.createdAt, message: '이 요청의 주문 등록이 완료됐습니다. 같은 주문을 다시 만들지 않습니다.' };
    }
    catch {
        return unknown();
    }
}
export async function recoverOrderCopy(db: admin.firestore.Firestore, scope: OrderInterpretationScope & {
    employeeId: string;
}, input: OrderCopyRecoveryCommand): Promise<OrderCopyRecoveryResult | OrderCopyRecoveryHistoryResult> {
    if (!input || !['inspect', 'stop', 'listHistory'].includes(input.action))
        fail('복사 주문 복구 작업을 확인해 주세요.');
    if (input.action === 'listHistory') {
        normalizeOrderCopyRecoveryReference({ companyId: input.companyId, requestId: 'history' });
        if (input.companyId !== scope.companyId)
            throw new HttpsError('permission-denied', '다른 회사의 복사 주문 기록은 조회하지 않습니다.');
        const binding = orderCopyHash(JSON.stringify([scope.companyId, scope.actorUid]));
        let after: string | undefined;
        if (input.cursor !== undefined) {
            try {
                if (typeof input.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(input.cursor))
                    throw Error();
                const decoded = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'));
                if (decoded.version !== 1 || decoded.binding !== binding || !/^[a-f0-9]{64}$/.test(decoded.after))
                    throw Error();
                after = decoded.after;
            }
            catch {
                throw new HttpsError('invalid-argument', '이력 페이지의 회사·작성자가 다릅니다. 처음부터 다시 조회해 주세요.');
            }
        }
        let query = db.collection(ORDER_COPY_OPERATIONS).where('actorUid', '==', scope.actorUid).orderBy(admin.firestore.FieldPath.documentId()).limit(50);
        if (after)
            query = query.startAfter(after);
        return db.runTransaction(async (tx) => {
            const page = await tx.get(query), entries: OrderCopyRecoveryResult[] = [];
            for (const row of page.docs) {
                const value = row.data();
                if (value.companyId !== scope.companyId || !id(value.requestId) || row.id !== orderCopyHash(`${scope.companyId}:${value.requestId}`))
                    continue;
                entries.push(await readOrderCopyRecovery(tx, db, scope, { companyId: scope.companyId, requestId: value.requestId }, row));
            }
            return { version: 1, companyId: scope.companyId, actorUid: scope.actorUid, entries, nextCursor: page.size === 50 ? Buffer.from(JSON.stringify({ version: 1, binding, after: page.docs[49].id })).toString('base64url') : null };
        });
    }
    const reference = normalizeOrderCopyRecoveryReference(input.reference);
    if (reference.companyId !== scope.companyId)
        throw new HttpsError('permission-denied', '요청 회사가 다릅니다.');
    return db.runTransaction(async (tx) => {
        const saved = await tx.get(db.collection(ORDER_COPY_OPERATIONS).doc(orderCopyHash(`${scope.companyId}:${reference.requestId}`)));
        if (saved.exists || input.action === 'inspect')
            return readOrderCopyRecovery(tx, db, scope, reference, saved);
        tx.create(saved.ref, { version: 1, companyId: scope.companyId, actorUid: scope.actorUid, requestId: reference.requestId, status: 'stopped', recoveryFence: true, requestHash: null });
        return { version: 1, reference, actorUid: scope.actorUid, status: 'stopped', requestHash: null, message: '미처리 복사 주문 요청을 중단했습니다. 늦게 도착하는 같은 요청도 주문을 만들지 않습니다.' };
    });
}
