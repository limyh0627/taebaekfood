import {deriveOrderListProjection,type OrderListProjectionV1} from './orderListProjection';
export interface OrderListWriteAdapter {
  isDeleteValue(value:unknown):boolean;
  isTransform(value:unknown):boolean;
}
const dependencies=['status','deliveredAt','deliveryDate','createdAt'];
const has=(value:Readonly<Record<string,unknown>>,key:string)=>Object.prototype.hasOwnProperty.call(value,key);
function valid(value:unknown,expected:OrderListProjectionV1):boolean {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const row=value as Record<string,unknown>;
  return Object.keys(row).length===2 && has(row,'version') && has(row,'candidateDay') && row.version===expected.version && row.candidateDay===expected.candidateDay;
}
/** 업무 원문은 보존하고 실제 postimage로 계산한 조회 메타만 새 사본에 붙인다. */
export function withOrderListProjection(before:Readonly<Record<string,unknown>>|undefined,write:Readonly<Record<string,unknown>>,mode:'create'|'replace'|'patch',adapter?:OrderListWriteAdapter):Record<string,unknown> {
  if(!['create','replace','patch'].includes(mode))throw Error('주문 저장 방식을 확인해 주세요.');
  for(const key of Reflect.ownKeys(write)){
    if(typeof key!=='string'||dependencies.some(field=>key.startsWith(field+'.'))||key.startsWith('orderListProjection.'))throw Error('주문 조회 기준의 하위 경로는 직접 저장할 수 없습니다.');
  }
  const next:Record<string,unknown>=mode==='patch'?{...before,...write}:{...write};
  for(const key of dependencies)if(has(write,key)){
    const value=write[key];
    if(adapter?.isDeleteValue(value)){delete next[key];}
    else if(adapter?.isTransform(value))throw Error('주문 조회 기준의 변환 값을 확정할 수 없습니다.');
  }
  const expected=deriveOrderListProjection(next);
  if(has(write,'orderListProjection')&&!valid(write.orderListProjection,expected))throw Error('주문 조회 메타가 업무 원문과 다릅니다.');
  const changed=dependencies.some(key=>has(write,key));
  if(mode==='patch'&&!changed&&!has(write,'orderListProjection')){
    if(before&&has(before,'orderListProjection')&&!valid(before.orderListProjection,expected))throw Error('기존 주문 조회 메타를 확인해 주세요.');
    return {...write};
  }
  return {...write,orderListProjection:expected};
}
