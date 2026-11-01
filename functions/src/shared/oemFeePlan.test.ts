import {describe,it,expect} from 'vitest';
import {buildOemFeePlan,buildOemFeePlanV2,buildOemFeeSnapshotV2,normalizeOemFeeTermsV2,type OemFeePlanInput,type OemFeePlanV2Input} from './oemFeePlan';
const base:OemFeePlanInput={receivedKg:10,sentKg:12,perKg:500,exempt:false,accountCode:'540',products:[],bulk:[]};
describe('OEM 가공비 전표 순수 계획',()=>{
 it('옛 배치 fallback의 이름·공급액·세액과 단가를 그대로 보존한다',()=>{
  expect(buildOemFeePlan({...base,receivedKg:405,sentKg:1000,perKg:2000})).toEqual({lines:[{name:'외주가공비 (1000kg→405kg)',spec:'',qty:1,price:736364,supply:736364,tax:73636,total:810000,isTaxExempt:false,accountCode:'540'}],totalSupply:736364,totalTax:73636,totalAmount:810000});
 });
 it('제품과 벌크는 줄별 공급가로 나누며 총액과 한 번 나눈 공급가 차이를 보존한다',()=>{
  const input={...base,products:[{name:'제품',spec:'3.5kg',qty:2,unitKg:3.5}],bulk:[{material:'원료',kg:3}]};
  const before=JSON.stringify(input),plan=buildOemFeePlan(input);
  expect(plan.lines).toEqual([{name:'제품',spec:'3.5kg',qty:2,price:1591,supply:3182,tax:318,total:3500,isTaxExempt:false,accountCode:'540'},{name:'원료 벌크 가공비',spec:'kg',qty:3,price:455,supply:1364,tax:136,total:1500,isTaxExempt:false,accountCode:'540'}]);
  expect(plan).toMatchObject({totalSupply:4546,totalTax:454,totalAmount:5000});expect(JSON.stringify(input)).toBe(before);
 });
 it.each([[0.667,334,304,607],[0.665,332,302,605]])('마지막 줄에 %s kg 전체합계 잔차만 반영한다',(receivedKg,lastTotal,lastSupply,totalSupply)=>{
  const plan=buildOemFeePlan({...base,receivedKg,perKg:1000,products:[{name:'A',spec:'0.3333kg',qty:1,unitKg:0.3333},{name:'B',spec:'0.3333kg',qty:1,unitKg:0.3333}]});
  expect(plan.lines[0]).toMatchObject({price:303,total:333,supply:303,tax:30});expect(plan.lines[1]).toMatchObject({price:lastSupply,total:lastTotal,supply:lastSupply,tax:30});
  expect(plan.totalAmount).toBe(Math.round(receivedKg*1000));expect(plan.totalSupply).toBe(totalSupply);expect(plan.totalSupply+plan.totalTax).toBe(plan.totalAmount);
 });
 it('면세도 같은 끝잔차를 적용하고 공급가는 총액과 같다',()=>{
  const plan=buildOemFeePlan({...base,receivedKg:0.667,perKg:1000,exempt:true,products:[{name:'A',spec:'',qty:1,unitKg:0.3333},{name:'B',spec:'',qty:1,unitKg:0.3333}]});
  expect(plan.lines.map(row=>row.total)).toEqual([333,334]);expect(plan.totalSupply).toBe(667);expect(plan.totalTax).toBe(0);
 });
 it('0수량 제품·벌크만 있으면 기존 fallback을 사용한다',()=>{
  expect(buildOemFeePlan({...base,products:[{name:'0제품',spec:'',qty:0,unitKg:1}],bulk:[{material:'0벌크',kg:0}]}).lines).toHaveLength(1);
  expect(buildOemFeePlan({...base,products:[{name:'0제품',spec:'',qty:0,unitKg:1}]}).lines[0].name).toBe('외주가공비 (12kg→10kg)');
 });
 it('끝잔차가 마지막 줄을 음수로 만들면 기존과 같이 거절한다',()=>{
  expect(()=>buildOemFeePlan({...base,receivedKg:0.001,perKg:1000,products:[{name:'A',spec:'',qty:1,unitKg:1},{name:'B',spec:'',qty:1,unitKg:1}]})).toThrow('일치하지 않습니다');
 });
});


