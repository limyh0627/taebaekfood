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

describe('서버 strict 재고 선택',()=>{
 const items=[{id:'box',name:'박스',type:'product',unit:'박스',spec:'1kg * 2'},{id:'p',name:'병',type:'product',unit:'개',spec:'1kg'},{id:'oil',name:'오일',type:'wip',unit:'kg',subtype:'벌크',phantom:true}];
 const make=(rows=[{parent_id:'box',child_id:'p',quantity:2},{parent_id:'p',child_id:'oil',quantity:0.5}])=>createOrderProductionPlanner({allItems:items,inputs:{bom:buildBomIndex(items,rows),pack:{of:()=>0}},buildFormula:()=>[{raw:'볶음참깨',ratio:1}]});
 const run=(order:{items:{itemId:string;quantity:number}[]},plan?:Parameters<ReturnType<typeof make>['planOrderProduction']>[3],strict=true,stock=new Map([['box',0],['p',4]]))=>{
  const deltas=new Map<string,number>(),allocated=new Map<string,number>();
  const result=make().planOrderProduction(order,deltas,stock,plan,allocated,strict?{strictSelection:true}:undefined);
  return {result,deltas:[...deltas],allocated:[...allocated]};
 };
 it('반복 품목은 호출당 기본 출력 배정을 공유하며 둘째 초과 선택만 거절한다',()=>{
  const planner=make(),order={items:[{itemId:'p',quantity:1},{itemId:'p',quantity:1}]},stock=new Map([['p',1]]);
  expect(planner.planOrderProduction(order,new Map(),stock,{0:{own:1},1:{own:1}}).producedUnits).toEqual([{itemId:'p',qty:1}]);
  expect(()=>planner.planOrderProduction(order,new Map(),stock,{0:{own:1},1:{own:1}},undefined,{strictSelection:true})).toThrow('invalid-selection:1:own');
  expect(run(order,{0:{own:1},1:{own:0}},true,stock)).toEqual(run(order,{0:{own:1},1:{own:0}},false,stock));
 });
 it.each([-1,NaN,Infinity])('own 비정상 수량 %s 거절',own=>{
  expect(()=>run({items:[{itemId:'p',quantity:1}]},{0:{own}})).toThrow('invalid-selection:0:own');
 });
 it.each([['수요',2,4],['가용',1,0]])('own %s 초과는 거절하고 기본 clamp는 유지',(_label,own,available)=>{
  const order={items:[{itemId:'p',quantity:1}]},stock=new Map([['p',available]]);
  expect(()=>run(order,{0:{own}},true,stock)).toThrow('invalid-selection:0:own');
  expect(run(order,{0:{own}},false,stock)).toEqual(run(order,{0:{own:Math.min(own,available,1)}},false,stock));
 });
 it.each([{'01':{own:0}},{1:{own:0}},{0:{own:0,extra:1}},{0:{}},{0:{own:0,loose:undefined}},Object.create({0:{own:0}}),{0:Object.create({own:0})},JSON.parse('{"__proto__":{"own":0}}')])('shape 및 상속 선택 거절 %#',plan=>{
  expect(()=>run({items:[{itemId:'p',quantity:1}]},plan as never)).toThrow('invalid-selection');
 });
 it('박스 낱개 수요 초과와 앞줄 사용 뒤 가용 초과를 거절한다',()=>{
  expect(()=>run({items:[{itemId:'box',quantity:1}]},{0:{own:0,loose:3}})).toThrow('invalid-selection:0:loose');
  expect(()=>run({items:[{itemId:'box',quantity:1},{itemId:'box',quantity:1}]},{0:{own:0,loose:2},1:{own:0,loose:2}},true,new Map([['box',0],['p',3]]))).toThrow('invalid-selection:1:loose');
 });
 it.each([undefined,{0:{own:0,loose:0}},{0:{own:0,loose:2}}])('정상 박스 및 자동 선택 결과와 Map 근거 순서 보존 %#',plan=>{
  const order={items:[{itemId:'box',quantity:2}]};expect(run(order,plan)).toEqual(run(order,plan,false));
 });
 it('생산 없는 낱개 선택과 unpack 없는 양수 loose는 거절하되 0은 허용',()=>{
  const order={items:[{itemId:'p',quantity:1}]};
  expect(()=>run(order,{0:{own:1,loose:1}})).toThrow('unsupported-selection:0:loose');
  expect(()=>run(order,{0:{own:0,loose:1}})).toThrow('unsupported-selection:0:loose');
  expect(run(order,{0:{own:1,loose:0}})).toEqual(run(order,{0:{own:1,loose:0}},false));
  expect(run(order,{0:{own:0,loose:0}})).toEqual(run(order,{0:{own:0,loose:0}},false));
 });
 it.each([{type:'raw',unit:'kg'},{type:'material',unit:'개'},{type:'product',unit:'개',procureType:'임가공'},{type:'goods',unit:'개'}])('선택 미사용 분기는 0을 무시하고 양수는 거절 %#',kind=>{
  const p={id:'x',name:'볶음참깨',spec:'1kg',...kind},planner=createOrderProductionPlanner({allItems:[p],inputs:{bom:buildBomIndex([p],[]),pack:{of:()=>0}},buildFormula:()=>[{raw:'볶음참깨',ratio:1}]}),order={items:[{itemId:'x',quantity:1}]};
  const call=(own:number,loose:number,strict=true)=>planner.planOrderProduction(order,new Map(),new Map([['x',1]]),{0:{own,loose}},undefined,strict?{strictSelection:true}:undefined);
  expect(call(0,0)).toEqual(call(0,0,false));expect(()=>call(1,0)).toThrow('unsupported-selection:0:own');expect(()=>call(0,1)).toThrow('unsupported-selection:0:loose');
 });
 it('낱개와 박스 교차 순서 및 중복 BOM도 원계산을 유지한다',()=>{
  for(const ids of [['p','box'],['box','p']]) {const order={items:ids.map(itemId=>({itemId,quantity:1}))};expect(run(order)).toEqual(run(order,undefined,false));}
  const planner=make([{parent_id:'box',child_id:'p',quantity:2},{parent_id:'box',child_id:'p',quantity:2},{parent_id:'p',child_id:'oil',quantity:0.5}]);
  const order={items:[{itemId:'box',quantity:1}]},stock=new Map([['box',0],['p',4]]),a=new Map<string,number>(),b=new Map<string,number>();
  expect(planner.planOrderProduction(order,a,stock,{0:{own:0,loose:0}},undefined,{strictSelection:true})).toEqual(planner.planOrderProduction(order,b,stock,{0:{own:0,loose:0}}));expect([...a]).toEqual([...b]);
 });
});

