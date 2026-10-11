/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Item, Partner } from '../src/shared/types';
import { buildBomIndex } from '../src/shared/bomIndex';
import { buildPackIndex } from '../src/shared/packIndex';
const api=vi.hoisted(()=>({call:vi.fn()}));
vi.mock('firebase/app',()=>({getApp:()=>({})}));
vi.mock('firebase/functions',()=>({getFunctions:()=>({}),httpsCallable:()=>api.call}));
import PasteOrderModal from './PasteOrderModal';

const items:Item[]=[{id:'oil',companyId:'taebaek',name:'참기름',type:'product',unit:'개',spec:'350ml',stock:0,minStock:0,image:''},
 {id:'perilla',companyId:'taebaek',name:'들기름',type:'product',unit:'개',spec:'350ml',stock:0,minStock:0,image:''}];
const partner:Partner={id:'client',companyId:'taebaek',name:'원본 거래처',type:'일반',address:'첫 주소',
 shipTos:[{id:'a',name:'첫 배송지'},{id:'b',name:'둘째 배송지'}]};
const second:Partner={...partner,id:'second',name:'다른 거래처'};
const inputs={bom:buildBomIndex(items,[]),pack:buildPackIndex([{item_id:'oil',units_per_box:12},{item_id:'perilla',units_per_box:12}])};
const props={items,partners:[partner,second],palletStocks:[],orderUnitInputs:inputs,onClose:vi.fn()};
const staleText='AI가 읽는 동안 주문 입력이 바뀌어 응답을 적용하지 않았습니다. 현재 입력을 보존했습니다.';
function deferred(){let resolve!:(value:unknown)=>void,reject!:(error:Error)=>void;const promise=new Promise((ok,bad)=>{resolve=ok;reject=bad;});return {promise,resolve,reject};}
const answer=()=>({data:{lines:[{itemId:'perilla',qty:2,isBox:true,source:'들기름 두 박스'}],deliveryDate:'2026-11-12',note:'AI 메모'}});
function review(){
 fireEvent.click(screen.getByRole('button',{name:'원본 거래처'}));
 fireEvent.change(screen.getByLabelText('주문일'),{target:{value:'2026-11-01'}});
 fireEvent.change(screen.getByLabelText('출고예정일'),{target:{value:'2026-11-10'}});
 fireEvent.change(screen.getByPlaceholderText(/주문 내용을 그대로 붙여넣으세요/),{target:{value:'참기름 3개'}});
 fireEvent.click(screen.getByRole('button',{name:'분석하기'}));
}
function beginRead(){const pending=deferred();api.call.mockReturnValueOnce(pending.promise);fireEvent.click(screen.getByRole('button',{name:'AI로 다시 읽기'}));return pending;}
async function finish(pending:ReturnType<typeof deferred>){await act(async()=>{pending.resolve(answer());await pending.promise;});}
beforeEach(()=>{api.call.mockReset();props.onClose.mockReset();vi.spyOn(console,'error').mockImplementation(()=>{});});

it('변경 없는 정상 AI 답은 품목·수량·박스 단위·메모·배송일에 적용한다',async()=>{
 const save=vi.fn().mockResolvedValue(undefined);render(<PasteOrderModal {...props} onSave={save}/>);review();
 const pending=beginRead();expect(api.call).toHaveBeenCalledTimes(1);await finish(pending);
 expect(screen.getByRole('combobox')).toHaveValue('perilla');expect(screen.getByRole('spinbutton')).toHaveValue(2);
 expect(screen.getByLabelText('주문 비고')).toHaveValue('AI 메모');expect(screen.getByLabelText('출고예정일')).toHaveValue('2026-11-12');
 fireEvent.click(screen.getByRole('button',{name:/주문 생성/}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));
 expect(save.mock.calls[0][0]).toMatchObject({partnerId:'client',shipToId:'a',note:'AI 메모',deliveryDate:'2026-11-12T00:00:00.000Z',items:[{itemId:'perilla',quantity:24,isBoxUnit:true,boxQuantity:2,orderedAs:'들기름 두 박스'}]});
});

