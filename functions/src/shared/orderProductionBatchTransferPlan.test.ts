import { describe, expect, it } from 'vitest';
import type { BatchAssignment, BatchReference } from './orderProductionBatchContract';
import { planBatchAssignmentTransfer } from './orderProductionBatchTransferPlan';

const reference: BatchReference = {version:1, companyId:'taebaek', orderId:'root', requestId:'pb1-12345678-1234-4234-8234-123456789abc'};
const h = 'a'.repeat(64);
const make = (batchId = 'batch', lineId = '__proto__'): BatchAssignment => ({kind:'assignment',version:1,companyId:'taebaek',batchId,source:{reference,ownerUid:'owner'},revision:0,createdAt:'now',state:'active',lastTransfer:null,outputs:[{outputId:'out',role:'customer',itemId:'item',originOrderId:'root',originLineId:lineId,quantityMilli:4000,unit:{version:1,measureId:h,order:{kind:'box-count',label:'box',orderedValue:4},sourceLine:{quantity:48,isBoxUnit:true,boxQuantity:4,unitsPerBox:12},stock:{itemId:'item',label:'box',quantityKind:'count',orderedValue:4,unitsPerOrderUnit:1},basis:{kind:'box-stock-bom',orderUnitEvidenceHash:h,catalogEvidenceHash:h}},productionEvidence:{sourcePlanRowId:'source',rawOperationIds:['raw'],productionRecordIds:['record'],producedLots:[{itemId:'item',lotId:'lot',qty:1}]},claims:[{orderId:'root',lineId,fromMilli:0,toMilli:4000,state:'allocated',lastReference:reference}]},{outputId:'extra',role:'stock-only',itemId:'extra',originOrderId:'root',originLineId:null,quantityMilli:3000,unit:{version:1,measureId:h,stock:{itemId:'extra',label:'stock',quantityKind:'count'},basis:{kind:'item-stock',catalogEvidenceHash:h}},productionEvidence:{sourcePlanRowId:'extra-source',rawOperationIds:[],productionRecordIds:[],producedLots:[]},claims:[]}]});
const run = (assignments: BatchAssignment[], moves = [{lineId:'__proto__',moveCompletedMilli:2000}]) => planBatchAssignmentTransfer({reference,ownerUid:'owner',at:'later',sourceOrderId:'root',childOrderId:'child',assignments,moves});

describe('완료 지분 분할', () => {
 it('4박스 중 2박스를 child로 옮기고 원본과 생산 증거를 보존한다', () => {
  const original = make(), before = structuredClone(original), result = run([original]);
  const output = result.assignmentsAfter[0].outputs.find(x=>x.outputId==='out')!;
  expect(output.claims.map(c=>[c.orderId,c.lineId,c.fromMilli,c.toMilli])).toEqual([['child','__proto__',0,2000],['root','__proto__',2000,4000]]);
  expect(output.productionEvidence).toEqual(before.outputs[0].productionEvidence);
  expect(result.assignmentsAfter[0].outputs.find(x=>x.outputId==='extra')!.claims).toEqual([]);
  expect(original).toEqual(before);
 });
 it('주문 4박스 중 완료 2박스 전부를 child에 넘기면 root 완료는 0이다', () => {
  const a=make(); a.outputs[0].quantityMilli=2000; a.outputs[0].claims[0].toMilli=2000;
  const before=structuredClone(a), result=run([a]);
  const customer=result.assignmentsAfter[0].outputs.find(x=>x.outputId==='out')!;
  expect(customer.unit).toEqual(before.outputs[0].unit);
  expect(customer.productionEvidence).toEqual(before.outputs[0].productionEvidence);
  expect(customer.claims.filter(c=>c.orderId==='child').reduce((sum,c)=>sum+c.toMilli-c.fromMilli,0)).toBe(2000);
  expect(customer.claims.filter(c=>c.orderId==='root' && c.state==='allocated').reduce((sum,c)=>sum+c.toMilli-c.fromMilli,0)).toBe(0);
  expect(result.assignmentsAfter[0].outputs.find(x=>x.outputId==='extra')!.claims).toEqual([]);
  expect(a).toEqual(before);
 });
 it('여러 batch와 뒤섞인 출력 순서에서 같은 앞 구간을 선택한다', () => {
  const a=make('a'), b=make('b');
  const x=run([b,a],[{lineId:'__proto__',moveCompletedMilli:5000}]);
  const y=run([{...a,outputs:[...a.outputs].reverse()},{...b,outputs:[...b.outputs].reverse()}],[{lineId:'__proto__',moveCompletedMilli:5000}]);
  expect(x).toEqual(y); expect(x.transfers.map(t=>[t.batchId,t.fromMilli,t.toMilli])).toEqual([['a',0,4000],['b',0,1000]]);
 });
 it('중복, 틈, 겹침, 부족과 부적절한 수량을 거절한다', () => {
  const a=make();
  expect(()=>run([a,a])).toThrow();
  expect(()=>run([a],[{lineId:'__proto__',moveCompletedMilli:1},{lineId:'__proto__',moveCompletedMilli:1}])).toThrow();
  expect(()=>run([a],[{lineId:'__proto__',moveCompletedMilli:4001}])).toThrow();
  expect(()=>run([a],[{lineId:'__proto__',moveCompletedMilli:-1}])).toThrow();
  for (const ranges of [[[0,1000],[2000,4000]],[[0,3000],[2000,4000]],[[0,5000]]]) {
   const bad=make(); const c=bad.outputs[0].claims[0]; bad.outputs[0].claims=ranges.map(([fromMilli,toMilli])=>({...c,fromMilli,toMilli})); expect(()=>run([bad])).toThrow();
  }
 });
 it('박스 단위는 지분과 이동량이 온전한 박스여야 하며 낱개 단위 소수량은 유지한다', () => {
  expect(()=>run([make()],[{lineId:'__proto__',moveCompletedMilli:500}])).toThrow();
  const badTotal=make(); badTotal.outputs[0].quantityMilli=3500; badTotal.outputs[0].claims[0].toMilli=3500; expect(()=>run([badTotal])).toThrow();
  const badBoundary=make(); const c=badBoundary.outputs[0].claims[0]; badBoundary.outputs[0].claims=[{...c,toMilli:1500},{...c,fromMilli:1500}]; expect(()=>run([badBoundary])).toThrow();
  const loose=make(); const output=loose.outputs[0]; if ('order' in output.unit) output.unit.order.kind='item-quantity';
  expect(run([loose],[{lineId:'__proto__',moveCompletedMilli:500}]).transfers[0].toMilli).toBe(500);
 });
 it('출고·해제 지분은 이동하지 않고 서로 다른 불투명 줄을 구분한다', () => {
  const a=make('a','box/1'), b=make('b','loose:1');
  a.outputs[0].claims[0].state='shipped';
  expect(()=>run([a],[{lineId:'box/1',moveCompletedMilli:1}])).toThrow();
  const result=run([a,b],[{lineId:'box/1',moveCompletedMilli:0},{lineId:'loose:1',moveCompletedMilli:1000}]);
  expect(result.transfers[0].childLineId).toBe('loose:1'); expect(result.assignmentsAfter[0]).toEqual(a);
 });
});


