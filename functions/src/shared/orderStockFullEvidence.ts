import type {Firestore,Transaction,Timestamp} from 'firebase-admin/firestore';
import type {FullRow,FullEvidence,FullNativeEvidence,FullHistoryQuery,OrderStockFullPlan} from './orderStockFullPlan';
import type {OrderItemInventoryState} from './orderLineInventory';
import {rawReverseReportedDelta,rawReverseLotDeltas,rawAppliedDelta,commandHash,inventoryDocId,operationDocId,legacyOperationDocId} from './rawInventoryCore';
import {orderRawBatchJobId,type OrderRawBatchRequest} from './orderRawBatchIdentity';
import {readOrderRawBatchJobRequest,orderRawBatchProofProblem,orderRawBatchRequestHash} from './orderRawBatchProof';
import {hasOrderInventoryGenerationCompletion,sameOrderInventoryGeneration} from './orderInventoryCompletionEvidence';
import {validateProductionRecordIndex} from './orderProductionRecordPlan';
import {orderRawTracesFromMovement} from './orderRawCommandPlan';
import {normalizeRawMovement} from './rawInventoryDocument';
import {advanceInventoryWriterProtocol} from './inventoryWriterProtocol';

export interface FullHistoricalEvidenceInput {
 tx:Pick<Transaction,'get'>;db:Firestore;companyId:'taebaek'|'punghoe';orderId:string;selfAttemptPath:string;
 codec:{text:(value:unknown)=>string;decode:(value:string)=>any};hash:(value:string)=>string;
 reject:(reason:string,status?:'blocked'|'conflict')=>never;usable:(row:FullRow|undefined,company:string,id:string)=>void;
 materializeTerminal:typeof import('./orderStockFullPlan').materializeOrderStockFullTerminal;
 infrastructure:{protocol:string;attempts:string;object:(value:unknown)=>value is FullRow;id:(value:unknown)=>value is string;path:(path:string)=>void;snapshotNative:(db:Firestore,snapshot:any)=>void;nativeReads:(plan:OrderStockFullPlan)=>FullNativeEvidence[];validateReadEvidence:(plan:OrderStockFullPlan,selfPath:string)=>void;attemptId:(reference:any,uid:string)=>string;isRejected:(error:unknown)=>boolean};
}
/** DB 원문은 이 거래 안에서만 읽는다. 읽기 캐시는 다음 거래의 CAS를 대신하지 않는다. */
export function createFullHistoricalEvidenceContext(input:FullHistoricalEvidenceInput){
 const {db,companyId:company,orderId,selfAttemptPath,codec,hash:fullHash,usable:fullUsable,materializeTerminal:materializeOrderStockFullTerminal}=input;
 const {protocol:FULL_PROTOCOL,attempts:FULL_ATTEMPTS,object:fullObject,id:fullId,path:fullPath,snapshotNative:fullSnapshotNative,nativeReads:fullNativeReads,validateReadEvidence:validateFullReadEvidence,attemptId:fullAttemptId,isRejected}=input.infrastructure;
 function fullReject(reason:string,status?:'blocked'|'conflict'):never{return input.reject(reason,status);}
 const {text}=codec,preview={intent:{orderId}},snapshots=new Map<string,any>();let nativeFailure:string|undefined;
 const nativeTx={get:async(ref:any)=>{const result:any=await input.tx.get(ref);try{for(const snapshot of result.docs??[result]){fullSnapshotNative(db,snapshot);const collection=typeof ref.path==='string'?ref.path:typeof ref.collection==='string'?ref.collection:'';const path=snapshot.ref?.path??(result.docs?collection&&snapshot.id?collection+'/'+snapshot.id:undefined:ref.path);if(path)snapshots.set(path,snapshot);}}catch(error){if(isRejected(error))nativeFailure=(error as any).reason;throw error;}return result;}};
 const evidence=new Map<string,FullEvidence>(),original=new Map<string,FullRow|undefined>();
 function remember(path:string,data:FullRow|undefined,version:Timestamp|undefined){fullPath(path);if(evidence.get(path)?.kind==='digest')fullReject('invalid-history-digest');text(data??null);original.set(path,data);evidence.set(path,{kind:'native',path,exists:data!==undefined,version:version?{seconds:version.seconds,nanoseconds:version.nanoseconds}:null,nativeText:text(data??null)});}
 const read=async(path:string)=>{fullPath(path);if(evidence.get(path)?.kind==='digest')fullReject('invalid-history-digest');if(!evidence.has(path)){const snap=snapshots.get(path)??await nativeTx.get(db.doc(path));remember(path,snap.data(),snap.updateTime);}return original.get(path);};
  // 큰 과거 원문은 검증 메모리에만 두고 새 계획에는 digest만 남긴다.
  const historical=new Map<string,FullRow|undefined>(),historyWork=new Map<string,number>(),historyQueries=new Map<string,FullHistoryQuery>();
  const trackHistorical=(path:string,row:FullRow|undefined,encodedBytes?:number)=>{if(!historyWork.has(path)){const known=evidence.get(path);historyWork.set(path,encodedBytes??Buffer.byteLength(known&&known.kind!=='digest'?known.nativeText:text(row??null),'utf8'));}if(historyWork.size>500||[...historyWork.values()].reduce((sum,value)=>sum+value,0)>16777216)fullReject('history-work-budget-exceeded');};
  const readPast=async(path:string)=>{const row=await read(path);trackHistorical(path,row);return row;};
  const readHistoricalEvidence=async(path:string)=>{fullPath(path);if(!['orderStockFullAttemptsV1','rawInventoryJobs'].includes(path.split('/')[0])||path===selfAttemptPath||original.has(path))fullReject('invalid-history-digest');if(!historical.has(path)){const snap=await nativeTx.get(db.doc(path)),row=snap.data(),native=text(row??null);historical.set(path,row);trackHistorical(path,row,Buffer.byteLength(native,'utf8'));evidence.set(path,{kind:'digest',path,exists:row!==undefined,version:snap.updateTime?{seconds:snap.updateTime.seconds,nanoseconds:snap.updateTime.nanoseconds}:null,nativeSha256:fullHash(native),encodedBytes:Buffer.byteLength(native,'utf8')});}return historical.get(path);};
  const predecessor=async(rawItemId:string,sequence:number)=>{if(!Number.isSafeInteger(sequence)||sequence<1)fullReject('prior-balance-unproven');const key=text([company,rawItemId,sequence]);let query=historyQueries.get(key);if(!query){const result:any=await nativeTx.get(db.collection('rawMaterialLedger').where('companyId','==',company).where('rawItemId','==',rawItemId).where('sequence','==',sequence).limit(3));if(result.docs.length===0||result.docs.length>=3)fullReject('prior-balance-unproven');const orderedEvidence:FullNativeEvidence[]=[];for(const snap of result.docs){const row=snap.data(),path=snap.ref.path;if(!row||row.companyId!==company||row.rawItemId!==rawItemId||row.sequence!==sequence||typeof row.operationId!=='string'||![operationDocId(row.operationId),legacyOperationDocId(row.operationId)].includes(snap.id)||!Number.isFinite(row.balanceAfterKg))fullReject('prior-balance-unproven');remember(path,row,snap.updateTime);trackHistorical(path,row);orderedEvidence.push(evidence.get(path) as FullNativeEvidence);}orderedEvidence.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);query={companyId:company,rawItemId,sequence,limit:3,orderedEvidence};historyQueries.set(key,query);}
   const values=query.orderedEvidence.map(row=>normalizeRawMovement(codec.decode(row.nativeText)));if(values.length===2&&(values[0].operationId!==values[1].operationId||text(values[0])!==text(values[1])))fullReject('prior-balance-unproven');return values[0].balanceAfterKg;
  };

 let order:FullRow;
  const legacyJobs=new Map<string,{request:OrderRawBatchRequest;job:FullRow}>();
  const sourceLines=new Map<string,{state:FullRow;origin?:FullRow;sourceLegacy?:FullRow}>(),operationsByLine=new Map<string,{operationId:string;rawItemId:string;original:FullRow;movement:ReturnType<typeof normalizeRawMovement>}[]>();
  const validateFullOrigin=(value:unknown,lineId:string,attempt:number):FullRow=>{const origin=value;
   if(!fullObject(origin)||origin.protocol!==FULL_PROTOCOL||!fullObject(origin.reference)||origin.reference.version!==1||origin.reference.companyId!==company||origin.reference.orderId!==preview.intent.orderId||!fullId(origin.reference.requestId)||!fullObject(origin.owner)||origin.owner.companyId!==company||typeof origin.owner.uid!=='string'||!origin.owner.uid||!fullId(origin.owner.employeeId)||origin.lineId!==lineId||origin.attempt!==attempt)fullReject('invalid-full-raw-origin');
   return origin;
  };
  const appliedAttempt=async(origin:FullRow)=>{
   const attemptId=fullAttemptId(origin.reference,origin.owner.uid),saved=await readHistoricalEvidence(FULL_ATTEMPTS+'/'+attemptId);
   if(!saved||saved.version!==1||saved.protocol!==FULL_PROTOCOL||saved.attemptId!==attemptId||saved.state!=='applied'||text(saved.reference)!==text(origin.reference)||text(saved.owner)!==text(origin.owner)||typeof saved.fullPlanText!=='string'||fullHash(saved.fullPlanText)!==saved.fullPlanHash||!fullObject(saved.receipt)||saved.receipt.state!=='applied'||fullHash(text(saved.receipt))!==saved.receiptHash||saved.receipt.fullPlanHash!==saved.fullPlanHash)fullReject('prior-full-provenance-unproven');
   const prior=codec.decode(saved.fullPlanText) as OrderStockFullPlan;
   if(prior.version!==1||prior.protocol!==FULL_PROTOCOL||text(prior.owner)!==text(origin.owner)||prior.intent.companyId!==company||prior.intent.orderId!==preview.intent.orderId||prior.intent.requestId!==origin.reference.requestId||text(prior.intent)!==saved.intentText||fullHash(saved.intentText)!==saved.intentHash||!Array.isArray(prior.readSet)||!Array.isArray(prior.effectSet))fullReject('prior-full-provenance-unproven');
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
   sourceLines.set(lineId,{state:persisted,origin});
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
  const legacySource=async(lineId:string,state:OrderItemInventoryState,sourceOrder=order,requireAtomic=false)=>{
   let generation=sourceOrder.productionRecordIndex?.[lineId]?.generation;const marker=sourceOrder.inventoryGenerationCompletion;
   if(requireAtomic){let patch:FullRow|undefined;try{patch=JSON.parse(marker?.requestText).patch;}catch{fullReject('legacy-raw-history-unproven');}if(!hasOrderInventoryGenerationCompletion({...sourceOrder,id:orderId} as any,marker?.generation)||!state.applied||text(patch?.itemInventory?.[lineId]??null)!==text(state)||!Array.isArray(patch?.items)||patch.items.filter((row:FullRow)=>row.lineId===lineId).length!==1||text(patch.items.find((row:FullRow)=>row.lineId===lineId))!==text(sourceOrder.items?.find((row:FullRow)=>row.lineId===lineId))||patch.items.find((row:FullRow)=>row.lineId===lineId)?.checked!==true)fullReject('legacy-raw-history-unproven');}
   if(!generation&&marker?.generation?.startedAt===state.completedAt){const patch=JSON.parse(marker.requestText).patch;if(text(patch.itemInventory?.[lineId]??null)===text(state)&&patch.itemInventory?.[lineId]?.applied===true)generation=marker.generation;}
   if(!generation){
    const production=state.production,empty=(value:any)=>Array.isArray(value)&&value.length===0;
    const zero=Object.prototype.hasOwnProperty.call(production,'rawCalculationEvidence')&&empty(production.rawCalculationEvidence)&&[state.rawConsumedLots,production.rawConsumedLots,production.rawLedgerIds,production.stockDeltas,production.productProducedLots,production.productConsumedLots,state.autoBuilt,state.producedUnits].every(empty);
    const patch=marker?JSON.parse(marker.requestText).patch:undefined;
    if(!requireAtomic&&!sourceOrder.productionRecordIndex?.[lineId]&&!state.rawEffectOrigin&&zero&&text(patch?.itemInventory?.[lineId]??null)===text(state))return [];
    fullReject('legacy-raw-history-unproven');
   }
   if(generation.companyId!==company||generation.orderId!==preview.intent.orderId||generation.startedAt!==state.completedAt)fullReject('legacy-raw-history-unproven');
   const jobId=orderRawBatchJobId(generation);let cached=legacyJobs.get(jobId);
   if(!cached){
    const job=await readHistoricalEvidence('rawInventoryJobs/'+jobId);if(!job)fullReject('legacy-raw-history-unproven');let request:OrderRawBatchRequest;
    try{request=readOrderRawBatchJobRequest(job);}catch{fullReject('legacy-raw-history-unproven');}
    if(!sameOrderInventoryGeneration(request!.generation,generation)||!Array.isArray(request!.plan.lines))fullReject('legacy-raw-history-unproven');
    const reads=[];
    for(const {command}of request!.commands){
     const movement=await readPast('rawMaterialLedger/'+operationDocId(command.operationId)),legacyId=legacyOperationDocId(command.operationId),old=legacyId===operationDocId(command.operationId)?undefined:await readPast('rawMaterialLedger/'+legacyId),state=await readPast('rawInventories/'+inventoryDocId(company,command.rawItemId)),item=await readPast('items/'+command.rawItemId),snap=(row:any)=>({exists:()=>row!==undefined,data:()=>row});
     reads.push({movementSnap:snap(movement),oldMovementSnap:legacyId===operationDocId(command.operationId)?null:snap(old),stateSnap:snap(state),itemSnap:snap(item)});
    }
    if(orderRawBatchProofProblem(job,request!,reads,await orderRawBatchRequestHash(request!)))fullReject('legacy-raw-proof-conflict');
    const covered=new Set<number>(),lineIds=new Set<string>();
    for(const row of request!.plan.lines as FullRow[]){
     if(typeof row.lineId!=='string'||lineIds.has(row.lineId)||!Number.isSafeInteger(row.attempt)||row.attempt<1||!Array.isArray(row.commandIndices))fullReject('legacy-command-index-unproven');lineIds.add(row.lineId);
     for(const index of row.commandIndices){const command=request!.commands[index]?.command;
      if(!Number.isSafeInteger(index)||index<0||!command||covered.has(index)||command.operationId!==(command.kind==='ledger-consume'?'production-ledger':'production')+':'+preview.intent.orderId+':'+row.lineId+':a'+row.attempt+':'+command.rawItemId)fullReject('legacy-command-index-unproven');covered.add(index);
     }
    }
    if(covered.size!==request!.commands.length)fullReject('legacy-command-index-unproven');cached={request:request!,job};legacyJobs.set(jobId,cached);
   }
   if(sourceOrder.productionRecordIndex?.[lineId]&&sourceOrder.productionRecordIndex[lineId].requestHash!==cached.job.requestHash)fullReject('legacy-record-request-conflict');
   const matches=(cached.request.plan.lines as FullRow[]).filter(row=>row.lineId===lineId);
   if(matches.length!==1||matches[0].attempt!==state.attempt||text(matches[0].rowDeltas)!==text(state.production.stockDeltas)||text(matches[0].bomLines)!==text(state.production.bomLines)||text(matches[0].production.rawCalculationEvidence??null)!==text(state.production.rawCalculationEvidence??null)||text(matches[0].production.autoBuilt)!==text(state.autoBuilt)||text(matches[0].production.producedUnits)!==text(state.producedUnits))fullReject('legacy-line-snapshot-unproven');
   const indices=matches[0].commandIndices as number[],traces=indices.flatMap(index=>orderRawTracesFromMovement(cached!.request.commands[index].command,cached!.job.results[index].movement));
   if(text(traces)!==text(state.rawConsumedLots))fullReject('legacy-line-snapshot-unproven');if(requireAtomic)sourceLines.set(lineId,{state,sourceLegacy:{kind:'legacy-atomic-v1',generation,jobId,requestHash:cached.job.requestHash,lineId,attempt:state.attempt,sourceLineNativeSha256:fullHash(text(state)),completionNativeSha256:fullHash(text(marker))}});return indices.map(index=>({operationId:cached!.request.commands[index].command.operationId,rawItemId:cached!.request.commands[index].command.rawItemId,command:cached!.request.commands[index].command}));
  };

 const verifyCurrentLineHistory=async(legacyReversalLineId?:string)=>{order=(await read('orders/'+orderId))!;fullUsable(order,company,orderId);
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
    }else{operations=state.rawEffectOrigin?await fullSource(lineId,state):await legacySource(lineId,state,order,lineId===legacyReversalLineId);
     if(state.rawReversalOrigin){if(state.applied||!state.rawEffectOrigin)fullReject('invalid-full-reversal-origin');await verifyFullReversal(lineId,state);}
    }
    const verified: {operationId:string;rawItemId:string;original:FullRow;movement:ReturnType<typeof normalizeRawMovement>}[]=[];operationsByLine.set(lineId,verified);
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
   }
  }

 return {order,states:lineBasis.currentStates,operationsByLine,sourceLines};
 };

 return {tx:nativeTx as Pick<Transaction,'get'>,get nativeFailure(){return nativeFailure;},readNative:read,readPast,readHistoricalDigest:readHistoricalEvidence,readPredecessor:predecessor,get readSet(){return [...evidence.values()];},get historyQueries(){return [...historyQueries.values()];},native:original as ReadonlyMap<string,FullRow|undefined>,verifyCurrentLineHistory};
}