it('사람이 품목·수량·단위·메모·배송일·주소를 고치면 늦은 답이 덮지 않고 그 내용으로 저장한다',async()=>{
 const save=vi.fn().mockResolvedValue(undefined);render(<PasteOrderModal {...props} onSave={save}/>);review();const pending=beginRead();
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'oil'}});
 fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'7'}});fireEvent.click(screen.getByRole('button',{name:'박스'}));
 fireEvent.change(screen.getByLabelText('주문 비고'),{target:{value:'사람 메모'}});fireEvent.click(screen.getByRole('checkbox'));
 fireEvent.change(screen.getByLabelText('출고예정일'),{target:{value:'2026-11-15'}});fireEvent.click(screen.getByRole('button',{name:'둘째 배송지'}));
 await finish(pending);expect(screen.getByText(staleText)).toBeInTheDocument();expect(screen.getByRole('spinbutton')).toHaveValue(7);
 expect(screen.getByRole('combobox')).toHaveValue('oil');expect(screen.getByLabelText('주문 비고')).toHaveValue('사람 메모');
 fireEvent.click(screen.getByRole('button',{name:/주문 생성/}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));
 expect(save.mock.calls[0][0]).toMatchObject({partnerId:'client',shipToId:'b',note:'사람 메모',noteImportant:true,deliveryDate:'2026-11-15T00:00:00.000Z',items:[{itemId:'oil',quantity:84,isBoxUnit:true,boxQuantity:7,orderedAs:'참기름 3개'}]});
});

it('수량을 고쳤다가 요청 당시 값으로 되돌려도 사람의 확정 세대를 보존한다',async()=>{
 render(<PasteOrderModal {...props} onSave={vi.fn()}/>);review();const pending=beginRead();
 fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'9'}});fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'3'}});
 await finish(pending);expect(screen.getByRole('spinbutton')).toHaveValue(3);expect(screen.getByText(staleText)).toBeInTheDocument();
});

it('원문을 다시 입력하고 분석한 뒤에는 이전 요청의 답을 적용하지 않는다',async()=>{
 render(<PasteOrderModal {...props} onSave={vi.fn()}/>);review();const pending=beginRead();
 fireEvent.click(screen.getByRole('button',{name:'원문 수정'}));fireEvent.change(screen.getByPlaceholderText(/주문 내용을 그대로 붙여넣으세요/),{target:{value:'참기름 8개'}});
 fireEvent.click(screen.getByRole('button',{name:'분석하기'}));await finish(pending);
 expect(screen.getByRole('spinbutton')).toHaveValue(8);expect(within(screen.getByRole('heading',{name:'원본 주문'}).closest('section')!).getByText('참기름 8개')).toBeInTheDocument();expect(screen.getByText(staleText)).toBeInTheDocument();
});

it('거래처를 전환한 뒤 이전 거래처의 지연 답으로 새 주문을 바꾸지 않는다',async()=>{
 const save=vi.fn().mockResolvedValue(undefined);render(<PasteOrderModal {...props} onSave={save}/>);review();const pending=beginRead();
 fireEvent.click(screen.getByRole('button',{name:'거래처 다시 선택'}));fireEvent.click(screen.getByRole('button',{name:'다른 거래처'}));
 fireEvent.change(screen.getByPlaceholderText(/주문 내용을 그대로 붙여넣으세요/),{target:{value:'참기름 5개'}});fireEvent.click(screen.getByRole('button',{name:'분석하기'}));
 await finish(pending);expect(screen.getByRole('spinbutton')).toHaveValue(5);expect(screen.getByText(staleText)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/주문 생성/}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));expect(save.mock.calls[0][0]).toMatchObject({partnerId:'second',items:[{itemId:'oil',quantity:5}]});
});

it('같은 ID라도 회사와 주소 원문이 갱신되면 이전 응답을 적용하지 않는다',async()=>{
 const save=vi.fn().mockResolvedValue(undefined);const view=render(<PasteOrderModal {...props} onSave={save}/>);review();const pending=beginRead();
 view.rerender(<PasteOrderModal {...props} items={items.map(item=>({...item,companyId:'punghoe'}))} partners={[{...partner,companyId:'punghoe',address:'새 주소',shipTos:[{id:'a',name:'첫 배송지 갱신'}]}]} onSave={save}/>);
 await finish(pending);expect(screen.getByRole('spinbutton')).toHaveValue(3);expect(screen.getByLabelText('출고예정일')).toHaveValue('2026-11-10');expect(screen.getByText(staleText)).toBeInTheDocument();
});

