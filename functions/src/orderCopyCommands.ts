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
  if(saved.exists){const row=saved.data()!;if(row.companyId!==scope.companyId||row.actorUid!==scope.actorUid||row.requestText!==input.requestText||row.requestHash!==input.requestHash||row.orderId!==orderId||!['applied','rejected'].includes(row.status))throw new HttpsError('already-exists','같은 주문 요청 ID의 최초 원문이나 계정이 다릅니다.');
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
  tx.create(order!,approved);tx.create(operation,{...capture,orderText:JSON.stringify(approved)});
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
export const submitOrderCopyCommand=onCall({region:'asia-northeast3'},request=>submitOrderCopy(admin.firestore(),authorizeOrderCopy(request.auth),request.data));
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
