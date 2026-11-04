import type {planOrderStockReservation} from './orderStockReservationPlan';

export type StockShortageRow=ReturnType<typeof planOrderStockReservation>['shortages'][number];
const SHORTAGE_LIST_LIMIT=10;
const DEFAULT_MESSAGE='재고가 부족해 처리할 수 없습니다. 품목 재고를 확인해 주세요.';

/** 오류 코드는 기존 그대로 'stock-shortage'이고, 어느 품목이 얼마나 부족한지 문장을 덧붙인다. */
export function stockShortageError(rows:readonly StockShortageRow[],itemOf:(itemId:string)=>{name?:unknown;unit?:unknown}|undefined):Error{
 const text=rows.slice(0,SHORTAGE_LIST_LIMIT).map(row=>{const item=itemOf(row.itemId),name=typeof item?.name==='string'&&item.name.trim()?item.name.trim():row.itemId,unit=typeof item?.unit==='string'?item.unit:'';return `${name} ${row.missing}${unit} 부족(재고 ${row.current}${unit}${row.other>0?`, 다른 주문 예약 ${row.other}${unit}`:''})`;}).join(' · ');
 const more=rows.length>SHORTAGE_LIST_LIMIT?` 외 ${rows.length-SHORTAGE_LIST_LIMIT}개 품목`:'';
 return Object.assign(Error('stock-shortage'),{shortageMessage:text?`재고가 부족해 처리할 수 없습니다: ${text}${more}`:DEFAULT_MESSAGE});
}

/** 원료 계산의 INSUFFICIENT_STOCK 거절은 현재 재고·사용량·부족량을 이미 문장으로 주므로 원료 이름만 붙인다. */
export function rawStockShortageError(item:{name?:unknown}|undefined,rawItemId:string,detail:string):Error{
 const name=typeof item?.name==='string'&&item.name.trim()?item.name.trim():rawItemId;
 return Object.assign(Error('stock-shortage'),{shortageMessage:`재고가 부족해 처리할 수 없습니다: ${name} — ${detail}`});
}

/** stockShortageError가 붙인 문장. 다른 곳에서 난 재고 부족에는 일반 안내를 돌려준다. */
export function stockShortageMessage(error:unknown):string{
 const message=(error as {shortageMessage?:unknown}|null)?.shortageMessage;
 return typeof message==='string'&&message?message:DEFAULT_MESSAGE;
}

export const STOCK_SHORTAGE_NEXT_ACTION='부족한 품목을 입고하거나 재고를 확인한 뒤 다시 시도해 주세요.';
