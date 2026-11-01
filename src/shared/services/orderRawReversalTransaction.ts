import {doc, type Firestore, type Transaction} from 'firebase/firestore';
import {readRawCommandInTransaction,prepareRawCommand,normalizeRawMovement} from './rawInventoryService';
import {buildPreparedRawWritePlan} from '../../../functions/src/shared/rawPreparedWritePlan';
import {protectInventoryWriterPatch,protectItemInventoryPatch} from '../inventoryWriterProtocol';
import type {RawInventoryState} from '../rawInventoryCore';
import type {buildOrderRawReversalPlan} from '../../features/admin/orderRawInventory';

type Plan=NonNullable<ReturnType<typeof buildOrderRawReversalPlan>>;
const protectedFields=['fullEffectAuthority','orderManualCorrectionEffectAuthority'] as const;
/** 서버 전용 효과는 값이 null이어도 클라이언트 역처리로 승격하지 않는다. */
export function assertLegacyReversalAuthority(data:Record<string,unknown>|undefined){
 if(data&&protectedFields.some(key=>Object.prototype.hasOwnProperty.call(data,key)))throw Error('서버 전용 재고 효과입니다. 기존 서버 복구 경로에서 확인해 주세요.');
}

/** 원료의 모든 원문을 먼저 읽고 순서대로 준비한다. 호출자가 모든 품목 검증을 마친 뒤 write한다. */
export async function prepareOrderRawReversal(tx:Transaction,db:Firestore,plan:Plan,productItemIds:ReadonlySet<string>){
 if(!plan.commands.length||new Set(plan.commands.map(row=>row.command.operationId)).size!==plan.commands.length)throw Error('원료 역처리 명령이 중복되었거나 비어 있습니다.');
 if(plan.commands.some(row=>row.command.kind!=='reverse'||row.command.companyId!==plan.companyId||row.command.source.type!=='reversal'||row.command.source.id!==plan.source.id||productItemIds.has(row.command.rawItemId)))throw Error('원료와 품목 역처리 경로가 겹치거나 회사가 다릅니다.');
 const jobRef=doc(db,'rawInventoryJobs',plan.jobId),jobSnap=await tx.get(jobRef);
 if(jobSnap.exists())throw Error('기존 원료 역처리 작업을 자동 승계하지 않습니다. 원문을 확인해 주세요.');
 const reads=await Promise.all(plan.commands.map(row=>readRawCommandInTransaction(tx,db,row.command)));
 const virtual=new Map<string,{state:RawInventoryState;itemData:Record<string,any>}>();
 const prepared:{read:typeof reads[number];plan:ReturnType<typeof buildPreparedRawWritePlan>;state:ReturnType<ReturnType<typeof buildPreparedRawWritePlan>['state']>;movement:ReturnType<ReturnType<typeof buildPreparedRawWritePlan>['movement']>;guard:ReturnType<ReturnType<typeof buildPreparedRawWritePlan>['guard']>;itemPatch:Record<string,unknown>|undefined}[]=[];
 for(let i=0;i<plan.commands.length;i++){
  const row=plan.commands[i],read=reads[i],c=row.command;
  for(const snap of [read.movementSnap,read.oldMovementSnap,read.stateSnap,read.itemSnap,read.originalSnap,read.oldOriginalSnap,read.guardSnap])if(snap?.exists())assertLegacyReversalAuthority(snap.data());
  if(read.guardSnap?.exists())throw Error('기존 원료 역처리 근거가 있어 자동 승계하지 않습니다.');
  if(read.originalSnap?.exists()&&read.oldOriginalSnap?.exists())throw Error('원료 원본이 중복되어 자동 역처리할 수 없습니다.');
  const original=read.originalSnap?.exists()?read.originalSnap:read.oldOriginalSnap;
  if(!original?.exists())throw Error('원료 원본 이력을 찾을 수 없습니다.');
  const origin=normalizeRawMovement(original.data()!);
  if(!(origin.source?.type==='production'||origin.source?.type==='oem'&&origin.kind==='ledger-consume')||origin.source.id!==plan.source.id||!origin.commandHash||origin.operationId!==(c.kind==='reverse'?c.originalOperationId:''))throw Error('원료 원본 명령과 주문의 연결을 확인해 주세요.');
  const result=prepareRawCommand(c,read,{...row.options,now:plan.now},virtual.get(c.rawItemId));
  if(result.status!=='applied')throw Error('원료 역처리 근거를 확인해 주세요: '+result.status+(result.status==='rejected'?' '+result.code:''));
  const write=buildPreparedRawWritePlan(c,read,result,row.options),state=write.state(),movement=write.movement(),guard=write.hasGuard()?write.guard():undefined,itemPatch=write.itemPatch();
  const previous=virtual.get(c.rawItemId)?.itemData??read.itemSnap.data()!;
  virtual.set(c.rawItemId,{state:result.state,itemData:{...previous,...itemPatch}});
  prepared.push({read,plan:write,state,movement,guard,itemPatch});
 }
 return {write(){
  const last=new Map<string,typeof prepared[number]>();
  for(let i=0;i<prepared.length;i++){const p=prepared[i];last.set(plan.commands[i].command.rawItemId,p);tx.set(p.read.movementRef,protectInventoryWriterPatch(p.read.movementSnap.exists()?p.read.movementSnap.data():undefined,p.movement));if(p.guard)tx.set(p.read.guardRef,protectInventoryWriterPatch(p.read.guardSnap?.exists()?p.read.guardSnap.data():undefined,p.guard));}
  for(const [id,p] of last){const first=reads.find((_,i)=>plan.commands[i].command.rawItemId===id)!;tx.set(p.read.stateRef,protectInventoryWriterPatch(first.stateSnap.exists()?first.stateSnap.data():undefined,{...first.stateSnap.data(),...p.state}));const final=virtual.get(id)!;if(prepared.some((entry,i)=>plan.commands[i].command.rawItemId===id&&entry.itemPatch))tx.update(p.read.itemRef,protectItemInventoryPatch(first.itemSnap.data(),{stock:final.itemData.stock,lots:final.itemData.lots}));}
  tx.set(jobRef,protectInventoryWriterPatch(undefined,{id:plan.jobId,companyId:plan.companyId,source:plan.source,expectedOperationIds:plan.commands.map(row=>row.command.operationId),status:'complete',createdAt:plan.now,completedAt:plan.now}));
 }};
}
