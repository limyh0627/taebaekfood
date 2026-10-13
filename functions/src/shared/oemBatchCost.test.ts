import {describe,it,expect} from 'vitest';
import {oemFeeUnitKgFromSavedReceipt,buildOemBatchCostPreview,finalizeOemBatchCost,sumOemReceivedKg,validateOemCostEvidence,validateOemCostIssueFingerprint} from './oemBatchCost';
const scope={companyId:'taebaek',sent:[{rawItemId:'raw',kg:100}]};
const evidence={version:1,ownerCompanyId:'taebaek',rawMaterials:[{rawItemId:'raw',kg:100,supplyAmount:200000}],packaging:{confirmed:true,supplyAmount:30000},capturedAt:'2026-10-12T00:00:00Z'};
const rows=[{itemId:'a',kg:20},{itemId:'b',kg:70}];
const pending=()=>{const result=buildOemBatchCostPreview(evidence,scope,rows);if(result.status!=='pending-fee')throw Error('fixture');return result;};
describe('신규 OEM 확인 공급가 근거와 kg 배분',()=>{
 it('행별 로트 반올림을 합산해 전체 중량과 원가 분모를 일치시킨다',()=>{
  expect(sumOemReceivedKg([0.3334,0.3334])).toBe(0.666);
  const result=buildOemBatchCostPreview(evidence,scope,[{itemId:'a',kg:0.333},{itemId:'b',kg:0.333}]);
  expect(result.receivedKg).toBe(0.666);
  expect(()=>sumOemReceivedKg([0.0001])).toThrow();
 });
 it('원물·부자재와 확정 가공비 공급가를 받은90kg에 배분한다',()=>{
  const preview=pending();expect(preview).toMatchObject({status:'pending-fee',sentKg:100,receivedKg:90,lossKg:10,rawSupplyAmount:200000,packagingSupplyAmount:30000});
  const cost=finalizeOemBatchCost(preview,{statementId:'fee',feeSupplyAmount:40909});
  expect(cost.totalSupplyAmount).toBe(270909);expect(cost.costPerKg).toBe(270909/90);
  expect(cost.allocations.map(row=>row.supplyAmount)).toEqual([60202,210707]);
 });
 it('근거 없음과 증가수율 미확인은 입고 허용용 blocked로 남긴다',()=>{
  expect(buildOemBatchCostPreview(undefined,scope,rows)).toEqual({version:1,status:'blocked',reason:'missing-evidence'});
  expect(buildOemBatchCostPreview(evidence,scope,[{itemId:'a',kg:101}])).toMatchObject({status:'blocked',reason:'yield-unconfirmed',sentKg:100,receivedKg:101});
 });
 it.each(['company','kg','raw','duplicate','packaging','negative','fraction','nonfinite'])('불일치 %s를 추정 없이 거절한다',mode=>{
  const copy=structuredClone(evidence);if(mode==='company')copy.ownerCompanyId='punghoe';if(mode==='kg')copy.rawMaterials[0].kg=99;if(mode==='raw')copy.rawMaterials[0].rawItemId='other';if(mode==='duplicate')copy.rawMaterials.push(copy.rawMaterials[0]);if(mode==='packaging')copy.packaging.confirmed=false;if(mode==='negative')copy.rawMaterials[0].supplyAmount=-1;if(mode==='fraction')copy.rawMaterials[0].supplyAmount=0.5;if(mode==='nonfinite')copy.rawMaterials[0].kg=Infinity;
  expect(()=>validateOemCostEvidence(copy,scope)).toThrow();
 });
 it('명시 확인한0원만 인정하고 비용 누락은 0으로 보충하지 않는다',()=>{
  const zero={...evidence,rawMaterials:[{...evidence.rawMaterials[0],supplyAmount:0}],packaging:{confirmed:true,supplyAmount:0}};
  expect(validateOemCostEvidence(zero,scope)?.rawMaterials[0].supplyAmount).toBe(0);
  expect(()=>validateOemCostEvidence({...zero,packaging:{confirmed:true}},scope)).toThrow();
 });
 it('원단위 잔차와 큰금액 곱셈을 정수비율로 처리한다',()=>{
  const large={...evidence,rawMaterials:[{...evidence.rawMaterials[0],supplyAmount:Number.MAX_SAFE_INTEGER}],packaging:{confirmed:true,supplyAmount:0}};
  const preview=buildOemBatchCostPreview(large,scope,[{itemId:'a',kg:0.001},{itemId:'b',kg:0.002},{itemId:'c',kg:99.997}]);if(preview.status!=='pending-fee')throw Error('fixture');
  const result=finalizeOemBatchCost(preview,{statementId:'fee',feeSupplyAmount:0});
  expect(result.allocations.every(row=>Number.isSafeInteger(row.supplyAmount)&&row.supplyAmount>=0)).toBe(true);expect(result.allocations.reduce((sum,row)=>sum+row.supplyAmount,0)).toBe(Number.MAX_SAFE_INTEGER);
  expect(()=>buildOemBatchCostPreview(evidence,scope,[{itemId:'a',kg:Number.MAX_VALUE}])).toThrow();
 });
 it('수정된 미리보기나 범위를 벗어난 합계는 확정하지 않는다',()=>{
  expect(()=>finalizeOemBatchCost({...pending(),rawSupplyAmount:1},{statementId:'fee',feeSupplyAmount:1})).toThrow();
  expect(()=>finalizeOemBatchCost(pending(),{statementId:'fee',feeSupplyAmount:Number.MAX_SAFE_INTEGER})).toThrow();
 });
 it('출고 입력 지문은 회사·거래처·수량·명시원가를 고정하며 레거시 근거없는 배치는 유지한다',()=>{
  const source={companyId:'taebaek',partnerId:'factory',sent:scope.sent,date:'2026-10-03',note:'',oemCostEvidence:evidence};
  const po={companyId:'taebaek',partnerId:'factory',oemPartnerId:'factory',oemSent:scope.sent,oemIssueDate:source.date,oemCostEvidence:evidence,oemIssueFingerprint:JSON.stringify(source)};
  expect(()=>validateOemCostIssueFingerprint(po)).not.toThrow();
  expect(()=>validateOemCostIssueFingerprint({...po,note:'메모만 변경'})).not.toThrow();
  expect(()=>validateOemCostIssueFingerprint({...po,oemSent:[{rawItemId:'raw',kg:99}]})).toThrow('변경');
  expect(()=>validateOemCostIssueFingerprint({...po,oemIssueFingerprint:''})).toThrow('지문');
  expect(()=>validateOemCostIssueFingerprint({companyId:'taebaek'})).not.toThrow();
 });
});

