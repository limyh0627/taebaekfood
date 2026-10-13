/** 서버와 앱이 같은 업무 필드를 고른다. 기존 직렬화 함수를 받아 최초 요청 해시를 바꾸지 않는다. */
export function selectOrderRawBatchOrderEvidence(order:Record<string,any>,text:(value:any)=>string):string{
 const items=order.items.map(({checkedAt,checkedBy,...row}:Record<string,any>)=>row);
 return text({id:order.id,companyId:order.companyId,status:order.status,items,producedAt:order.producedAt,shippedOut:order.shippedOut,deliveredAt:order.deliveredAt,rawInventoryAttempt:order.rawInventoryAttempt,itemInventory:order.itemInventory,inventorySnapshots:order.inventorySnapshots,rawConsumedLots:order.rawConsumedLots,purpose:order.purpose});
}
/** 옛 사본을 보관할 때 현 작업의 정상 세대는 건드리지 않는다. 판독 불가·옛 세대 재활성은 차단한다. */
export function assertArchiveOldGenerationAbsent(order:Record<string,any>|undefined,g:{operationId:string;startedAt:string;actorUid:string}):void{
 const op=order?.inventoryOperation;if(op==null)return;
 const identity=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=512&&value.trim()===value&&!value.includes('/');
 if(typeof op!=='object'||op.contractVersion!==1||![op.id,op.startedAt,op.actorUid].every(identity)||!Number.isFinite(Date.parse(op.startedAt)))throw Error('현재 주문 작업의 세대를 판독할 수 없습니다. 원문을 보존했습니다.');
 if(op.id===g.operationId&&op.startedAt===g.startedAt&&op.actorUid===g.actorUid)throw Error('옛 최초 작업이 현재 다시 활성화되어 보관만으로 끝내지 않았습니다.');
}
