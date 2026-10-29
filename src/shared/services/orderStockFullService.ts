import {httpsCallable} from 'firebase/functions';
import {auth,authReady,functions} from '../firebase';
import {sessionActorKey,sessionIdentityLifetime} from '../sessionIdentityLifetime';
import {CheckpointInactive,readOwnedCheckpoint,writeOwnedCheckpoint,clearOwnedCheckpoint,type OwnedCheckpoint} from '../sessionOwnedCheckpointStore';
import {normalizePublicOrderStockRecoveryRequest,normalizePublicOrderStockRecoveryResult,type PublicOrderStockReference,type PublicOrderStockRecoveryRequest,type PublicOrderStockRecoveryResult} from '../../../functions/src/shared/orderStockPublicContract';
export type {PublicOrderStockReference,PublicOrderStockRecoveryResult} from '../../../functions/src/shared/orderStockPublicContract';
export type FullRecoveryLocator=Pick<PublicOrderStockRecoveryRequest,'reference'|'originalOwnerUid'>;
export type FullRecoveryScope={companyId:PublicOrderStockReference['companyId'];actorUid:string;employeeId:string;isAdmin:boolean};
export type FullRecoveryCurrent=()=>boolean;
export type FullRecoveryOutcome={kind:'confirmed';result:PublicOrderStockRecoveryResult;copyCleanup:'cleared'|'retained'|'not-required';notice?:string}|{kind:'local-error';code:'storage'|'transport'|'invalid-response';message:string}|{kind:'invalidated'}|{kind:'busy'};
export type FullRecoveryCopies={kind:'ready';copies:FullRecoveryLocator[]}|{kind:'local-error';message:string};
const feature='order-stock-full-recovery-v1';
const storageMessage='기기에 요청 번호를 보관하지 못했습니다. 원문은 지우지 않았습니다. 저장 공간/브라우저 보관 권한을 확인한 뒤 다시 조회해 주세요.';
const flights=new Map<string,object>();
const ownerOf=(scope:FullRecoveryScope)=>({uid:scope.actorUid,companyId:scope.companyId,employeeId:scope.employeeId});
function locatorOf(value:FullRecoveryLocator):FullRecoveryLocator{if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==2)throw Error('locator');for(const key of ['reference','originalOwnerUid']){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!d.enumerable||!('value'in d))throw Error('locator');}const request=normalizePublicOrderStockRecoveryRequest({version:1,mode:'inspect',reference:value.reference,originalOwnerUid:value.originalOwnerUid});return{reference:request.reference,originalOwnerUid:request.originalOwnerUid};}
export function fullRecoveryLocatorKey(value:FullRecoveryLocator):string{const {reference:r,originalOwnerUid}=locatorOf(value);return JSON.stringify([r.version,r.companyId,r.orderId,r.requestId,originalOwnerUid]);}
function validCopies(value:unknown):value is FullRecoveryLocator[]{try{if(!Array.isArray(value))return false;const keys=new Set<string>();for(const item of value){if(!item||typeof item!=='object'||Object.getPrototypeOf(item)!==Object.prototype||Reflect.ownKeys(item).length!==2||!Object.prototype.hasOwnProperty.call(item,'reference')||!Object.prototype.hasOwnProperty.call(item,'originalOwnerUid'))return false;for(const key of ['reference','originalOwnerUid']){const d=Object.getOwnPropertyDescriptor(item,key);if(!d||!d.enumerable||!('value'in d))return false;}const key=fullRecoveryLocatorKey(item);if(keys.has(key))return false;keys.add(key);}return true;}catch{return false;}}
function read(scope:FullRecoveryScope):OwnedCheckpoint<FullRecoveryLocator[]>|null{const saved=readOwnedCheckpoint(ownerOf(scope),feature,validCopies);if(saved?.envelope.payload.some(item=>item.reference.companyId!==scope.companyId))throw Error('company');return saved;}
export function readFullRecoveryCopies(scope:FullRecoveryScope):FullRecoveryCopies{try{return{kind:'ready',copies:read(scope)?.envelope.payload??[]};}catch{return{kind:'local-error',message:storageMessage};}}
export function inspectFullRecovery(scope:FullRecoveryScope,locator:FullRecoveryLocator,current:FullRecoveryCurrent):Promise<FullRecoveryOutcome>{return execute(scope,locator,current,'inspect');}
export function cancelFullRecovery(scope:FullRecoveryScope,locator:FullRecoveryLocator,current:FullRecoveryCurrent):Promise<FullRecoveryOutcome>{return execute(scope,locator,current,'cancel');}
async function execute(inputScope:FullRecoveryScope,inputLocator:FullRecoveryLocator,current:FullRecoveryCurrent,mode:'inspect'|'cancel'):Promise<FullRecoveryOutcome>{
 const scope={...inputScope};let locator:FullRecoveryLocator,key:string;
 try{locator=locatorOf(inputLocator);if(locator.reference.companyId!==scope.companyId)throw Error();key=JSON.stringify([scope.actorUid,scope.companyId,scope.employeeId,scope.isAdmin,fullRecoveryLocatorKey(locator)]);}catch{return{kind:'local-error',code:'storage',message:storageMessage};}
 if(flights.has(key))return{kind:'busy'};const run={};flights.set(key,run);
 try{
  await authReady;if(!current()||auth.currentUser?.uid!==scope.actorUid)return{kind:'invalidated'};
  const ticket=sessionIdentityLifetime.capture(sessionActorKey({uid:scope.actorUid,...scope}));if(!ticket)return{kind:'local-error',code:'storage',message:'현재 로그인을 확인한 뒤 다시 조회해 주세요.'};
  const active=()=>flights.get(key)===run&&current()&&auth.currentUser?.uid===scope.actorUid&&sessionIdentityLifetime.isCurrent(ticket);
  const ready=async()=>{if(!current()||auth.currentUser?.uid!==scope.actorUid)return false;return await sessionIdentityLifetime.waitUntilReady(ticket)&&active();};
  // lock 대기 중 같은 로그인 확인만 보류된 경우 동일 CAS를 한 번 재시도한다.
  const local=async<T>(operation:()=>Promise<T>):Promise<T>=>{try{return await operation();}catch(error){if(!(error instanceof CheckpointInactive)||!await ready())throw error;return await operation();}};
  if(!await ready())return{kind:'invalidated'};
  let saved:OwnedCheckpoint<FullRecoveryLocator[]>;
  try{const previous=read(scope);const copies=previous?.envelope.payload??[];if(copies.some(item=>fullRecoveryLocatorKey(item)===fullRecoveryLocatorKey(locator)))saved=previous!;else saved=await local(()=>writeOwnedCheckpoint(ownerOf(scope),feature,previous?.bytes??null,[...copies,locator],validCopies,active));}
  catch(error){if(!current()||auth.currentUser?.uid!==scope.actorUid)return{kind:'invalidated'};if(!await ready())return{kind:'invalidated'};return{kind:'local-error',code:'storage',message:storageMessage};}
  if(!await ready())return{kind:'invalidated'};
  let data:unknown;
  try{if(!active())return{kind:'invalidated'};const call=httpsCallable(functions,'orderStockFullRecoveryCommand');data=(await call({version:1,mode,reference:locator.reference,originalOwnerUid:locator.originalOwnerUid})).data;}
  catch{if(!await ready())return{kind:'invalidated'};return{kind:'local-error',code:'transport',message:'응답을 확인하지 못했습니다. 보관한 같은 요청을 다시 조회해 주세요.'};}
  if(!await ready())return{kind:'invalidated'};
  let result:PublicOrderStockRecoveryResult;try{result=normalizePublicOrderStockRecoveryResult(data,locator);}catch{return{kind:'local-error',code:'invalid-response',message:'요청과 일치하는 응답을 확인하지 못했습니다. 같은 요청을 다시 조회해 주세요.'};}
  if(result.state!=='applied'&&result.state!=='cancelled')return{kind:'confirmed',result,copyCleanup:'not-required'};
  try{const remaining=saved.envelope.payload.filter(item=>fullRecoveryLocatorKey(item)!==fullRecoveryLocatorKey(locator));await local(()=>remaining.length?writeOwnedCheckpoint(ownerOf(scope),feature,saved.bytes,remaining,validCopies,active).then(()=>undefined):clearOwnedCheckpoint(ownerOf(scope),feature,saved.bytes,active));if(!await ready())return{kind:'invalidated'};return{kind:'confirmed',result,copyCleanup:'cleared'};}
  catch{if(!await ready())return{kind:'invalidated'};return{kind:'confirmed',result,copyCleanup:'retained',notice:'처리 결과는 확인했지만 기기 사본을 정리하지 못했습니다. 같은 요청 번호를 보존했습니다.'};}
 }finally{if(flights.get(key)===run)flights.delete(key);}
}
