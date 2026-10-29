import { describe, expect, it } from 'vitest';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import { resolveOrderItem, assessOrderBoxConversion, resolveOrderItemChecked } from './orderResolvedItem';

const products = [{ id: 'box', name: 'box' }, { id: 'loose', name: 'loose' }, { id: 'unit', name: 'unit' }];
const inputs = {
  bom: { of: (id: string) => id === 'box' ? [{ childId: 'loose', qty: 20, child: { type: 'product' } }] : [] },
  pack: { of: (id: string) => id === 'unit' ? 12 : 0 },
};
describe('resolveOrderItem 서버 공통 원본', () => {
  it('박스 품목은 명시 박스 수와 낱개 품목을 사용한다', () => {
    expect(resolveOrderItem({ itemId: 'box', quantity: 100, boxQuantity: 3 }, products, inputs)).toEqual({ product: products[1], qty: 60, perBox: 20, unknownItem: false });
  });
  it('명시 0과 음수 및 이전 수량을 보존한다', () => {
    expect(resolveOrderItem({ itemId: 'box', quantity: 4, boxQuantity: 0 }, products, inputs).qty).toBe(0);
    expect(resolveOrderItem({ itemId: 'box', quantity: -2 }, products, inputs).qty).toBe(-40);
    expect(resolveOrderItem({ itemId: 'box', quantity: 4 }, products, inputs).qty).toBe(80);
  });
  it('낱개 품목의 박스 환산은 명시 0과 undefined를 구분한다', () => {
    expect(resolveOrderItem({ itemId: 'unit', quantity: 2, isBoxUnit: true, boxQuantity: 2, unitsPerBox: 0 }, products, inputs)).toEqual({ product: products[2], qty: 2, perBox: 1, unknownItem: false });
    expect(resolveOrderItem({ itemId: 'unit', quantity: 2, isBoxUnit: true, boxQuantity: 2 }, products, inputs)).toEqual({ product: products[2], qty: 24, perBox: 12, unknownItem: false });
  });
  it('품목 또는 낱개가 없으면 원 수량과 품목 판정을 지킨다', () => {
    expect(resolveOrderItem({ itemId: 'missing', quantity: 7 }, products, inputs)).toEqual({ product: undefined, qty: 7, perBox: 1, unknownItem: true });
    expect(resolveOrderItem({ itemId: 'box', quantity: 7 }, [products[0]], inputs)).toEqual({ product: products[0], qty: 7, perBox: 1, unknownItem: false });
  });
});

