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
it('실제 애매 분류로 초기 성공 1·확인 2와 부분 AI 후 성공 2·확인 1을 표시한다',async()=>{
 api.call.mockImplementation(async(input)=>({data:{results:[{sourceId:input.scopedSources[0].sourceId,lines:[{itemId:'other',qty:2,isBox:true,source:input.scopedSources[0].text}],rejected:[]},{sourceId:input.scopedSources[1].sourceId,lines:[],rejected:[{text:input.scopedSources[1].text}]}]}}));
 render(<PasteOrderModal {...props} onSave={vi.fn()}/>);await analyze('참기름 2박스\n들기름 두 박스요\n참기름 조금요');expect(screen.getByRole('status')).toHaveTextContent('성공 1건 · 확인 필요 2건');expect(screen.getAllByText('분석 성공')).toHaveLength(1);expect(screen.getAllByText('확인 필요',{exact:true})).toHaveLength(2);
 fireEvent.click(screen.getByRole('button',{name:'AI로 다시 읽기'}));await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('성공 2건 · 확인 필요 1건'));expect(screen.getByText('AI 판독 반영')).toBeInTheDocument();fireEvent.change(screen.getAllByRole('spinbutton')[2],{target:{value:'3'}});expect(screen.getByText('직접 확인')).toBeInTheDocument();expect(screen.getByRole('status')).toHaveTextContent('성공 3건 · 확인 필요 0건');
});
it('규격만 적힌 줄은 기본 수량 1로 확정하지 않고 명시 주문 수량이 있는 줄은 유지한다',async()=>{
 const sized=items.map(item=>({...item,spec:'1L'}));api.call.mockImplementation(async(input)=>({data:{results:input.scopedSources.map((source:any)=>({sourceId:source.sourceId,lines:[],rejected:[{text:source.text}]}))}}));
 render(<PasteOrderModal {...props} items={sized} onSave={vi.fn()}/>);await analyze('참기름 1L\n들기름 1L 2박스');fireEvent.click(screen.getByRole('button',{name:'AI로 다시 읽기'}));await waitFor(()=>expect(api.call).toHaveBeenCalledOnce());expect(api.call.mock.calls[0][0].scopedSources.map((source:any)=>source.text)).toEqual(['참기름 1L']);expect(screen.getAllByRole('spinbutton')[1]).toHaveValue(2);
});
async function analyze(text:string){fireEvent.click(screen.getByRole('button',{name:'거래처'}));fireEvent.change(screen.getByPlaceholderText(/주문 내용을 그대로 붙여넣으세요/),{target:{value:text}});await act(async()=>{});fireEvent.click(screen.getByRole('button',{name:'분석하기'}));await screen.findAllByRole('spinbutton');}
it('공백 포함 원문·첫 판독·사람 확정 수량을 따로 보존하고 기존 박스 환산을 유지한다',async()=>{
 const save=vi.fn().mockResolvedValue(undefined);render(<PasteOrderModal {...props} onSave={save}/>);await analyze('  참기름 2박스  \n');fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'3'}});fireEvent.click(screen.getByRole('button',{name:/주문 생성/}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());const [draft,evidence]=save.mock.calls[0];expect(draft.items[0]).toMatchObject({quantity:36,boxQuantity:3,unitsPerBox:12});expect(evidence).toMatchObject({sourceText:'  참기름 2박스  \n',firstAnalysis:{kind:'rules',lines:[{qty:2}]},inputLines:[{quantity:3,isBoxUnit:true,orderedAs:'  참기름 2박스  '}]});
});
it('부분 AI raw와 거절된 구간은 보존하고 최초 규칙 판독을 바꾸지 않는다',async()=>{
 let raw:unknown;api.call.mockImplementation(async(input)=>{raw={results:[{sourceId:input.scopedSources[0].sourceId,lines:[{itemId:'other',qty:2,isBox:true,source:input.scopedSources[0].text}],rejected:[]},{sourceId:input.scopedSources[1].sourceId,lines:[],rejected:[{text:input.scopedSources[1].text,reason:'직접 확인'}]}]};return {data:raw};});
 const save=vi.fn().mockResolvedValue(undefined);render(<PasteOrderModal {...props} onSave={save}/>);await analyze('들기름 두 박스\n모르는품목??');fireEvent.click(screen.getByRole('button',{name:'AI로 다시 읽기'}));await waitFor(()=>expect(screen.getAllByRole('spinbutton')[0]).toHaveValue(2));
 fireEvent.click(screen.getByRole('button',{name:/주문 생성/}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(save.mock.calls[0][1].firstAnalysis).toMatchObject({kind:'rules',lines:[{qty:1},{rawText:'모르는품목??'}],scopedAiEvidence:{rawResponse:raw,validatedResult:{results:[{lines:[{itemId:'other'}]}],unresolvedSourceIds:[expect.any(String)]}}});expect(save.mock.calls[0][0].items).toHaveLength(1);
});
it('승인된 같은 거래처의 전체 별칭만 기존 수량과 함께 적용하고 규격은 변환하지 않는다',async()=>{
 api.rules.mockResolvedValue([{partnerId:'partner',alias:'붙임참기름 350ml',itemId:'other',status:'approved'},{partnerId:'different',alias:'참기름',itemId:'other',status:'approved'}]);const save=vi.fn();render(<PasteOrderModal {...props} onSave={save}/>);await analyze('붙임참기름 350ml 10박스');expect(screen.getByRole('combobox')).toHaveValue('other');expect(screen.getByRole('spinbutton')).toHaveValue(10);
});
it('서로 다른 품목으로 승인된 충돌 별칭은 강제로 적용하지 않는다',async()=>{
 api.rules.mockResolvedValue([{partnerId:'partner',alias:'참기름',itemId:'oil',status:'approved'},{partnerId:'partner',alias:'참기름',itemId:'other',status:'approved'}]);render(<PasteOrderModal {...props} onSave={vi.fn()}/>);await analyze('참기름 2개');expect(screen.getByRole('combobox')).toHaveValue('');expect(screen.getByRole('spinbutton')).toHaveValue(2);expect(api.call).not.toHaveBeenCalled();
});
it('승인 목록의 늦은 답은 사람이 바꾼 원문과 거래처 판독을 덮지 않는다',async()=>{
 let finish!:(rows:any[])=>void;const pending=new Promise<any[]>(resolve=>finish=resolve);api.rules.mockReturnValue(pending);render(<PasteOrderModal {...props} onSave={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'거래처'}));const input=screen.getByPlaceholderText(/주문 내용을 그대로 붙여넣으세요/);fireEvent.change(input,{target:{value:'참기름 2박스'}});fireEvent.click(screen.getByRole('button',{name:'분석하기'}));fireEvent.change(input,{target:{value:'사람이 바꾼 새 원문'}});await act(async()=>{finish([{partnerId:'partner',alias:'참기름',itemId:'other',status:'approved'}]);await pending;});expect(input).toHaveValue('사람이 바꾼 새 원문');expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
});
it('복구 상세를 여는 동안 Escape로 숨겨진 작성창을 닫거나 입력을 초기화하지 않는다',async()=>{
 const save=vi.fn(),close=vi.fn(),view=render(<PasteOrderModal {...props} onClose={close} onSave={save}/>);await analyze('참기름 2박스');view.rerender(<PasteOrderModal {...props} suspended onClose={close} onSave={save}/>);fireEvent.keyDown(document,{key:'Escape'});expect(close).not.toHaveBeenCalled();view.rerender(<PasteOrderModal {...props} onClose={close} onSave={save}/>);expect(screen.getByRole('spinbutton')).toHaveValue(2);
});
it('원문 구간을 명시 확인한 비고만 제안하고 회사공통은 직접 선택한다',async()=>{
 const text='참기름10박스\n스티커X\n일요일방문',save=vi.fn();render(<PasteOrderModal {...props} onSave={save}/>);fireEvent.click(screen.getByRole('button',{name:'거래처'}));fireEvent.change(screen.getByPlaceholderText(/주문 내용을 그대로 붙여넣으세요/),{target:{value:text}});fireEvent.click(screen.getByRole('button',{name:'분석하기'}));await screen.findByText('원문 표현 확인');fireEvent.click(screen.getByText('원문 표현 확인'));const sticker=text.indexOf('스티커X'),visit=text.indexOf('일요일방문');expect(screen.queryByLabelText('수령 방식')).toBeNull();expect(screen.getByLabelText(`표현 ${visit} 확인값`)).toHaveValue('일요일방문');fireEvent.click(screen.getByLabelText(`표현 ${sticker} 내용 확인`));fireEvent.click(screen.getByLabelText(`표현 ${sticker} 규칙 제안`));fireEvent.change(screen.getByLabelText(`표현 ${sticker} 적용 범위`),{target:{value:'company'}});fireEvent.click(screen.getByRole('button',{name:/주문 생성/}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(save.mock.calls[0][0]).toMatchObject({note:'스티커 없이',shipMethod:'배송',items:[{quantity:120}]});expect(save.mock.calls[0][1].expressionConfirmations).toEqual([{sourceStart:sticker,sourceEnd:sticker+4,sourceText:'스티커X',scope:'company',target:'note',value:'스티커 없이'}]);
});
it('숫자 미리는 판독사본에서ml로 적용하지만 전체원문·최초행·붙은수량을 보존한다',async()=>{
 api.rules.mockResolvedValue([{partnerId:'partner',alias:'붙임참기름350ml',itemId:'other',status:'approved'}]);const save=vi.fn().mockResolvedValue(undefined);render(<PasteOrderModal {...props} onSave={save}/>);await analyze('붙임참기름350미리10박스');expect(screen.getByRole('combobox')).toHaveValue('other');expect(screen.getByRole('spinbutton')).toHaveValue(10);fireEvent.click(screen.getByRole('button',{name:/주문 생성/}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(save.mock.calls[0][1]).toMatchObject({sourceText:'붙임참기름350미리10박스',inputLines:[{orderedAs:'붙임참기름350미리10박스',quantity:10}]});expect(save.mock.calls[0][0].items[0]).toMatchObject({quantity:120,boxQuantity:10});
});

it.each([false,true])('자동 비고만 원문 변경 시 회수하고 직접 수정한 비고는 보존한다: %s',async manual=>{
 api.rules.mockResolvedValue([{kind:'expression',scope:'partner',partnerId:'partner',alias:'스티커X',target:'note',value:'스티커 없이',status:'approved'}]);const save=vi.fn();render(<PasteOrderModal {...props} onSave={save}/>);fireEvent.click(screen.getByRole('button',{name:'거래처'}));fireEvent.change(screen.getByPlaceholderText(/주문 내용을 그대로 붙여넣으세요/),{target:{value:'참기름10박스\n스티커X'}});fireEvent.click(screen.getByRole('button',{name:'분석하기'}));await screen.findAllByRole('spinbutton');expect(screen.getByLabelText('주문 비고')).toHaveValue('스티커 없이');if(manual)fireEvent.change(screen.getByLabelText('주문 비고'),{target:{value:'직접 확인한 메모\n스티커 없이'}});fireEvent.click(screen.getByRole('button',{name:'원문 수정'}));fireEvent.change(screen.getByPlaceholderText(/주문 내용을 그대로 붙여넣으세요/),{target:{value:'참기름2박스'}});fireEvent.click(screen.getByRole('button',{name:'분석하기'}));await screen.findByRole('spinbutton');expect(screen.getByLabelText('주문 비고')).toHaveValue(manual?'직접 확인한 메모\n스티커 없이':'');
});

it('이전 거래처의 자동 비고는 다른 거래처 주문에 옮기지 않는다',async()=>{
 api.rules.mockResolvedValue([{kind:'expression',scope:'partner',partnerId:'partner',alias:'스티커X',target:'note',value:'스티커 없이',status:'approved'}]);render(<PasteOrderModal {...props} partners={[partner,{...partner,id:'b',name:'다른 거래처',type:'택배'}]} onSave={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'거래처'}));fireEvent.change(screen.getByPlaceholderText(/주문 내용을 그대로 붙여넣으세요/),{target:{value:'참기름10박스\n스티커X'}});fireEvent.click(screen.getByRole('button',{name:'분석하기'}));await screen.findAllByRole('spinbutton');expect(screen.getByLabelText('주문 비고')).toHaveValue('스티커 없이');fireEvent.click(screen.getByRole('button',{name:/거래처 다시 선택/}));fireEvent.click(screen.getByRole('button',{name:'다른 거래처'}));fireEvent.change(screen.getByPlaceholderText(/주문 내용을 그대로 붙여넣으세요/),{target:{value:'참기름10박스'}});fireEvent.click(screen.getByRole('button',{name:'분석하기'}));await screen.findByRole('spinbutton');expect(screen.getByLabelText('주문 비고')).toHaveValue('');
});


it.each([false,true])('승인 별칭이 충돌하면 자동 품목을 해제하며 한쪽이 목록 밖이어도 충돌을 숨기지 않는다: %s',async outside=>{
 const text='  참기름350ml 2박스  ',save=vi.fn().mockResolvedValue(undefined);
 api.rules.mockResolvedValue([{partnerId:'partner',alias:'참기름350ml',itemId:'oil',status:'approved'},{partnerId:'partner',alias:'참기름350ml',itemId:outside?'outside':'other',status:'approved'}]);
 render(<PasteOrderModal {...props} onSave={save}/>);await analyze(text);
 expect(screen.getByRole('combobox')).toHaveValue('');expect(screen.getByRole('spinbutton')).toHaveValue(2);
 expect(screen.getByText(/같은 표현에 서로 다른 품목이 승인되어/)).toHaveTextContent('품목을 직접 선택해 주세요.');
 expect(screen.getByRole('button',{name:/주문 생성/})).toBeDisabled();expect(api.call).not.toHaveBeenCalled();
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'oil'}});fireEvent.click(screen.getByRole('button',{name:/주문 생성/}));
 await waitFor(()=>expect(save).toHaveBeenCalledOnce());
 const [draft,evidence]=save.mock.calls[0];expect(draft.items[0]).toMatchObject({itemId:'oil',quantity:24,boxQuantity:2,orderedAs:text.trim()});
 expect(evidence).toMatchObject({sourceText:text,firstAnalysis:{kind:'rules',lines:[{qty:2,rawText:text,selectedProductId:null}]},inputLines:[{orderedAs:text,itemId:'oil',quantity:2,isBoxUnit:true}]});
});

it.each(['duplicate','unapproved','different-partner','none'])('충돌이 아닌 승인 및 일반 판독은 기존 품목·수량을 유지한다: %s',async kind=>{
 const base={partnerId:'partner',alias:'참기름',itemId:'other',status:'approved'};
 api.rules.mockResolvedValue(kind==='duplicate'?[base,{...base}]:kind==='unapproved'?[{...base,status:'proposed'},{...base,status:'stopped'}]:kind==='different-partner'?[{...base,partnerId:'else'}]:[]);
 render(<PasteOrderModal {...props} onSave={vi.fn()}/>);await analyze('참기름 2박스');
 expect(screen.getByRole('combobox')).toHaveValue(kind==='duplicate'?'other':'oil');expect(screen.getByRole('spinbutton')).toHaveValue(2);
 expect(screen.queryByText(/같은 표현에 서로 다른 품목이 승인되어/)).toBeNull();expect(api.call).not.toHaveBeenCalled();
});

it('확정 행은 보내지 않고 애매한 원문만 한 번 보내며 응답 순서와 무관하게 원래 행 순서를 보존한다',async()=>{
 api.call.mockImplementation(async(input)=>({data:{results:[...input.scopedSources].reverse().map((source:any)=>({sourceId:source.sourceId,lines:[{itemId:source.text.includes('들기름')?'other':'oil',qty:source.text.includes('들기름')?2:5,isBox:true,source:source.text}],rejected:[]})),note:'자동 비고 금지',deliveryDate:'2030-01-01'}}));
 const save=vi.fn();render(<PasteOrderModal {...props} onSave={save}/>);await analyze('참기름 2박스\r\n들기름 두 박스요\r\n참기름 조금요');fireEvent.change(screen.getByLabelText('주문 비고'),{target:{value:'사용자 메모'}});const deadline=(screen.getByLabelText('출고예정일') as HTMLInputElement).value;
 fireEvent.click(screen.getByRole('button',{name:'AI로 다시 읽기'}));await waitFor(()=>expect(screen.getAllByRole('spinbutton')[2]).toHaveValue(5));
 expect(api.call).toHaveBeenCalledOnce();const input=api.call.mock.calls[0][0];expect(input).not.toHaveProperty('text');expect(input.scopedSources.map((source:any)=>source.text)).toEqual(['들기름 두 박스요','참기름 조금요']);expect(new Set(input.scopedSources.map((source:any)=>source.sourceId)).size).toBe(2);
 expect(screen.getAllByRole('spinbutton').map(element=>(element as HTMLInputElement).value)).toEqual(['2','2','5']);expect(screen.getAllByRole('combobox').map(element=>(element as HTMLSelectElement).value)).toEqual(['oil','other','oil']);expect(screen.getByLabelText('주문 비고')).toHaveValue('사용자 메모');expect(screen.getByLabelText('출고예정일')).toHaveValue(deadline);
 fireEvent.click(screen.getByRole('button',{name:/주문 생성/}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(save.mock.calls[0][1].firstAnalysis).toMatchObject({kind:'rules',lines:[{qty:2,sourceStart:0},{qty:1},{qty:1}],scopedAiEvidence:{sources:input.scopedSources}});
});

it('한 애매 문장에서 여러 품목을 얻어도 저장과 학습 입력은 각각 검증된 부분 원문으로 귀속한다',async()=>{
 const text='참기름 세 박스 들기름 두 박스';api.call.mockImplementation(async(input)=>({data:{results:[{sourceId:input.scopedSources[0].sourceId,lines:[{itemId:'oil',qty:3,isBox:true,source:'참기름 세 박스'},{itemId:'other',qty:2,isBox:true,source:'들기름 두 박스'}],rejected:[]}]}}));
 const save=vi.fn();render(<PasteOrderModal {...props} onSave={save}/>);await analyze(text);fireEvent.click(screen.getByRole('button',{name:'AI로 다시 읽기'}));await waitFor(()=>expect(screen.getAllByRole('spinbutton')).toHaveLength(2));
 expect(screen.getAllByRole('spinbutton').map(element=>(element as HTMLInputElement).value)).toEqual(['3','2']);fireEvent.click(screen.getByRole('button',{name:/주문 생성/}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());
 expect(save.mock.calls[0][0].items.map((item:any)=>item.orderedAs)).toEqual(['참기름 세 박스','들기름 두 박스']);expect(save.mock.calls[0][1].inputLines.map((item:any)=>item.orderedAs)).toEqual(['참기름 세 박스','들기름 두 박스']);expect(save.mock.calls[0][1].firstAnalysis.lines).toHaveLength(1);expect(save.mock.calls[0][1].firstAnalysis.lines[0].rawText).toBe(text);expect(save.mock.calls[0][1].firstAnalysis.scopedAiEvidence.sources[0].text).toBe(text);
});

it('동일한 애매 문장 두 개도 sourceId로 분리해 행별 수량을 반영한다',async()=>{
 api.call.mockImplementation(async(input)=>({data:{results:[...input.scopedSources].reverse().map((source:any)=>({sourceId:source.sourceId,lines:[{itemId:'other',qty:input.scopedSources.indexOf(source)+2,isBox:true,source:source.text}],rejected:[]}))}}));
 render(<PasteOrderModal {...props} onSave={vi.fn()}/>);await analyze('들기름 조금\n들기름 조금');fireEvent.click(screen.getByRole('button',{name:'AI로 다시 읽기'}));await waitFor(()=>expect(screen.getAllByRole('spinbutton')[1]).toHaveValue(3));expect(screen.getAllByRole('spinbutton')[0]).toHaveValue(2);expect(api.call.mock.calls[0][0].scopedSources[0].sourceId).not.toBe(api.call.mock.calls[0][0].scopedSources[1].sourceId);
});

it.each(['unknown','missing','duplicate','mixed-rejection'])('원문 연결이 불명확한 응답은 해당 원문을 그대로 남긴다: %s',async mode=>{
 api.call.mockImplementation(async(input)=>{const group={sourceId:input.scopedSources[0].sourceId,lines:[{itemId:'other',qty:9,isBox:true,source:input.scopedSources[0].text}],rejected:[] as any[]};return {data:{results:mode==='unknown'?[{...group,sourceId:'unknown'}]:mode==='missing'?[]:mode==='duplicate'?[group,group]:[{...group,rejected:[{text:input.scopedSources[0].text}]}]}};});
 render(<PasteOrderModal {...props} onSave={vi.fn()}/>);await analyze('참기름 조금');const old=(screen.getByRole('combobox') as HTMLSelectElement).value;fireEvent.click(screen.getByRole('button',{name:'AI로 다시 읽기'}));await waitFor(()=>expect(screen.getByRole('button',{name:'AI로 다시 읽기'})).toBeEnabled());expect(screen.getByRole('spinbutton')).toHaveValue(1);expect(screen.getByRole('combobox')).toHaveValue(old);
});

it.each(['','0'])('수량에 직접 빈값·0을 입력한 행과 직접 제외한 행은 다음 AI에서 보호한다: %s',async quantity=>{
 api.call.mockImplementation(async(input)=>({data:{results:input.scopedSources.map((source:any)=>({sourceId:source.sourceId,lines:[{itemId:'other',qty:4,isBox:true,source:source.text}],rejected:[]}))}}));
 render(<PasteOrderModal {...props} onSave={vi.fn()}/>);await analyze('참기름 조금\n들기름 조금\n참기름 대략');fireEvent.change(screen.getAllByRole('spinbutton')[0],{target:{value:quantity}});fireEvent.change(screen.getAllByRole('combobox')[1],{target:{value:''}});
 fireEvent.click(screen.getByRole('button',{name:'AI로 다시 읽기'}));await waitFor(()=>expect(screen.getAllByRole('spinbutton')[2]).toHaveValue(4));expect(api.call.mock.calls[0][0].scopedSources.map((source:any)=>source.text)).toEqual(['참기름 대략']);expect(screen.getAllByRole('spinbutton')[0]).toHaveValue(1);expect(screen.getAllByRole('combobox')[1]).toHaveValue('');
});

it('후속 부분 AI 응답은 최초 규칙 판독과 첫 AI 증거를 교체하지 않는다',async()=>{
 let firstRaw:any;api.call.mockImplementationOnce(async(input)=>{firstRaw={results:[{sourceId:input.scopedSources[0].sourceId,lines:[],rejected:[{text:input.scopedSources[0].text}]}]};return {data:firstRaw};}).mockImplementationOnce(async(input)=>({data:{results:[{sourceId:input.scopedSources[0].sourceId,lines:[{itemId:'other',qty:2,isBox:true,source:input.scopedSources[0].text}],rejected:[]}]}}));
 const save=vi.fn();render(<PasteOrderModal {...props} onSave={save}/>);await analyze('참기름 조금');fireEvent.click(screen.getByRole('button',{name:'AI로 다시 읽기'}));await waitFor(()=>expect(api.call).toHaveBeenCalledTimes(1));await screen.findByText(/애매한 원문을 확정하지 못했습니다/);fireEvent.click(screen.getByRole('button',{name:'AI로 다시 읽기'}));await waitFor(()=>expect(screen.getByRole('spinbutton')).toHaveValue(2));fireEvent.click(screen.getByRole('button',{name:/주문 생성/}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(save.mock.calls[0][1].firstAnalysis).toMatchObject({kind:'rules',lines:[{qty:1}],scopedAiEvidence:{rawResponse:firstRaw}});
});

it('확정된 주문과 승인 별칭 충돌만 있으면 AI를 호출하지 않는다',async()=>{
 api.rules.mockResolvedValue([{partnerId:'partner',alias:'들기름',itemId:'oil',status:'approved'},{partnerId:'partner',alias:'들기름',itemId:'other',status:'approved'}]);render(<PasteOrderModal {...props} onSave={vi.fn()}/>);await analyze('참기름 2박스\n들기름 3개');fireEvent.click(screen.getByRole('button',{name:'AI로 다시 읽기'}));expect(api.call).not.toHaveBeenCalled();expect(screen.getAllByRole('combobox')[1]).toHaveValue('');
});

it('UI와 범위 분류기의 단위 해석이 달라도 기존 별칭 충돌 판정을 AI로 우회하지 않는다',async()=>{
 api.rules.mockResolvedValue([{partnerId:'partner',alias:'기름2L',itemId:'oil',status:'approved'},{partnerId:'partner',alias:'기름2L',itemId:'other',status:'approved'}]);render(<PasteOrderModal {...props} onSave={vi.fn()}/>);await analyze('기름2L');expect(screen.getByRole('combobox')).toHaveValue('');fireEvent.click(screen.getByRole('button',{name:'AI로 다시 읽기'}));expect(api.call).not.toHaveBeenCalled();
});
