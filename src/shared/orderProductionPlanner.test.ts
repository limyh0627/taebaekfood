import {describe,expect,it} from 'vitest';
import {createOrderProductionPlanner} from './orderProductionPlanner';
import {buildBomIndex,getBomIndex,setBomIndex} from './bomIndex';
import {buildPackIndex,getPackIndex,setPackIndex} from './packIndex';
import type {Item,Order} from './types';

const product=(id:string,more:Partial<Item>={}):Item=>Object.freeze({id,name:id,type:'product',unit:'개',spec:'1800ml',stock:0,...more}) as Item;
const order=(itemId:string,more:Record<string,unknown>={}):Order=>Object.freeze({id:'합성주문',status:'PENDING',items:Object.freeze([Object.freeze({itemId,quantity:2,...more})])}) as unknown as Order;
const factory=(quantity:number,raw:string,ratio:number)=>{
 const items=[product('p'),product('oil',{type:'wip',subtype:'벌크',unit:'kg',phantom:true,name:'합성 오일'})];
 const inputs={bom:buildBomIndex(items,[{parent_id:'p',child_id:'oil',quantity}]),pack:buildPackIndex([])};
 return {items,inputs,planner:createOrderProductionPlanner({allItems:items,inputs,buildFormula:()=>[{raw,ratio}]})};
};

describe('명시 기준정보를 사용하는 생산 계획 factory',()=>{
 it('회사별 BOM·공식을 격리하고 전역 기준정보가 바뀌어도 원문과 계산을 보존한다',()=>{
  const a=factory(0.5,'통깨참기름',1),b=factory(0.75,'깨분참기름',0.5),o=order('p');
  const before=JSON.stringify({a:a.items,b:b.items,o}),oldBom=getBomIndex(),oldPack=getPackIndex();
  try{
   setBomIndex(buildBomIndex(a.items,[{parent_id:'p',child_id:'oil',quantity:99}]));setPackIndex(buildPackIndex([{item_id:'p',units_per_box:99}]));
   const ad=new Map<string,number>(),bd=new Map<string,number>(),aa=new Map<string,number>(),ba=new Map<string,number>();
   const ar=a.planner.planOrderProduction(o,ad,new Map([['p',0]]),undefined,aa),br=b.planner.planOrderProduction(o,bd,new Map([['p',0]]),undefined,ba);
   expect(ar.rawUsage).toEqual({통깨참기름:1});expect(br.rawUsage).toEqual({깨분참기름:0.75});
   expect(ar.rawCalculationEvidence).toEqual([{productId:'p',spec:'1800ml',units:2,raw:'통깨참기름',kg:1,path:'bom-formula',childItemId:'oil',bomQuantityKg:0.5,formulaName:'합성 오일',ratio:1}]);
   expect(br.rawCalculationEvidence[0]).toMatchObject({bomQuantityKg:0.75,ratio:0.5,kg:0.75});
   expect([...ad]).toEqual([['p',2]]);expect([...bd]).toEqual([['p',2]]);expect([...aa]).toEqual([['p',2]]);expect([...ba]).toEqual([['p',2]]);
   expect(JSON.stringify({a:a.items,b:b.items,o})).toBe(before);
  }finally{setBomIndex(oldBom);setPackIndex(oldPack);}
 });
 it('동일 상품의 회사별 포장 개입수로 출고·취소하고 전역 포장표에 기대지 않는다',()=>{
  const items=[product('goods',{type:'goods'})],bom=buildBomIndex(items,[]),o=order('goods',{isBoxUnit:true,boxQuantity:2});
  const a=createOrderProductionPlanner({allItems:items,inputs:{bom,pack:buildPackIndex([{item_id:'goods',units_per_box:6}])},buildFormula:()=>[]});
  const b=createOrderProductionPlanner({allItems:items,inputs:{bom,pack:buildPackIndex([{item_id:'goods',units_per_box:12}])},buildFormula:()=>[]});
  const oldPack=getPackIndex(),before=JSON.stringify({items,o});
  try{
   setPackIndex(buildPackIndex([{item_id:'goods',units_per_box:99}]));
   const ad=new Map<string,number>(),bd=new Map<string,number>();a.shipOrder(o,ad);b.shipOrder(o,bd);
   expect([...ad]).toEqual([['goods',-12]]);expect([...bd]).toEqual([['goods',-24]]);
   a.unShipOrder(o,ad);b.unShipOrder(o,bd);expect([...ad]).toEqual([['goods',0]]);expect([...bd]).toEqual([['goods',0]]);
   expect(JSON.stringify({items,o})).toBe(before);
  }finally{setPackIndex(oldPack);}
 });
 it('한 factory의 공식 조회 오류가 다른 factory의 의존성이나 계산을 바꾸지 않는다',()=>{
  const a=factory(0.5,'통깨참기름',1),failure=new Error('합성 공식 조회 실패');
  const broken=createOrderProductionPlanner({allItems:a.items,inputs:a.inputs,buildFormula:()=>{throw failure;}});
  let caught:unknown;try{broken.planOrderProduction(order('p'),new Map(),new Map([['p',0]]));}catch(error){caught=error;}
  expect(caught).toBe(failure);expect(a.planner.planOrderProduction(order('p'),new Map(),new Map([['p',0]])).rawUsage).toEqual({통깨참기름:1});
 });
});