describe('MB 공통 박스 환산 근거/checked API',()=>{
 const line={itemId:'unit',quantity:5,isBoxUnit:true,boxQuantity:3};
 it('MB-A01 원료/포장BOM과 이름규격은 입수근거가 아니다',()=>{const items=[{id:'unit',name:'20개입처럼보이는원문'},{id:'raw'}],units={bom:{of:()=>[{childId:'raw',qty:4,child:{type:'wip'}}]},pack:{of:()=>0}};expect(assessOrderBoxConversion(line,items,units)).toEqual({kind:'unresolved',reason:'missing-pack-factor'});expect(resolveOrderItemChecked(line,items,units)).toEqual({kind:'unresolved',reason:'missing-pack-factor'});});
 it.each([null,0,-1,NaN,Infinity])('MB-A02 잘못된 명시factor %s는 유효pack으로 fallback하지 않는다',factor=>{const pack=()=>12;expect(assessOrderBoxConversion({...line,unitsPerBox:factor as number},products,{...inputs,pack:{of:pack}})).toEqual({kind:'unresolved',reason:'invalid-order-snapshot'});expect(resolveOrderItemChecked({...line,unitsPerBox:factor as number},products,{...inputs,pack:{of:pack}}).kind).toBe('unresolved');});
 it('MB-A03 실제BOM/낱개대상/유한factor를 확인하고 무관snapshot은 무시한다',()=>{expect(assessOrderBoxConversion({itemId:'box',quantity:5,unitsPerBox:NaN},products,inputs)).toEqual({kind:'known',source:'bom',factor:20});expect(assessOrderBoxConversion({itemId:'box',quantity:5},[products[0]],inputs)).toEqual({kind:'unresolved',reason:'missing-loose-item'});expect(assessOrderBoxConversion({itemId:'box',quantity:5},products,{...inputs,bom:{of:()=>[{childId:'loose',qty:Infinity,child:{type:'product'}}]}})).toEqual({kind:'unresolved',reason:'invalid-bom-factor'});});
 it.each([0.5,1,2,7])('MB-A04 명시factor %s의 qty/perBox는 원goodsShipQty 계산과 일치한다',factor=>{const original={...line,quantity:99,unitsPerBox:factor},before={...original};expect(assessOrderBoxConversion(original,products,inputs)).toEqual({kind:'known',source:'order-snapshot',factor});expect(resolveOrderItemChecked(original,products,inputs)).toEqual({kind:'resolved',value:{product:products[2],qty:3*factor,perBox:factor,unknownItem:false},conversion:{kind:'known',source:'order-snapshot',factor}});expect(original).toEqual(before);expect(resolveOrderItem(original,products,inputs).qty).toBe(factor>1?3*factor:99);});
 it.each([0.5,1,12])('MB-A05 등록pack %s도 명시근거이며 기본1추정이 아니다',factor=>{expect(resolveOrderItemChecked(line,products,{...inputs,pack:{of:()=>factor}})).toEqual({kind:'resolved',value:{product:products[2],qty:3*factor,perBox:factor,unknownItem:false},conversion:{kind:'known',source:'pack',factor}});});
 it('MB-A06 낱개/반품/BOM 원resolver golden 값과 입력을 보존한다',()=>{for(const row of [{itemId:'unit',quantity:-5},{itemId:'box',quantity:2,boxQuantity:0},{itemId:'box',quantity:-2,unitsPerBox:0}]){const checked=resolveOrderItemChecked(row,products,inputs);expect(checked.kind).toBe('resolved');if(checked.kind==='resolved')expect(checked.value).toEqual(resolveOrderItem(row,products,inputs));}expect(assessOrderBoxConversion({itemId:'missing',quantity:5,isBoxUnit:true},products,inputs)).toEqual({kind:'unresolved',reason:'missing-item'});expect(assessOrderBoxConversion({itemId:'missing',quantity:5},products,inputs)).toEqual({kind:'not-box'});});
 it('MB-A07 기존resolver본문은 새API추가와관계없이 그대로다',()=>{const parse=(text:string)=>ts.createSourceFile('source.ts',text,ts.ScriptTarget.Latest,true),body=(text:string)=>{const source=parse(text),fn=source.statements.find(row=>ts.isFunctionDeclaration(row)&&row.name?.text==='resolveOrderItem') as ts.FunctionDeclaration;return ts.createPrinter().printNode(ts.EmitHint.Unspecified,fn,source);};expect(body(readFileSync('functions/src/shared/orderResolvedItem.ts','utf8'))).toBe(body(execFileSync('git',['show','bbf6cefb652f8a46be4d6b96f5b12efbd547ca26:functions/src/shared/orderResolvedItem.ts'],{encoding:'utf8'})));});
});
it('MB-A08 nonBOM 박스수 부재/비유한은 미확인, 명시0과 음수는 원helper 정책을 따른다',()=>{expect(resolveOrderItemChecked({itemId:'unit',quantity:99,isBoxUnit:true,unitsPerBox:2},products,inputs)).toEqual({kind:'unresolved',reason:'missing-box-count'});expect(resolveOrderItemChecked({itemId:'unit',quantity:99,isBoxUnit:true,unitsPerBox:2,boxQuantity:NaN},products,inputs)).toEqual({kind:'unresolved',reason:'invalid-box-count'});for(const count of [0,-3]){const out=resolveOrderItemChecked({itemId:'unit',quantity:99,isBoxUnit:true,unitsPerBox:0.5,boxQuantity:count},products,inputs);expect(out.kind).toBe('resolved');if(out.kind==='resolved'){expect(out.value.qty).toBe(count*0.5);expect(out.value.perBox).toBe(0.5);}}});
