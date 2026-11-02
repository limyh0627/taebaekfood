import {createHash,randomUUID} from 'node:crypto';
import {HttpsError,onCall} from 'firebase-functions/v2/https';
import type {firestore} from 'firebase-admin';
import {inventoryDocId,operationDocId,legacyOperationDocId,commandHash,type RawInventoryCommand,type RawInventoryMovement,type RawInventoryState} from './shared/rawInventoryCore';
import {prepareRawCommand,type RawReadSnapshot} from './shared/rawInventoryPrepare';
import {toLedgerDoc,normalizeRawMovement,type LegacyLedgerFields} from './shared/rawInventoryDocument';
import {advanceInventoryWriterProtocol} from './shared/inventoryWriterProtocol';
import {buildPreparedRawWritePlan} from './shared/rawPreparedWritePlan';
import {assertFullEmployeeScope,fullCodec,fullSnapshotNative} from './shared/orderStockFullPlan';
import {planOrderCancellation} from './shared/orderInventoryCancellationPlan';
import {cancellationEvidenceText} from './shared/orderCancellationEvidence';
import {buildClientRawReverseOperationV2} from './shared/orderProductionBatchContract';
import {ensureOrderLineIds,aggregateOrderLineInventory} from './shared/orderLineInventory';

export type RawManualCorrectionRequest={
 version:1;operationId:string;companyId:'taebaek'|'punghoe';actorUid:string;employeeId:string;
 command:Extract<RawInventoryCommand,{kind:'consume'|'receive'|'stocktake'}>;
 options:{now:string;newLotId:string;carryOverLotId:string;legacy:LegacyLedgerFields};
 display:{originalId:string;material:string;amount:string;unit:'kg'|'L';date:string;note:string;mode:'pos'|'neg'|'stocktake'};
};
export type RawManualCorrectionResult={
 version:1;operationId:string;companyId:string;actorUid:string;employeeId:string;requestHash:string;requestText:string;
 status:'applied'|'cancelled'|'rejected'|'unknown'|'conflict';message:string;movement?:RawInventoryMovement;code?:string;
};
type Actor={uid:string;token:Record<string,unknown>};
const validId=(v:unknown):v is string=>typeof v==='string'&&!!v&&v.trim()===v&&v.length<=512&&!v.includes('/');
const longDocId=(v:unknown):v is string=>typeof v==='string'&&!!v&&v.trim()===v&&!v.includes('/')&&!['.','..'].includes(v)&&!/^__.*__$/.test(v)&&!/\p{Cs}/u.test(v)&&Buffer.byteLength(v,'utf8')<=1500;
const fail=(message:string):never=>{throw new HttpsError('invalid-argument',message);};
const keys=(value:object,allowed:string[])=>{if(Object.keys(value).some(key=>!allowed.includes(key)))fail('등록되지 않은 수동정정 필드입니다.');};
const iso=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const json=(value:unknown):unknown=>{
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'&&Number.isFinite(value)&&!Object.is(value,-0))return value;
 if(Array.isArray(value))return value.map(json);
 if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.keys(value).sort().map(key=>[key,json((value as Record<string,unknown>)[key])]));
 return fail('수동정정 원문은 유한한 JSON 값이어야 합니다.');
};
/** 해시의 직렬화 원본은 서버 한 곳에서만 정한다. 표시값·시각·legacy 옵션도 원문이다. */
export function rawManualCorrectionText(value:unknown):string{return JSON.stringify(json(value));}
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
export const rawManualCorrectionReceiptId=(companyId:string,operationId:string)=>sha(JSON.stringify([companyId,operationId]));
export function normalizeRawManualCorrectionRequest(value:unknown):RawManualCorrectionRequest{
 const text=rawManualCorrectionText(value);if(Buffer.byteLength(text)>300_000)fail('수동정정 원문이 저장 한도를 넘었습니다.');
 const r=JSON.parse(text) as RawManualCorrectionRequest;
 if(!r||typeof r!=='object'||Array.isArray(r))fail('수동정정 요청 형식을 확인해 주세요.');
 keys(r,['version','operationId','companyId','actorUid','employeeId','command','options','display']);
 if(r.version!==1||!/^raw-manual-v1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.operationId)||!['taebaek','punghoe'].includes(r.companyId)||!validId(r.actorUid)||!validId(r.employeeId))fail('최초 정정 번호와 회사·직원·로그인을 확인해 주세요.');
 const c=r.command,o=r.options,d=r.display;
 if(!c||!o||!d||Array.isArray(c)||Array.isArray(o)||Array.isArray(d))fail('최초 정정 본문과 표시 입력을 확인해 주세요.');
 keys(c,['operationId','companyId','rawItemId','materialSnapshot','effectiveAt','source','actorName','kind',...(c.kind==='stocktake'?['targetKg']:c.kind==='receive'?['kg','lot']:['kg'])]);
 if(c.operationId!==r.operationId||c.companyId!==r.companyId||!validId(c.rawItemId)||typeof c.materialSnapshot!=='string'||!c.materialSnapshot.trim()||!['consume','receive','stocktake'].includes(c.kind)||typeof c.effectiveAt!=='string'||!Number.isFinite(Date.parse(c.effectiveAt))||c.actorName!==undefined&&typeof c.actorName!=='string')fail('정정의 품목·회사·시각·종류를 확인해 주세요.');
 if(!c.source||Array.isArray(c.source))fail('정정 출처를 확인해 주세요.');keys(c.source,['type','id']);
 if(c.source.id!==r.operationId||c.source.type!==(c.kind==='stocktake'?'stocktake':'adjustment'))fail('최초 정정과 출처 번호가 다릅니다.');
 const kg=c.kind==='stocktake'?c.targetKg:c.kg;
 if(!Number.isFinite(kg)||kg<=0)fail('정정 수량은 0보다 큰 유한한 값이어야 합니다.');
 if(c.kind==='receive'){if(!c.lot||Array.isArray(c.lot))fail('입고 정정 로트를 확인해 주세요.');keys(c.lot,['supplierName','qtyIn']);if(c.lot.supplierName!=='정정'||c.lot.qtyIn!==0)fail('입고 정정의 최초 로트 표시가 다릅니다.');}
 keys(o,['now','newLotId','carryOverLotId','legacy']);
 if(!iso(o.now)||o.newLotId!=='lot-'+r.operationId||o.carryOverLotId!=='carry-'+r.operationId||!o.legacy||Array.isArray(o.legacy))fail('최초 저장 시각과 정정 로트 번호를 확인해 주세요.');
 keys(o.legacy,['note','type','addedBy','originalAmount','originalUnit']);
 if(o.legacy.type!=='correction'||typeof o.legacy.note!=='string'||typeof o.legacy.originalAmount!=='number'||!Number.isFinite(o.legacy.originalAmount)||o.legacy.originalAmount<=0||!['kg','L'].includes(o.legacy.originalUnit??'')||o.legacy.addedBy!==undefined&&typeof o.legacy.addedBy!=='string')fail('정정 표시 원문을 확인해 주세요.');
 keys(d,['originalId','material','amount','unit','date','note','mode']);
 if(!validId(d.originalId)||typeof d.material!=='string'||!d.material.trim()||typeof d.amount!=='string'||!Number.isFinite(Number(d.amount))||Number(d.amount)<=0||!['kg','L'].includes(d.unit)||!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||!Number.isFinite(Date.parse(d.date+'T00:00:00Z'))||new Date(d.date+'T00:00:00Z').toISOString().slice(0,10)!==d.date||typeof d.note!=='string'||!['pos','neg','stocktake'].includes(d.mode))fail('최초 입력 표시를 확인해 주세요.');
 // 원래 UI의 used 양수는 consume, 음수는 receive이며 실사는 절대 목표다.
 if(d.mode!==(c.kind==='consume'?'pos':c.kind==='receive'?'neg':'stocktake')||d.unit!==o.legacy.originalUnit||Number(d.amount)!==o.legacy.originalAmount||d.material!==c.materialSnapshot)fail('표시 입력과 정정 명령이 다릅니다.');
 return r;
}
function authorize(actor:Actor|undefined,r:RawManualCorrectionRequest){
 if(!actor)throw new HttpsError('unauthenticated','로그인이 필요합니다.');
 if(!validId(actor.uid)||actor.uid!==r.actorUid||actor.token.companyId!==r.companyId||actor.token.employeeId!==r.employeeId)throw new HttpsError('permission-denied','최초 정정과 같은 회사·직원 계정으로 확인해 주세요.');
}
const adapter=(snapshot:firestore.DocumentSnapshot):RawReadSnapshot=>({exists:()=>snapshot.exists,data:()=>snapshot.data()});
const clean=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
// SDK의 Timestamp·reference를 JSON으로 바꾸지 않고 undefined만 제거한다.
const cleanNative=(value:any):any=>Array.isArray(value)?value.map(cleanNative):value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,cleanNative(v)])):value;
export type RawReverseRequest={version:2;kind:'raw-reverse';operationId:string;companyId:'taebaek'|'punghoe';actorUid:string;employeeId:string;command:Extract<RawInventoryCommand,{kind:'reverse'}>;options:{now:string;newLotId:string;carryOverLotId:string;mirrorToItem?:boolean;legacy?:LegacyLedgerFields}};
export type RawReverseResult=Omit<RawManualCorrectionResult,'version'|'movement'> & {version:2;valueCodec?:'catalog-value-v1';stateNativeText?:string;movementNativeText?:string;resultHash?:string};
export type RawReverseGroupRequest={version:3;kind:'raw-reverse-group';operationId:string;companyId:'taebaek'|'punghoe';actorUid:string;employeeId:string;commands:{command:RawReverseRequest['command'];options:RawReverseRequest['options']}[];business:{kind:'oem-cancel'|'press-cancel'|'order-cancel'|'order-reversal';id:string;beforeNativeText:string;afterNativeText:string|null}};
export type RawReverseGroupResult={version:3;kind:'raw-reverse-group';operationId:string;companyId:string;actorUid:string;employeeId:string;requestText:string;requestHash:string;state:'prepared'|'applied'|'cancelled'|'blocked'|'conflict'|'unknown';permitId?:string;message:string};
export function normalizeRawReverseGroupRequest(value:unknown):RawReverseGroupRequest {
 const text=rawManualCorrectionText(value);if(Buffer.byteLength(text)>600_000)fail('원료 취소 묶음 원문이 저장 한도를 넘었습니다.');
 const r=JSON.parse(text) as RawReverseGroupRequest;if(!r||typeof r!=='object'||Array.isArray(r))fail('원료 취소 묶음을 확인해 주세요.');
 keys(r,['version','kind','operationId','companyId','actorUid','employeeId','commands','business']);
 if(r.version!==3||r.kind!=='raw-reverse-group'||!/^raw-reverse-group-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.operationId)||!['taebaek','punghoe'].includes(r.companyId)||!validId(r.actorUid)||!validId(r.employeeId)||!Array.isArray(r.commands)||!r.commands.length||r.commands.length>8)fail('원료 취소 묶음의 최초 번호와 회사를 확인해 주세요.');
 const seen=new Set<string>();for(const row of r.commands){if(!row||typeof row!=='object'||Array.isArray(row))fail('원료 취소 명령을 확인해 주세요.');keys(row,['command','options']);const one=normalizeRawReverseRequest({version:2,kind:'raw-reverse',operationId:row.command?.operationId,companyId:r.companyId,actorUid:r.actorUid,employeeId:r.employeeId,command:row.command,options:row.options});if(seen.has(one.operationId))fail('같은 원료 취소 번호가 중복되었습니다.');seen.add(one.operationId);}
 const b=r.business;if(!b||typeof b!=='object'||Array.isArray(b))fail('원래 업무를 확인해 주세요.');keys(b,['kind','id','beforeNativeText','afterNativeText']);if(!['oem-cancel','press-cancel','order-cancel','order-reversal'].includes(b.kind)||!longDocId(b.id)||typeof b.beforeNativeText!=='string'||b.afterNativeText!==null&&typeof b.afterNativeText!=='string')fail('원래 업무 원문을 확인해 주세요.');return r;
}
/** 거래 전체를 쪼개지 않고 기존 Web 거래가 소비할 원료 효과만 고정한다. */
async function executeRawReverseGroup(db:firestore.Firestore,actor:Actor|undefined,input:{action:'prepare'|'inspect'|'cancel';request:RawReverseGroupRequest}):Promise<RawReverseGroupResult>{
 const r=normalizeRawReverseGroupRequest(input.request);authorize(actor,r as unknown as RawManualCorrectionRequest);
 const requestText=rawManualCorrectionText(r),requestHash=sha(requestText),permitId=rawManualCorrectionReceiptId(r.companyId,r.operationId),receiptRef=db.doc('rawManualCorrectionReceipts/'+permitId),codec=fullCodec(db);
 const answer=(state:RawReverseGroupResult['state'],message:string,withPermit=false):RawReverseGroupResult=>({version:3,kind:'raw-reverse-group',operationId:r.operationId,companyId:r.companyId,actorUid:r.actorUid,employeeId:r.employeeId,requestText,requestHash,state,...(withPermit?{permitId}:{}),message});
 return db.runTransaction(async tx=>{
  const cache=new Map<string,firestore.DocumentSnapshot>();
  const read=async(path:string)=>{const old=cache.get(path);if(old)return old;const snap=await tx.get(db.doc(path));fullSnapshotNative(db,snap);cache.set(path,snap);return snap;};
  const [employee,receipt]=await Promise.all([read('employees/'+r.employeeId),read(receiptRef.path)]);
  try{assertFullEmployeeScope(employee.data(),{uid:r.actorUid,employeeId:r.employeeId,companyId:r.companyId});}catch{throw new HttpsError('permission-denied','현재 회사 직원 권한을 확인해 주세요.');}
  if(receipt.exists){const saved=receipt.data()!;if(saved.version!==3||saved.kind!==r.kind||saved.operationId!==r.operationId||saved.requestText!==requestText||saved.requestHash!==requestHash||saved.companyId!==r.companyId||saved.actorUid!==r.actorUid||saved.employeeId!==r.employeeId)return answer('conflict','같은 번호의 최초 원문이 다릅니다.');
   if(!['prepared','applied','cancelled'].includes(saved.state)||typeof saved.nonce!=='string'||!/^[0-9a-f-]{36}$/i.test(saved.nonce)||rawManualCorrectionText(normalizeRawReverseGroupRequest(saved.request))!==requestText||typeof saved.effectsHash!=='string'||saved.effectsHash!==sha(codec.text({rawEffects:saved.rawEffects,businessWitness:saved.businessWitness,resultsNativeText:saved.resultsNativeText})))throw new HttpsError('failed-precondition','묶음 원료 처리 근거가 손상되었습니다.');
   if(input.action==='cancel'&&saved.state==='prepared'){tx.update(receiptRef,{state:'cancelled'});return answer('cancelled','원료 묶음 사용을 중단했습니다.',true);}return answer(saved.state,'기존 원료 묶음 상태를 확인했습니다.',true);
  }
  if(input.action!=='prepare')return answer('unknown','처리 기록이 없어 미처리로 확정하지 않았습니다.');
  const businessPath=r.business.kind==='oem-cancel'?'purchaseOrders/'+r.business.id:r.business.kind==='press-cancel'?'rawInventoryJobs/raw-press-'+operationDocId(r.business.id):'orders/'+r.business.id,businessSnap=await read(businessPath),before=businessSnap.data();
  if(!businessSnap.exists||!before||codec.text(before)!==r.business.beforeNativeText||(before.companyId??'taebaek')!==r.companyId)return answer('conflict','원래 업무가 변경되었거나 회사를 확인할 수 없습니다.');
  let after:any;try{after=r.business.afterNativeText===null?null:codec.decode(r.business.afterNativeText);}catch{return answer('blocked','업무 변경 원문을 확인할 수 없습니다.');}
  if(r.business.kind!=='order-cancel'&&(!after||typeof after!=='object'||Array.isArray(after)))return answer('blocked','업무 취소 원문을 확인할 수 없습니다.');
  const originalsById=new Map<string,RawInventoryCommand>();
  let orderPlan:ReturnType<typeof planOrderCancellation>|undefined;
  let reversalTraces:{operationId?:string;rawItemId?:string;kg:number;ledgerOnly?:boolean}[]|undefined;
  if(r.business.kind==='oem-cancel'){
   const sent=before.oemSent;if(before.poType!=='oem'||before.status!=='invoiced'||before.oemIssueStatus!=='complete'||before.receivedAt||before.oemReceiptOperationId||before.linkedStatementId||before.oemCancelledAt||before.oemCancelOperationId||!Array.isArray(sent)||!sent.length||sent.length!==r.commands.length||typeof before.oemIssueDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(before.oemIssueDate))return answer('blocked','OEM 원발주와 전체 원료를 확인해 주세요.');
   const [received,fee,statement]=await Promise.all([read('oemReceiptOperations/oem-receive:'+r.business.id),read('adjustmentRequests/OEMFEE-'+r.business.id),read('issuedStatements/OEMFEE-'+r.business.id)]);if(received.exists||fee.exists||statement.exists)return answer('blocked','이미 처리된 OEM 입고 또는 전표가 있습니다.');
   if(typeof after.oemCancelledAt!=='string'||!iso(after.oemCancelledAt)||after.oemCancelOperationId!=='oem-cancel:'+r.business.id||codec.text({...before,oemCancelledAt:after.oemCancelledAt,oemCancelOperationId:after.oemCancelOperationId})!==codec.text(after))return answer('blocked','OEM 취소 전이를 확인해 주세요.');
   const itemIds=new Set<string>();for(const row of sent){if(!row||!longDocId(row.rawItemId)||itemIds.has(row.rawItemId)||typeof row.material!=='string'||!Number.isFinite(row.kg)||row.kg<=0)return answer('blocked','OEM 원료 목록을 확인해 주세요.');itemIds.add(row.rawItemId);const id='oem-issue:'+r.business.id+':'+row.rawItemId;originalsById.set(id,{kind:'consume',operationId:id,companyId:r.companyId,rawItemId:row.rawItemId,materialSnapshot:row.material,effectiveAt:before.oemIssueDate+'T12:00:00+09:00',source:{type:'oem',id:r.business.id},kg:row.kg,...(before.oemIssuedBy?{actorName:before.oemIssuedBy}:{})});}
   for(const row of r.commands)if(!originalsById.has(row.command.originalOperationId)||row.command.operationId!=='oem-cancel:'+r.business.id+':'+row.command.rawItemId||row.command.source.type!=='oem'||row.command.source.id!==r.business.id||row.command.effectiveAt!==after.oemCancelledAt||row.options.mirrorToItem===false||row.options.legacy?.orderId!==undefined)return answer('blocked','OEM 취소 명령과 원발주가 다릅니다.');
  }else if(r.business.kind==='press-cancel'){
   const evidence=before.rawPressEvidence,cancellation=after.cancellation,cr=cancellation?.request,expected=before.expectedOperationIds;
   if(before.status!=='complete'||before.id!=='raw-press-'+operationDocId(r.business.id)||before.source?.type!=='production'||before.source.id!==r.business.id||before.cancellation!==undefined||!evidence||evidence.companyId!==r.companyId||evidence.entry?.id!==r.business.id||before.actorUid!==evidence.actorUid||before.createdAt!==evidence.entry?.createdAt||before.completedAt!==evidence.entry?.createdAt||!Array.isArray(expected)||expected.length!==r.commands.length||!cr||cr.originalOperationId!==r.business.id||cr.companyId!==r.companyId||cr.actorUid!==r.actorUid||codec.text(cr.original)!==codec.text(evidence)||cancellation.companyId!==r.companyId||cancellation.actorUid!==r.actorUid||cancellation.completedAt!==cr.createdAt)return answer('blocked','압착 원작업과 취소 원문을 확인해 주세요.');
   const source=evidence.sourceCommand,derived=evidence.derivedCommand;if(!source||!derived||source.operationId!==r.business.id||derived.operationId!=='yield:'+r.business.id||source.kind!=='consume-lot'||derived.kind!=='receive'||source.source?.type!=='manual'||derived.source?.type!=='manual'||source.source.id!==r.business.id||derived.source.id!==r.business.id)return answer('blocked','압착 원료 쌍을 확인해 주세요.');
   const entry=evidence.entry,rule=evidence.yieldRule;if(entry.type!=='manual'||entry.companyId!==undefined&&entry.companyId!==r.companyId||entry.targetKg!=null||entry.received!==0||!Number.isFinite(entry.used)||entry.used<=0||!entry.targetLotId||!Number.isFinite(Date.parse(entry.effectiveAt))||!Number.isFinite(Date.parse(entry.createdAt))||!rule||typeof rule.product!=='string'||!rule.product||!Number.isFinite(rule.rate)||rule.rate<=0||source.companyId!==r.companyId||derived.companyId!==r.companyId||!longDocId(source.rawItemId)||!longDocId(derived.rawItemId)||source.rawItemId===derived.rawItemId||source.kg!==entry.used||source.lotId!==entry.targetLotId||source.effectiveAt!==entry.effectiveAt||derived.effectiveAt!==entry.effectiveAt||!Number.isFinite(derived.kg)||derived.kg<0||derived.kg!==Math.round(entry.used*rule.rate*1000)/1000||source.materialSnapshot!==entry.material||derived.materialSnapshot!==rule.product)return answer('blocked','압착 최초 수량과 원료 쌍을 확인해 주세요.');
   const disposition=before.sourceAppliedKg===0?'source-unapplied':derived.kg===0?'yield-zero':'received';if(before.derivedDisposition!==disposition||!Number.isFinite(before.sourceAppliedKg)||!Number.isFinite(before.derivedAppliedKg))return answer('blocked','압착 적용 근거를 확인해 주세요.');
   originalsById.set(source.operationId,source);if(disposition==='received')originalsById.set(derived.operationId,derived);if(codec.text(expected)!==codec.text([...originalsById.keys()]))return answer('blocked','압착 원료 전체 근거를 확인해 주세요.');
   if(cr.version!==1||typeof cr.cancellationId!=='string'||!cr.cancellationId||!iso(cr.effectiveAt)||cr.createdAt!==cr.effectiveAt)return answer('blocked','압착 취소 원문을 확인해 주세요.');
   const reverse=(command:any,side:string)=>({kind:'reverse',companyId:r.companyId,rawItemId:command.rawItemId,materialSnapshot:command.materialSnapshot,operationId:cr.cancellationId+':'+side,effectiveAt:cr.effectiveAt,source:{type:'reversal',id:command.operationId},originalOperationId:command.operationId});
   if(codec.text(cr.sourceReverse)!==codec.text(reverse(source,'source'))||codec.text(cr.derivedReverse)!==codec.text(reverse(derived,'derived'))||Object.keys(cr).sort().join(',')!=='actorUid,cancellationId,companyId,createdAt,derivedReverse,effectiveAt,original,originalOperationId,sourceReverse,version'||Object.keys(cancellation).sort().join(',')!=='actorUid,companyId,completedAt,derivedAppliedKg,request,sourceAppliedKg')return answer('blocked','압착 취소 요청 형식을 확인해 주세요.');
   for(const row of r.commands){const c=row.command,expectedReverse=c.originalOperationId===source.operationId?cr.sourceReverse:cr.derivedReverse;if(!originalsById.has(c.originalOperationId)||codec.text(c)!==codec.text(expectedReverse)||row.options.now!==cr.createdAt||row.options.mirrorToItem===false||row.options.legacy?.orderId!==undefined)return answer('blocked','압착 취소 명령이 원문과 다릅니다.');}
   if(disposition!=='received'){const derivedModern=operationDocId(derived.operationId),derivedLegacy=legacyOperationDocId(derived.operationId),reverseModern=operationDocId(cr.derivedReverse.operationId),reverseLegacy=legacyOperationDocId(cr.derivedReverse.operationId),[dm,dl,dg,di,ds,rm,rl]=await Promise.all([read('rawMaterialLedger/'+derivedModern),derivedLegacy===derivedModern?Promise.resolve(null):read('rawMaterialLedger/'+derivedLegacy),read('rawInventoryReversalGuards/'+derivedModern),read('items/'+derived.rawItemId),read('rawInventories/'+inventoryDocId(r.companyId,derived.rawItemId)),read('rawMaterialLedger/'+reverseModern),reverseLegacy===reverseModern?Promise.resolve(null):read('rawMaterialLedger/'+reverseLegacy)]);if(dm.exists||dl?.exists||dg.exists||rm.exists||rl?.exists||!di.exists||(di.data()?.companyId??'taebaek')!==r.companyId||ds.exists&&(ds.data()?.companyId!==r.companyId||ds.data()?.rawItemId!==derived.rawItemId)||before.derivedAppliedKg!==0)return answer('blocked','압착 파생 원료의 미적용 근거를 확인해 주세요.');}
   const expectedAfter={...before,...advanceInventoryWriterProtocol(before,{cancellation}),rawReversePermitRefV1:{permitId,slot:0}};if(codec.text(expectedAfter)!==codec.text(after))return answer('blocked','압착 취소 전이를 확인해 주세요.');
  }else if(r.business.kind==='order-cancel'){
   if(after!==null||['orderProductionRefsV1','inventoryExecutionProtocol','orderManualCorrectionRefsV1','legacyRecoveryRetirementV1'].some(k=>Object.prototype.hasOwnProperty.call(before,k)))return answer('blocked','부분 생산 또는 정정 권한이 있는 주문은 기존 원료 묶음으로 취소할 수 없습니다.');
   const order={...before,id:r.business.id} as any;try{orderPlan=planOrderCancellation(order,'delete');}catch{return answer('blocked','원주문의 취소 근거를 확인해 주세요.');}
   const evidence=sha(cancellationEvidenceText(order,'delete')),lock=before.inventoryOperation;if(!lock||lock.id!=='order-cancellation-delete-'+r.business.id+'-'+evidence||lock.kind!=='status'||lock.targetStatus!=='PENDING'||lock.state!=='processing'||typeof lock.startedAt!=='string'||!Number.isFinite(Date.parse(lock.startedAt))||typeof lock.actor!=='string'||orderPlan.rawOriginals.size!==r.commands.length)return answer('blocked','원주문의 취소 승인과 전체 원료를 확인해 주세요.');
   for(const row of r.commands){const c=row.command,expectedItem=orderPlan.rawOriginals.get(c.originalOperationId),expectedId=buildClientRawReverseOperationV2(c.originalOperationId,operationDocId(c.originalOperationId),legacyOperationDocId(c.originalOperationId));if(!expectedItem||expectedItem!==c.rawItemId||c.operationId!==expectedId||c.source.type!=='reversal'||c.source.id!==r.business.id||c.effectiveAt!==lock.startedAt||row.options.now!==lock.startedAt||c.materialSnapshot!==''||c.actorName!==(lock.actor||undefined)||row.options.mirrorToItem===false||row.options.legacy?.orderId!==r.business.id)return answer('blocked','주문 취소 명령과 승인 원문이 다릅니다.');}
  }else{
   if(!after||typeof after!=='object'||Array.isArray(after)||['orderProductionRefsV1','inventoryExecutionProtocol','orderManualCorrectionRefsV1','legacyRecoveryRetirementV1'].some(k=>Object.prototype.hasOwnProperty.call(before,k)||Object.prototype.hasOwnProperty.call(after,k)))return answer('blocked','서버 전용 생산 주문은 기존 원료 묶음으로 취소할 수 없습니다.');
   const allowed=new Set(['items','status','itemInventory','producedAt','rawLotsDeducted','rawConsumedLots','rawInventoryAttempt','autoBuilt','producedUnits','inventorySnapshots','inventoryOperation','inventoryWriterProtocolVersion','inventoryWriteRevision','orderListProjection','catalogReferenceProofId','shippedOut','productConsumedLots','shipmentConfirmedBy','shipmentConfirmedAt','deliveredAt']);
   const fixed=(v:Record<string,any>)=>Object.fromEntries(Object.entries(v).filter(([k])=>!allowed.has(k)));if(codec.text(fixed(before))!==codec.text(fixed(after))||after.inventoryOperation!==null||!Array.isArray(before.items)||!Array.isArray(after.items)||before.items.length!==after.items.length)return answer('blocked','주문 취소 이외의 업무 원문이 변경되었습니다.');
   const beforeRows=ensureOrderLineIds(before.items) as Record<string,any>[],afterRows=ensureOrderLineIds(after.items) as Record<string,any>[],lock=before.inventoryOperation;let selected:string|undefined;
   if(lock?.kind==='line'){
    selected=lock.lineId;const states=before.itemInventory,next=after.itemInventory,prior=states?.[selected!],later=next?.[selected!];if(lock.state!=='processing'||typeof selected!=='string'||!prior||['rawEffectOrigin','rawEffectReferences','rawReversalOrigin'].some(k=>Object.prototype.hasOwnProperty.call(prior,k))||prior.applied!==true||!later||later.applied!==false||typeof later.reversedAt!=='string'||codec.text({...prior,applied:false,reversedAt:later.reversedAt})!==codec.text(later)||!states||!next||Object.keys(states).sort().join('\0')!==Object.keys(next).sort().join('\0')||Object.keys(states).some(k=>k!==selected&&codec.text(states[k])!==codec.text(next[k])))return answer('blocked','취소할 한 줄의 원료 근거를 확인해 주세요.');
    const aggregate=aggregateOrderLineInventory(before,next);if(Object.entries(aggregate).some(([key,value])=>codec.text(after[key])!==codec.text(value)))return answer('blocked','다른 줄의 생산 합계가 변경되었습니다.');
    reversalTraces=prior.rawConsumedLots;
   }else{
    if(lock?.kind!=='status'||lock.state!=='processing'||!before.producedAt||after.producedAt!=='')return answer('blocked','전체 생산 취소 전이를 확인해 주세요.');
    reversalTraces=before.inventorySnapshots?.production?.rawConsumedLots??before.rawConsumedLots;
    if(before.itemInventory){const states=before.itemInventory,next=after.itemInventory;if(!next||Object.keys(states).sort().join('\0')!==Object.keys(next).sort().join('\0')||Object.keys(states).some(k=>states[k]?.applied===true?(['rawEffectOrigin','rawEffectReferences','rawReversalOrigin'].some(field=>Object.prototype.hasOwnProperty.call(states[k],field))||next[k]?.applied!==false||typeof next[k].reversedAt!=='string'||codec.text({...states[k],applied:false,reversedAt:next[k].reversedAt})!==codec.text(next[k])):codec.text(states[k])!==codec.text(next[k])))return answer('blocked','전체 생산 원문을 확인해 주세요.');}
   }
   if(!Array.isArray(reversalTraces)||!reversalTraces.length||beforeRows.some((item:any,i:number)=>{const next=afterRows[i],without=(v:any)=>{const copy={...v};delete copy.checked;return copy;};if(codec.text(without(item))!==codec.text(without(next)))return true;return selected?item.lineId!==selected&&item.checked!==next.checked:item.checked!==next.checked;}))return answer('blocked','다른 주문 줄 또는 원료 원문이 변경되었습니다.');
   if(selected){const index=beforeRows.findIndex((row:any)=>row.lineId===selected);if(index<0||beforeRows[index]!.checked!==true||afterRows[index]!.checked!==false)return answer('blocked','취소한 주문 줄을 확인해 주세요.');}
   const ids=new Map<string,string>();for(const trace of reversalTraces){if(!trace.operationId||!trace.rawItemId||!Number.isFinite(trace.kg)||trace.kg<=0||ids.has(trace.operationId)&&ids.get(trace.operationId)!==trace.rawItemId)return answer('blocked','주문 원료 원본을 확인해 주세요.');ids.set(trace.operationId,trace.rawItemId);}if(ids.size!==r.commands.length)return answer('blocked','주문 원료가 일부 누락되었습니다.');
   for(const row of r.commands){const c=row.command,expectedId=buildClientRawReverseOperationV2(c.originalOperationId,operationDocId(c.originalOperationId),legacyOperationDocId(c.originalOperationId));if(ids.get(c.originalOperationId)!==c.rawItemId||c.operationId!==expectedId||c.source.type!=='reversal'||c.source.id!==r.business.id||row.options.now!==c.effectiveAt||row.options.mirrorToItem===false||row.options.legacy?.orderId!==r.business.id)return answer('blocked','주문 원료 취소 원문이 다릅니다.');}
  }
  const uniqueOriginals=new Set<string>(),rawReads:{row:RawReverseGroupRequest['commands'][number];movement:firestore.DocumentSnapshot;oldMovement:firestore.DocumentSnapshot|null;original:firestore.DocumentSnapshot;oldOriginal:firestore.DocumentSnapshot|null;guard:firestore.DocumentSnapshot;state:firestore.DocumentSnapshot;item:firestore.DocumentSnapshot}[]=[];
  for(const row of r.commands){const c=row.command,originalId=operationDocId(c.originalOperationId),oldOriginalId=legacyOperationDocId(c.originalOperationId),movementId=operationDocId(c.operationId),oldMovementId=legacyOperationDocId(c.operationId);if(uniqueOriginals.has(c.originalOperationId))return answer('blocked','같은 원본을 두 번 취소할 수 없습니다.');uniqueOriginals.add(c.originalOperationId);
   const [movement,oldMovement,original,oldOriginal,guard,state,item]=await Promise.all([read('rawMaterialLedger/'+movementId),oldMovementId===movementId?Promise.resolve(null):read('rawMaterialLedger/'+oldMovementId),read('rawMaterialLedger/'+originalId),oldOriginalId===originalId?Promise.resolve(null):read('rawMaterialLedger/'+oldOriginalId),read('rawInventoryReversalGuards/'+originalId),read('rawInventories/'+inventoryDocId(c.companyId,c.rawItemId)),read('items/'+c.rawItemId)]);
   if([movement,oldMovement,original,oldOriginal,guard,state,item].some(s=>s?.exists&&['fullEffectAuthority','orderManualCorrectionEffectAuthority'].some(k=>Object.prototype.hasOwnProperty.call(s.data()!,k))))return answer('conflict','서버 전용 원료 효과를 기존 묶음으로 취소할 수 없습니다.');
   if(movement.exists||oldMovement?.exists||guard.exists)return answer('conflict','이미 처리된 원료 이력 또는 취소표가 있습니다.');const raw=original.exists?original.data():oldOriginal?.data(),expected=originalsById.get(c.originalOperationId);
   if(!raw||raw.operationId!==c.originalOperationId||raw.companyId!==r.companyId||raw.rawItemId!==c.rawItemId||![originalId,oldOriginalId].includes(raw.id)||!Number.isSafeInteger(raw.sequence)||raw.sequence<1||!Number.isFinite(raw.reportedDeltaKg)||!Number.isFinite(raw.appliedDeltaKg)||['fullEffectAuthority','orderManualCorrectionEffectAuthority'].some(k=>Object.prototype.hasOwnProperty.call(raw,k))||original.exists&&oldOriginal?.exists&&codec.text(original.data())!==codec.text(oldOriginal.data()))return answer('conflict','원본 원료 이력과 최초 업무가 다릅니다.');
   if(r.business.kind==='order-cancel'||r.business.kind==='order-reversal'){const traces=(orderPlan?orderPlan.snapshots.flatMap(snapshot=>snapshot.rawConsumedLots??[]):reversalTraces??[]).filter(trace=>trace.operationId===c.originalOperationId);if(!['production','oem'].includes(raw.source?.type)||raw.source?.id!==r.business.id||!['consume','consume-lot','ledger-consume'].includes(raw.kind)||r.business.kind==='order-reversal'&&(typeof raw.commandHash!=='string'||!raw.commandHash||raw.source?.type==='oem'&&raw.kind!=='ledger-consume')||!traces.length||traces.some(trace=>!Number.isFinite(trace.kg)||trace.kg<=0)||Math.abs(traces.reduce((sum,trace)=>sum+trace.kg,0)+raw.reportedDeltaKg)>0.001||traces.some(trace=>!!trace.ledgerOnly!==(raw.kind==='ledger-consume'))||(orderPlan?.deltas.get(c.rawItemId)??0)!==0)return answer('conflict','원주문과 원료 이력의 수량 근거가 다릅니다.');}
   else if(!expected||normalizeRawMovement(raw).commandHash!==commandHash(expected)||raw.kind!==expected.kind||raw.effectiveAt!==expected.effectiveAt||codec.text(raw.source)!==codec.text(expected.source))return answer('conflict','원본 원료 이력과 최초 업무가 다릅니다.');
   if(r.business.kind==='oem-cancel'&&expected&&'kg'in expected){const reported=-Math.round(expected.kg*1000)/1000;if(raw.reportedDeltaKg!==reported||raw.appliedDeltaKg!==0&&raw.appliedDeltaKg!==reported)return answer('conflict','OEM 원료의 적용 수량이 원발주와 다릅니다.');}
   if(r.business.kind==='press-cancel'&&expected){const expectedApplied=c.originalOperationId===r.business.id?before.sourceAppliedKg:before.derivedAppliedKg,reported='kg'in expected?Math.round(expected.kg*1000)/1000*(expected.kind==='consume-lot'?-1:1):NaN;if(original.exists&&oldOriginal?.exists||raw.kind!==expected.kind||raw.effectiveAt!==expected.effectiveAt||codec.text(raw.source)!==codec.text(expected.source)||raw.reportedDeltaKg!==reported||raw.appliedDeltaKg!==expectedApplied||!Number.isFinite(expectedApplied)||expectedApplied!==0&&expectedApplied!==reported)return answer('conflict','압착 원료 적용 수량이 원작업과 다릅니다.');}
   rawReads.push({row,movement,oldMovement,original,oldOriginal,guard,state,item});
  }
  if(new Set(rawReads.map(row=>row.movement.ref.path)).size!==rawReads.length||new Set(rawReads.map(row=>row.guard.ref.path)).size!==rawReads.length)return answer('blocked','서로 다른 원료 작업 주소가 충돌합니다.');
  if(r.business.kind==='order-cancel'&&rawReads.some((row,index)=>index>0&&Number((rawReads[index-1]!.original.exists?rawReads[index-1]!.original.data():rawReads[index-1]!.oldOriginal?.data())?.sequence)<Number((row.original.exists?row.original.data():row.oldOriginal?.data())?.sequence)))return answer('blocked','주문 원료 취소 순서가 원래 적용 순서와 다릅니다.');
  const virtual=new Map<string,{state:RawInventoryState;itemData:Record<string,any>}>(),effects=new Map<string,{before:firestore.DocumentSnapshot;after:Record<string,any>}>(),results:unknown[]=[];
  for(const readSet of rawReads){const {row,movement,oldMovement,original,oldOriginal,guard,state,item}=readSet,c=row.command,readData={movementSnap:adapter(movement),oldMovementSnap:oldMovement?adapter(oldMovement):null,originalSnap:adapter(original),oldOriginalSnap:oldOriginal?adapter(oldOriginal):null,guardSnap:adapter(guard),stateSnap:adapter(state),itemSnap:adapter(item)},prepared=prepareRawCommand(c,readData,row.options,virtual.get(c.rawItemId));if(prepared.status!=='applied')return answer('blocked','원료 취소 계산을 확인해 주세요.');
   const plan=buildPreparedRawWritePlan(c,readData,prepared,row.options),itemPatch=plan.itemPatch(),nativeState=cleanNative(prepared.state),nativeItemPatch=itemPatch?{...itemPatch,lots:cleanNative([...prepared.state.activeLots,...prepared.state.recentDepletedLots])}:undefined;
   const itemData={...(virtual.get(c.rawItemId)?.itemData??item.data()??{}),...(nativeItemPatch??{})};virtual.set(c.rawItemId,{state:prepared.state,itemData});effects.set(state.ref.path,{before:state,after:{...state.data(),...nativeState}});if(nativeItemPatch)effects.set(item.ref.path,{before:item,after:itemData});effects.set(movement.ref.path,{before:movement,after:cleanNative(toLedgerDoc(prepared.movement,row.options.legacy))});if(!prepared.guard)return answer('blocked','원료 취소표를 확인할 수 없습니다.');effects.set(guard.ref.path,{before:guard,after:cleanNative(prepared.guard)});results.push({operationId:c.operationId,state:prepared.state,movement:prepared.movement});
  }
  if(effects.size>8)throw new HttpsError('resource-exhausted','한 번에 확인할 수 있는 원료 효과 수를 넘었습니다.');
  if(r.business.kind==='press-cancel'){const cancellation=after.cancellation,byId=new Map((results as any[]).map(v=>[v.operationId,v]));const sr=byId.get(cancellation.request.sourceReverse.operationId),dr=byId.get(cancellation.request.derivedReverse.operationId);if(!sr||cancellation.sourceAppliedKg!==sr.movement.appliedDeltaKg||cancellation.sourceAppliedKg!==-before.sourceAppliedKg||cancellation.derivedAppliedKg!==(dr?.movement.appliedDeltaKg??0)||cancellation.derivedAppliedKg!==-before.derivedAppliedKg)return answer('blocked','압착 취소 수량이 원료 계산과 다릅니다.');}
  const rawEffects=[...effects.entries()].map(([path,value],slot)=>{const [collection,id]=path.split('/');if(!collection||!id||!['items','rawInventories','rawMaterialLedger','rawInventoryReversalGuards'].includes(collection))throw new HttpsError('failed-precondition','원료 효과 주소를 확인해 주세요.');const current=value.before.data(),marker=current?.rawReversePermitRefV1;if(current&&Object.prototype.hasOwnProperty.call(current,'rawReversePermitRefV1')&&(!marker||typeof marker!=='object'||Array.isArray(marker)||Object.keys(marker).sort().join(',')!=='permitId,slot'||typeof marker.permitId!=='string'||!/^[a-f0-9]{64}$/.test(marker.permitId)||!Number.isInteger(marker.slot)||marker.slot<0||marker.slot>=8))throw new HttpsError('failed-precondition','기존 원료 허가 표식을 확인해 주세요.');return {collection,id,beforeExists:value.before.exists,before:current??null,after:{...advanceInventoryWriterProtocol(current,value.after),rawReversePermitRefV1:{permitId,slot}}};});
  const businessWitness={collection:businessPath.split('/')[0],id:businessPath.split('/')[1],beforeExists:true,before,afterExists:after!==null,after},resultsNativeText=codec.text(cleanNative(results)),effectsHash=sha(codec.text({rawEffects,businessWitness,resultsNativeText}));
  const saved={version:3,kind:r.kind,operationId:r.operationId,companyId:r.companyId,actorUid:r.actorUid,employeeId:r.employeeId,request:r,requestText,requestHash,state:'prepared',nonce:randomUUID(),rawEffects,businessWitness,resultsNativeText,effectsHash,createdAt:r.commands[0]!.options.now};
  if(Buffer.byteLength(codec.text(saved))>850_000)throw new HttpsError('resource-exhausted','원료 묶음 저장 한도를 넘었습니다.');tx.create(receiptRef,saved);return answer('prepared','원료 묶음을 준비했습니다. 기존 업무 거래에서 함께 적용해 주세요.',true);
 });
}
export function normalizeRawReverseRequest(value:unknown):RawReverseRequest {
 const text=rawManualCorrectionText(value);if(Buffer.byteLength(text)>300_000)fail('역처리 원문이 저장 한도를 넘었습니다.');
 const r=JSON.parse(text) as RawReverseRequest;if(!r||typeof r!=='object'||Array.isArray(r))fail('역처리 원문을 확인해 주세요.');
 keys(r,['version','kind','operationId','companyId','actorUid','employeeId','command','options']);
 const id=(v:unknown):v is string=>typeof v==='string'&&!!v&&v.trim()===v&&Buffer.byteLength(v)<=20000;
 if(r.version!==2||r.kind!=='raw-reverse'||!id(r.operationId)||!['taebaek','punghoe'].includes(r.companyId)||!validId(r.actorUid)||!validId(r.employeeId))fail('역처리 번호와 회사·직원을 확인해 주세요.');
 const c=r.command,o=r.options;if(!c||typeof c!=='object'||Array.isArray(c)||!o||typeof o!=='object'||Array.isArray(o))fail('역처리 명령을 확인해 주세요.');
 keys(c,['kind','operationId','originalOperationId','companyId','rawItemId','materialSnapshot','effectiveAt','source','actorId','actorName']);
 if(c.kind!=='reverse'||c.operationId!==r.operationId||c.companyId!==r.companyId||!id(c.originalOperationId)||!longDocId(c.rawItemId)||typeof c.materialSnapshot!=='string'||typeof c.effectiveAt!=='string'||!Number.isFinite(Date.parse(c.effectiveAt))||c.actorId!==undefined&&typeof c.actorId!=='string'||c.actorName!==undefined&&typeof c.actorName!=='string'||!c.source||typeof c.source!=='object'||Array.isArray(c.source))fail('역처리 원문이 올바르지 않습니다.');
 keys(c.source,['type','id']);if(typeof c.source.type!=='string'||!c.source.type||!id(c.source.id))fail('역처리 출처를 확인해 주세요.');
 const lotId=(v:unknown):v is string=>typeof v==='string'&&!!v&&v.trim()===v&&!v.includes('/')&&Buffer.byteLength(v)<=1500;
 keys(o,['now','newLotId','carryOverLotId','mirrorToItem','legacy']);if(!iso(o.now)||!lotId(o.newLotId)||!lotId(o.carryOverLotId)||o.mirrorToItem!==undefined&&typeof o.mirrorToItem!=='boolean')fail('역처리 최초 실행값을 확인해 주세요.');
 if(o.legacy!==undefined){if(!o.legacy||typeof o.legacy!=='object'||Array.isArray(o.legacy))fail('역처리 표시값을 확인해 주세요.');keys(o.legacy,['note','type','addedBy','orderId','canSize','canCount','canSizeTag','originalAmount','originalUnit']);for(const key of ['note','addedBy','orderId','canSizeTag'] as const)if(o.legacy[key]!==undefined&&typeof o.legacy[key]!=='string')fail('역처리 표시값을 확인해 주세요.');for(const key of ['canSize','canCount','originalAmount'] as const)if(o.legacy[key]!==undefined&&(typeof o.legacy[key]!=='number'||!Number.isFinite(o.legacy[key])))fail('역처리 표시값을 확인해 주세요.');if(o.legacy.type!==undefined&&!['auto','manual','correction','stocktake_unit'].includes(o.legacy.type)||o.legacy.originalUnit!==undefined&&!['kg','L'].includes(o.legacy.originalUnit))fail('역처리 표시값을 확인해 주세요.');}
 return r;
}
async function executeRawReverse(db:firestore.Firestore,actor:Actor|undefined,input:{action:'apply'|'inspect'|'cancel';request:unknown}):Promise<RawReverseResult>{
 const r=normalizeRawReverseRequest(input.request);authorize(actor,r as unknown as RawManualCorrectionRequest);
 const requestText=rawManualCorrectionText(r),requestHash=sha(requestText),ref=db.collection('rawManualCorrectionReceipts').doc(rawManualCorrectionReceiptId(r.companyId,r.operationId));
 const result=(status:RawReverseResult['status'],message:string,extra:Partial<RawReverseResult>={}):RawReverseResult=>({version:2,companyId:r.companyId,actorUid:r.actorUid,employeeId:r.employeeId,operationId:r.operationId,requestHash,requestText,status,message,...extra});
 return db.runTransaction(async tx=>{
  const [employee,receipt]=await Promise.all([tx.get(db.doc('employees/'+r.employeeId)),tx.get(ref)]);fullSnapshotNative(db,employee);fullSnapshotNative(db,receipt);
  try{assertFullEmployeeScope(employee.data(),{uid:r.actorUid,employeeId:r.employeeId,companyId:r.companyId});}catch{throw new HttpsError('permission-denied','현재 회사 직원 권한을 확인해 주세요.');}
  if(receipt.exists){const saved=receipt.data()!;if(saved.version!==2||saved.requestText!==requestText||saved.requestHash!==requestHash||saved.actorUid!==r.actorUid||saved.employeeId!==r.employeeId||saved.companyId!==r.companyId)return result('conflict','같은 처리 번호의 최초 원문이 다릅니다.');const {request:_request,createdAt:_at,resultHash,...body}=saved;if(!['applied','cancelled','rejected'].includes(saved.status)||rawManualCorrectionText(normalizeRawReverseRequest(saved.request))!==saved.requestText||typeof resultHash!=='string'||sha(rawManualCorrectionText(body))!==resultHash||saved.status==='applied'&&(saved.valueCodec!=='catalog-value-v1'||typeof saved.stateNativeText!=='string'||typeof saved.movementNativeText!=='string'))throw new HttpsError('failed-precondition','역처리 기록이 손상되었습니다.');if(saved.status==='applied'){fullCodec(db).decode(saved.stateNativeText);fullCodec(db).decode(saved.movementNativeText);}return {...body,resultHash} as RawReverseResult;}
  if(input.action==='inspect')return result('unknown','처리 기록을 찾지 못했습니다. 미처리로 확정하지 않았습니다.');
  const c=r.command,modern=operationDocId(c.operationId),legacy=legacyOperationDocId(c.operationId),originalId=operationDocId(c.originalOperationId),oldOriginalId=legacyOperationDocId(c.originalOperationId);
  const movementRef=db.doc('rawMaterialLedger/'+modern),oldMovementRef=db.doc('rawMaterialLedger/'+legacy),originalRef=db.doc('rawMaterialLedger/'+originalId),oldOriginalRef=db.doc('rawMaterialLedger/'+oldOriginalId),guardRef=db.doc('rawInventoryReversalGuards/'+originalId),stateRef=db.doc('rawInventories/'+inventoryDocId(c.companyId,c.rawItemId)),itemRef=db.doc('items/'+c.rawItemId);
  const [movement,oldMovement,original,oldOriginal,guard,state,item]=await Promise.all([tx.get(movementRef),legacy===modern?Promise.resolve(null):tx.get(oldMovementRef),tx.get(originalRef),oldOriginalId===originalId?Promise.resolve(null):tx.get(oldOriginalRef),tx.get(guardRef),tx.get(stateRef),tx.get(itemRef)]);
  for(const snap of [movement,oldMovement,original,oldOriginal,guard,state,item])if(snap)fullSnapshotNative(db,snap);
  if([movement,oldMovement,original,oldOriginal,guard,state,item].some(s=>s?.exists&&['fullEffectAuthority','orderManualCorrectionEffectAuthority'].some(k=>Object.prototype.hasOwnProperty.call(s.data()!,k))))return result('conflict','서버 전용 원료 효과를 기존 역처리로 취소할 수 없습니다.');
  if(movement.exists||oldMovement?.exists||guard.exists)return result('conflict','기존 역처리 원장 또는 취소표를 확인해 주세요.');
  const source=original.exists?original.data():oldOriginal?.data();
  if(!source||source.operationId!==c.originalOperationId||source.companyId!==c.companyId||source.rawItemId!==c.rawItemId||![originalId,oldOriginalId].includes(source.id)||['fullEffectAuthority','orderManualCorrectionEffectAuthority'].some(k=>Object.prototype.hasOwnProperty.call(source,k)))return result('conflict','원본 이력의 출처를 확인할 수 없습니다.');
  if(original.exists&&oldOriginal?.exists&&fullCodec(db).text(original.data())!==fullCodec(db).text(oldOriginal.data()))return result('conflict','두 원본 이력이 서로 다릅니다.');
  const origin=source.source,legacyOrder=!origin&&typeof source.orderId==='string'&&source.orderId?source.orderId:null;
  if(origin!==undefined&&origin!==null&&(typeof origin!=='object'||Array.isArray(origin)||typeof origin.type!=='string'||!origin.type||typeof origin.id!=='string'||!origin.id))return result('conflict','원본 이력의 출처를 확인할 수 없습니다.');
  if(c.source.type!=='reversal'||c.source.id!==c.originalOperationId)return result('conflict','역처리 출처와 원본 번호가 다릅니다.');
  if(origin?.type==='production'&&source.orderId&&source.orderId!==origin.id)return result('conflict','원본 주문 정보가 다릅니다.');
  if(origin?.type==='manual'){const press=await tx.get(db.doc('rawInventoryJobs/raw-press-'+operationDocId(origin.id)));fullSnapshotNative(db,press);if(press.exists)return result('conflict','압착 원료와 파생 입고는 원래 업무에서 함께 취소해 주세요.');}
  if(origin?.type==='oem'){if(!longDocId(origin.id))return result('conflict','OEM 원본 업무를 확인할 수 없습니다.');const [purchase,order]=await Promise.all([tx.get(db.doc('purchaseOrders/'+origin.id)),tx.get(db.doc('orders/'+origin.id))]);fullSnapshotNative(db,purchase);fullSnapshotNative(db,order);if(purchase.exists||!order.exists)return result('conflict','OEM 원본 업무의 원자 취소를 확인해 주세요.');}
  const orderId=origin?.type==='production'||origin?.type==='oem'?origin.id:legacyOrder;
  if(r.options.legacy?.orderId!==undefined&&r.options.legacy.orderId!==orderId)return result('conflict','원본 주문과 표시 주문이 다릅니다.');
  if(orderId){if(!longDocId(orderId))return result('conflict','원본 주문을 확인할 수 없습니다.');const order=await tx.get(db.doc('orders/'+orderId));fullSnapshotNative(db,order);if(!order.exists||(order.data()?.companyId??'taebaek')!==c.companyId||['orderProductionRefsV1','inventoryExecutionProtocol','orderManualCorrectionRefsV1'].some(k=>Object.prototype.hasOwnProperty.call(order.data()!,k)))return result('conflict','원본 주문의 처리 권한을 확인해 주세요.');}
  const save=(response:RawReverseResult)=>{const withHash={...response,resultHash:sha(rawManualCorrectionText(response))},receipt={...withHash,request:r,createdAt:r.options.now};if(Buffer.byteLength(JSON.stringify(receipt))>850_000)throw new HttpsError('resource-exhausted','처리 기록의 저장 한도를 넘었습니다.');tx.create(ref,receipt);return withHash;};
  if(input.action==='cancel')return save(result('cancelled','미처리 역처리 요청을 중단했습니다.'));
  const read={movementSnap:adapter(movement),oldMovementSnap:oldMovement?adapter(oldMovement):null,originalSnap:adapter(original),oldOriginalSnap:oldOriginal?adapter(oldOriginal):null,guardSnap:adapter(guard),stateSnap:adapter(state),itemSnap:adapter(item)};
  const prepared=prepareRawCommand(c,read,r.options);if(prepared.status==='rejected')return save(result('rejected',prepared.message,{code:prepared.code}));if(prepared.status!=='applied')return result('conflict','기존 역처리 이력을 확인해 주세요.');
  const plan=buildPreparedRawWritePlan(c,read,prepared,r.options),guardData=plan.guard(),itemPatch=plan.itemPatch();
  const nativeState=cleanNative(prepared.state),nativeMovement=cleanNative(toLedgerDoc(prepared.movement,r.options.legacy)),nativeGuard=cleanNative(prepared.guard),nativeItemPatch=itemPatch?{...itemPatch,lots:cleanNative([...prepared.state.activeLots,...prepared.state.recentDepletedLots])}:undefined;
  tx.set(stateRef,advanceInventoryWriterProtocol(state.data(),{...state.data(),...nativeState}));tx.create(movementRef,advanceInventoryWriterProtocol(undefined,nativeMovement));if(guardData)tx.create(guardRef,advanceInventoryWriterProtocol(undefined,nativeGuard));if(nativeItemPatch)tx.update(itemRef,advanceInventoryWriterProtocol(item.data(),nativeItemPatch));
  return save(result('applied','역처리 적용을 확인했습니다.',{valueCodec:'catalog-value-v1',stateNativeText:fullCodec(db).text(nativeState),movementNativeText:fullCodec(db).text(cleanNative(prepared.movement))}));
 });
}
/** 클라이언트 로그아웃은 이미 접수한 거래를 취소하지 않는다. receipt가 최종 결과를 보관한다. */
export async function executeRawManualCorrectionCommand(db:firestore.Firestore,actor:Actor|undefined,input:{action:'apply'|'inspect'|'cancel';request:RawManualCorrectionRequest}):Promise<RawManualCorrectionResult>;
export async function executeRawManualCorrectionCommand(db:firestore.Firestore,actor:Actor|undefined,input:{action:'apply'|'inspect'|'cancel';request:RawReverseRequest}):Promise<RawReverseResult>;
export async function executeRawManualCorrectionCommand(db:firestore.Firestore,actor:Actor|undefined,input:{action:'prepare'|'inspect'|'cancel';request:RawReverseGroupRequest}):Promise<RawReverseGroupResult>;
export async function executeRawManualCorrectionCommand(db:firestore.Firestore,actor:Actor|undefined,input:{action:'apply'|'prepare'|'inspect'|'cancel';request:RawManualCorrectionRequest|RawReverseRequest|RawReverseGroupRequest}):Promise<RawManualCorrectionResult|RawReverseResult|RawReverseGroupResult>{
 if(input?.request?.version===3){if(!['prepare','inspect','cancel'].includes(input.action))fail('묶음 처리 종류를 확인해 주세요.');keys(input,['action','request']);return executeRawReverseGroup(db,actor,input as {action:'prepare'|'inspect'|'cancel';request:RawReverseGroupRequest});}
 if(!input||!['apply','inspect','cancel'].includes(input.action))fail('정정 처리 종류를 확인해 주세요.');keys(input,['action','request']);
 if(input.request?.version===2)return executeRawReverse(db,actor,input as {action:'apply'|'inspect'|'cancel';request:RawReverseRequest});
 const r=normalizeRawManualCorrectionRequest(input.request);authorize(actor,r);
 const requestText=rawManualCorrectionText(r),requestHash=sha(requestText);
 const result=(status:RawManualCorrectionResult['status'],message:string,extra:Partial<RawManualCorrectionResult>={}):RawManualCorrectionResult=>({version:1,companyId:r.companyId,actorUid:r.actorUid,employeeId:r.employeeId,operationId:r.operationId,requestHash,requestText,status,message,...extra});
 const ref=db.collection('rawManualCorrectionReceipts').doc(rawManualCorrectionReceiptId(r.companyId,r.operationId));
 const existing=(snapshot:firestore.DocumentSnapshot):RawManualCorrectionResult|null=>{
  if(!snapshot.exists)return null;const saved=snapshot.data()!;
  if(saved.actorUid!==r.actorUid||saved.employeeId!==r.employeeId||saved.companyId!==r.companyId)return result('conflict','같은 정정 번호의 처리 주체가 다릅니다. 최초 원문을 보존해 주세요.');
  if(saved.version!==1)return result('conflict','같은 정정 번호의 최초 내용이 다릅니다. 기존 요청을 덮어쓰지 않았습니다.');
  if(saved.operationId!==r.operationId||!['applied','cancelled','rejected'].includes(saved.status)||typeof saved.requestText!=='string'||sha(saved.requestText)!==saved.requestHash||rawManualCorrectionText(normalizeRawManualCorrectionRequest(saved.request))!==saved.requestText)throw new HttpsError('failed-precondition','정정 처리 근거가 손상되었습니다. 최초 원문을 보존해 주세요.');
  if(saved.requestHash!==requestHash||saved.requestText!==requestText)return result('conflict','같은 정정 번호의 최초 내용이 다릅니다. 기존 요청을 덮어쓰지 않았습니다.');
  const {request:_request,createdAt:_at,...response}=saved;
  return response as RawManualCorrectionResult;
 };
 if(input.action==='inspect')return existing(await ref.get())??result('unknown','처리 기록을 찾지 못했습니다. 미처리로 확정하지 않았습니다. 같은 원문으로 재시도하거나 요청 중단을 확인해 주세요.');
 return db.runTransaction(async tx=>{
  const prior=existing(await tx.get(ref));if(prior)return prior;
  const save=(response:RawManualCorrectionResult)=>{const receipt={...response,request:r,createdAt:r.options.now};if(Buffer.byteLength(JSON.stringify(receipt))>850_000)throw new HttpsError('resource-exhausted','처리 기록의 저장 한도를 넘었습니다. 원문을 보존해 주세요.');tx.create(ref,receipt);return response;};
  const c=r.command,opId=operationDocId(c.operationId),oldId=legacyOperationDocId(c.operationId);
  const movementRef=db.collection('rawMaterialLedger').doc(opId);
  const [movement,oldMovement]=await Promise.all([tx.get(movementRef),oldId===opId?Promise.resolve(null):tx.get(db.collection('rawMaterialLedger').doc(oldId))]);
  if(movement.exists||oldMovement?.exists)return result('conflict','처리 영수증 없는 기존 원장이 있습니다. 새 정정으로 재적용하지 않았습니다.');
  // 원장이 이미 있으면 미처리 중단으로 확정할 수 없다. apply와 같은 읽기 집합으로 경쟁한다.
  if(input.action==='cancel')return save(result('cancelled','미처리 정정 요청을 중단했습니다. 늦게 도착한 같은 요청도 적용하지 않습니다.'));
  const stateRef=db.collection('rawInventories').doc(inventoryDocId(c.companyId,c.rawItemId)),itemRef=db.collection('items').doc(c.rawItemId);
  const [state,item]=await Promise.all([tx.get(stateRef),tx.get(itemRef)]);
  const prepared=prepareRawCommand(c,{movementSnap:adapter(movement),oldMovementSnap:oldMovement?adapter(oldMovement):null,stateSnap:adapter(state),itemSnap:adapter(item)},{...r.options,mirrorToItem:true});
  if(prepared.status==='rejected')return save(result('rejected',prepared.message,{code:prepared.code}));
  if(prepared.status!=='applied')return result('conflict','기존 원장과 최초 정정 명령을 확인해 주세요.');
  const response=result('applied','이 정정 요청의 적용을 확인했습니다.',{movement:clean(prepared.movement)});
  // 동일 거래에서 상태·원장·품목 mirror와 불변 receipt가 함께 성공한다.
  tx.set(stateRef,advanceInventoryWriterProtocol(state.data(),clean(prepared.state)));
  tx.set(movementRef,advanceInventoryWriterProtocol(movement.data(),clean(toLedgerDoc(prepared.movement,r.options.legacy))));
  tx.update(itemRef,advanceInventoryWriterProtocol(item.data(),{stock:prepared.state.stockKg,lots:clean([...prepared.state.activeLots,...prepared.state.recentDepletedLots])}));
  return save(response);
 });
}
export const rawManualCorrectionCommand=onCall({region:'asia-northeast3'},async request=>{
 const {getFirestore}=await import('firebase-admin/firestore');
 return executeRawManualCorrectionCommand(getFirestore(),request.auth as Actor|undefined,request.data);
});