it('확인 배치의 원입고 kg만 수량으로 나누고 legacy는 현재 경로를 유지한다',()=>{
 const po={oemCostEvidence:evidence,oemBatchCost:pending(),oemReceivedKg:90,items:[{itemId:'a',quantity:2},{itemId:'b',quantity:10}]};
 expect([...oemFeeUnitKgFromSavedReceipt(po)!]).toEqual([['a',10],['b',7]]);
 expect(oemFeeUnitKgFromSavedReceipt({items:po.items})).toBeNull();
 expect(()=>oemFeeUnitKgFromSavedReceipt({...po,oemReceivedKg:91})).toThrow();
 expect(()=>oemFeeUnitKgFromSavedReceipt({...po,items:[po.items[0],po.items[0]]})).toThrow();
 expect(()=>oemFeeUnitKgFromSavedReceipt({...po,items:[po.items[0],{itemId:'b',quantity:0}]})).toThrow();
});

describe('벌크와 제품의 원입고 원가 배분',()=>{
 const bulk={itemId:'raw',rawItemId:'raw',lotId:'bulk-lot',kind:'bulk' as const,kg:70};
 it.each([false,true])('벌크 단독·혼합 입고의 총 kg와 실제 공급가를 보존한다(%s)',mixed=>{
  const inputs=mixed?[{itemId:'a',kg:20},bulk]:[bulk];
  const preview=buildOemBatchCostPreview({...evidence,packaging:{confirmed:true,supplyAmount:0}},scope,inputs);
  if(preview.status!=='pending-fee')throw Error('시험 원가 미리보기');
  const po={oemCostEvidence:evidence,oemBatchCost:preview,oemReceivedKg:mixed?90:70,
   items:mixed?[{itemId:'a',quantity:2}]:[],oemReceivedBulk:[{rawItemId:'raw',lotId:'bulk-lot',kg:70}]};
  expect([...oemFeeUnitKgFromSavedReceipt(po)!]).toEqual(mixed?[['a',10]]:[]);
  const confirmed=finalizeOemBatchCost(preview,{statementId:'fee',feeSupplyAmount:35000});
  expect(confirmed.totalSupplyAmount).toBe(235000);
  expect(confirmed.allocations.reduce((sum,row)=>sum+row.supplyAmount,0)).toBe(235000);
  expect(confirmed.allocations.at(-1)).toMatchObject(bulk);
 });
 it.each(['kg','lot','raw','duplicate','missing'])('원벌크 명세 변조 %s는 확정하지 않는다',mode=>{
  const preview=buildOemBatchCostPreview(evidence,scope,[bulk]);
  const manifest=[{rawItemId:'raw',lotId:'bulk-lot',kg:70}];
  if(mode==='kg')manifest[0].kg=69;if(mode==='lot')manifest[0].lotId='other';if(mode==='raw')manifest[0].rawItemId='other';
  if(mode==='duplicate')manifest.push({...manifest[0]});if(mode==='missing')manifest.length=0;
  expect(()=>oemFeeUnitKgFromSavedReceipt({oemCostEvidence:evidence,oemBatchCost:preview,oemReceivedKg:70,items:[],oemReceivedBulk:manifest})).toThrow('벌크');
 });
 it('제품 ID와 벌크 원료 ID가 같아도 별도 로트를 배분하고 벌크 로트 중복은 거절한다',()=>{
  expect(buildOemBatchCostPreview(evidence,scope,[{itemId:'raw',kg:20},bulk])).toMatchObject({receivedKg:90});
  expect(()=>buildOemBatchCostPreview(evidence,scope,[bulk,bulk])).toThrow('배분');
  expect(()=>buildOemBatchCostPreview(evidence,scope,[{...bulk,rawItemId:'other'}])).toThrow('배분');
 });
});
