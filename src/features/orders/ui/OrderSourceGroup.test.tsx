/** @vitest-environment jsdom */
import React from 'react';
import {fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import type {Order,OrderSource} from '../../../shared/types';
const m=vi.hoisted(()=>({cards:[] as any[]}));
vi.mock('./OrderCard',()=>({OrderCard:(props:any)=>{m.cards.push(props);return <button data-testid="card" onClick={()=>props.onCardClick?.(props.order.id)}>{props.order.id}</button>;}}));
import {OrderSourceGroup} from './OrderSourceGroup';
beforeEach(()=>{m.cards=[];});
const fixture=()=>({colId:'pending_col',source:'전화' as OrderSource,orders:[{id:'second'},{id:'first'}] as Order[],collapsedCategories:new Set<string>(),onToggleCategory:vi.fn(),partners:[],items:[],editingOrderId:null,setEditingOrderId:vi.fn(),showAddProductSelect:null,setShowAddProductSelect:vi.fn(),onUpdateDeliveryDate:vi.fn(),onUpdateStatus:vi.fn(),onDeleteOrder:vi.fn(),onCardClick:vi.fn()});
it('빈 묶음은 제목·카드를 렌더하지 않는다',()=>{
 const {container}=render(<OrderSourceGroup {...fixture()} orders={[]}/>);expect(container).toBeEmptyDOMElement();expect(m.cards).toEqual([]);
});
it('입력 순서·grid·콜백/단위 객체를 바꾸지 않고 새 카드에 직접 전달한다',()=>{
 const props=fixture(),units={items:[]} as any,recovery=vi.fn();render(<OrderSourceGroup {...props} gridCols={3} orderUnitInputs={units} {...{renderOrderRecovery:recovery}}/>);
 expect(screen.getAllByTestId('card').map(node=>node.textContent)).toEqual(['second','first']);expect(screen.getByRole('button',{name:'전화 (2)'})).toBeInTheDocument();
 for(const card of m.cards){expect(card.gridCols).toBe(3);expect(card.orderUnitInputs).toBe(units);expect(card.onUpdateDeliveryDate).toBe(props.onUpdateDeliveryDate);expect(card.onUpdateStatus).toBe(props.onUpdateStatus);expect(card.onDeleteOrder).toBe(props.onDeleteOrder);expect(card.renderOrderRecovery).toBe(recovery);}
 fireEvent.click(screen.getByRole('button',{name:'second'}));expect(props.onCardClick).toHaveBeenCalledWith('second');
});
it('접힘키는 열과 채널을 함께 사용하고 제목 클릭은 부모에만 위임한다',()=>{
 const props=fixture();render(<OrderSourceGroup {...props} collapsedCategories={new Set(['pending_col-전화'])}/>);
 expect(screen.queryByTestId('card')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'전화 (2)'}));expect(props.onToggleCategory).toHaveBeenCalledWith('pending_col','전화');expect(m.cards).toEqual([]);
});
