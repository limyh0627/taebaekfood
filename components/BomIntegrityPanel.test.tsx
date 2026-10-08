/** @vitest-environment jsdom */
import React from 'react';
import {fireEvent,render,screen} from '@testing-library/react';
import {it,expect} from 'vitest';
import BomIntegrityPanel from './BomIntegrityPanel';
import {buildBomIndex,setBomIndex} from '../src/shared/bomIndex';
import type {Item,ItemFormula} from '../src/shared/types';
const item=(id:string,name:string,patch:Partial<Item>={})=>({id,name,type:'product',spec:'300ml',...patch}) as Item;
function view(items:Item[],boms:{parent_id:string;child_id:string;quantity:number}[],formulas:ItemFormula[]=[]){
 setBomIndex(buildBomIndex([],[]));
 render(<BomIntegrityPanel items={items} itemFormulas={formulas} {...{bomIndex:buildBomIndex(items,boms)}}/>);
 fireEvent.click(screen.getByRole('button'));
}
it('직접 벌크 구성은 다른 회사 전역 BOM과 무관하게 원료식 누락으로 표시하지 않는다',()=>{
 view([item('p','알찬참기름'),item('raw','통깨참기름',{type:'wip',subtype:'벌크',unit:'kg'})],[{parent_id:'p',child_id:'raw',quantity:0.3}]);
 expect(screen.getByText('이상 없음')).toBeInTheDocument();
});
it('보관 품목은 미설정 경고에서 제외하되 실제 orphan 식은 남긴다',()=>{
 view([item('old','시골향참기름3',{archived:true})],[],[{id:'f',parent_key:'깨분캔',child_name:'깨분참기름',ratio:1,yield_rate:1}]);
 expect(screen.queryByText(/부자재 BOM 미설정/)).toBeNull();
 expect(screen.getByText('깨분캔')).toBeInTheDocument();
});
it('phantom 구성은 기존 공용 배합식으로 전개하고 없는 leaf 홀더를 표시한다',()=>{
 view([item('p','같은이름'),item('ph','전개원액',{type:'wip',subtype:'벌크',phantom:true})],[{parent_id:'p',child_id:'ph',quantity:1}], [{id:'f',parent_key:'전개원액',child_name:'없는원료',ratio:1,yield_rate:1}]);
 expect(screen.getByText(/원료 '없는원료' 홀더 품목 없음/)).toBeInTheDocument();
});
it('동일 이름의 다른 규격과 끊긴 BOM 참조를 구별해서 표시한다',()=>{
 view([item('a','미등록',{spec:'300ml'}),item('b','미등록',{spec:'350ml'})],[{parent_id:'a',child_id:'deleted',quantity:1}]);
 expect(screen.getAllByText(/미등록 · 300ml/).length).toBeGreaterThan(0);
 expect(screen.getAllByText(/미등록 · 350ml/).length).toBeGreaterThan(0);
 expect(screen.getByText('deleted')).toBeInTheDocument();
});

it('벌크 구성 없는 기존 품목은 서류명 원료식과 홀더로 판정한다',()=>{
 view([item('p','기존제품'),item('raw','원료',{type:'raw',subtype:'벌크'})],[],[{id:'f',parent_key:'기존제품',child_name:'원료',ratio:1,yield_rate:1}]);
 expect(screen.getByText('이상 없음')).toBeInTheDocument();
});
it('0수량 벌크 구성은 사용량 없는 문제로 남기고 품목식으로 가리지 않는다',()=>{
 view([item('p','기존제품'),item('raw','원료',{type:'raw',subtype:'벌크'})],[{parent_id:'p',child_id:'raw',quantity:0}],[{id:'f',parent_key:'기존제품',child_name:'원료',ratio:1,yield_rate:1}]);
 expect(screen.getByText(/원료 BOM 없는 완제품 1개/)).toBeInTheDocument();
});
it('양수 phantom leaf 구성이 홀더까지 연결되면 경고하지 않는다',()=>{
 view([item('p','전개제품'),item('ph','전개원액',{type:'wip',subtype:'벌크',phantom:true}),item('leaf','원료',{type:'raw',subtype:'벌크'})],[{parent_id:'p',child_id:'ph',quantity:1}],[{id:'f',parent_key:'전개원액',child_name:'원료',ratio:1,yield_rate:1}]);
 expect(screen.getByText('이상 없음')).toBeInTheDocument();
});

it('실제 반제품 원가가 사용하는 baseRawName 원료식은 orphan이 아니다',()=>{
 view([item('can','깨분참기름-캔/16.5kg',{type:'wip'}),item('raw','원료',{type:'raw',subtype:'벌크'})],[],[{id:'f',parent_key:'깨분참기름-캔',child_name:'원료',ratio:1,yield_rate:1}]);
 expect(screen.getByText('이상 없음')).toBeInTheDocument();
});
it('NaN 벌크 수량은 유효한 원료 구성으로 숨기지 않는다',()=>{
 view([item('p','미등록'),item('raw','원료',{type:'raw',subtype:'벌크'})],[{parent_id:'p',child_id:'raw',quantity:NaN}]);
 expect(screen.getByText(/원료 BOM 없는 완제품 1개/)).toBeInTheDocument();
});
