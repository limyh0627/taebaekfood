import {describe,expect,it} from 'vitest';
import {createOrderProductionPlanner} from './orderProductionPlanner';
import {buildBomIndex} from './bomIndex';

describe('서버에서 실행하는 생산 계획 경계',()=>{
 it('하위 품목의 재고 callback 타입과 재귀 생산 증거를 유지한다',()=>{
  const items=[{id:'box',name:'박스',type:'product',unit:'박스',spec:'1800ml * 2',stock:0},{id:'p',name:'병',type:'product',unit:'개',spec:'1800ml',stock:0},{id:'oil',name:'합성 오일',type:'wip',unit:'kg',subtype:'벌크',phantom:true,stock:0}];
  const inputs={bom:buildBomIndex(items,[{parent_id:'box',child_id:'p',quantity:2},{parent_id:'p',child_id:'oil',quantity:0.5}]),pack:{of:()=>0}},planner=createOrderProductionPlanner({allItems:items,inputs,buildFormula:()=>[{raw:'통깨참기름',ratio:1}]});
  const order={items:[{itemId:'box',quantity:2}]},deltas=new Map<string,number>(),usage:Record<string,number>={},built:{itemId:string;qty:number}[]=[],evidence:Parameters<typeof planner.accrueBom>[10]=[],before=JSON.stringify({items,order});
  planner.accrueBom(order,items[0],2,deltas,usage,-1,built,0,undefined,item=>item.stock,evidence);
  expect([...deltas]).toEqual([['p',0]]);expect(usage).toEqual({통깨참기름:2});expect(built).toEqual([{itemId:'p',qty:4}]);
  expect(evidence).toEqual([{productId:'p',spec:'1800ml',units:4,raw:'통깨참기름',kg:2,path:'bom-formula',childItemId:'oil',bomQuantityKg:0.5,formulaName:'합성 오일',ratio:1}]);expect(JSON.stringify({items,order})).toBe(before);
 });
 it('OEM 박스는 명시 BOM으로 kg를 풀고 실제 생산 재고를 만들지 않는다',()=>{
  const items=[{id:'box',name:'깨 박스',type:'product',unit:'박스',spec:'1kg * 20',procureType:'임가공'},{id:'p',name:'깨',type:'product',unit:'개',spec:'1kg'}];
  const planner=createOrderProductionPlanner({allItems:items,inputs:{bom:buildBomIndex(items,[{parent_id:'box',child_id:'p',quantity:20}]),pack:{of:()=>99}},buildFormula:()=>[{raw:'볶음참깨',ratio:1}]});
  const deltas=new Map<string,number>(),allocated=new Map<string,number>(),result=planner.planOrderProduction({items:[{itemId:'box',quantity:40,boxQuantity:2,isBoxUnit:false}]},deltas,new Map([['box',0]]),undefined,allocated);
  expect(result).toEqual({rawUsage:{},rawCalculationEvidence:[],rawUsageLedgerOnly:{볶음참깨:40},autoBuilt:[],producedUnits:[]});expect([...deltas]).toEqual([]);expect([...allocated]).toEqual([['box',2]]);
 });
 it('서버 계산도 누락 기준정보와 원료0 오류를 같은 문구로 전달한다',()=>{
  const items=[{id:'p',name:'합성 완제품',type:'product',unit:'개',spec:'1800ml'}],planner=createOrderProductionPlanner({allItems:items,inputs:{bom:buildBomIndex(items,[]),pack:{of:()=>0}},buildFormula:()=>[]});
  expect(()=>planner.planOrderProduction({items:[{itemId:'없는품목',quantity:1}]},new Map(),new Map())).toThrow('주문 품목 기준정보를 찾을 수 없습니다: 없는품목');
  expect(()=>planner.planOrderProduction({items:[{itemId:'p',quantity:1}]},new Map(),new Map([['p',0]]))).toThrow('원료 BOM·원료식에서 사용량이 0kg인 완제품은 생산 완료할 수 없습니다: 합성 완제품');
 });
});
