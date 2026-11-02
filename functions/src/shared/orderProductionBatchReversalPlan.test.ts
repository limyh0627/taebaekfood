import { describe, expect, it } from 'vitest';
import type { BatchAssignment, BatchReference } from './orderProductionBatchContract';
import { planBatchAssignmentReversal } from './orderProductionBatchReversalPlan';
const reference: BatchReference={version:1,companyId:'taebaek',orderId:'root',requestId:'pb1-12345678-1234-4234-8234-123456789abc'};
const h='a'.repeat(64);
const make=():BatchAssignment=>({kind:'assignment',version:1,companyId:'taebaek',batchId:'batch',source:{reference,ownerUid:'owner'},revision:1,createdAt:'now',state:'active',lastTransfer:null,outputs:[{outputId:'customer',role:'customer',itemId:'item',originOrderId:'root',originLineId:'line',quantityMilli:2000,unit:{version:1,measureId:h,order:{kind:'box-count',label:'box',orderedValue:2},sourceLine:{quantity:2},stock:{itemId:'item',label:'box',quantityKind:'count',orderedValue:2,unitsPerOrderUnit:1},basis:{kind:'item-unit',orderUnitEvidenceHash:h,catalogEvidenceHash:h}},productionEvidence:{sourcePlanRowId:'source',rawOperationIds:['raw'],productionRecordIds:['record'],producedLots:[{itemId:'item',lotId:'lot',qty:1}]},claims:[{orderId:'root',lineId:'line',fromMilli:0,toMilli:1000,state:'allocated',lastReference:reference},{orderId:'child',lineId:'line',fromMilli:1000,toMilli:2000,state:'released',lastReference:reference}]},{outputId:'stock',role:'stock-only',itemId:'extra',originOrderId:'root',originLineId:null,quantityMilli:3000,unit:{version:1,measureId:h,stock:{itemId:'extra',label:'stock',quantityKind:'count'},basis:{kind:'item-stock',catalogEvidenceHash:h}},productionEvidence:{sourcePlanRowId:'extra',rawOperationIds:[],productionRecordIds:[],producedLots:[]},claims:[]}]});
const run=(assignment:BatchAssignment)=>planBatchAssignmentReversal({reference,ownerUid:'owner',at:'later',assignment});
describe('전체 생산 역처리 요구자료',()=>{
 it('할당만 해제하고 이미 해제된 지분은 중복 해제하지 않으며 모든 생산 증거를 요구한다',()=>{
  const a=make(),before=structuredClone(a),result=run(a);
  expect(result.allocationReleases).toEqual([{orderId:'root',lineId:'line',outputId:'customer',fromMilli:0,toMilli:1000}]);
  expect(result.assignmentAfter.outputs[0].claims.map(c=>c.state)).toEqual(['reversed','reversed']);
  expect(result.requiredOutputReversals).toEqual(before.outputs.map(({outputId,role,itemId,productionEvidence})=>({outputId,role,itemId,productionEvidence})));
  expect(before.outputs[0].quantityMilli).toBe(2000);
  // 완료 2 중 기존 재고 1은 생산 효과가 아니므로 원생산 1의 증거만 전달한다.
  expect(result.requiredOutputReversals[0].productionEvidence.producedLots[0].qty).toBe(1);
  expect(result.requiredOutputReversals[0]).not.toHaveProperty('quantityMilli');
  expect(a).toEqual(before);
 });
 it('입력 출력과 지분 순서를 바꿔도 같은 전이를 만든다',()=>{
  const a=make(), b=make(); b.outputs.reverse(); b.outputs.find(x=>x.outputId==='customer')!.claims.reverse();
  expect(run(a)).toEqual(run(b));
 });
 it('하나라도 출고 또는 이미 역처리됐거나 분할이 손상되면 전체를 거절한다',()=>{
  for(const state of ['shipped','reversed'] as const){const a=make();a.outputs[0].claims[1].state=state;expect(()=>run(a)).toThrow();}
  const bad=make();bad.outputs[0].claims[1].fromMilli=1100;expect(()=>run(bad)).toThrow();
 });
 it('처리자와 시각은 비어 있지 않은 문자열이어야 한다',()=>{
  for (const value of [1, {}, '', null]) {
   expect(()=>planBatchAssignmentReversal({reference,ownerUid:value as string,at:'later',assignment:make()})).toThrow();
   expect(()=>planBatchAssignmentReversal({reference,ownerUid:'owner',at:value as string,assignment:make()})).toThrow();
  }
 });
 it('박스 지분에 소수 경계가 있으면 전체 역처리를 거절한다',()=>{
  const a=make(); a.outputs[0].claims[0].toMilli=500; a.outputs[0].claims[1].fromMilli=500;
  expect(()=>run(a)).toThrow();
 });
 it('source 주문과 회사, active 상태를 검사한다',()=>{
  const a=make();expect(()=>planBatchAssignmentReversal({reference:{...reference,orderId:'child'},ownerUid:'owner',at:'later',assignment:a})).toThrow();
  a.state='reversed';expect(()=>run(a)).toThrow();
 });
});



