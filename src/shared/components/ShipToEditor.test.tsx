/** @vitest-environment jsdom */
import React,{useState} from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import ShipToEditor from './ShipToEditor';
import type {ShipTo} from '../types';
function Editor({initial=[]}:{initial?:ShipTo[]}){const [rows,setRows]=useState(initial);return <><ShipToEditor value={rows} onChange={setRows}/><output>{JSON.stringify(rows)}</output></>}
it('새 배송지는 방식 명시선택 전에는 추가되지 않으며 선택값을 저장한다',()=>{
 render(<Editor/>);fireEvent.change(screen.getByLabelText('새 배송지 이름'),{target:{value:'새 창고'}});
 expect(screen.getByRole('button',{name:'추가'})).toBeDisabled();
 fireEvent.keyDown(screen.getByLabelText('새 배송지 이름'),{key:'Enter'});expect(screen.getByRole('status')).toHaveTextContent('[]');
 fireEvent.change(screen.getByLabelText('새 배송지 기본 배송방식'),{target:{value:'화물'}});fireEvent.click(screen.getByRole('button',{name:'추가'}));
 expect(screen.getByRole('status')).toHaveTextContent('"defaultShipMethod":"화물"');expect(screen.getByLabelText('새 배송지 기본 배송방식')).toHaveValue('');
});
it('기존 미설정 배송지는 이름 수정과 순서·보관을 허용하며 방식별로 저장한다',()=>{
 render(<Editor initial={[{id:'a',name:'옛 창고'},{id:'b',name:'둘째 창고',defaultShipMethod:'수령'}]}/>);
 expect(screen.getByLabelText('옛 창고 기본 배송방식')).toHaveValue('');
 fireEvent.change(screen.getAllByLabelText('배송지 이름')[0],{target:{value:'변경 창고'}});
 expect(screen.getByLabelText('변경 창고 기본 배송방식')).toHaveValue('');
 fireEvent.change(screen.getByLabelText('변경 창고 기본 배송방식'),{target:{value:'택배'}});
 fireEvent.click(screen.getByRole('button',{name:'둘째 창고 기본 배송지로'}));
 expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual([{id:'b',name:'둘째 창고',defaultShipMethod:'수령'},{id:'a',name:'변경 창고',defaultShipMethod:'택배'}]);
 fireEvent.click(screen.getAllByRole('button',{name:'보관'})[1]);expect(screen.getByLabelText('변경 창고 기본 배송방식')).toBeDisabled();
});

it('매입·금융용 배송지에는 방식 선택을 요구하지 않는다',()=>{const change=vi.fn();render(<ShipToEditor value={[]} onChange={change} shippingEnabled={false}/>);fireEvent.change(screen.getByLabelText('새 배송지 이름'),{target:{value:'매입 창고'}});expect(screen.queryByLabelText('새 배송지 기본 배송방식')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'추가'}));expect(change).toHaveBeenCalledWith([expect.objectContaining({name:'매입 창고'})]);expect(change.mock.calls[0][0][0]).not.toHaveProperty('defaultShipMethod');});
