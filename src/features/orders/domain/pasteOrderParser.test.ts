import { expect, it } from 'vitest';
import { parseLine, scoreProduct } from './pasteOrderParser';
import type { Item } from '../../../shared/types';
const product=(id:string,name:string,spec='')=>({id,name,spec,type:'product',unit:'개',stock:0,minStock:0,image:''} as Item);
it('마지막 숫자와 한글 단위를 수량으로 쓰며 원문과 기본값을 보존한다',()=>{
 const pool=[product('oil','참기름')];expect(parseLine('참기름 1kg 2박스',pool)).toEqual({rawText:'참기름 1kg 2박스',rawName:'참기름',qty:2,isBox:true,selectedProductId:'oil'});expect(parseLine('참기름 2.5개',pool)).toMatchObject({qty:2.5,isBox:false});expect(parseLine('참기름',pool)).toMatchObject({qty:1,isBox:true});expect(parseLine('참기름 두박스',pool)).toMatchObject({qty:1,isBox:true});
});
it.each(['kg','g','L','ml','l','개'])('%s 단위는 박스가 아닌 수량으로 읽는다',unit=>{
 expect(parseLine('참기름 3'+unit,[product('oil','참기름')])).toMatchObject({qty:3,isBox:false,rawName:'참기름'});
});
it('정확일치·포함·이름과 규격을 함께 비교하는 원래 점수를 유지한다',()=>{
 expect(scoreProduct({name:'참기름',spec:'350ml'},'참 기 름 350ML')).toBe(1);expect(scoreProduct({name:'참기름'},'참')).toBe(.85);expect(scoreProduct({name:'a'},'b')).toBe(0);expect(scoreProduct({name:'참기름'},'')).toBe(0);
});
it('0.25 경계는 후보를 선택하고 그 아래는 미선택한다',()=>{
 const pool=[product('threshold','abcdefghi')];expect(scoreProduct(pool[0],'abcxyzpqr')).toBe(.25);expect(parseLine('abcxyzpqr',pool).selectedProductId).toBe('threshold');expect(parseLine('abxyzpqrs',pool).selectedProductId).toBeNull();expect(parseLine('참기름',[]).selectedProductId).toBeNull();
});
it('같은 점수 후보는 기존 품목 순서를 유지하고 입력은 바꾸지 않는다',()=>{
 const a=product('a','참기름'),b=product('b','참기름'),pool=[a,b],before=structuredClone(pool);expect(parseLine('참기름 3box',pool).selectedProductId).toBe('a');expect(parseLine('참기름 3box',[b,a]).selectedProductId).toBe('b');expect(pool).toEqual(before);
});