describe('OEM 품목별 V2 가공·업체부자재 계획',()=>{
 const input=():OemFeePlanV2Input=>({accountCode:'540',rows:[
  {itemId:'a',name:'10kg 포장',spec:'10kg',processing:{unit:'box',quantity:10,grossUnitPrice:1100,taxExempt:false},vendorPackaging:{unit:'box',quantity:10,grossUnitPrice:100,taxExempt:true}},
  {itemId:'b',name:'20kg 포장',spec:'20kg',processing:{unit:'kg',quantity:400,grossUnitPrice:20,taxExempt:true},vendorPackaging:{unit:'box',quantity:20,grossUnitPrice:220,taxExempt:false}}
 ],bulk:[]});
 it('각 품목의 다른 수량·단가와 혼합과세는 줄별 계산하고 원문을 보존한다',()=>{
  const source=input(),before=structuredClone(source),result=buildOemFeePlanV2(source);
  expect(result.lines).toEqual([
   {name:'10kg 포장 가공비',spec:'10kg · 박스 기준',qty:10,price:1000,supply:10000,tax:1000,total:11000,isTaxExempt:false,accountCode:'540'},
   {name:'10kg 포장 업체부자재비',spec:'10kg · 박스 기준',qty:10,price:100,supply:1000,tax:0,total:1000,isTaxExempt:true,accountCode:'540'},
   {name:'20kg 포장 가공비',spec:'20kg · kg 기준',qty:400,price:20,supply:8000,tax:0,total:8000,isTaxExempt:true,accountCode:'540'},
   {name:'20kg 포장 업체부자재비',spec:'20kg · 박스 기준',qty:20,price:200,supply:4000,tax:400,total:4400,isTaxExempt:false,accountCode:'540'}]);
  expect(result).toMatchObject({totalSupply:23000,totalTax:1400,totalAmount:24400});expect(source).toEqual(before);
 });
 it('명시 0원은 새 비용 줄을 만들지 않지만 조건을 보존하고 누락은 거절한다',()=>{
  const source=input();source.rows[0].vendorPackaging.grossUnitPrice=0;const before=structuredClone(source);expect(buildOemFeePlanV2(source).lines).toHaveLength(3);expect(source).toEqual(before);
  expect(()=>buildOemFeePlanV2({...source,rows:[{...source.rows[0],processing:undefined} as any]})).toThrow();
  const allZero=input();for(const row of allZero.rows){row.processing.grossUnitPrice=0;row.vendorPackaging.grossUnitPrice=0;}expect(buildOemFeePlanV2(allZero)).toEqual({lines:[],totalSupply:0,totalTax:0,totalAmount:0});
 });
 it('벌크는 별도의 kg 요율을 적용하고 제품 단가로 평균내지 않는다',()=>{
  const source=input();source.bulk=[{material:'합성 원료',kg:2,grossUnitPrice:330,taxExempt:false}];const result=buildOemFeePlanV2(source);
  expect(result.lines.at(-1)).toMatchObject({name:'합성 원료 벌크 가공비',spec:'kg 기준',qty:2,price:300,total:660,supply:600,tax:60});expect(result.totalAmount).toBe(25060);
 });
 it.each(['duplicate','unit','quantity','rate','tax','overflow'])('잘못된 %s는 추정 없이 거절한다',mode=>{
  const source=input();if(mode==='duplicate')source.rows=[...source.rows,structuredClone(source.rows[0])];if(mode==='unit')source.rows[0].processing.unit='wrong' as any;if(mode==='quantity')source.rows[0].processing.quantity=0;if(mode==='rate')source.rows[0].processing.grossUnitPrice=NaN;if(mode==='tax')source.rows[0].processing.taxExempt=undefined as any;if(mode==='overflow')source.rows[0].processing.grossUnitPrice=Number.MAX_SAFE_INTEGER;
  expect(()=>buildOemFeePlanV2(source)).toThrow();
 });
});