it('주문 저장이 실패해 검토 화면에 남아도 저장 승인 뒤 늦은 AI 답으로 내용이 바뀌지 않는다',async()=>{
 const save=vi.fn().mockRejectedValue(Error('합성 저장 실패'));render(<PasteOrderModal {...props} onSave={save}/>);review();const pending=beginRead();
 fireEvent.click(screen.getByRole('button',{name:/주문 생성/}));await screen.findByText('저장하지 못했습니다: 합성 저장 실패');
 await finish(pending);expect(save.mock.calls[0][0]).toMatchObject({items:[{itemId:'oil',quantity:3}]});
 expect(screen.getByRole('spinbutton')).toHaveValue(3);expect(screen.getByLabelText('주문 비고')).toHaveValue('');expect(screen.getByText(staleText)).toBeInTheDocument();
});

it('닫기 요청 뒤 늦은 답은 닫힌 모달의 검토 입력에 적용하지 않는다',async()=>{
 render(<PasteOrderModal {...props} onSave={vi.fn()}/>);review();const pending=beginRead();
 fireEvent.click(screen.getByRole('button',{name:'주문 등록 · 주문 내역 붙여넣기 닫기'}));expect(props.onClose).toHaveBeenCalledTimes(1);
 await finish(pending);expect(screen.getByRole('spinbutton')).toHaveValue(3);expect(screen.getByLabelText('주문 비고')).toHaveValue('');
});

it('늦은 AI 오류도 사람 입력을 보존하고 현재 입력이 바뀌었다는 안내를 유지한다',async()=>{
 render(<PasteOrderModal {...props} onSave={vi.fn()}/>);review();const pending=beginRead();
 fireEvent.change(screen.getByLabelText('주문 비고'),{target:{value:'확정 메모'}});
 await act(async()=>{pending.reject(Error('합성 AI 오류'));await pending.promise.catch(()=>{});});
 expect(screen.getByLabelText('주문 비고')).toHaveValue('확정 메모');expect(screen.getByText(staleText)).toBeInTheDocument();expect(screen.queryByText(/읽지 못했습니다/)).toBeNull();
});

it('진행 중 같은 버튼을 다시 눌러도 기존 AI 요청만 보낸다',async()=>{
 render(<PasteOrderModal {...props} onSave={vi.fn()}/>);review();const pending=beginRead();
 fireEvent.click(screen.getByRole('button',{name:'읽는 중…'}));expect(api.call).toHaveBeenCalledTimes(1);await finish(pending);
});


it.each(['2026-02-30', '2026-04-31', '2026-02-29'])('AI가 불가능한 날짜 %s를 보내도 기존 날짜로 정상 주문을 저장한다', async deliveryDate => {
 const save=vi.fn().mockResolvedValue(undefined);render(<PasteOrderModal {...props} onSave={save}/>);review();const pending=beginRead();
 await act(async()=>{pending.resolve({data:{...answer().data,deliveryDate}});await pending.promise;});
 expect(screen.getByLabelText('주문일')).toHaveValue('2026-11-01');expect(screen.getByLabelText('출고예정일')).toHaveValue('2026-11-10');
 expect(screen.getByRole('combobox')).toHaveValue('perilla');expect(screen.getByRole('spinbutton')).toHaveValue(2);expect(screen.getByLabelText('주문 비고')).toHaveValue('AI 메모');
 const create=screen.getByRole('button',{name:/주문 생성/});expect(create).toBeEnabled();fireEvent.click(create);await waitFor(()=>expect(save).toHaveBeenCalledOnce());
 expect(save.mock.calls[0][0]).toMatchObject({deliveryDate:'2026-11-10T00:00:00.000Z',note:'AI 메모',items:[{itemId:'perilla',quantity:24,isBoxUnit:true,boxQuantity:2}]});expect(api.call).toHaveBeenCalledOnce();
});
it('윤년의 실제 날짜는 AI 응답에서 정확히 적용하고 저장한다',async()=>{
 const save=vi.fn().mockResolvedValue(undefined);render(<PasteOrderModal {...props} onSave={save}/>);review();const pending=beginRead();
 await act(async()=>{pending.resolve({data:{...answer().data,deliveryDate:'2028-02-29'}});await pending.promise;});expect(screen.getByLabelText('출고예정일')).toHaveValue('2028-02-29');
 fireEvent.click(screen.getByRole('button',{name:/주문 생성/}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(save.mock.calls[0][0]).toMatchObject({deliveryDate:'2028-02-29T00:00:00.000Z'});
});
