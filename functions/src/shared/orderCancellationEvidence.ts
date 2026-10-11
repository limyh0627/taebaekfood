/** 원자 취소의 승인 원문. 표시명·BOM은 제외하고 실제 수불 근거만 동일하게 직렬화한다. */
export type CancellationEvidenceOrder = {id:string;companyId?:string;status:string;producedAt?:unknown;shippedOut?:unknown;
 items?:readonly {lineId?:unknown;itemId?:unknown;quantity?:unknown;isBoxUnit?:unknown;boxQuantity?:unknown}[];
 inventorySnapshots?:unknown;itemInventory?:unknown;rawConsumedLots?:unknown;productConsumedLots?:unknown};
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
 ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,val])=>[key,canonical(val)])):value;
export function cancellationEvidenceText(order:CancellationEvidenceOrder,action:'cancel-shipment'|'delete'):string{
 return JSON.stringify(canonical({action,id:order.id,companyId:order.companyId??'taebaek',status:order.status,
  producedAt:order.producedAt??'',shippedOut:!!order.shippedOut,
  items:(order.items??[]).map(row=>({lineId:row.lineId??'',itemId:row.itemId,quantity:row.quantity,isBoxUnit:!!row.isBoxUnit,boxQuantity:row.boxQuantity??null})),
  inventorySnapshots:order.inventorySnapshots??null,itemInventory:order.itemInventory??null,
  rawConsumedLots:order.rawConsumedLots??[],productConsumedLots:order.productConsumedLots??[]}));
}
export type LockRecoveryAssessment={status:'ready'|'blocked';inventoryApplied:'none'|'unknown'|'complete';reason?:string;action?:'cancel-shipment'|'delete'};
/** 빈 실패 감사만으로 미반영을 단정하지 않는다. 원자 취소의 완료표와 승인 원문만 판정한다. */
export function assessCancellationLockRecovery(input:{order:CancellationEvidenceOrder&{inventoryOperation?:{id?:string;state?:string;kind?:string;stage?:string;targetStatus?:string}|null};failedOperationId:string;evidenceHash:string;completionExists:boolean}):LockRecoveryAssessment{
 const {order,failedOperationId,evidenceHash,completionExists}=input,operation=order.inventoryOperation;
 if(completionExists)return {status:'blocked',inventoryApplied:'complete',reason:'COMPLETION_RECEIPT_PRESENT'};
 if(!operation||operation.id!==failedOperationId)return {status:'blocked',inventoryApplied:'unknown',reason:'OPERATION_CHANGED'};
 if(operation.state!=='failed')return {status:'blocked',inventoryApplied:'unknown',reason:'OPERATION_NOT_FAILED'};
 const action=operation.targetStatus==='DISPATCHED'?'cancel-shipment':operation.targetStatus==='PENDING'?'delete':null;
 if(!action||operation.kind!=='status'||operation.stage!=='final-stock')return {status:'blocked',inventoryApplied:'unknown',reason:'LEGACY_OPERATION_UNPROVEN'};
 const prefix=`order-cancellation-${action}-${order.id}-`;
 if(!failedOperationId.startsWith(prefix)||!/^[a-f0-9]{64}$/.test(failedOperationId.slice(prefix.length)))return {status:'blocked',inventoryApplied:'unknown',reason:'LEGACY_OPERATION_UNPROVEN'};
 if(failedOperationId!==prefix+evidenceHash)return {status:'blocked',inventoryApplied:'unknown',reason:'APPROVAL_EVIDENCE_CHANGED'};
 if(!['PENDING','PROCESSING','DISPATCHED','SHIPPED','DELIVERED','ON_HOLD'].includes(order.status)
  ||action==='cancel-shipment'&&order.status!=='SHIPPED'||action==='delete'&&order.status==='SHIPPED')return {status:'blocked',inventoryApplied:'unknown',reason:'ORDER_STATUS_CHANGED'};
 return {status:'ready',inventoryApplied:'none',action};
}
