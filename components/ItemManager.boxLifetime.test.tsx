/** @vitest-environment jsdom */
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import ItemManager from './ItemManager';
import type {Item} from '../types';
vi.mock('../src/shared/services/firebaseService',()=>({fetchCollection:vi.fn(async()=>[])}));
const purchase=vi.hoisted(()=>({subscribe:vi.fn(),save:vi.fn()}));
vi.mock('../src/shared/services/itemPurchaseUnitService',()=>({subscribeItemPurchaseUnits:(...a:unknown[])=>purchase.subscribe(...a),saveItemPurchaseUnit:(...a:unknown[])=>purchase.save(...a)}));
afterEach(cleanup);
const items:Item[]=[{id:'unit-a',name:'합성 기름',unit:'병',type:'product',stock:0,minStock:0,image:'',companyId:'taebaek'}];
const props={companyId:'taebaek' as const,items,partners:[],onEditProduct:vi.fn(),onAddItem:vi.fn(),onDeleteItem:vi.fn(),onLinkItem:vi.fn(),onUnlinkItem:vi.fn()};
it('박스 만들기 대기에는 개입수와 취소를 잠가 원초안을 보존한다',()=>{render(<ItemManager {...props} onCreateBoxItem={()=>new Promise(()=>{})}/>);fireEvent.click(screen.getByTitle('이 낱개로 박스 품목 만들기'));const dialog=screen.getByRole('dialog',{name:'박스 품목 만들기'});fireEvent.click(within(dialog).getByRole('button',{name:'만들기'}));expect(within(dialog).getAllByRole('spinbutton')[0]).toBeDisabled();expect(within(dialog).getByRole('button',{name:'취소'})).toBeDisabled();});
it('회사/요청세대가 바뀌면 이전 매입단위 선택은 렌더 전에 폐기되고 왕복해도 되살아나지 않는다',()=>{purchase.subscribe.mockImplementation((_c:string,cb:(v:unknown[])=>void)=>{cb([]);return()=>{};});purchase.subscribe.mockClear();const raw:Item={...items[0],subtype:'벌크'};const view=render(<ItemManager {...props} items={[raw]} requestScopeKey="A"/>);fireEvent.click(screen.getByRole('button',{name:'매입단위'}));expect(screen.getByRole('dialog',{name:'매입단위 관리'})).toBeInTheDocument();expect(purchase.subscribe).toHaveBeenCalledTimes(1);view.rerender(<ItemManager {...props} companyId="punghoe" items={[raw]} requestScopeKey="B"/>);expect(screen.queryByRole('dialog',{name:'매입단위 관리'})).toBeNull();expect(purchase.subscribe).toHaveBeenCalledTimes(1);expect(purchase.save).not.toHaveBeenCalled();view.rerender(<ItemManager {...props} items={[raw]} requestScopeKey="A"/>);expect(screen.queryByRole('dialog',{name:'매입단위 관리'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'매입단위'}));expect(purchase.subscribe).toHaveBeenCalledTimes(2);});
