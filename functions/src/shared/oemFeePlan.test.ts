import {describe,it,expect} from 'vitest';
import {buildOemFeePlan,type OemFeePlanInput} from './oemFeePlan';
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
