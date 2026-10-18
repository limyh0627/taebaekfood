import * as admin from 'firebase-admin';
import {createHash} from 'node:crypto';
import {HttpsError,onCall} from 'firebase-functions/v2/https';
import {cleanupValidId} from './shared/partnerItemCleanup';
import {ORDER_EDIT_OPERATIONS,normalizeOrderEditRequest,normalizeOrderEditReference,normalizeOrderEditResult,serializeOrderEditRequest,orderEditExpected,type OrderEditRequest,type OrderEditCommand,type OrderEditReference,type OrderEditResult,type OrderEditItem} from './shared/orderEditCommand';
import {decodeCatalogValue,needsCatalogOrderReferenceProof,CATALOG_ORDER_EPOCH,type CatalogValueAdapter} from './shared/catalogOrderReferenceProof';
import {classifyOrderEdit,editBlockMessage,orderEditTouchesInventory} from './shared/orderEditGuard';
import {stampOrderItemEdits} from './shared/stampOrderItemEdits';
import {workStatusFromItems} from './shared/orderWorkStatus';
import {diffOrderItems} from './shared/orderItemDiff';
import {protectInventoryWriterPatch,inventoryWriterSame} from './shared/inventoryWriterProtocol';
import {assertCatalogOrderItemsUsable as validateCatalogItems} from './catalogOrderReferenceProof';