describe('strict 추가 정책',()=>{
 it('재고생산 own은 0만 허용하고 자동 생산을 보존한다',()=>{
  const p={id:'p',name:'병',type:'product',unit:'개',spec:'1kg'},planner=createOrderProductionPlanner({allItems:[p],inputs:{bom:buildBomIndex([p],[]),pack:{of:()=>0}},buildFormula:()=>[{raw:'볶음참깨',ratio:1}]}),order={purpose:'stock-production' as const,items:[{itemId:'p',quantity:1}]};
  expect(()=>planner.planOrderProduction(order,new Map(),new Map([['p',4]]),{0:{own:1}},undefined,{strictSelection:true})).toThrow('invalid-selection:0:own');
  expect(planner.planOrderProduction(order,new Map(),new Map([['p',4]]),{0:{own:0}},undefined,{strictSelection:true})).toEqual(planner.planOrderProduction(order,new Map(),new Map([['p',4]]),{0:{own:0}}));
 });
 it.each([-1,NaN,Infinity])('loose 비정상 수량 %s 거절',loose=>{
  const p={id:'p',name:'병',type:'product',unit:'개',spec:'1kg'},planner=createOrderProductionPlanner({allItems:[p],inputs:{bom:buildBomIndex([p],[]),pack:{of:()=>0}},buildFormula:()=>[]});
  expect(()=>planner.planOrderProduction({items:[{itemId:'p',quantity:1}]},new Map(),new Map([['p',1]]),{0:{own:0,loose}},undefined,{strictSelection:true})).toThrow('invalid-selection:0:loose');
 });
});
