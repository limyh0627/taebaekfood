/** @vitest-environment jsdom */
import React from 'react';
import {render,screen,fireEvent,waitFor,act,cleanup} from '@testing-library/react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import PasteOrderModal from './PasteOrderModal';
import {buildBomIndex} from '../src/shared/bomIndex';
import {buildPackIndex} from '../src/shared/packIndex';
const api=vi.hoisted(()=>({rules:vi.fn(),call:vi.fn()}));
vi.mock('../src/shared/services/orderCopyService',()=>({listOrderInterpretationRules:api.rules}));
vi.mock('firebase/app',()=>({getApp:()=>({})}));vi.mock('firebase/functions',()=>({getFunctions:()=>({}),httpsCallable:()=>api.call}));
const items:any[]=[{id:'oil',companyId:'taebaek',name:'참기름',type:'product',unit:'개',spec:'350ml',stock:0,minStock:0,image:''},{id:'other',companyId:'taebaek',name:'들기름',type:'product',unit:'개',spec:'350ml',stock:0,minStock:0,image:''}];
const partner:any={id:'partner',companyId:'taebaek',name:'거래처',type:'일반'};
const props={items,partners:[partner],palletStocks:[],companyId:'taebaek' as const,actorUid:'actor',orderUnitInputs:{bom:buildBomIndex(items,[]),pack:buildPackIndex([{item_id:'oil',units_per_box:12},{item_id:'other',units_per_box:12}])},onClose:vi.fn()};
beforeEach(()=>{vi.clearAllMocks();api.rules.mockResolvedValue([]);});afterEach(cleanup);
async function analyze(text:string){fireEvent.click(screen.getByRole('button',{name:'거래처'}));fireEvent.change(screen.getByPlaceholderText(/주문 내용을 그대로 붙여넣으세요/),{target:{value:text}});await act(async()=>{});fireEvent.click(screen.getByRole('button',{name:'분석하기'}));await screen.findByRole('spinbutton');}
it('공백 포함 원문·첫 판독·사람 확정 수량을 따로 보존하고 기존 박스 환산을 유지한다',async()=>{
 const save=vi.fn().mockResolvedValue(undefined);render(<PasteOrderModal {...props} onSave={save}/>);await analyze('  참기름 2박스  \n');fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'3'}});fireEvent.click(screen.getByRole('button',{name:/주문 생성/}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());const [draft,evidence]=save.mock.calls[0];expect(draft.items[0]).toMatchObject({quantity:36,boxQuantity:3,unitsPerBox:12});expect(evidence).toMatchObject({sourceText:'  참기름 2박스  \n',firstAnalysis:{kind:'rules',lines:[{qty:2}]},inputLines:[{quantity:3,isBoxUnit:true,orderedAs:'  참기름 2박스  '}]});
});
it('AI raw와 거절된 줄까지 보존하되 검증된 줄로만 최종 주문을 만든다',async()=>{
 const raw={lines:[{itemId:'other',qty:2,isBox:true,source:'들기름 두 박스'},{itemId:'missing',qty:9,source:'없는 품목'}],note:'첫 메모'};api.call.mockResolvedValue({data:raw});const save=vi.fn().mockResolvedValue(undefined);render(<PasteOrderModal {...props} onSave={save}/>);await analyze('참기름 1박스');fireEvent.click(screen.getByRole('button',{name:'AI로 다시 읽기'}));await waitFor(()=>expect(screen.getByRole('combobox')).toHaveValue('other'));fireEvent.click(screen.getByRole('button',{name:/주문 생성/}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(save.mock.calls[0][1].firstAnalysis).toMatchObject({kind:'ai',rawResponse:raw,validatedResult:{lines:[{itemId:'other'}],rejected:[{text:expect.any(String)}]},firstRules:{kind:'rules'}});expect(save.mock.calls[0][0].items).toHaveLength(1);
});
it('승인된 같은 거래처의 전체 별칭만 기존 수량과 함께 적용하고 규격은 변환하지 않는다',async()=>{
 api.rules.mockResolvedValue([{partnerId:'partner',alias:'붙임참기름 350ml',itemId:'other',status:'approved'},{partnerId:'different',alias:'참기름',itemId:'other',status:'approved'}]);const save=vi.fn();render(<PasteOrderModal {...props} onSave={save}/>);await analyze('붙임참기름 350ml 10박스');expect(screen.getByRole('combobox')).toHaveValue('other');expect(screen.getByRole('spinbutton')).toHaveValue(10);
});
it('서로 다른 품목으로 승인된 충돌 별칭은 강제로 적용하지 않는다',async()=>{
 api.rules.mockResolvedValue([{partnerId:'partner',alias:'참기름',itemId:'oil',status:'approved'},{partnerId:'partner',alias:'참기름',itemId:'other',status:'approved'}]);render(<PasteOrderModal {...props} onSave={vi.fn()}/>);await analyze('참기름 2개');expect(screen.getByRole('combobox')).toHaveValue('oil');expect(api.call).not.toHaveBeenCalled();
});
it('승인 목록의 늦은 답은 사람이 바꾼 원문과 거래처 판독을 덮지 않는다',async()=>{
 let finish!:(rows:any[])=>void;const pending=new Promise<any[]>(resolve=>finish=resolve);api.rules.mockReturnValue(pending);render(<PasteOrderModal {...props} onSave={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'거래처'}));const input=screen.getByPlaceholderText(/주문 내용을 그대로 붙여넣으세요/);fireEvent.change(input,{target:{value:'참기름 2박스'}});fireEvent.click(screen.getByRole('button',{name:'분석하기'}));fireEvent.change(input,{target:{value:'사람이 바꾼 새 원문'}});await act(async()=>{finish([{partnerId:'partner',alias:'참기름',itemId:'other',status:'approved'}]);await pending;});expect(input).toHaveValue('사람이 바꾼 새 원문');expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
});
it('복구 상세를 여는 동안 Escape로 숨겨진 작성창을 닫거나 입력을 초기화하지 않는다',async()=>{
 const save=vi.fn(),close=vi.fn(),view=render(<PasteOrderModal {...props} onClose={close} onSave={save}/>);await analyze('참기름 2박스');view.rerender(<PasteOrderModal {...props} suspended onClose={close} onSave={save}/>);fireEvent.keyDown(document,{key:'Escape'});expect(close).not.toHaveBeenCalled();view.rerender(<PasteOrderModal {...props} onClose={close} onSave={save}/>);expect(screen.getByRole('spinbutton')).toHaveValue(2);
});
