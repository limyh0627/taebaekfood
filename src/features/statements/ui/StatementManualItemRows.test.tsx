/** @vitest-environment jsdom */
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import StatementManualItemRows from './StatementManualItemRows';
import {buildBomIndex,getBomIndex,setBomIndex} from '../../../shared/bomIndex';
import type {Item} from '../../../shared/types';
const original=getBomIndex();afterEach(()=>setBomIndex(original));
it('수동 품목 검색은 같은 ID의 상대 회사 BOM을 섞지 않는다',()=>{
 const items=[{id:'oil',name:'참기름',type:'product'},{id:'cap',name:'태백 마개',type:'submaterial',category:'마개'}] as Item[];
 const rows=[{parent_id:'oil',child_id:'cap',quantity:1}],own=buildBomIndex(items,rows),other=buildBomIndex(items.map(i=>i.id==='cap'?{...i,name:'풍회 마개'}:i),rows);setBomIndex(other);
 const props={rows:[{name:'참기름',spec:'',qty:'1',price:'1000',isTaxExempt:false}],readOnly:false,selectedIndex:0,activeSearchIndex:0,statementType:'매출',accountCodes:[],formatAmount:String,searchResults:()=>[{pc:{id:'link'},product:items[0]}],onSelect:vi.fn(),onChange:vi.fn(),onSearchFocus:vi.fn(),onSearchBlur:vi.fn(),onChooseProduct:vi.fn(),onRemove:vi.fn()};
 const view=render(<table><tbody><StatementManualItemRows {...props} bomIndex={own}/></tbody></table>);
 expect(screen.getByText('태백 마개')).toBeInTheDocument();
 view.rerender(<table><tbody><StatementManualItemRows {...props} bomIndex={other}/></tbody></table>);
 expect(screen.getByText('풍회 마개')).toBeInTheDocument();
});
