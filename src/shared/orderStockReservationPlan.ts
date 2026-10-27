import type {ItemInventoryReservation} from './types';

export const stock3 = (value: number) => Math.round(value * 1000) / 1000;
const RESERVATION_TTL_MS = 60 * 60 * 1000;

export const liveItemInventoryReservations = (value: unknown, nowMs = Date.now()): ItemInventoryReservation[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is ItemInventoryReservation => {
    if (!row || typeof row !== 'object') return false;
    const candidate = row as Partial<ItemInventoryReservation>;
    const createdAt = Date.parse(candidate.createdAt ?? '');
    if (typeof candidate.operationId !== 'string' || typeof candidate.orderId !== 'string' ||
      !Number.isFinite(candidate.qty) || Number(candidate.qty) <= 0 || !Number.isFinite(createdAt)) return false;
    // 배정 완료분은 실제 출고나 주문 취소까지 주문 몫이다. 처리 중 브라우저가 닫힌 흔적만 만료한다.
    return candidate.state === 'allocated' || nowMs - createdAt < RESERVATION_TTL_MS;
  });
};

/** 예약과 사전검사가 같은 전체 가용량·부족 판정을 쓴다. 이 함수는 저장하지 않는다. */
export function planOrderStockReservation(orderId:string, dataByItem:ReadonlyMap<string,Record<string,any>>, planDeltas:(stock:ReadonlyMap<string,number>)=>ReadonlyMap<string,number>, options:{preserveOwnAllocation?:boolean;nowMs?:number}={}) {
 const activeByItem=new Map<string,ItemInventoryReservation[]>(),previousReservations=new Map<string,ItemInventoryReservation[]>(),available=new Map<string,number>();
 const nowMs=options.nowMs??Date.now();
 for(const [itemId,data] of dataByItem){
  const active=liveItemInventoryReservations(data.inventoryReservations,nowMs),own=active.filter(row=>row.orderId===orderId),others=active.filter(row=>row.orderId!==orderId);
  previousReservations.set(itemId,own);activeByItem.set(itemId,others);
  const ownAllocated=options.preserveOwnAllocation?own.filter(row=>row.state==='allocated').reduce((sum,row)=>sum+Number(row.qty),0):0;
  available.set(itemId,stock3(Math.max(0,Number(data.stock??0)-others.reduce((sum,row)=>sum+Number(row.qty),0)-ownAllocated)));
 }
 const planned=planDeltas(available),outside=[...planned.keys()].filter(id=>!available.has(id));
 if(outside.length)throw Error('주문 재고 예약 범위에 없는 품목이 계산되었습니다: '+outside.join(', '));
 const quantities=new Map<string,number>(),shortages:{itemId:string;current:number;other:number;required:number;missing:number}[]=[];
 for(const [itemId,data] of dataByItem){
  const previousQty=options.preserveOwnAllocation?(previousReservations.get(itemId)??[]).filter(row=>row.state==='allocated').reduce((sum,row)=>sum+Number(row.qty),0):0;
  const qty=stock3(previousQty+Math.max(0,-(planned.get(itemId)??0))),current=Number(data.stock??0),other=(activeByItem.get(itemId)??[]).reduce((sum,row)=>sum+Number(row.qty),0);
  if(qty>0){quantities.set(itemId,qty);if(stock3(current-other-qty)<0)shortages.push({itemId,current,other:stock3(other),required:qty,missing:stock3(qty+other-current)});}
 }
 return {activeByItem,previousReservations,available,quantities,shortages};
}
