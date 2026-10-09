/** @vitest-environment jsdom */
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import ItemPriceManager from './ItemPriceManager';
import {buildBomIndex,getBomIndex,setBomIndex} from '../src/shared/bomIndex';
import {buildPackIndex} from '../src/shared/packIndex';
import type {Item} from '../src/shared/types';
const old=getBomIndex();afterEach(()=>setBomIndex(old));
it('단가 목록의 구성은 화면 회사 BOM을 사용하고 입력만 변경돼도 갱신한다',()=>{
 const items=[{id:'oil',name:'참기름',type:'product'},{id:'cap',name:'태백 마개',type:'submaterial',category:'마개'}] as Item[];
 const rows=[{parent_id:'oil',child_id:'cap',quantity:1}],own={bom:buildBomIndex(items,rows),pack:buildPackIndex([])},other={bom:buildBomIndex(items.map(i=>i.id==='cap'?{...i,name:'풍회 마개'}:i),rows),pack:own.pack};setBomIndex(other.bom);
 const props={items:[items[0]],onEditProduct:vi.fn(),onAddItem:vi.fn(),onDeleteItem:vi.fn()};
 const view=render(<ItemPriceManager {...props} orderUnitInputs={own}/>);
 expect(screen.getByText(/태백 마개/)).toBeInTheDocument();expect(screen.queryByText(/풍회 마개/)).not.toBeInTheDocument();
 view.rerender(<ItemPriceManager {...props} orderUnitInputs={other}/>);expect(screen.getByText(/풍회 마개/)).toBeInTheDocument();
});