describe('OEM V2 최초 품목조건 입력',()=>{
 const request=()=>({version:2,companyId:'taebaek',partnerId:'factory',rows:[{itemId:'a',processing:{unit:'kg',grossUnitPrice:0,taxExempt:true},vendorPackaging:{unit:'box',grossUnitPrice:200,taxExempt:false}}],bulk:{grossUnitPrice:500,taxExempt:false},nonDuplicatePackagingConfirmed:true});
 it('명시 0원·단위·과세·별도비용 확인을 보존한다',()=>{const first=request(),before=structuredClone(first);expect(normalizeOemFeeTermsV2(first)).toEqual(first);expect(first).toEqual(before);});
 it.each(['missing','duplicate','bad-unit','negative','company','flag','unknown'])('변조 또는 누락 %s를 거절한다',mode=>{const x:any=request();if(mode==='missing')delete x.rows[0].processing.grossUnitPrice;if(mode==='duplicate')x.rows.push(structuredClone(x.rows[0]));if(mode==='bad-unit')x.rows[0].processing.unit='bag';if(mode==='negative')x.rows[0].vendorPackaging.grossUnitPrice=-1;if(mode==='company')x.companyId='elsewhere';if(mode==='flag')x.nonDuplicatePackagingConfirmed='yes';if(mode==='unknown')x.rows[0].unexpected=true;expect(()=>normalizeOemFeeTermsV2(x)).toThrow();});
 it('양수 총액이라도 원단위 공급단가가 0이면 단위를 다시 확인한다',()=>{expect(()=>buildOemFeePlanV2({accountCode:'540',rows:[{itemId:'a',name:'A',spec:'',processing:{unit:'kg',quantity:100,grossUnitPrice:0.1,taxExempt:false},vendorPackaging:{unit:'kg',quantity:100,grossUnitPrice:0,taxExempt:false}}],bulk:[]})).toThrow('단위');});
});


describe('입고 당시 V2 수량·단위 snapshot',()=>{
 const terms:any={version:2,companyId:'taebaek',partnerId:'factory',rows:[{itemId:'box10',processing:{unit:'kg',grossUnitPrice:20,taxExempt:false},vendorPackaging:{unit:'box',grossUnitPrice:100,taxExempt:true}},{itemId:'box20',processing:{unit:'box',grossUnitPrice:1100,taxExempt:false},vendorPackaging:{unit:'piece',grossUnitPrice:5,taxExempt:true}}],nonDuplicatePackagingConfirmed:true};
 const items=()=>[{itemId:'box10',name:'10kg 박스',spec:'10kg',itemUnit:'박스',receivedQty:10,unitKg:10,components:[]},{itemId:'box20',name:'20kg 박스',spec:'20kg',itemUnit:'박스',receivedQty:20,unitKg:20,components:[{childId:'piece',qty:4,child:{type:'product'}}]}];
 it('서로 다른 10kg×10·20kg×20은 실제 kg와 요율단위 수량을 고정한다',()=>{const data=items(),before=structuredClone(data),snapshot=buildOemFeeSnapshotV2(terms,data,[]);expect(snapshot.rows).toMatchObject([{itemId:'box10',receivedKg:100,processing:{quantity:100},vendorPackaging:{quantity:10}},{itemId:'box20',receivedKg:400,unitsPerBox:4,processing:{quantity:20},vendorPackaging:{quantity:80}}]);expect(data).toEqual(before);});
 it('박스에서 개수 환산은 단일 BOM 개입수 없으면 자동1로 바꾸지 않는다',()=>{const bad=items();bad[1].components=[];expect(()=>buildOemFeeSnapshotV2(terms,bad,[])).toThrow('개입수');});
 it('낱개를 박스로 자동 환산하지 않으며 누락/추가/중복 품목을 거절한다',()=>{const bad=items();bad[0].itemUnit='개';expect(()=>buildOemFeeSnapshotV2(terms,bad,[])).toThrow('박스');expect(()=>buildOemFeeSnapshotV2(terms,items().slice(0,1),[])).toThrow('일치');expect(()=>buildOemFeeSnapshotV2(terms,[items()[0],items()[0]],[])).toThrow('일치');});
 it('벌크는 별도 요율이 없으면 거절하고 원료/로트도 고정한다',()=>{const bulk=[{rawItemId:'raw',lotId:'lot',material:'원료',kg:5}];expect(()=>buildOemFeeSnapshotV2(terms,items(),bulk)).toThrow();const snapshot=buildOemFeeSnapshotV2({...terms,bulk:{grossUnitPrice:9,taxExempt:true}},items(),bulk);expect(snapshot.bulk).toEqual([{...bulk[0],grossUnitPrice:9,taxExempt:true}]);});
});
