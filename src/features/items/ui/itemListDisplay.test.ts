import { expect, it } from 'vitest';
import { boxEquivalentLabel, inventoryNameSpec, withSpec, parseMakeLabel } from './itemListDisplay';
it('박스 환산 표시는 정수·소수 두 자리·불필요한 끝 0 제거를 유지한다',()=>{
 expect(boxEquivalentLabel(20,10)).toBe('2박스 분량');expect(boxEquivalentLabel(1,3)).toBe('0.33박스 분량');expect(boxEquivalentLabel(15,10)).toBe('1.5박스 분량');expect(boxEquivalentLabel(0,10)).toBe('0박스 분량');
});
it('재고 이름·규격은 이름 속 용량과 옛 개입수·규격 개입수 우선순위를 유지한다',()=>{
 expect(inventoryNameSpec({name:'참기름/350ml',spec:'350ml * 1'})).toEqual({name:'참기름',spec:'350ml'});
 expect(inventoryNameSpec({name:'참기름 (10개입)',spec:'350ml'})).toEqual({name:'참기름',spec:'350ml × 10'});
 expect(inventoryNameSpec({name:'참기름 (10개입)',spec:'350ml * 20'})).toEqual({name:'참기름',spec:'350ml * 20'});
});
it('선물세트는 규격을 선물세트로 표시하며 규격 없는 품목은 기존 빈값 대체를 쓴다',()=>{
 expect(inventoryNameSpec({name:'선물세트 1호',spec:'350ml',subtype:'선물세트'})).toEqual({name:'선물세트 1호',spec:'선물세트'});expect(inventoryNameSpec({name:'미지정'})).toEqual({name:'미지정',spec:'-'});
});
it('검색용 문자열은 이름에 있는 용량을 중복하지 않고 개입수는 붙인다',()=>{
 expect(withSpec({name:'참기름',spec:'1l * 10'})).toBe('참기름/1L ×10');expect(withSpec({name:'300ML-소주병',spec:'300ml * 20'})).toBe('300ML-소주병 ×20');expect(withSpec({name:'미지정'})).toBe('미지정');
});
it('제조 선택 배지는 등급·브랜드·용량·개입수·용기를 원문 순서로 구분한다',()=>{
 const source=Object.freeze({name:'참기름/특골드/태백/1750ml (10개입)',spec:'1750ml * 20'});expect(parseMakeLabel(source)).toEqual({base:'참기름',grade:'특골드',size:'1750ml',pack:'20개입',brand:'태백',container:'페트'});expect(parseMakeLabel({name:'참기름/300ml'}).container).toBe('병');expect(parseMakeLabel({name:'벌크/16.5kg'}).container).toBe('');expect(parseMakeLabel({name:'참기름 (10개입)'}).pack).toBe('10개입');
});