type Actor = {uid:string;token:Record<string,unknown>};
type Scope = OrderEditReference & {actorUid:string};
const sha = (value:string):string=>createHash('sha256').update(value).digest('hex');
export const orderEditReceiptId = (companyId:string,actorUid:string,planId:string):string=>sha(JSON.stringify([companyId,actorUid,planId]));
function adapter(db:admin.firestore.Firestore):CatalogValueAdapter {
  return {
    special:value=>value instanceof admin.firestore.Timestamp?['timestamp',value.seconds,value.nanoseconds]
      :value instanceof admin.firestore.DocumentReference?['reference',value.path]
      :value instanceof admin.firestore.GeoPoint?['geo',value.latitude,value.longitude]
      :Buffer.isBuffer(value)?['bytes',[...value]]:undefined,
    timestamp:(seconds,nanos)=>new admin.firestore.Timestamp(seconds,nanos),reference:path=>db.doc(path),
    geo:(lat,lng)=>new admin.firestore.GeoPoint(lat,lng),bytes:bytes=>Buffer.from(bytes),
  };
}
function outcome(scope:Scope,status:OrderEditResult['status'],requestHash:string|null,message:string):OrderEditResult {
  return {...scope,status,requestHash,message};
}
/** 응답만 유실돼도 같은 주문 수정과 감사 이력을 두 번 반영하지 않는다. */
export async function executeOrderEditCommand(db:admin.firestore.Firestore,actor:Actor|undefined,input:OrderEditCommand):Promise<OrderEditResult> {
  if (!actor?.uid) throw new HttpsError('unauthenticated','로그인이 필요합니다.');
  if (!cleanupValidId(actor.token.employeeId) || !['taebaek','punghoe'].includes(String(actor.token.companyId))) throw new HttpsError('permission-denied','현재 회사 직원으로 로그인해 주세요.');
  let request:OrderEditRequest|undefined;
  let reference:OrderEditReference;
  let requestText:string|null=null;
  let requestHash:string|undefined;
  const codec = adapter(db);
  try {
    if (!input || typeof input !== 'object' || !['apply','inspect','cancel'].includes(input.mode)) throw Error('주문 수정 처리 종류를 확인해 주세요.');
    const keys = input.mode==='apply'?['mode','request']:['mode','reference','requestHash'];
    if (Object.keys(input).some(key=>!keys.includes(key))) throw Error('주문 수정 명령 형식을 확인해 주세요.');
    if (input.mode==='apply') {
      request = normalizeOrderEditRequest(input.request);
      reference = normalizeOrderEditReference({companyId:request.companyId,planId:request.planId,targetId:request.targetId});
      // codec의 실제 형식과 projection 범위까지 검증하며 옛 값을 새 입력 규칙으로 재해석하지 않는다.
      const expected = decodeCatalogValue(request.expected,codec) as Record<string,unknown>;
      if (!expected || Array.isArray(expected) || JSON.stringify(orderEditExpected(expected,codec))!==JSON.stringify(request.expected)) throw Error('주문 수정 비교 원문을 확인해 주세요.');
      requestText = serializeOrderEditRequest(request);
      requestHash = sha(requestText);
    } else {
      reference = normalizeOrderEditReference(input.reference);
      requestHash = input.requestHash;
      if (requestHash!==undefined && (typeof requestHash!=='string' || !/^[a-f0-9]{64}$/.test(requestHash))) throw Error('주문 수정 원문 해시를 확인해 주세요.');
    }
  } catch(error) {throw new HttpsError('invalid-argument',error instanceof Error?error.message:'주문 수정 원문을 확인해 주세요.');}
  if (reference.companyId!==actor.token.companyId) throw new HttpsError('permission-denied','다른 회사의 주문은 수정할 수 없습니다.');
  const scope:Scope = {...reference,actorUid:actor.uid};
  const operationRef = db.collection(ORDER_EDIT_OPERATIONS).doc(orderEditReceiptId(scope.companyId,actor.uid,scope.planId));
  const at = new Date().toISOString();
  return db.runTransaction(async tx=>{
    const prior = await tx.get(operationRef);
    if (prior.exists) {
      const data = prior.data()!;
      let saved:OrderEditResult;
      try {
        if (data.version!==1 || !['applied','rejected','cancelled'].includes(data.status)) throw Error();
        saved=normalizeOrderEditResult({companyId:data.companyId,planId:data.planId,targetId:data.targetId,actorUid:data.actorUid,status:data.status,requestHash:data.requestHash,message:data.message},reference,actor.uid);
        if (saved.requestHash===null) {if(data.requestText!==null || saved.status!=='cancelled')throw Error();}
        else {
          if(typeof data.requestText!=='string'||sha(data.requestText)!==saved.requestHash)throw Error();
          const original=normalizeOrderEditRequest(JSON.parse(data.requestText));
          if(serializeOrderEditRequest(original)!==data.requestText||original.companyId!==scope.companyId||original.planId!==scope.planId||original.targetId!==scope.targetId)throw Error();
        }
      } catch {throw new HttpsError('failed-precondition','주문 수정 처리 근거를 확인하지 못했습니다. 최초 원문을 보존해 주세요.');}
      if(requestHash!==undefined&&saved.requestHash!==null&&requestHash!==saved.requestHash)throw new HttpsError('already-exists','같은 주문 수정 번호의 최초 내용이 다릅니다.');
      return input.mode==='apply'&&saved.status==='applied'?{...saved,status:'duplicate' as const}:saved;
    }
    if(input.mode==='inspect')return outcome(scope,'unknown',null,'주문 수정 결과를 확인하지 못했습니다. 자동으로 다시 저장하지 않습니다.');
    const receipt=(response:OrderEditResult,text:string|null)=>{
      tx.create(operationRef,{...response,version:1,requestText:text,createdAt:at});return response;
    };
    if(input.mode==='cancel')return receipt(outcome(scope,'cancelled',null,'이 주문 수정 요청을 중단했습니다. 늦게 도착한 저장도 막았습니다.'),null);
    const reject=(message:string)=>receipt(outcome(scope,'rejected',requestHash!,message),requestText);
    const orderRef=db.collection('orders').doc(scope.targetId);
    const [snapshot,employee]=await tx.getAll(orderRef,db.collection('employees').doc(actor.token.employeeId as string));
    const current=snapshot.data();
    if(!snapshot.exists||!current||(current.companyId??'taebaek')!==scope.companyId)return reject('대상 주문이 없거나 현재 회사의 주문이 아닙니다. 다시 조회해 주세요.');
    if(!employee.exists||(employee.get('companyId')??'taebaek')!==scope.companyId||typeof employee.get('name')!=='string'||!employee.get('name').trim())return reject('현재 회사 직원의 처리자 정보를 확인해 주세요.');
    if(JSON.stringify(orderEditExpected(current,codec))!==JSON.stringify(request!.expected))return reject('주문 내용이 변경되었습니다. 다시 조회한 뒤 수정해 주세요.');
    if(!Array.isArray(current.items))return reject('현재 주문 품목 원문을 확인해 주세요.');
    const before=current.items as OrderEditItem[];
    const edit=request!.edit;
    const items=edit.kind==='draft'?edit.draft.items:edit.items;
    const by=employee.get('name') as string;
    // 작업완료는 재고 경로의 소유다. 편집 DTO로 체크 상태나 처리자를 만들지 않는다.
    for(let index=0;index<items.length;index++){
      const line=items[index];
      const old=line.lineId?before.find(row=>row.lineId===line.lineId):before[index];
      if(old&&old.itemId===line.itemId){
        if(['checked','checkedBy','checkedAt'].some(key=>!inventoryWriterSame((old as unknown as Record<string,unknown>)[key],(line as unknown as Record<string,unknown>)[key])))return reject('작업완료 상태는 품목 편집에서 변경할 수 없습니다. 작업완료 버튼을 사용해 주세요.');
      }else if(line.checked===true||line.checkedBy!==undefined||line.checkedAt!==undefined)return reject('새 품목에 작업완료 기록을 넣을 수 없습니다.');
    }
    if((['processing','failed'].includes(current.inventoryOperation?.state)||current.retirementClaimPending===true)&&orderEditTouchesInventory(before,items))return reject('이 주문의 재고 작업을 먼저 확인해야 합니다. 작업 결과를 확인한 뒤 수량·구성을 수정해 주세요.');
    const decision=classifyOrderEdit(current as Parameters<typeof classifyOrderEdit>[0],items);
    if(decision.kind==='blocked')return reject(editBlockMessage(current,decision.line));
    if(decision.kind==='added'&&current.status==='DISPATCHED'&&!request!.confirmedAddedToDispatched)return reject('작업완료 주문의 품목 추가 확인이 필요합니다.');
    const stamped=stampOrderItemEdits(before,items,by,at);
    const patch:Record<string,unknown>={items:stamped};
    if(['PENDING','PROCESSING','DISPATCHED'].includes(current.status))patch.status=workStatusFromItems(stamped);
    if(edit.kind==='draft'){
      const draft=edit.draft;
      if(draft.deliveryDate.split('T')[0]!==current.deliveryDate?.split('T')[0])patch.deliveryDate=draft.deliveryDate;
      patch.note=draft.note;patch.noteImportant=!!draft.note&&draft.noteImportant;
      if(draft.note!==(current.note||'')||draft.noteImportant!==!!current.noteImportant){patch.noteBy=by;patch.noteAt=at;}
    }
    const next={...current,...patch};
    if(needsCatalogOrderReferenceProof(current,next,codec)){
      const epoch=await tx.get(db.collection(CATALOG_ORDER_EPOCH).doc(scope.companyId));
      if(epoch.exists){
        if(epoch.get('companyId')!==scope.companyId||!Number.isSafeInteger(epoch.get('revision'))||epoch.get('revision')<0)return reject('현재 회사의 품목 버전을 확인해 주세요.');
        // 기존 catalog proof와 같은 검증 정본을 이 거래 안에서 실행한다.
        try {await validateCatalogItems(db,tx,scope.companyId,stamped);}
        catch(error){if(error instanceof HttpsError&&error.code==='failed-precondition')return reject(error.message);throw error;}
      }
    }
    const changes=diffOrderItems(before,stamped);
    const auditRef=db.collection('orderItemEdits').doc('order-edit-'+operationRef.id);
    if(changes.length&&(await tx.get(auditRef)).exists)return reject('같은 수정 이력 번호가 이미 있습니다. 최초 요청을 확인해 주세요.');
    tx.update(orderRef,protectInventoryWriterPatch(current,patch,['items','status']));
    if(changes.length)tx.create(auditRef,{companyId:scope.companyId,orderId:scope.targetId,at,by,changes:changes.map(change=>change.text)});
    return receipt(outcome(scope,'applied',requestHash!,'주문 수정을 완료했습니다.'),requestText);
  });
}
export const orderEditCommand=onCall({region:'asia-northeast3'},request=>executeOrderEditCommand(admin.firestore(),request.auth as Actor|undefined,request.data));
