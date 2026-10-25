import {createHash} from 'node:crypto';
import {HttpsError,onCall} from 'firebase-functions/v2/https';
import type {firestore} from 'firebase-admin';
import {inventoryDocId,operationDocId,legacyOperationDocId,type RawInventoryCommand,type RawInventoryMovement} from './shared/rawInventoryCore';
import {prepareRawCommand,type RawReadSnapshot} from './shared/rawInventoryPrepare';
import {toLedgerDoc,type LegacyLedgerFields} from './shared/rawInventoryDocument';
import {advanceInventoryWriterProtocol} from './shared/inventoryWriterProtocol';

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
/** 클라이언트 로그아웃은 이미 접수한 거래를 취소하지 않는다. receipt가 최종 결과를 보관한다. */
export async function executeRawManualCorrectionCommand(db:firestore.Firestore,actor:Actor|undefined,input:{action:'apply'|'inspect'|'cancel';request:RawManualCorrectionRequest}):Promise<RawManualCorrectionResult>{
 if(!input||!['apply','inspect','cancel'].includes(input.action))fail('정정 처리 종류를 확인해 주세요.');keys(input,['action','request']);
 const r=normalizeRawManualCorrectionRequest(input.request);authorize(actor,r);
 const requestText=rawManualCorrectionText(r),requestHash=sha(requestText);
 const result=(status:RawManualCorrectionResult['status'],message:string,extra:Partial<RawManualCorrectionResult>={}):RawManualCorrectionResult=>({version:1,companyId:r.companyId,actorUid:r.actorUid,employeeId:r.employeeId,operationId:r.operationId,requestHash,requestText,status,message,...extra});
 const ref=db.collection('rawManualCorrectionReceipts').doc(rawManualCorrectionReceiptId(r.companyId,r.operationId));
 const existing=(snapshot:firestore.DocumentSnapshot):RawManualCorrectionResult|null=>{
  if(!snapshot.exists)return null;const saved=snapshot.data()!;
  if(saved.actorUid!==r.actorUid||saved.employeeId!==r.employeeId||saved.companyId!==r.companyId)return result('conflict','같은 정정 번호의 처리 주체가 다릅니다. 최초 원문을 보존해 주세요.');
  if(saved.version!==1||saved.operationId!==r.operationId||!['applied','cancelled','rejected'].includes(saved.status)||typeof saved.requestText!=='string'||sha(saved.requestText)!==saved.requestHash||rawManualCorrectionText(normalizeRawManualCorrectionRequest(saved.request))!==saved.requestText)throw new HttpsError('failed-precondition','정정 처리 근거가 손상되었습니다. 최초 원문을 보존해 주세요.');
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
