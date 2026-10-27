import {describe,expect,it,vi} from 'vitest';
import {liveItemInventoryReservations,planOrderStockReservation,stock3} from './orderStockReservationPlan';
import type {ItemInventoryReservation} from './types';

const now=Date.parse('2026-10-27T05:00:00.000Z'),hour=60*60*1000;
const row=(overrides:Partial<ItemInventoryReservation>={}):ItemInventoryReservation=>({operationId:'operation',orderId:'other',qty:2,createdAt:new Date(now).toISOString(),state:'processing',...overrides});

describe('DB에 의존하지 않는 주문 예약 판단',()=>{
 it('처리 예약은 한시간 직전까지 살고 정각에 만료된다',()=>{
  const before=row({createdAt:new Date(now-hour+1).toISOString()}),at=row({createdAt:new Date(now-hour).toISOString()}),expired=row({createdAt:new Date(now-hour-1).toISOString()});
  expect(liveItemInventoryReservations([before,at,expired],now)).toEqual([before]);
 });
 it('확정 배정은 오래되어도 유지하고 미래 처리 시각도 기존대로 유지한다',()=>{
  const allocated=row({state:'allocated',createdAt:'2020-01-01T00:00:00.000Z'}),future=row({createdAt:new Date(now+hour).toISOString()});
  expect(liveItemInventoryReservations([allocated,future],now)).toEqual([allocated,future]);
 });
 it('무효행만 제외하고 유효행의 순서·동일 객체·추가 필드를 보존한다',()=>{
  const generation={contractVersion:1 as const,companyId:'taebaek' as const,orderId:'other',operationId:'operation',actorUid:'actor',startedAt:'2026-10-27T00:00:00.000Z'};
  const a=Object.freeze({...row(),generation,unknown:{tag:'보존'}}),b=Object.freeze(row({qty:3,operationId:''}));
  const input=Object.freeze([null,{},a,row({qty:0}),row({qty:-1}),row({qty:NaN}),row({createdAt:'잘못된 날짜'}),b]);
  const live=liveItemInventoryReservations(input,now);
  expect(live).toEqual([a,b]);expect(live[0]).toBe(a);expect(live[1]).toBe(b);expect((live[0] as typeof a).unknown).toEqual({tag:'보존'});expect(input).toHaveLength(8);
 });
 it.each([undefined,null,{},'문자열'])('배열 아닌 입력 %s는 비어 있는 예약이다',value=>{
  expect(liveItemInventoryReservations(value,now)).toEqual([]);
 });
 it('기본 시각은 Date.now를 사용하며 명시 시각과 같은 경계를 계산한다',()=>{
  vi.spyOn(Date,'now').mockReturnValue(now);
  const input=[row({createdAt:new Date(now-hour).toISOString()}),row()];
  expect(liveItemInventoryReservations(input)).toEqual(liveItemInventoryReservations(input,now));
  const data=new Map([['a',{stock:10,inventoryReservations:input}]]);
  const plan=(stock:ReadonlyMap<string,number>)=>new Map([['a',-stock.get('a')!]]);
  expect(planOrderStockReservation('mine',data,plan)).toEqual(planOrderStockReservation('mine',data,plan,{nowMs:now}));
 });
 it.each([false,true])('자기 확정 배정 보존 %s에 따라 기존 가용량과 필요한 예약을 계산한다',preserveOwnAllocation=>{
  const other=row({qty:3}),ownAllocated=row({orderId:'mine',qty:4,state:'allocated'}),ownProcessing=row({orderId:'mine',qty:2});
  const data=Object.freeze({stock:12,inventoryReservations:Object.freeze([other,ownAllocated,ownProcessing]),extra:'유지'}),input=new Map([['a',data]]);
  const plan=vi.fn((available:ReadonlyMap<string,number>)=>new Map([['a',-Math.min(5,available.get('a')!)]]));
  const result=planOrderStockReservation('mine',input,plan,{nowMs:now,preserveOwnAllocation});
  expect(plan).toHaveBeenCalledTimes(1);expect([...plan.mock.calls[0][0]]).toEqual([['a',preserveOwnAllocation?5:9]]);
  expect([...result.available]).toEqual([['a',preserveOwnAllocation?5:9]]);expect([...result.quantities]).toEqual([['a',preserveOwnAllocation?9:5]]);
  expect(result.activeByItem.get('a')).toEqual([other]);expect(result.previousReservations.get('a')).toEqual([ownAllocated,ownProcessing]);expect(result.shortages).toEqual([]);
  expect(input.get('a')).toBe(data);expect(data.inventoryReservations).toEqual([other,ownAllocated,ownProcessing]);
 });
 it('다른 주문 몫과 자기 확정 배정을 포함한 부족량을 세자리로 계산한다',()=>{
  const input=new Map([['a',{stock:10,inventoryReservations:[row({qty:3}),row({orderId:'mine',state:'allocated',qty:4})]}]]);
  const result=planOrderStockReservation('mine',input,()=>new Map([['a',-5.1234]]),{preserveOwnAllocation:true,nowMs:now});
  expect([...result.available]).toEqual([['a',3]]);expect([...result.quantities]).toEqual([['a',9.123]]);
  expect(result.shortages).toEqual([{itemId:'a',current:10,other:3,required:9.123,missing:2.123}]);
 });
 it('소모 없는 증가와 미계산 품목은 예약을 만들지 않고 입력 순서를 유지한다',()=>{
  const input=new Map([['b',{stock:2}],['a',{stock:1}],['c',{stock:3}]]);
  const result=planOrderStockReservation('mine',input,()=>new Map([['a',2],['b',0]]),{nowMs:now});
  expect([...result.available]).toEqual([['b',2],['a',1],['c',3]]);expect([...result.quantities]).toEqual([]);expect(result.shortages).toEqual([]);
 });
 it('예약 범위 밖 품목은 원래 오류로 거절하고 콜백은 한번만 실행한다',()=>{
  const plan=vi.fn(()=>new Map([['outside',-1]]));
  expect(()=>planOrderStockReservation('mine',new Map([['a',{stock:1}]]),plan,{nowMs:now})).toThrow('주문 재고 예약 범위에 없는 품목이 계산되었습니다: outside');
  expect(plan).toHaveBeenCalledTimes(1);
 });
 it('계획 콜백 예외를 같은 객체로 전달하고 입력을 변경하지 않는다',()=>{
  const failure=new Error('계획 중단'),input=new Map([['a',Object.freeze({stock:10})]]),plan=vi.fn(()=>{throw failure;});
  let caught:unknown;try{planOrderStockReservation('mine',input,plan,{nowMs:now});}catch(error){caught=error;}
  expect(caught).toBe(failure);expect(plan).toHaveBeenCalledTimes(1);expect([...input]).toEqual([['a',{stock:10}]]);
 });
 it('공용 수량 반올림은 기존 세자리 식을 유지한다',()=>{
  expect([stock3(1.2344),stock3(1.2345),stock3(-1.2345),stock3(0.0004)]).toEqual([1.234,1.235,-1.234,0]);
 });
});
