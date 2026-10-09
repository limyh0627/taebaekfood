/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StatementQuickItemBar from './StatementQuickItemBar';

const props = {
  name: '참기름', spec: '350ml', quantity: '2', price: '11000', note: '', searchOpen: true,
  results: [], productCost: 8000, salePrice: 11000, unitSupply: 10000, supply: 20000,
  tax: 2000, marginRate: 0.2, showUnitSupply: true, formatAmount: (n: number) => n.toLocaleString(),
  onNameChange: vi.fn(), onNameFocus: vi.fn(), onNameBlur: vi.fn(), onSpecChange: vi.fn(),
  onQuantityChange: vi.fn(), onPriceChange: vi.fn(), onNoteChange: vi.fn(), onSelect: vi.fn(),
  onAdd: vi.fn(), onOpenPicker: vi.fn(),
};

describe('StatementQuickItemBar', () => {
  it('전표 입력값과 공급가·세액·마진을 함께 보여 준다', () => {
    render(<StatementQuickItemBar {...props}/>);
    expect(screen.getByDisplayValue('참기름')).toBeTruthy();
    expect(screen.getByText('20,000')).toBeTruthy();
    expect(screen.getByText('2,000')).toBeTruthy();
    expect(screen.getByText('20.0%')).toBeTruthy();
  });

  it('직접 추가와 품목 선택 동작을 부모에 전달한다', () => {
    const onAdd = vi.fn();
    const onOpenPicker = vi.fn();
    render(<StatementQuickItemBar {...props} onAdd={onAdd} onOpenPicker={onOpenPicker}/>);
    fireEvent.click(screen.getByRole('button', { name: '직접 추가' }));
    fireEvent.click(screen.getByRole('button', { name: '품목 선택' }));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onOpenPicker).toHaveBeenCalledOnce();
  });
});

import {buildBomIndex,getBomIndex,setBomIndex} from '../../../shared/bomIndex';
import type {Item} from '../../../shared/types';
const originalBom=getBomIndex();afterEach(()=>setBomIndex(originalBom));
it('빠른 품목 검색의 부자재 태그는 회사 명시 BOM을 따른다',()=>{
 const items=[{id:'oil',name:'참기름',type:'product'},{id:'cap',name:'태백 마개',type:'submaterial',category:'마개'}] as Item[];
 const own=buildBomIndex(items,[{parent_id:'oil',child_id:'cap',quantity:1}]);
 setBomIndex(buildBomIndex(items.map(i=>i.id==='cap'?{...i,name:'풍회 마개'}:i),[{parent_id:'oil',child_id:'cap',quantity:1}]));
 render(<StatementQuickItemBar {...props} results={[{pc:{id:'link'},product:items[0]}]} bomIndex={own}/>);
 expect(screen.getByText('태백 마개')).toBeInTheDocument();expect(screen.queryByText('풍회 마개')).not.toBeInTheDocument();
});
