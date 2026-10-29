import type {DocumentSnapshot,Firestore,Transaction} from 'firebase-admin/firestore';
import type {ReservationPreviewActor} from './orderStockExecutionPlan';
import {productionRecordValidId} from './productionRecordCommand';
import {readFullEffectAuthority,assertProductionRecordBusinessMatches} from './orderStockFullAuthority';
import {assertFullActorScope,assertFullEmployeeScope,FULL_ATTEMPTS,fullAttemptId,fullCodec,fullId,fullObject,fullPath,fullSnapshotNative,validateStoredFullAttempt} from './orderStockFullPlan';

export class ProductionRecordSourceRejected extends Error {
 constructor(readonly reason:'actor-scope'|'company'|'unproven-source'|'target-id'){super(reason);}
}
function rejectSource(reason:ProductionRecordSourceRejected['reason']='unproven-source'):never{throw new ProductionRecordSourceRejected(reason);}
export type ProductionRecordFullSource = {kind:'absent'} | {kind:'unmarked';snapshot:DocumentSnapshot} | {kind:'verified-source';snapshot:DocumentSnapshot;sourceAttemptId:string};
/** 현재 문서와 실제 생산 출처를 같은 거래에서 읽는다. 현재 실적 여부는 판정하지 않는다. */
export async function readProductionRecordFullSource(tx:Pick<Transaction,'get'>,db:Firestore,input:{companyId:'taebaek'|'punghoe';targetId:string;actor:ReservationPreviewActor|null|undefined}):Promise<ProductionRecordFullSource>{
 if(!productionRecordValidId(input.targetId))rejectSource('target-id');
 const snapshot=await tx.get(db.collection('productionRecords').doc(input.targetId));
 if(!snapshot.exists)return {kind:'absent'};
 const current=snapshot.data()!;
 if(current.companyId!==input.companyId)rejectSource('company');
 const marker=readFullEffectAuthority(current);
 if(marker.kind==='absent')return {kind:'unmarked',snapshot};
 if(marker.kind!=='valid-v1')rejectSource();
 try{assertFullActorScope(input.actor,input.companyId);}catch{rejectSource('actor-scope');}
 const actor=input.actor!;
 const employee=await tx.get(db.collection('employees').doc(actor.token.employeeId));
 try{assertFullEmployeeScope(employee.data(),{uid:actor.uid,employeeId:actor.token.employeeId,companyId:input.companyId});}catch{rejectSource('actor-scope');}
 const authority=marker.value,path=FULL_ATTEMPTS+'/'+authority.attemptId;
 try{fullPath(path);}catch{rejectSource();}
 if(authority.companyId!==input.companyId||!fullId(authority.orderId))rejectSource();
 const source=await tx.get(db.collection(FULL_ATTEMPTS).doc(authority.attemptId));
 if(!source.exists)rejectSource();
 try{fullSnapshotNative(db,snapshot);fullSnapshotNative(db,employee);fullSnapshotNative(db,source);}catch{rejectSource();}
 const saved=source.data()!,reference=saved.reference,owner=saved.owner;
 if(!fullObject(reference)||reference.version!==1||reference.companyId!==input.companyId||reference.orderId!==authority.orderId||!fullId(reference.requestId)||!fullObject(owner)||owner.companyId!==input.companyId||owner.uid!==authority.ownerUid||!fullId(owner.employeeId)||fullAttemptId(reference as Parameters<typeof validateStoredFullAttempt>[2],owner.uid)!==authority.attemptId||saved.state!=='applied')rejectSource();
 let plan:ReturnType<typeof validateStoredFullAttempt>;
 try{plan=validateStoredFullAttempt(db,saved,reference as Parameters<typeof validateStoredFullAttempt>[2],owner);}catch{rejectSource();}
 if(!plan||plan.authorityVersion!==1)rejectSource();
 try{
  const effects=plan.effectSet.filter(row=>row.path==='productionRecords/'+input.targetId);
  if(effects.length!==1||effects[0].operation!=='create')rejectSource();
  const {text,decode}=fullCodec(db),original=decode(effects[0].nativeText),originalMarker=readFullEffectAuthority(original);
  if(originalMarker.kind!=='valid-v1'||text(originalMarker.value)!==text(authority))rejectSource();
  assertProductionRecordBusinessMatches(original,current,{text});
 }catch{rejectSource();}
 return {kind:'verified-source',snapshot,sourceAttemptId:authority.attemptId};
}
