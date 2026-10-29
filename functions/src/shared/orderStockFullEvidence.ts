import {HttpsError} from 'firebase-functions/v2/https';
import {assertRetirementStaticProof,exactClaimCompletion,readRetirementHandoff,retirementText,retirementHash} from './orderRetirementHandoff';
import {selectOrderRawBatchOrderEvidence} from './orderRawBatchOrderEvidence';
import {assertProductionRecordBusinessMatches} from './orderStockFullAuthority';
import type {Firestore,Transaction,Timestamp} from 'firebase-admin/firestore';
import type {FullRow,FullEvidence,FullNativeEvidence,FullHistoryQuery,FullAggregateSourceQuery,OrderStockFullPlan} from './orderStockFullPlan';
import {ensureOrderLineIds,type OrderItemInventoryState} from './orderLineInventory';
import {rawReverseReportedDelta,rawReverseLotDeltas,rawAppliedDelta,commandHash,inventoryDocId,operationDocId,legacyOperationDocId} from './rawInventoryCore';
import {orderRawBatchJobId,type OrderRawBatchRequest} from './orderRawBatchIdentity';
import {readOrderRawBatchJobRequest,orderRawBatchProofProblem,orderRawBatchRequestHash} from './orderRawBatchProof';
import {hasOrderInventoryGenerationCompletion,sameOrderInventoryGeneration} from './orderInventoryCompletionEvidence';
export {ownLineIndexEntry} from './orderProductionRecordPlan';
import {ownLineIndexEntry,deriveNextProductionRecordIndex,validateOrderProductionRecordPlan,validateProductionRecordIndex} from './orderProductionRecordPlan';
import {orderRawTracesFromMovement} from './orderRawCommandPlan';
import {normalizeRawMovement} from './rawInventoryDocument';
import {advanceInventoryWriterProtocol} from './inventoryWriterProtocol';

