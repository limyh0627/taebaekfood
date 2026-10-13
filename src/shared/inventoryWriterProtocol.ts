export * from '../../functions/src/shared/inventoryWriterProtocol';
import {advanceInventoryWriterProtocol,preserveInventoryWriterProtocol} from '../../functions/src/shared/inventoryWriterProtocol';
import {runTransaction,getDocFromServer,doc,type Firestore,type Transaction,type DocumentSnapshot,type DocumentReference} from 'firebase/firestore';
import type {User} from 'firebase/auth';
import {companyOf} from './types';

const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
export const inventoryWriterSame=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export const ITEM_INVENTORY_FIELDS=['stock','lots','inventoryReservations','stocktakeAnchors','allocated','inventoryAllocations'] as const;
/** 초기 snapshot을 넘긴다. 같은 거래의 virtual 명령들이 문서 revision을 각각 올리지 않는다. */
export function protectInventoryWriterPatch(before:Record<string,any>|undefined,next:Record<string,any>,keys?:readonly string[]):Record<string,any>{
 const fields=keys??Object.keys(next).filter(key=>key!=='inventoryWriterProtocolVersion'&&key!=='inventoryWriteRevision');
 const changed=!before||!keys||fields.some(key=>key in next&&!inventoryWriterSame(key.split('.').reduce((value,part)=>value?.[part],before),next[key]));
 return changed?advanceInventoryWriterProtocol(before,next):preserveInventoryWriterProtocol(before,next);
}
export const protectItemInventoryPatch=(before:Record<string,any>|undefined,next:Record<string,any>)=>protectInventoryWriterPatch(before,next,ITEM_INVENTORY_FIELDS);

export interface InventoryWriterContext {
 readonly companyId:string;
 readonly actorUid:string;
 readonly requestIdentity:string;
 readonly isStillCurrent:()=>boolean|Promise<boolean>;
}
type CaptureOptions={requestIdentity:string;companyId?:string;isStillCurrent?:()=>boolean|Promise<boolean>;getCurrentUser?:()=>User|null|undefined;ready?:Promise<unknown>};
/** 기존 Auth만 읽는다. 신원을 얻지 못하면 새 로그인 가드를 만들지 않고 추가 재시도만 끈다. */
export async function captureInventoryWriterContext(database:Firestore,options:CaptureOptions):Promise<InventoryWriterContext|undefined>{
 try{
  if(!database?.app)return undefined;
  await options.ready;
  let getUser=options.getCurrentUser;
  if(!getUser){if(!database?.app)return undefined;const {getAuth}=await import('firebase/auth');const auth=getAuth(database.app);getUser=()=>auth.currentUser;}
  const user=getUser();if(!user||typeof user.uid!=='string'||!user.uid.trim())return undefined;
  const token=await user.getIdTokenResult(),companyId=options.companyId??token.claims.companyId;
  if(!['taebaek','punghoe'].includes(String(companyId))||token.claims.companyId!==companyId||getUser()?.uid!==user.uid||!options.requestIdentity)return undefined;
  const currentUser=getUser,actorUid=user.uid;
  return {companyId:String(companyId),actorUid,requestIdentity:options.requestIdentity,isStillCurrent:async()=>{
   try{const actor=currentUser();if(!actor||actor.uid!==actorUid)return false;const current=await actor.getIdTokenResult();
    return currentUser()?.uid===actorUid&&current.claims.companyId===companyId&&(!options.isStillCurrent||await options.isStillCurrent());
   }catch{return false;}
  }};
 }catch{return undefined;}
}
type Seen={snapshot:DocumentSnapshot;ref:DocumentReference};
type Written={ref:DocumentReference;kind:'set'|'update'|'delete';data?:Record<string,any>};
export type InventoryWriterObserver=(snapshot:DocumentSnapshot)=>void;
const originalRevision=(data:Record<string,any>|undefined):number|null=>{
 if(!data)return 0;
 if(data.inventoryWriterProtocolVersion!==undefined&&data.inventoryWriterProtocolVersion!==1)return null;
 if(data.inventoryWriterProtocolVersion===1&&data.inventoryWriteRevision===undefined)return null;
 const value=data.inventoryWriteRevision===undefined?0:data.inventoryWriteRevision;
 return Number.isSafeInteger(value)&&value>=0&&value<Number.MAX_SAFE_INTEGER?value:null;
};
const owner=(data:Record<string,any>|undefined)=>companyOf(data);
const permissionDenied=(error:unknown)=>!!error&&typeof error==='object'&&(error as {code?:unknown}).code==='permission-denied';

