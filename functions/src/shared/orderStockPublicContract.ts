export interface PublicOrderStockReference {version:1;companyId:'taebaek'|'punghoe';orderId:string;requestId:string}
export interface PublicOrderStockRecoveryRequest {version:1;mode:'inspect'|'cancel';reference:PublicOrderStockReference;originalOwnerUid:string}
export type PublicOrderStockRecoveryState='reserved'|'applied'|'cancelled'|'needs-review'|'not-found-unconfirmed';
export type PublicOrderStockRecoveryReason='none'|'current-state-changed'|'source-unproven'|'permission-denied'|'request-unconfirmed';
export interface PublicOrderStockRecoveryResult {version:1;reference:PublicOrderStockReference;originalOwnerUid:string;state:PublicOrderStockRecoveryState;canCancel:boolean;reason:PublicOrderStockRecoveryReason;duplicate:boolean}

const invalid=():never=>{throw new Error('주문 재고 복구 요청 또는 응답 형식이 올바르지 않습니다.');};
const bytes=(value:string):number=>new TextEncoder().encode(value).length;
function object(value:unknown,keys:readonly string[]):Record<string,unknown> {
 if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype) return invalid();
 const own=Reflect.ownKeys(value);if(own.length!==keys.length||own.some(key=>typeof key!=='string'||!keys.includes(key)))return invalid();
 const row:Record<string,unknown>={};
 for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!descriptor.enumerable||!('value'in descriptor)||descriptor.value===undefined)return invalid();row[key]=descriptor.value;}
 return row;
}
function identifier(value:unknown):string {
 if(typeof value!=='string'||!value||/\s|[\/\u0000-\u001f\u007f-\u009f]/u.test(value)||value==='.'||value==='..'||bytes(value)>1500)return invalid();return value;
}
function owner(value:unknown):string {
 if(typeof value!=='string'||!value||value.trim()!==value||value.length>512||/[\u0000-\u001f\u007f-\u009f]/u.test(value))return invalid();return value;
}
function reference(value:unknown):PublicOrderStockReference {
 const row=object(value,['version','companyId','orderId','requestId']);
 if(row.version!==1||(row.companyId!=='taebaek'&&row.companyId!=='punghoe'))return invalid();
 return {version:1,companyId:row.companyId,orderId:identifier(row.orderId),requestId:identifier(row.requestId)};
}
function budget(value:unknown):void {if(bytes(JSON.stringify(value))>32768)invalid();}
export function normalizePublicOrderStockRecoveryRequest(value:unknown):PublicOrderStockRecoveryRequest {
 const row=object(value,['version','mode','reference','originalOwnerUid']);if(row.version!==1||(row.mode!=='inspect'&&row.mode!=='cancel'))return invalid();
 const result:PublicOrderStockRecoveryRequest={version:1,mode:row.mode,reference:reference(row.reference),originalOwnerUid:owner(row.originalOwnerUid)};budget(result);return result;
}
export function normalizePublicOrderStockRecoveryResult(value:unknown,expected:{reference:PublicOrderStockReference;originalOwnerUid:string}):PublicOrderStockRecoveryResult {
 const expectedRow=object(expected,['reference','originalOwnerUid']),expectedReference=reference(expectedRow.reference),expectedOwner=owner(expectedRow.originalOwnerUid);
 const row=object(value,['version','reference','originalOwnerUid','state','canCancel','reason','duplicate']);
 const ref=reference(row.reference),uid=owner(row.originalOwnerUid);
 if(row.version!==1||ref.companyId!==expectedReference.companyId||ref.orderId!==expectedReference.orderId||ref.requestId!==expectedReference.requestId||uid!==expectedOwner)return invalid();
 if(row.state!=='reserved'&&row.state!=='applied'&&row.state!=='cancelled'&&row.state!=='needs-review'&&row.state!=='not-found-unconfirmed')return invalid();
 if(row.reason!=='none'&&row.reason!=='current-state-changed'&&row.reason!=='source-unproven'&&row.reason!=='permission-denied'&&row.reason!=='request-unconfirmed')return invalid();
 if(typeof row.canCancel!=='boolean'||typeof row.duplicate!=='boolean'||row.canCancel&&(row.state!=='reserved'||row.reason!=='none')||((row.state==='applied'||row.state==='cancelled')&&(row.reason!=='none'||row.canCancel)))return invalid();
 const result:PublicOrderStockRecoveryResult={version:1,reference:ref,originalOwnerUid:uid,state:row.state,canCancel:row.canCancel,reason:row.reason,duplicate:row.duplicate};budget(result);return result;
}
