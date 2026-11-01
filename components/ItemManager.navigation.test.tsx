/** @vitest-environment jsdom */
import React from 'react';
import {fireEvent,render,screen,within} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import ItemManager from './ItemManager';
import type {Item} from '../types';
vi.mock('../src/shared/services/firebaseService',()=>({fetchCollection:vi.fn().mockResolvedValue([])}));
const item={id:'one',companyId:'taebaek',name:'합성 참기름',type:'product',category:'기름'} as Item;
const props=()=>({companyId:'taebaek' as const,items:[item],partners:[],onEditProduct:vi.fn(),onAddItem:vi.fn(),onDeleteItem:vi.fn(),onLinkItem:vi.fn(),onUnlinkItem:vi.fn()});
it('관리자는 표 행과 품목명으로 수정하고 행의 삭제 버튼은 수정 진입을 만들지 않는다',()=>{
 const p=props();render(<ItemManager {...p}/>);const name=screen.getByRole('button',{name:'합성 참기름 품목 수정'});const row=name.closest('tr')!;
 fireEvent.click(row);expect(p.onEditProduct).toHaveBeenCalledWith(item);fireEvent.keyDown(row,{key:'Enter'});expect(p.onEditProduct).toHaveBeenCalledTimes(2);fireEvent.click(name);expect(p.onEditProduct).toHaveBeenCalledTimes(3);
 fireEvent.click(within(row).getByTitle('삭제'));expect(p.onDeleteItem).toHaveBeenCalledWith(item.id,item.type);expect(p.onEditProduct).toHaveBeenCalledTimes(3);
});
it('직원은 수정 진입을 얻지 않는다',()=>{const p=props();render(<ItemManager {...p} isAdmin={false}/>);expect(screen.queryByRole('button',{name:'합성 참기름 품목 수정'})).toBeNull();expect(p.onEditProduct).not.toHaveBeenCalled();});