declare const retirementReadBrand:unique symbol;
export type FullRetirementReadAccess={readonly [retirementReadBrand]:true};
const retirementReads=new WeakMap<object,{companyId:string;orderId:string;orderText:string;text:(value:unknown)=>string}>();
/** JSON/boolean으로 만들 수 없고 같은 reader가 검증한 원주문 전체와만 맞는다. */
export function assertFullRetirementReadAccess(access:FullRetirementReadAccess|undefined,order:FullRow,identity:{companyId:string;orderId:string}):void {const proof=access&&retirementReads.get(access);if(!proof||proof.companyId!==identity.companyId||proof.orderId!==identity.orderId||proof.text(order)!==proof.orderText)throw Error('retirement-history-unproven');}
export interface FullHistoricalEvidenceInput {
 tx:Pick<Transaction,'get'>;db:Firestore;companyId:'taebaek'|'punghoe';orderId:string;selfAttemptPath:string;actorUid:string;retirementRequest?:unknown;
 codec:{text:(value:unknown)=>string;decode:(value:string)=>any};hash:(value:string)=>string;
 reject:(reason:string,status?:'blocked'|'conflict')=>never;usable:(row:FullRow|undefined,company:string,id:string)=>void;
 materializeTerminal:typeof import('./orderStockFullPlan').materializeOrderStockFullTerminal;
 infrastructure:{storedAttempt:(saved:FullRow,reference:FullRow,owner:FullRow)=>OrderStockFullPlan|undefined;protocol:string;attempts:string;object:(value:unknown)=>value is FullRow;id:(value:unknown)=>value is string;path:(path:string)=>void;snapshotNative:(db:Firestore,snapshot:any)=>void;nativeReads:(plan:OrderStockFullPlan)=>FullNativeEvidence[];validateReadEvidence:(plan:OrderStockFullPlan,selfPath:string)=>void;aggregateQuery:(capturedAt:string)=>any;aggregateCandidates:(snapshot:any)=>any[];generationOperationId:(reference:FullRow,uid:string)=>string;attemptId:(reference:any,uid:string)=>string;isRejected:(error:unknown)=>boolean};
}
/** DB 원문은 이 거래 안에서만 읽는다. 읽기 캐시는 다음 거래의 CAS를 대신하지 않는다. */
export function createFullHistoricalEvidenceContext(input:FullHistoricalEvidenceInput){
 const {db,companyId:company,orderId,selfAttemptPath,codec,hash:fullHash,usable:fullUsable,materializeTerminal:materializeOrderStockFullTerminal}=input;
 const {protocol:FULL_PROTOCOL,attempts:FULL_ATTEMPTS,object:fullObject,id:fullId,path:fullPath,snapshotNative:fullSnapshotNative,nativeReads:fullNativeReads,validateReadEvidence:validateFullReadEvidence,attemptId:fullAttemptId,isRejected}=input.infrastructure;
 function fullReject(reason:string,status?:'blocked'|'conflict'):never{return input.reject(reason,status);}
 let retirementFailure:{reason:string;status:'blocked'|'conflict'}|undefined,retirementAccess:FullRetirementReadAccess|undefined,freshRetirement:FullRow|undefined,historyVerified=false;
 const {text}=codec,preview={intent:{orderId}},snapshots=new Map<string,any>();let nativeFailure:string|undefined;
 const nativeTx={get:async(ref:any)=>{const result:any=await input.tx.get(ref);try{for(const snapshot of result.docs??[result]){fullSnapshotNative(db,snapshot);const collection=typeof ref.path==='string'?ref.path:typeof ref.collection==='string'?ref.collection:'';const path=snapshot.ref?.path??(result.docs?collection&&snapshot.id?collection+'/'+snapshot.id:undefined:ref.path);if(path)snapshots.set(path,snapshot);}}catch(error){if(isRejected(error))nativeFailure=(error as any).reason;throw error;}return result;}};
 const evidence=new Map<string,FullEvidence>(),original=new Map<string,FullRow|undefined>();
 function remember(path:string,data:FullRow|undefined,version:Timestamp|undefined){fullPath(path);if(evidence.get(path)?.kind==='digest')fullReject('invalid-history-digest');text(data??null);original.set(path,data);evidence.set(path,{kind:'native',path,exists:data!==undefined,version:version?{seconds:version.seconds,nanoseconds:version.nanoseconds}:null,nativeText:text(data??null)});}
 const read=async(path:string)=>{fullPath(path);if(evidence.get(path)?.kind==='digest')fullReject('invalid-history-digest');if(!evidence.has(path)){const snap=snapshots.get(path)??await nativeTx.get(db.doc(path));remember(path,snap.data(),snap.updateTime);}return original.get(path);};
  // 큰 과거 원문은 검증 메모리에만 두고 새 계획에는 digest만 남긴다.
  const historical=new Map<string,FullRow|undefined>(),historyWork=new Map<string,number>(),historyQueries=new Map<string,FullHistoryQuery>();
  const trackHistorical=(path:string,row:FullRow|undefined,encodedBytes?:number)=>{if(!historyWork.has(path)){const known=evidence.get(path);historyWork.set(path,encodedBytes??Buffer.byteLength(known&&known.kind!=='digest'?known.nativeText:text(row??null),'utf8'));}if(historyWork.size>500||[...historyWork.values()].reduce((sum,value)=>sum+value,0)>16777216)fullReject('history-work-budget-exceeded');};
  const readPast=async(path:string)=>{const row=await read(path);trackHistorical(path,row);return row;};
  const readHistoricalEvidence=async(path:string)=>{fullPath(path);if(!['orderStockFullAttemptsV1','rawInventoryJobs'].includes(path.split('/')[0])||path===selfAttemptPath||original.has(path))fullReject('invalid-history-digest');if(!historical.has(path)){const snap=snapshots.get(path)??await nativeTx.get(db.doc(path)),row=snap.data(),native=text(row??null);historical.set(path,row);trackHistorical(path,row,Buffer.byteLength(native,'utf8'));evidence.set(path,{kind:'digest',path,exists:row!==undefined,version:snap.updateTime?{seconds:snap.updateTime.seconds,nanoseconds:snap.updateTime.nanoseconds}:null,nativeSha256:fullHash(native),encodedBytes:Buffer.byteLength(native,'utf8')});}return historical.get(path);};
  const predecessor=async(rawItemId:string,sequence:number)=>{if(!Number.isSafeInteger(sequence)||sequence<1)fullReject('prior-balance-unproven');const key=text([company,rawItemId,sequence]);let query=historyQueries.get(key);if(!query){const result:any=await nativeTx.get(db.collection('rawMaterialLedger').where('companyId','==',company).where('rawItemId','==',rawItemId).where('sequence','==',sequence).limit(3));if(result.docs.length===0||result.docs.length>=3)fullReject('prior-balance-unproven');const orderedEvidence:FullNativeEvidence[]=[];for(const snap of result.docs){const row=snap.data(),path=snap.ref.path;if(!row||row.companyId!==company||row.rawItemId!==rawItemId||row.sequence!==sequence||typeof row.operationId!=='string'||![operationDocId(row.operationId),legacyOperationDocId(row.operationId)].includes(snap.id)||!Number.isFinite(row.balanceAfterKg))fullReject('prior-balance-unproven');remember(path,row,snap.updateTime);trackHistorical(path,row);orderedEvidence.push(evidence.get(path) as FullNativeEvidence);}orderedEvidence.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);query={companyId:company,rawItemId,sequence,limit:3,orderedEvidence};historyQueries.set(key,query);}
   const values=query.orderedEvidence.map(row=>normalizeRawMovement(codec.decode(row.nativeText)));if(values.length===2&&(values[0].operationId!==values[1].operationId||text(values[0])!==text(values[1])))fullReject('prior-balance-unproven');return values[0].balanceAfterKg;
  };

 const aggregateSourceQueries=new Map<string,FullAggregateSourceQuery>();
 let order:FullRow;
  const legacyJobs=new Map<string,{request:OrderRawBatchRequest;job:FullRow}>();
  const sourceLines=new Map<string,{state:FullRow;origin?:FullRow;sourceLegacy?:FullRow;recordProof?:FullRow}>(),operationsByLine=new Map<string,{operationId:string;rawItemId:string;original:FullRow;movement:ReturnType<typeof normalizeRawMovement>}[]>();
  const validateFullOrigin=(value:unknown,lineId:string,attempt:number):FullRow=>{const origin=value;
   if(!fullObject(origin)||origin.protocol!==FULL_PROTOCOL||!fullObject(origin.reference)||origin.reference.version!==1||origin.reference.companyId!==company||origin.reference.orderId!==preview.intent.orderId||!fullId(origin.reference.requestId)||!fullObject(origin.owner)||origin.owner.companyId!==company||typeof origin.owner.uid!=='string'||!origin.owner.uid||!fullId(origin.owner.employeeId)||origin.lineId!==lineId||origin.attempt!==attempt)fullReject('invalid-full-raw-origin');
   return origin;
  };
  const appliedAttempt=async(origin:FullRow)=>{
   const attemptId=fullAttemptId(origin.reference,origin.owner.uid),saved=await readHistoricalEvidence(FULL_ATTEMPTS+'/'+attemptId);
   if(!saved||saved.version!==1||saved.protocol!==FULL_PROTOCOL||saved.attemptId!==attemptId||saved.state!=='applied'||text(saved.reference)!==text(origin.reference)||text(saved.owner)!==text(origin.owner)||typeof saved.fullPlanText!=='string'||fullHash(saved.fullPlanText)!==saved.fullPlanHash||!fullObject(saved.receipt)||saved.receipt.state!=='applied'||fullHash(text(saved.receipt))!==saved.receiptHash||saved.receipt.fullPlanHash!==saved.fullPlanHash)fullReject('prior-full-provenance-unproven');
   const prior=codec.decode(saved.fullPlanText) as OrderStockFullPlan;
   if(prior.version!==1||prior.protocol!==FULL_PROTOCOL||text(prior.owner)!==text(origin.owner)||prior.intent.companyId!==company||prior.intent.orderId!==preview.intent.orderId||prior.intent.requestId!==origin.reference.requestId||text(prior.intent)!==saved.intentText||fullHash(saved.intentText)!==saved.intentHash||!Array.isArray(prior.readSet)||!Array.isArray(prior.effectSet))fullReject('prior-full-provenance-unproven');
   input.infrastructure.storedAttempt(saved,origin.reference,origin.owner);
   validateFullReadEvidence(prior,FULL_ATTEMPTS+'/'+attemptId);
   const current=new Map<string,FullRow|undefined>(fullNativeReads(prior).map(row=>[row.path,codec.decode(row.nativeText)]));
   for(const row of saved.expectedB??[])current.set(row.path,codec.decode(row.nativeText));
   const terminal=materializeOrderStockFullTerminal(db,prior,saved,current,'apply',{now:saved.receipt.at,nowMs:Date.parse(saved.receipt.at)});
   if(text(terminal.next.receipt)!==text(saved.receipt))fullReject('prior-full-receipt-unproven');
   return {saved,prior,terminal};
  };
  const fullSource=async(lineId:string,state:OrderItemInventoryState)=>{
   const origin=validateFullOrigin(state.rawEffectOrigin,lineId,state.attempt);if(!Array.isArray(state.rawEffectReferences))fullReject('invalid-full-raw-origin');
   const {prior}=await appliedAttempt(origin);
   const persisted=prior.orderPatch.itemInventory?.[lineId],withoutReverse=(row:FullRow)=>{const {reversedAt:_reversed,applied:_applied,rawReversalOrigin:_rawReversal,...rest}=row;return rest;};
   if(!persisted||persisted.applied!==true||text(withoutReverse(persisted))!==text(withoutReverse(state)))fullReject('prior-full-line-unproven');
   sourceLines.set(lineId,{state:persisted,origin,recordProof:{entry:ownLineIndexEntry<FullRow>(prior.orderPatch.productionRecordIndex,lineId),record:prior.effectSet.filter(row=>row.path.startsWith('productionRecords/')).map(row=>codec.decode(row.nativeText)).find(row=>row.id===ownLineIndexEntry<FullRow>(prior.orderPatch.productionRecordIndex,lineId)?.recordId)}});
   const fullRecord=sourceLines.get(lineId)!.recordProof;if(fullRecord?.entry!==undefined){const actual=await readPast('productionRecords/'+fullRecord.entry.recordId);if(!actual||!fullRecord.record)fullReject('prior-full-record-unproven');try{assertProductionRecordBusinessMatches(fullRecord.record,actual,{text});}catch{fullReject('prior-full-record-unproven');}}
   const lines=prior.linePlans?.filter(row=>row.lineId===lineId);
   if(!lines||lines.length!==1||lines[0].attempt!==state.attempt||!Array.isArray(lines[0].commandIndices)||lines[0].commandIndices.length!==state.rawEffectReferences!.length)fullReject('prior-full-line-unproven');
   return state.rawEffectReferences!.map((ref,index)=>{
    if(text({protocol:ref.protocol,reference:ref.reference,owner:ref.owner,lineId:ref.lineId,attempt:ref.attempt})!==text(origin)||!Number.isSafeInteger(ref.commandIndex)||ref.commandIndex!==lines[0].commandIndices[index]||ref.movementPath!=='rawMaterialLedger/'+operationDocId(ref.operationId))fullReject('prior-full-command-unproven');
    const effect=prior.effectSet.find(row=>row.path===ref.movementPath);if(!effect)fullReject('prior-full-command-unproven');
    const raw=codec.decode(effect.nativeText),before=fullNativeReads(prior).find(row=>row.path===ref.movementPath);if(!before||before.exists)fullReject('prior-full-command-unproven');
    const actual=advanceInventoryWriterProtocol(undefined,raw);
    if(fullHash(text(actual))!==ref.movementHash||actual.operationId!==ref.operationId||actual.rawItemId!==ref.rawItemId||actual.commandHash!==ref.commandHash||text(actual.source)!==text(ref.source))fullReject('prior-full-command-unproven');
    return {operationId:ref.operationId,rawItemId:ref.rawItemId,movementHash:ref.movementHash};
   });
  };
  const verifyFullReversal=async(lineId:string,state:OrderItemInventoryState)=>{
   const origin=validateFullOrigin(state.rawReversalOrigin,lineId,state.attempt),source=sourceLines.get(lineId);
   if(!source||(source.sourceLegacy?( !source?.sourceLegacy||origin.sourceReference!==undefined||text(origin.sourceLegacy)!==text(source.sourceLegacy)):(origin.sourceLegacy!==undefined||!source?.origin||text(origin.sourceReference)!==text(source.origin.reference))))fullReject('prior-full-reversal-unproven');
   const {prior,terminal}=await appliedAttempt(origin),relation=prior.reversalOf,target=prior.intent.target;
   if(prior.intent.action!=='line-reverse'||!fullObject(target)||target.lineId!==lineId||target.itemId!==state.itemId||target.attempt!==state.attempt||!fullObject(relation)||relation.lineId!==lineId||relation.attempt!==state.attempt||(source.sourceLegacy?(relation.sourceReference!==undefined||relation.sourceOwner!==undefined||text(relation.sourceLegacy)!==text(source.sourceLegacy)):(relation.sourceLegacy!==undefined||text(relation.sourceReference)!==text(source.origin!.reference)||text(relation.sourceOwner)!==text(source.origin!.owner)))||relation.sourceLineNativeSha256!==fullHash(text(source.state)))fullReject('prior-full-reversal-unproven');
   const expected={...source.state,applied:false,reversedAt:prior.clock.now,rawReversalOrigin:origin};
   if(text(prior.orderPatch.itemInventory?.[lineId]??null)!==text(expected)||text(state)!==text(expected)||!Array.isArray(prior.orderPatch.items)||text(prior.orderPatch.items[target.index]??null)!==text({...prior.intent.expectedTarget,checked:false}))fullReject('prior-full-reversal-unproven');
   for(const [path,write]of terminal.writes)if(path.startsWith('rawMaterialLedger/')||path.startsWith('rawInventoryReversalGuards/')){const actual=await readPast(path);if(write.operation!=='create'||text(actual??null)!==text(write.data))fullReject('prior-full-reversal-effect-conflict');}
  };
  const validatedLineJobs=new Set<string>();
  const loadVerifiedLegacyJob=async(generation:NonNullable<Parameters<typeof sameOrderInventoryGeneration>[0]>,requireLines=false)=>{
   const jobId=orderRawBatchJobId(generation);let cached=legacyJobs.get(jobId);
   if(!cached){
    const job=await readHistoricalEvidence('rawInventoryJobs/'+jobId);if(!job)fullReject('legacy-raw-history-unproven');let request:OrderRawBatchRequest;
    try{request=readOrderRawBatchJobRequest(job);}catch{fullReject('legacy-raw-history-unproven');}
    if(!sameOrderInventoryGeneration(request!.generation,generation)||requireLines&&!Array.isArray(request!.plan.lines))fullReject('legacy-raw-history-unproven');
    const reads=[];
    for(const {command}of request!.commands){
     const movement=await readPast('rawMaterialLedger/'+operationDocId(command.operationId)),legacyId=legacyOperationDocId(command.operationId),old=legacyId===operationDocId(command.operationId)?undefined:await readPast('rawMaterialLedger/'+legacyId),state=await readPast('rawInventories/'+inventoryDocId(company,command.rawItemId)),item=await readPast('items/'+command.rawItemId),snap=(row:any)=>({exists:()=>row!==undefined,data:()=>row});
     reads.push({movementSnap:snap(movement),oldMovementSnap:legacyId===operationDocId(command.operationId)?null:snap(old),stateSnap:snap(state),itemSnap:snap(item)});
    }
    if(orderRawBatchProofProblem(job,request!,reads,await orderRawBatchRequestHash(request!)))fullReject('legacy-raw-proof-conflict');
    cached={request:request!,job};legacyJobs.set(jobId,cached);
   }
   if(requireLines&&!Array.isArray(cached.request.plan.lines))fullReject('legacy-raw-history-unproven');return cached;
  };
  const legacySource=async(lineId:string,state:OrderItemInventoryState,sourceOrder=order,requireAtomic=false)=>{
   let generation=ownLineIndexEntry<FullRow>(sourceOrder.productionRecordIndex,lineId)?.generation;const marker=sourceOrder.inventoryGenerationCompletion;
   if(requireAtomic){let patch:FullRow|undefined;try{patch=JSON.parse(marker?.requestText).patch;}catch{fullReject('legacy-raw-history-unproven');}if(!hasOrderInventoryGenerationCompletion({...sourceOrder,id:orderId} as any,marker?.generation)||!state.applied||text(patch?.itemInventory?.[lineId]??null)!==text(state)||!Array.isArray(patch?.items)||patch.items.filter((row:FullRow)=>row.lineId===lineId).length!==1||text(patch.items.find((row:FullRow)=>row.lineId===lineId))!==text(sourceOrder.items?.find((row:FullRow)=>row.lineId===lineId))||patch.items.find((row:FullRow)=>row.lineId===lineId)?.checked!==true)fullReject('legacy-raw-history-unproven');}
   if(!generation&&marker?.generation?.startedAt===state.completedAt){const patch=JSON.parse(marker.requestText).patch;if(text(patch.itemInventory?.[lineId]??null)===text(state)&&patch.itemInventory?.[lineId]?.applied===true)generation=marker.generation;}
   if(!generation){
    const production=state.production,empty=(value:any)=>Array.isArray(value)&&value.length===0;
    const zero=Object.prototype.hasOwnProperty.call(production,'rawCalculationEvidence')&&empty(production.rawCalculationEvidence)&&[state.rawConsumedLots,production.rawConsumedLots,production.rawLedgerIds,production.stockDeltas,production.productProducedLots,production.productConsumedLots,state.autoBuilt,state.producedUnits].every(empty);
    const patch=marker?JSON.parse(marker.requestText).patch:undefined;
    if(!requireAtomic&&!ownLineIndexEntry<FullRow>(sourceOrder.productionRecordIndex,lineId)&&!state.rawEffectOrigin&&zero&&text(patch?.itemInventory?.[lineId]??null)===text(state))return [];
    fullReject('legacy-raw-history-unproven');
   }
   if(generation.companyId!==company||generation.orderId!==preview.intent.orderId||generation.startedAt!==state.completedAt)fullReject('legacy-raw-history-unproven');
   const jobId=orderRawBatchJobId(generation),cached=await loadVerifiedLegacyJob(generation,true);
   if(!validatedLineJobs.has(jobId)){
    const covered=new Set<number>(),lineIds=new Set<string>();
    for(const row of cached.request.plan.lines as FullRow[]){
     if(typeof row.lineId!=='string'||lineIds.has(row.lineId)||!Number.isSafeInteger(row.attempt)||row.attempt<1||!Array.isArray(row.commandIndices))fullReject('legacy-command-index-unproven');lineIds.add(row.lineId);
     for(const index of row.commandIndices){const command=cached.request.commands[index]?.command;
      if(!Number.isSafeInteger(index)||index<0||!command||covered.has(index)||command.operationId!==(command.kind==='ledger-consume'?'production-ledger':'production')+':'+preview.intent.orderId+':'+row.lineId+':a'+row.attempt+':'+command.rawItemId)fullReject('legacy-command-index-unproven');covered.add(index);
     }
    }
    if(covered.size!==cached.request.commands.length)fullReject('legacy-command-index-unproven');validatedLineJobs.add(jobId);
   }
   if(ownLineIndexEntry<FullRow>(sourceOrder.productionRecordIndex,lineId)&&ownLineIndexEntry<FullRow>(sourceOrder.productionRecordIndex,lineId)!.requestHash!==cached.job.requestHash)fullReject('legacy-record-request-conflict');
   const matches=(cached.request.plan.lines as FullRow[]).filter(row=>row.lineId===lineId);
   if(matches.length!==1||matches[0].attempt!==state.attempt||text(matches[0].rowDeltas)!==text(state.production.stockDeltas)||text(matches[0].bomLines)!==text(state.production.bomLines)||text(matches[0].production.rawCalculationEvidence??null)!==text(state.production.rawCalculationEvidence??null)||text(matches[0].production.autoBuilt)!==text(state.autoBuilt)||text(matches[0].production.producedUnits)!==text(state.producedUnits))fullReject('legacy-line-snapshot-unproven');
   const indices=matches[0].commandIndices as number[],traces=indices.flatMap(index=>orderRawTracesFromMovement(cached!.request.commands[index].command,cached!.job.results[index].movement));
   if(text(traces)!==text(state.rawConsumedLots))fullReject('legacy-line-snapshot-unproven');if(requireAtomic)sourceLines.set(lineId,{state,sourceLegacy:{kind:'legacy-atomic-v1',generation,jobId,requestHash:cached.job.requestHash,lineId,attempt:state.attempt,sourceLineNativeSha256:fullHash(text(state)),completionNativeSha256:fullHash(text(marker))},recordProof:{entry:ownLineIndexEntry(deriveNextProductionRecordIndex(cached.request.plan.productionRecords as any,cached.job.requestHash),lineId),record:(cached.request.plan.productionRecords as any).records.find((row:FullRow)=>row.lineId===lineId)}});return indices.map(index=>({operationId:cached!.request.commands[index].command.operationId,rawItemId:cached!.request.commands[index].command.rawItemId,command:cached!.request.commands[index].command}));
  };

  type SourceOperation={operationId:string;rawItemId:string;command?:any;movementHash?:string};
  type VerifiedOperation={operationId:string;rawItemId:string;original:FullRow;movement:ReturnType<typeof normalizeRawMovement>};
  const appendVerifiedOriginals=async(operations:SourceOperation[],state:Pick<OrderItemInventoryState,'applied'|'rawConsumedLots'>,verified:VerifiedOperation[])=>{
    for(const trace of operations){const operation=trace.operationId;
     const canonical=operationDocId(operation),legacy=legacyOperationDocId(operation),a=await readPast('rawMaterialLedger/'+canonical),b=legacy===canonical?undefined:await readPast('rawMaterialLedger/'+legacy);
     const select=(first:FullRow|undefined,second:FullRow|undefined)=>{if(first&&second&&text(normalizeRawMovement(first))!==text(normalizeRawMovement(second)))fullReject('conflicting-prior-raw-movements');return first??second;};
     const original=select(a,b),movement=original?normalizeRawMovement(original):undefined;
     const savedTraces=state.rawConsumedLots.filter(row=>row.operationId===operation),ledgerOnly=movement?.kind==='ledger-consume';
     if(!movement||movement.operationId!==operation||movement.companyId!==company||movement.rawItemId!==trace.rawItemId||movement.source?.id!==preview.intent.orderId||movement.source?.type!==(ledgerOnly?'oem':'production')||!['ledger-consume','consume'].includes(movement.kind)||text(savedTraces)!==text(orderRawTracesFromMovement('command'in trace?trace.command as any:movement as any,movement))||savedTraces.some(row=>![canonical,legacy].includes(row.ledgerId!))||'movementHash'in trace&&fullHash(text(original))!==trace.movementHash)fullReject('invalid-prior-raw-movement');
     fullUsable(original,company,movement.id);verified.push({operationId:operation,rawItemId:trace.rawItemId,original:original!,movement});
     const reverseOperation='reverse:'+operation,reverseCanonical=operationDocId(reverseOperation),reverseLegacy=legacyOperationDocId(reverseOperation),reverseA=await readPast('rawMaterialLedger/'+reverseCanonical),reverseB=reverseLegacy===reverseCanonical?undefined:await readPast('rawMaterialLedger/'+reverseLegacy),reverseRaw=select(reverseA,reverseB),guard=await readPast('rawInventoryReversalGuards/'+canonical);
     if(state.applied){if(guard||reverseRaw)fullReject('prior-line-reversal-conflict');continue;}
     const reverse=reverseRaw?normalizeRawMovement(reverseRaw):undefined;
     if(!guard||guard.id!==canonical||guard.originalOperationId!==operation||guard.reverseOperationId!==reverseOperation||guard.companyId!==company||guard.rawItemId!==trace.rawItemId||typeof guard.createdAt!=='string'||!Number.isFinite(Date.parse(guard.createdAt))||!reverse||reverse.operationId!==reverseOperation||![reverseCanonical,reverseLegacy].includes(reverse.id)||reverse.kind!=='reverse'||reverse.reversalOf!==operation||reverse.companyId!==company||reverse.rawItemId!==trace.rawItemId||reverse.source?.type!=='reversal'||reverse.source.id!==preview.intent.orderId||reverse.recordedAt!==guard.createdAt||!Number.isFinite(reverse.reportedDeltaKg)||!Number.isFinite(reverse.appliedDeltaKg)||!Array.isArray(reverse.lotChanges)||reverse.lotChanges.some(row=>!Number.isFinite(row.deltaKg)||!Number.isFinite(row.beforeKg)||!Number.isFinite(row.afterKg)))fullReject(savedTraces.length===0?'prior-reporting-reversal-incomplete':'prior-line-reversal-unproven');
     fullUsable(guard,company,canonical);fullUsable(reverseRaw,company,reverse.id);
     if(!Array.isArray(original!.lotChanges)||original!.lotChanges.some((row:any)=>!fullObject(row.lotSnapshot)||row.lotSnapshot.id!==row.lotId)||!Array.isArray(reverseRaw!.lotChanges)||reverseRaw!.lotChanges.some((row:any)=>!fullObject(row.lotSnapshot)||row.lotSnapshot.id!==row.lotId||row.lotSnapshot.kgRemaining!==row.beforeKg||(row.lotSnapshot.supplierName??null)!==(row.supplierName??null)||(row.lotSnapshot.lotNo??null)!==(row.lotNo??null)||(row.lotSnapshot.receivedDate??null)!==(row.receivedDate??null)))fullReject('prior-reversal-lot-evidence-unproven');
     if(typeof reverse.effectiveAt!=='string'||!Number.isFinite(Date.parse(reverse.effectiveAt))||reverse.commandHash!==commandHash({operationId:reverseOperation,companyId:company,rawItemId:trace.rawItemId,materialSnapshot:reverse.materialSnapshot,effectiveAt:reverse.effectiveAt,source:{type:'reversal',id:preview.intent.orderId},kind:'reverse',originalOperationId:operation}))fullReject('prior-line-reversal-unproven');
     const expectedLots=rawReverseLotDeltas(movement);if(reverse.reportedDeltaKg!==rawReverseReportedDelta(movement)||reverse.lotChanges.length!==expectedLots.length||new Set(movement.lotChanges.map(row=>row.lotId)).size!==movement.lotChanges.length||reverse.lotChanges.some((row,index)=>row.lotId!==expectedLots[index].lotId||row.deltaKg!==expectedLots[index].deltaKg||rawAppliedDelta(row.beforeKg,row.afterKg)!==row.deltaKg||!row.lotSnapshot||row.lotSnapshot.id!==row.lotId||row.lotSnapshot.kgRemaining!==row.beforeKg))fullReject('invalid-prior-reversal-numerics');
     if(!Number.isSafeInteger(reverse.sequence)||reverse.sequence<=1||reverse.appliedDeltaKg!==rawAppliedDelta(await predecessor(reverse.rawItemId,reverse.sequence-1),reverse.balanceAfterKg))fullReject('invalid-prior-reversal-numerics');
    }
  };
  const aggregateCandidates=async(capturedAt:string)=>{
   if(typeof capturedAt!=='string'||!Number.isFinite(Date.parse(capturedAt)))fullReject('aggregate-source-unproven');
   let query=aggregateSourceQueries.get(capturedAt);if(!query){const result:any=await nativeTx.get(input.infrastructure.aggregateQuery(capturedAt)),candidates=input.infrastructure.aggregateCandidates(result),orderedEvidence:import('./orderStockFullPlan').FullDigestEvidence[]=[];
    if(result.docs.some((row:any)=>row.ref.path===selfAttemptPath))trackHistorical(selfAttemptPath,undefined,0);
    for(const snapshot of candidates){await readHistoricalEvidence(snapshot.ref.path);const row=evidence.get(snapshot.ref.path);if(!row||row.kind!=='digest')fullReject('invalid-history-digest');orderedEvidence.push(row);}
    orderedEvidence.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);query={version:1,companyId:company,orderId,capturedAt,limit:4,orderedEvidence};aggregateSourceQueries.set(capturedAt,query);
   }
   const sources=[];for(const row of query.orderedEvidence){const saved=historical.get(row.path);
    if(!saved||!fullObject(saved.reference)||saved.reference.version!==1||saved.reference.companyId!==company||saved.reference.orderId!==orderId||!fullId(saved.reference.requestId)||!fullObject(saved.owner)||saved.owner.companyId!==company||typeof saved.owner.uid!=='string'||!saved.owner.uid||!fullId(saved.owner.employeeId)||row.path!==FULL_ATTEMPTS+'/'+fullAttemptId(saved.reference,saved.owner.uid))fullReject('aggregate-source-unproven');
    const result=await appliedAttempt({reference:saved.reference,owner:saved.owner});if(result.prior.clock.now!==capturedAt||!Number.isFinite(result.prior.clock.nowMs)||Date.parse(result.prior.clock.now)!==result.prior.clock.nowMs)fullReject('aggregate-source-unproven');sources.push(result);
   }return sources;
  };
  const readAggregateRecords=async(generation:FullRow,expectedIndex?:FullRow,expectedRecords?:FullRow[],fullSource=false)=>{
   const index=order.productionRecordIndex??{};try{validateProductionRecordIndex(index,company,orderId);}catch{fullReject('invalid-production-record-index');}
   if(expectedIndex&&text(index)!==text(expectedIndex))fullReject('aggregate-record-unproven');
   for(const [lineId,entry]of Object.entries(index)as[string,FullRow][]){const record=await readPast('productionRecords/'+entry.recordId);if(!record||record.companyId!==company||record.orderId!==orderId||record.lineId!==lineId||text(record.generation)!==text(entry.generation)||text(entry.generation)!==text(generation)||record.createdAt!==generation.startedAt||record.supersededBy)fullReject('aggregate-record-unproven');fullUsable(record,company,entry.recordId);if(expectedRecords){const expected=expectedRecords.find(row=>row.id===entry.recordId);if(!expected)fullReject('aggregate-record-unproven');if(fullSource){try{assertProductionRecordBusinessMatches(expected,record,{text});}catch{fullReject('aggregate-record-unproven');}}else if(['id','companyId','orderId','lineId','generation','createdAt','itemId','finishedQty','wipUsed','wipItemId'].some(key=>text(record[key]??null)!==text(expected[key]??null)))fullReject('aggregate-record-unproven');}}
   if(expectedRecords?.some(row=>!Object.values(index).some((entry:any)=>entry.recordId===row.id)))fullReject('aggregate-record-unproven');
  };
  const aggregateItemSelection=(rows:unknown)=>{if(!Array.isArray(rows)||!rows.length||rows.some(row=>!fullObject(row)||!fullId(row.itemId)||typeof row.quantity!=='number'||!Number.isFinite(row.quantity)||row.quantity<=0))fullReject('aggregate-items-unproven');return ensureOrderLineIds(rows).map((row:any)=>({itemId:row.itemId,lineId:row.lineId,quantity:row.quantity,isBoxUnit:!!row.isBoxUnit,boxQuantity:row.boxQuantity??null,unitsPerBox:row.unitsPerBox??null}));};
  const aggregateFieldsMatch=(patch:FullRow,production:FullRow)=>text(patch.inventorySnapshots?.production??null)===text(production)&&patch.producedAt===order.producedAt&&patch.rawInventoryAttempt===order.rawInventoryAttempt&&text(patch.rawConsumedLots??[])===text(order.rawConsumedLots??[])&&text(patch.producedUnits??null)===text(order.producedUnits??null)&&text(patch.autoBuilt??[])===text(order.autoBuilt??[]);
  const allocationQuantities=(value:unknown):[string,number][]=>{
   if(!Array.isArray(value))fullReject('aggregate-allocation-unproven');const ids=new Set<string>(),result:[string,number][]=[];
   for(const row of value){if(!Array.isArray(row)||row.length!==2||!fullId(row[0])||typeof row[1]!=='number'||!Number.isFinite(row[1])||row[1]<0||ids.has(row[0]))fullReject('aggregate-allocation-unproven');ids.add(row[0]);result.push([row[0],row[1]]);}
   return result;
  };
  const verifyCurrentAggregateProduction=async()=>{
   order=(await read('orders/'+orderId))!;fullUsable(order,company,orderId);const production=order.inventorySnapshots?.production;
   if(!fullObject(production)||typeof order.producedAt!=='string'||production.capturedAt!==order.producedAt||!Number.isSafeInteger(order.rawInventoryAttempt)||order.rawInventoryAttempt<1||!Array.isArray(production.stockDeltas)||!Array.isArray(production.bomLines)||!Array.isArray(order.rawConsumedLots))fullReject('aggregate-source-unproven');
   const sources=await aggregateCandidates(production.capturedAt),matches=sources.filter(({prior})=>prior.intent.action==='status-forward'&&!prior.linePlans&&aggregateFieldsMatch(prior.orderPatch,production)&&text(aggregateItemSelection(prior.orderPatch.items))===text(aggregateItemSelection(order.items)));
   if(sources.length){if(matches.length!==1)fullReject('aggregate-source-unproven');const {prior,saved}=matches[0],generation={contractVersion:1,companyId:company,orderId,operationId:input.infrastructure.generationOperationId(saved.reference,saved.owner.uid),actorUid:saved.owner.uid,startedAt:prior.clock.now},records=prior.effectSet.filter(row=>row.path.startsWith('productionRecords/')).map(row=>codec.decode(row.nativeText));await readAggregateRecords(generation,prior.orderPatch.productionRecordIndex??{},records,true);
    const operations:SourceOperation[]=[];for(const effect of prior.effectSet.filter(row=>row.path.startsWith('rawMaterialLedger/'))){const raw=codec.decode(effect.nativeText),before=fullNativeReads(prior).find(row=>row.path===effect.path);if(!before||before.exists||effect.path!=='rawMaterialLedger/'+operationDocId(raw.operationId)||!['consume','ledger-consume'].includes(raw.kind)||raw.operationId!==(raw.kind==='ledger-consume'?'production-ledger':'production')+':'+orderId+':a'+order.rawInventoryAttempt+':'+raw.rawItemId)fullReject('aggregate-command-unproven');operations.push({operationId:raw.operationId,rawItemId:raw.rawItemId,movementHash:fullHash(text(advanceInventoryWriterProtocol(undefined,raw)))});}
    const verified:VerifiedOperation[]=[];await appendVerifiedOriginals(operations,{applied:true,rawConsumedLots:order.rawConsumedLots},verified);
    const lock=saved.lock,reference=saved.reference,owner=saved.owner;if(!fullObject(lock)||!fullObject(reference)||!fullObject(owner)||lock.id!==FULL_PROTOCOL+':'+fullAttemptId(reference,owner.uid)||lock.fullAttemptId!==fullAttemptId(reference,owner.uid)||lock.fullProtocol!==FULL_PROTOCOL||text(lock.fullReference)!==text(reference)||lock.actorUid!==owner.uid||typeof lock.nonce!=='string'||!lock.nonce||lock.startedAt!==prior.clock.now)fullReject('aggregate-allocation-unproven');
    if(prior.authorityVersion!==undefined&&prior.authorityVersion!==1||saved.authorityVersion!==prior.authorityVersion)fullReject('invalid-authority-version','conflict');
    const allocationEvidence={kind:'full' as const,reference,owner,operationId:lock.id,reservationAttemptId:lock.nonce,createdAt:prior.clock.now,quantities:allocationQuantities(prior.preview?.allocationQuantities),...(prior.authorityVersion===1?{authorityVersion:1 as const}:{})};
    return {source:'full' as const,production,operations:verified,allocationEvidence};
   }
   const marker=order.inventoryGenerationCompletion;let patch:FullRow;try{if(!hasOrderInventoryGenerationCompletion({...order,id:orderId}as any,marker?.generation))fullReject('legacy-aggregate-unproven');patch=JSON.parse(marker.requestText).patch;}catch{fullReject('legacy-aggregate-unproven');}
   if(!aggregateFieldsMatch(patch!,production))fullReject('legacy-aggregate-unproven');const entries=Object.values(order.productionRecordIndex??{})as FullRow[],generations=new Map(entries.map(entry=>[text(entry.generation),entry.generation]));if(generations.size>1)fullReject('legacy-aggregate-generation-unproven');const generation=generations.size?[...generations.values()][0]:marker?.generation?.startedAt===production.capturedAt?marker.generation:undefined;if(!generation||generation.companyId!==company||generation.orderId!==orderId||generation.startedAt!==production.capturedAt)fullReject('legacy-aggregate-generation-unproven');
   const {request,job}=await loadVerifiedLegacyJob(generation),plan=request.plan as FullRow;
   if(plan.finalPlan?.kind!=='status'||Array.isArray(plan.lines)||!fullObject(plan.production)||!Array.isArray(plan.productionDeltas)||!fullObject(plan.productLots)||!Array.isArray(plan.productLots.positive)||plan.attempt!==order.rawInventoryAttempt||text(plan.productionDeltas)!==text(production.stockDeltas)||text(plan.bomLines)!==text(production.bomLines)||text(plan.production.rawCalculationEvidence??[])!==text(production.rawCalculationEvidence??[])||text(plan.production.producedUnits??null)!==text(order.producedUnits??null)||text(plan.production.autoBuilt??[])!==text(order.autoBuilt??[]))fullReject('legacy-aggregate-snapshot-unproven');
   let businessOrder:FullRow;try{businessOrder=JSON.parse(request.business.orderText as string);}catch{fullReject('legacy-aggregate-items-unproven');}const sourceItems=plan.finalPlan.completionPatch?.items??businessOrder!.items;if(text(aggregateItemSelection(sourceItems))!==text(aggregateItemSelection(plan.normalizedItems))||text(aggregateItemSelection(plan.normalizedItems))!==text(aggregateItemSelection(order.items)))fullReject('legacy-aggregate-items-unproven');
   try{validateOrderProductionRecordPlan(plan.productionRecords);}catch{fullReject('legacy-aggregate-record-unproven');}if(text(plan.productionRecords.generation)!==text(generation))fullReject('legacy-aggregate-record-unproven');await readAggregateRecords(generation,deriveNextProductionRecordIndex(plan.productionRecords,job.requestHash),plan.productionRecords.records);
   const positive=plan.productLots.positive.map((row:any)=>({itemId:row.itemId,lotId:row.lot.id,qty:row.lot.qtyIn??0}));if(text(positive)!==text(production.productProducedLots??[]))fullReject('legacy-aggregate-lots-unproven');
   const traces=request.commands.flatMap(({command},index)=>orderRawTracesFromMovement(command,job.results[index].movement));if(text(traces)!==text(order.rawConsumedLots)||text(traces)!==text(production.rawConsumedLots??[]))fullReject('legacy-aggregate-raw-unproven');
   const operations=request.commands.map(({command})=>{if(command.operationId!==(command.kind==='ledger-consume'?'production-ledger':'production')+':'+orderId+':a'+plan.attempt+':'+command.rawItemId)fullReject('legacy-aggregate-command-unproven');return {operationId:command.operationId,rawItemId:command.rawItemId,command};}),verified:VerifiedOperation[]=[];await appendVerifiedOriginals(operations,{applied:true,rawConsumedLots:order.rawConsumedLots},verified);const reservation=plan.finalPlan.reservation;if(!fullObject(reservation)||reservation.orderId!==orderId||reservation.operationId!==generation.operationId||text(reservation.generation)!==text(generation))fullReject('aggregate-allocation-unproven');
   const allocationEvidence={kind:'legacy-atomic' as const,generation:request.generation,operationId:reservation.operationId,quantities:allocationQuantities(reservation.allocationQuantities)};
   return {source:'legacy-atomic' as const,production,operations:verified,allocationEvidence};
  };
  const verifyCurrentShipment=async()=>{
   order=(await read('orders/'+orderId))!;fullUsable(order,company,orderId);const shipment=order.inventorySnapshots?.shipment;if(order.status!=='SHIPPED'||order.shippedOut!==true||!fullObject(shipment)||typeof shipment.capturedAt!=='string'||!Number.isFinite(Date.parse(shipment.capturedAt)))fullReject('shipment-source-unproven');
   const matches=(patch:FullRow)=>patch.status==='SHIPPED'&&patch.shippedOut===true&&text(patch.inventorySnapshots?.shipment??null)===text(shipment)&&text(patch.productConsumedLots??[])===text(order.productConsumedLots??[]),marker=order.inventoryGenerationCompletion;
   const origin=shipment.fullOrigin;if(origin!==undefined){if(!fullObject(origin)||Object.keys(origin).sort().join(',')!=='owner,protocol,reference'||origin.protocol!==FULL_PROTOCOL||!fullObject(origin.reference)||Object.keys(origin.reference).sort().join(',')!=='companyId,orderId,requestId,version'||origin.reference.version!==1||origin.reference.companyId!==company||origin.reference.orderId!==orderId||!fullId(origin.reference.requestId)||!fullObject(origin.owner)||Object.keys(origin.owner).sort().join(',')!=='companyId,employeeId,uid'||origin.owner.companyId!==company||typeof origin.owner.uid!=='string'||!origin.owner.uid||!fullId(origin.owner.employeeId))fullReject('shipment-source-unproven');const {prior}=await appliedAttempt(origin);if(prior.intent.action!=='shipment-forward'||prior.shipment?.version!==1||prior.authorityVersion!==1||!matches(prior.orderPatch))fullReject('shipment-source-unproven');return;}

   if(marker&&hasOrderInventoryGenerationCompletion({...order,id:orderId}as any,marker.generation)){const patch=JSON.parse(marker.requestText).patch;if(matches(patch))return;}
   const sources=await aggregateCandidates(shipment.capturedAt);if(sources.filter(({prior})=>prior.intent.action==='status-forward'&&matches(prior.orderPatch)).length!==1)fullReject('shipment-source-unproven');
  };

 const verifyCurrentAllocationIssuerRows=async()=>{
  order=(await read('orders/'+orderId))!;fullUsable(order,company,orderId);
  const current=new Map<string,FullRow[]>();
  for(const [path,snapshot] of snapshots){if(!path.startsWith('items/'))continue;const data=snapshot.data();if(!data||!Array.isArray(data.inventoryReservations))continue;const rows=data.inventoryReservations.filter((row:FullRow)=>row?.orderId===orderId);if(rows.length){const id=path.slice(6);if(!fullId(id))fullReject('invalid-previous-allocation');await read(path);current.set(id,rows);}}
  const fullIssuers=new Map<string,Awaited<ReturnType<typeof appliedAttempt>>>(),legacyRows:[string,FullRow[]][]=[];
  for(const [id,rows] of current){for(const row of rows){if(!fullObject(row)||row.state!=='allocated'||typeof row.operationId!=='string')fullReject('invalid-previous-allocation');
   if(row.operationId.startsWith(FULL_PROTOCOL+':')){const attemptId=row.operationId.slice(FULL_PROTOCOL.length+1);if(!/^[a-f0-9]{64}$/.test(attemptId))fullReject('invalid-previous-allocation');
    if(!fullIssuers.has(attemptId)){const saved=await readHistoricalEvidence(FULL_ATTEMPTS+'/'+attemptId);if(!saved||!fullObject(saved.reference)||!fullObject(saved.owner)||saved.reference.companyId!==company||saved.reference.orderId!==orderId||saved.owner.companyId!==company||typeof saved.owner.uid!=='string'||!saved.owner.uid||fullAttemptId(saved.reference,saved.owner.uid)!==attemptId)fullReject('invalid-previous-allocation');fullIssuers.set(attemptId,await appliedAttempt({reference:saved.reference,owner:saved.owner}));}
   }else{legacyRows.push([id,rows]);break;}
  }}
  for(const [attemptId,source] of fullIssuers){const itemIds=new Set<string>([...source.prior.itemIds,...current.keys()]);for(const id of itemIds){const path='items/'+id,before=fullNativeReads(source.prior).find(row=>row.path===path),expectedB=(source.saved.expectedB??[]).find((row:FullRow)=>row.path===path),basis=expectedB?codec.decode(expectedB.nativeText):before?.exists?codec.decode(before.nativeText):undefined,write=source.terminal.writes.get(path),post=write?.operation==='delete'?undefined:write?.operation==='create'?write.data:{...basis,...write?.data},expected=(post?.inventoryReservations??[]).filter((row:FullRow)=>row?.orderId===orderId&&row.operationId===FULL_PROTOCOL+':'+attemptId),actual=(current.get(id)??[]).filter(row=>row.operationId===FULL_PROTOCOL+':'+attemptId);if(text(expected)!==text(actual))fullReject('invalid-previous-allocation');}}
  if(legacyRows.length){const marker=order.inventoryGenerationCompletion;let request:FullRow;try{if(!hasOrderInventoryGenerationCompletion({...order,id:orderId} as any,marker?.generation))fullReject('invalid-previous-allocation');request=JSON.parse(marker.requestText);}catch{fullReject('invalid-previous-allocation');}
   if(!fullObject(request!.patch)||text(request!.patch.itemInventory??null)!==text(order.itemInventory??null)||text(aggregateItemSelection(request!.patch.items))!==text(aggregateItemSelection(order.items)))fullReject('invalid-previous-allocation');
   const reservation=request!.reservationEvidence?.reservation,generation=marker.generation;if(!fullObject(reservation)||reservation.orderId!==orderId||reservation.operationId!==generation.operationId||text(reservation.generation)!==text(generation))fullReject('invalid-previous-allocation');const quantities=new Map(allocationQuantities(reservation.allocationQuantities).filter(([,qty])=>qty>0));
   for(const [id,rows] of legacyRows){if(rows.length!==1)fullReject('invalid-previous-allocation');const row=rows[0];if(row.operationId!==reservation.operationId||text(row.generation)!==text(generation)||row.qty!==quantities.get(id)||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt))||Object.prototype.hasOwnProperty.call(row,'reservationAttemptId')||Object.prototype.hasOwnProperty.call(row,'serverProtocol'))fullReject('invalid-previous-allocation');}
   for(const [id] of quantities)if(!legacyRows.some(([itemId])=>itemId===id))fullReject('invalid-previous-allocation');
  }
  return [...current].map(([itemId,rows])=>({itemId,rows}));
 };
 const mintRetirementRead=(live:FullRow)=>{retirementAccess=Object.freeze({}) as FullRetirementReadAccess;retirementReads.set(retirementAccess,{companyId:company,orderId,orderText:text(live),text});};
 const retirementBoundary=async(run:()=>unknown|Promise<unknown>):Promise<void>=>{try{const result=await run();if(result!==undefined)fullReject('retirement-verifier-unconfirmed');}catch(error){if(isRejected(error))retirementFailure={reason:(error as any).reason,status:(error as any).status};throw error;}};
 const verifyRetirementHistory=()=>retirementBoundary(async()=>{
  if(historyVerified)return;const live=await read('orders/'+orderId);fullUsable(live,company,orderId);if(!Object.prototype.hasOwnProperty.call(live!,'retirementId')){if(live!.retirementClaimPending!==undefined&&live!.retirementClaimPending!==false&&live!.retirementClaimPending!==null)fullReject('retirement-history-unproven');historyVerified=true;return;}
  const retirementId=live!.retirementId;if(typeof retirementId!=='string'||!/^[a-f0-9]{64}$/.test(retirementId)||live!.retirementClaimPending!==false||live!.inventoryOperation!=null)fullReject('retirement-history-unproven');
  const terminal=await read('orderRequestRetirements/'+retirementId),authorization=await read('orderRequestRetirementAuthorizations/'+retirementId);if(!terminal||!authorization||typeof terminal.actorUid!=='string'||!terminal.actorUid||terminal.actorUid.trim()!==terminal.actorUid||terminal.actorUid.length>512)fullReject('retirement-history-unproven');
  try{assertRetirementStaticProof({companyId:company,actorUid:terminal.actorUid,orderId,retirementId,saved:terminal,authorization,terminalExists:true,authorizationExists:true},'historical');}catch{fullReject('retirement-history-unproven');}
  const hasFull=Object.prototype.hasOwnProperty.call(terminal,'firstConsumer'),hasClaim=Object.prototype.hasOwnProperty.call(terminal,'firstClaim');if(hasFull===hasClaim)fullReject('retirement-history-unproven');
  if(hasFull){const consumer=terminal.firstConsumer;if(!fullObject(consumer)||Object.keys(consumer).sort().join(',')!=='attemptId,consumedAt,fullPlanHash,kind,ownerUid,reference,version'||consumer.version!==1||consumer.kind!=='full-v1'||consumer.ownerUid!==terminal.actorUid||typeof consumer.attemptId!=='string'||!/^[a-f0-9]{64}$/.test(consumer.attemptId)||typeof consumer.fullPlanHash!=='string'||!/^[a-f0-9]{64}$/.test(consumer.fullPlanHash)||!fullObject(consumer.reference)||Object.keys(consumer.reference).sort().join(',')!=='companyId,orderId,requestId,version'||consumer.reference.version!==1||consumer.reference.companyId!==company||consumer.reference.orderId!==orderId||!fullId(consumer.reference.requestId)||fullAttemptId(consumer.reference,consumer.ownerUid)!==consumer.attemptId||terminal.consumedBy!==FULL_PROTOCOL+':'+consumer.attemptId)fullReject('retirement-history-unproven');
   const saved=await readHistoricalEvidence(FULL_ATTEMPTS+'/'+consumer.attemptId);if(!saved||!fullObject(saved.owner)||saved.owner.uid!==consumer.ownerUid||saved.owner.companyId!==company||!fullId(saved.owner.employeeId)||text(saved.reference)!==text(consumer.reference)||!['applied','cancelled'].includes(saved.state)||saved.fullPlanHash!==consumer.fullPlanHash)fullReject('retirement-history-unproven');
   const prior=input.infrastructure.storedAttempt(saved,consumer.reference,saved.owner);if(!prior||consumer.consumedAt!==prior.clock.now||!fullObject(prior.retirementHandoff)||Object.keys(prior.retirementHandoff).sort().join(',')!=='backupHash,originalGenerationIdentity,retirementId,terminalRequestHash,version'||prior.retirementHandoff.version!==1||prior.retirementHandoff.retirementId!==retirementId||prior.retirementHandoff.terminalRequestHash!==terminal.requestHash||prior.retirementHandoff.backupHash!==authorization.backupHash)fullReject('retirement-history-unproven');
   const g=terminal.generation,identity={companyId:company,orderId,operationId:g.operationId,startedAt:g.startedAt,actorUid:g.actorUid};if(text(prior.retirementHandoff.originalGenerationIdentity)!==text(identity))fullReject('retirement-history-unproven');const before=fullNativeReads(prior).find(row=>row.path==='orders/'+orderId),prepared=(saved.expectedB??[]).find((row:FullRow)=>row.path==='orderRequestRetirements/'+retirementId);if(!before?.exists||!prepared)fullReject('retirement-history-unproven');const original=codec.decode(before.nativeText),expected=codec.decode(prepared.nativeText);if(original.companyId!==company||original.retirementId!==retirementId||original.retirementClaimPending!==true||original.inventoryOperation!=null||original.inventoryGenerationCompletion||text(expected.firstConsumer)!==text(consumer)||expected.consumedBy!==terminal.consumedBy)fullReject('retirement-history-unproven');
  }else{const first=terminal.firstClaim,g=first?.generation;let request:FullRow;try{if(!fullObject(first)||typeof first.requestText!=='string'||typeof first.requestHash!=='string'||retirementHash(first.requestText)!==first.requestHash)fullReject('retirement-history-unproven');request=JSON.parse(first.requestText);if(retirementText(request)!==first.requestText||request.version!==1||request.companyId!==company||request.actorUid!==terminal.actorUid||request.orderId!==orderId||request.retirementId!==retirementId||!fullObject(g)||g.contractVersion!==1||g.companyId!==company||g.actorUid!==terminal.actorUid||g.orderId!==orderId||!fullId(g.operationId)||g.operationId===terminal.generation.operationId||typeof g.startedAt!=='string'||!Number.isFinite(Date.parse(g.startedAt))||request.operation?.id!==g.operationId||request.operation?.startedAt!==g.startedAt||request.operation?.actorUid!==g.actorUid||terminal.consumedBy!==g.operationId||!exactClaimCompletion(live,g))fullReject('retirement-history-unproven');}catch(error){if(isRejected(error))throw error;fullReject('retirement-history-unproven');}}
  historyVerified=true;mintRetirementRead(live!);
 });
 const verifyRetirementAccess=()=>retirementBoundary(async()=>{
  if(input.retirementRequest===undefined){await verifyRetirementHistory();return;}if(freshRetirement)return;const handoff=input.retirementRequest;if(!fullObject(handoff)||Object.keys(handoff).sort().join(',')!=='releaseId,retirementId,version'||handoff.version!==1||typeof handoff.retirementId!=='string'||!/^[a-f0-9]{64}$/.test(handoff.retirementId)||typeof handoff.releaseId!=='string'||!handoff.releaseId)fullReject('invalid-retirement-handoff');
  const live=await read('orders/'+orderId);fullUsable(live,company,orderId);const paths=new Set<string>(),get=async(ref:any)=>{if(typeof ref.path!=='string')fullReject('invalid-retirement-handoff');paths.add(ref.path);return nativeTx.get(ref);},tracked={get,getAll:async(...refs:any[])=>Promise.all(refs.map(get))};let proof:Awaited<ReturnType<typeof readRetirementHandoff>>;
  try{proof=await readRetirementHandoff(tracked as any,db,{companyId:company,actorUid:input.actorUid,orderId,retirementId:handoff.retirementId,releaseId:handoff.releaseId,expectedOrderEvidence:selectOrderRawBatchOrderEvidence({...live,id:orderId},retirementText)});}catch(error){if(error instanceof HttpsError)fullReject('retirement-handoff-unproven');throw error;}for(const path of paths)await read(path);
  freshRetirement={version:1,retirementId:proof.retirementId,terminalRequestHash:proof.terminalRequestHash,backupHash:proof.backupHash,originalGenerationIdentity:proof.originalGenerationIdentity};mintRetirementRead(live!);
 });
 const verifyCurrentLineHistory=async(legacyReversalLineIds?:string|ReadonlySet<string>)=>{const strictLegacyIds=new Set(typeof legacyReversalLineIds==='string'?[legacyReversalLineIds]:legacyReversalLineIds??[]);order=(await read('orders/'+orderId))!;fullUsable(order,company,orderId);
  const lineBasis={currentStates:(order.itemInventory??{}) as Record<string,OrderItemInventoryState>};
  {
   try{validateProductionRecordIndex(order.productionRecordIndex??{},company,preview.intent.orderId);}catch{fullReject('invalid-production-record-index');}
   const states=lineBasis.currentStates,index=order.productionRecordIndex??{};
   for(const [lineId,entry]of Object.entries(index) as [string,any][]){const state=states[lineId];if(!state)fullReject('invalid-production-record-index');const record=await readPast('productionRecords/'+entry.recordId),relatedItems=new Set([state.itemId,...state.production.bomLines.filter(row=>row.parentItemId===state.itemId).map(row=>row.childItemId),...(state.production.productProducedLots??[]).map(row=>row.itemId)]);if(!record||record.companyId!==company||record.orderId!==preview.intent.orderId||record.lineId!==lineId||!relatedItems.has(record.itemId)||text(record.generation)!==text(entry.generation)||record.createdAt!==entry.generation.startedAt||record.supersededBy||state.completedAt!==entry.generation.startedAt)fullReject('invalid-prior-production-record');fullUsable(record,company,entry.recordId);}
   for(const [lineId,state] of Object.entries(states)){
    let operations;
    if(state.rawReversalOrigin?.sourceLegacy){
     if(state.applied||state.rawEffectOrigin||state.rawReversalOrigin.sourceReference!==undefined)fullReject('invalid-full-reversal-origin');
     const origin=validateFullOrigin(state.rawReversalOrigin,lineId,state.attempt),{prior}=await appliedAttempt(origin),before=fullNativeReads(prior).find(row=>row.path==='orders/'+orderId);
     if(!before?.exists)fullReject('prior-full-reversal-unproven');const sourceOrder=codec.decode(before.nativeText),sourceState=sourceOrder.itemInventory?.[lineId];
     if(!sourceState||sourceState.applied!==true||sourceState.rawEffectOrigin)fullReject('prior-full-reversal-unproven');
     operations=await legacySource(lineId,sourceState,sourceOrder,true);await verifyFullReversal(lineId,state);
    }else{operations=state.rawEffectOrigin?await fullSource(lineId,state):await legacySource(lineId,state,order,strictLegacyIds.has(lineId));
     if(state.rawReversalOrigin){if(state.applied||!state.rawEffectOrigin)fullReject('invalid-full-reversal-origin');await verifyFullReversal(lineId,state);}
    }
    const verified: {operationId:string;rawItemId:string;original:FullRow;movement:ReturnType<typeof normalizeRawMovement>}[]=[];operationsByLine.set(lineId,verified);
    await appendVerifiedOriginals(operations,state,verified);
   }
  }

 return {order,states:lineBasis.currentStates,operationsByLine,sourceLines};
 };

 return {tx:nativeTx as Pick<Transaction,'get'>,verifyRetirementHistory,verifyRetirementAccess,get retirementAccess(){return retirementAccess;},get retirementHandoff(){return freshRetirement;},get retirementFailure(){return retirementFailure;},get nativeFailure(){return nativeFailure;},readNative:read,readPast,readHistoricalDigest:readHistoricalEvidence,readPredecessor:predecessor,get readSet(){return [...evidence.values()];},get historyQueries(){return [...historyQueries.values()];},native:original as ReadonlyMap<string,FullRow|undefined>,get aggregateSourceQueries(){return [...aggregateSourceQueries.values()];},verifyCurrentAggregateProduction,verifyCurrentShipment,verifyCurrentLineHistory,verifyCurrentAllocationIssuerRows};
}
