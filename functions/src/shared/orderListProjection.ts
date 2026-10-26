/** Rules에도 그대로 이식할 보수적인 UTC 형식: 말일은 누락 방지를 위해 후보로 남긴다. */
export const ORDER_LIST_CANONICAL_UTC_PATTERN = '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|1[0-9]|2[0-8])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{3}Z$';
const canonicalUtc = new RegExp(ORDER_LIST_CANONICAL_UTC_PATTERN);
const SENTINEL = '9999-12-31';
export type OrderListProjectionV1 = Readonly<{version:1;candidateDay:string}>;
export function isCanonicalOrderListUtc(value:unknown):value is string {
  return typeof value === 'string' && canonicalUtc.exec(value)?.[0] === value;
}
export function deriveOrderListProjection(order:Readonly<Record<string,unknown>>):OrderListProjectionV1 {
  const bounded = order.status === 'DELIVERED' && isCanonicalOrderListUtc(order.deliveredAt)
    && isCanonicalOrderListUtc(order.deliveryDate) && isCanonicalOrderListUtc(order.createdAt);
  return {version:1,candidateDay:bounded ? (order.deliveredAt as string).split('T')[0] : SENTINEL};
}
function calendarDay(value:unknown):value is string {
  if(typeof value !== 'string' || !/^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(value))return false;
  const [year,month,day]=value.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year && date.getUTCMonth()===month-1 && date.getUTCDate()===day;
}
export function orderListCandidateFloor(cutoffDay:string):string {
  if(!calendarDay(cutoffDay))throw Error('올바른 주문 조회 기준일을 확인해 주세요.');
  const [year,month,day]=cutoffDay.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day));
  date.setUTCDate(date.getUTCDate()-2);
  if(date.getUTCFullYear()<1000)throw Error('주문 조회 후보 날짜가 지원 범위를 벗어났습니다.');
  return date.toISOString().slice(0,10);
}
/** 후보는 넓게 읽고 원래 status/완료일 fallback 필터로 최종 표시한다. */
export function isOrderListServerCandidate(_order:Readonly<Record<string,unknown>>,projection:OrderListProjectionV1,floor:string):boolean {
  if(!calendarDay(floor))throw Error('올바른 주문 조회 후보 하한을 확인해 주세요.');
  return !!projection && projection.version===1 && calendarDay(projection.candidateDay) && projection.candidateDay>=floor;
}