/** Rules가 precondition보다 먼저 거절한 정상 경합만 새 거래로 읽는다. 권한 오류나 응답 유실을 미반영으로 바꾸지 않는다. */
export async function runInventoryWriterTransaction<T>(database:Firestore,context:InventoryWriterContext|undefined,
 callback:(transaction:Transaction,observe:InventoryWriterObserver)=>Promise<T>):Promise<T>{
 if(!context)return runTransaction(database,transaction=>callback(transaction,()=>{}));
 const identity=context?{companyId:context.companyId,actorUid:context.actorUid,requestIdentity:context.requestIdentity}:undefined;
 const current=async()=>{
  if(!context||!identity||!identity.actorUid||!identity.requestIdentity||!['taebaek','punghoe'].includes(identity.companyId))return false;
  try{return context.companyId===identity.companyId&&context.actorUid===identity.actorUid&&context.requestIdentity===identity.requestIdentity&&await context.isStillCurrent();}catch{return false;}
 };
 let additional=0;
 let retryError:unknown;
 for(;;){
  let seen=new Map<string,Seen>(),written=new Map<string,Written>();
  try{return await runTransaction(database,async native=>{
   // SDK가 자체 재시도할 때도 앞 시도의 snapshot·쓰기 목록을 섞지 않는다.
   seen=new Map();written=new Map();const observe:InventoryWriterObserver=snapshot=>{seen.set(snapshot.ref.path,{snapshot,ref:snapshot.ref});};
   if(additional>0&&!await current())throw retryError;
   let proxy:Transaction;
   proxy=new Proxy(native,{get(target,key){
    if(key==='get')return async(ref:DocumentReference)=>{const snapshot=await target.get(ref);observe(snapshot);return snapshot;};
    if(key==='set'||key==='update'||key==='delete')return (...args:any[])=>{
     const ref=args[0] as DocumentReference;written.set(ref.path,{ref,kind:key,data:key==='delete'?undefined:args[1]});
     (target[key] as (...values:any[])=>unknown).apply(target,args);return proxy;
    };
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
   }}) as Transaction;
   return callback(proxy,observe);
  });}catch(error){
   if(!permissionDenied(error)||additional>=2||!await current())throw error;
   let changed=false,valid=true,eligible=0;
   try{
    for(const [path,write] of written){
     const observed=seen.get(path);
     if(!observed){if(write.kind==='delete'||write.data?.inventoryWriterProtocolVersion===1){valid=false;break;}continue;}
     const before=observed.snapshot.exists()?observed.snapshot.data():undefined,revision=originalRevision(before);
     const proposal=write.data;
     if(write.kind!=='delete'&&!(proposal?.inventoryWriterProtocolVersion===1&&Number.isSafeInteger(proposal.inventoryWriteRevision)))continue;
     eligible++;
     if(write.kind==='delete'&&!before){valid=false;break;}
     if(revision===null||before&&owner(before)!==identity!.companyId||proposal?.companyId!==undefined&&proposal.companyId!==identity!.companyId){valid=false;break;}
     let floor=revision;
     const parts=path.split('/');
     if(!before&&parts[0]==='items'){
      const tomb=seen.get('inventoryWriterDeletions/'+identity!.companyId+'__'+parts[1])?.snapshot.data();
      if(tomb){if(tomb.companyId!==identity!.companyId||tomb.itemId!==parts[1]||tomb.inventoryWriterProtocolVersion!==1||!Number.isSafeInteger(tomb.lastDeletedItemRevision)||tomb.lastDeletedItemRevision<0||tomb.beforeRevision!==tomb.lastDeletedItemRevision){valid=false;break;}floor=tomb.lastDeletedItemRevision;}
     }
     if(write.kind!=='delete'&&before&&proposal!.inventoryWriteRevision===revision){
      const keys=parts[0]==='items'?ITEM_INVENTORY_FIELDS:parts[0]==='orders'?['status','items','inventoryOperation','inventoryGenerationCompletion','productionRecordIndex','producedAt','shippedOut','productConsumedLots','rawConsumedLots','itemInventory','inventorySnapshots','rawInventoryAttempt','deliveredAt']:null;
      if(keys&&Object.keys(proposal!).every(key=>!keys.some(field=>key===field||key.startsWith(field+'.'))||inventoryWriterSame(key.split('.').reduce((value,part)=>value?.[part],before),proposal![key]))){eligible--;continue;}
     }
     if(write.kind!=='delete'&&proposal!.inventoryWriteRevision!==floor+1){valid=false;break;}
     const fresh=await getDocFromServer(write.ref),after=fresh.exists()?fresh.data():undefined;
     if(after){
      if(owner(after)!==identity!.companyId||originalRevision(after)===null){valid=false;break;}
      if(inventoryWriterSame(before,after))continue;
      if(after.inventoryWriterProtocolVersion!==1||after.inventoryWriteRevision!==floor+1){valid=false;break;}
      changed=true;continue;
     }
     if(!before)continue;
     if(parts[0]==='items'){
      const tombRef=doc(database,'inventoryWriterDeletions',identity!.companyId+'__'+parts[1]),tomb=(await getDocFromServer(tombRef)).data();
      const prior=seen.get(tombRef.path)?.snapshot.data()?.deletionRevision??0;
      if(!tomb||tomb.companyId!==identity!.companyId||tomb.itemId!==parts[1]||tomb.inventoryWriterProtocolVersion!==1||tomb.beforeRevision!==revision||tomb.lastDeletedItemRevision!==revision||tomb.deletionRevision!==prior+1){valid=false;break;}
     }else if(parts[0]==='orders'&&write.kind==='delete'){
      const operationId=before.inventoryOperation?.id;if(typeof operationId!=='string'||!operationId){valid=false;break;}
      const auditRef=doc(database,'orderStatusAudits',operationId),audit=(await getDocFromServer(auditRef)).data();
      if(seen.get(auditRef.path)?.snapshot.exists()||!audit||audit.companyId!==identity!.companyId||audit.orderId!==parts[1]||audit.id!==operationId||audit.state!=='completed'||audit.cancellation?.action!=='delete'||audit.cancellation?.deleted!==true||audit.beforeOrderWriteRevision!==revision||audit.inventoryWriterProtocolVersion!==1||audit.inventoryWriteRevision!==1){valid=false;break;}
     }else{valid=false;break;}
     changed=true;
    }
   }catch{valid=false;}
   if(!valid||!changed||!eligible||!await current())throw error;
   retryError=error;additional++;
  }
 }
}
