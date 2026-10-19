/** @vitest-environment jsdom */
import React from 'react';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import ItemManager from './ItemManager';
import type {Item,Partner,PartnerItem} from '../types';
import type {PartnerItemTermsInput,PartnerItemTermsOutcome,PendingPartnerItemTerms} from '../src/features/items/infrastructure/partnerItemTermsWrites';
vi.mock('../src/shared/services/firebaseService',()=>({fetchCollection:vi.fn(async()=>[])}));
const item:Item={id:'item',companyId:'taebaek',name:'참기름',type:'product',subtype:'낱개',stock:0,minStock:0,unit:'병',image:''};
const partner:Partner={id:'partner',name:'합성 거래처',type:'일반'};
const opening:PartnerItem={id:'link',itemId:item.id,partnerId:partner.id,Direction:'out',price:100,taxType:'과세'};
const props={companyId:'taebaek' as const,requestScopeKey:'actor',items:[item],partners:[partner],partnerItems:[opening],onEditProduct:vi.fn(),onAddItem:vi.fn(),onDeleteItem:vi.fn(),onLinkItem:vi.fn(),onUnlinkItem:vi.fn()};
function openPrice(){fireEvent.click(screen.getByRole('button',{name:'거래처별 품목'}));fireEvent.click(screen.getByRole('button',{name:/합성 거래처/}));fireEvent.click(screen.getByTitle('판매단가 수정'));}
it('보드 단가0 초안은 ACK 전에 사라지지 않고 같은 원본과 분리해 저장한다',async()=>{
 let finish!:(outcome:PartnerItemTermsOutcome)=>void;const save=vi.fn((_input:PartnerItemTermsInput)=>new Promise<PartnerItemTermsOutcome>(resolve=>{finish=resolve;}));render(<ItemManager {...props} onSavePartnerItemTerms={save}/>);openPrice();fireEvent.change(screen.getByPlaceholderText('단가'),{target:{value:'0'}});fireEvent.click(screen.getByTitle('저장'));await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(screen.getByPlaceholderText('단가')).toHaveValue(0);expect(screen.getByPlaceholderText('단가')).toBeDisabled();expect(save.mock.calls[0][0]).toEqual({target:{itemId:item.id,partnerId:partner.id,direction:'out',existingLinkId:opening.id,opening},terms:{price:0,taxType:'과세'}});await act(async()=>finish({status:'saved'}));expect(screen.queryByPlaceholderText('단가')).toBeNull();
});
it('보드 UID 변경 뒤 늦은 ACK는 새 초안을 지우지 않는다',async()=>{
 let finish!:(outcome:PartnerItemTermsOutcome)=>void;const save=vi.fn((_input:PartnerItemTermsInput)=>new Promise<PartnerItemTermsOutcome>(resolve=>{finish=resolve;}));const view=render(<ItemManager {...props} onSavePartnerItemTerms={save}/>);openPrice();fireEvent.change(screen.getByPlaceholderText('단가'),{target:{value:'20'}});fireEvent.click(screen.getByTitle('저장'));await waitFor(()=>expect(save).toHaveBeenCalledOnce());view.rerender(<ItemManager {...props} requestScopeKey="other-actor" onSavePartnerItemTerms={save}/>);fireEvent.click(screen.getByTitle('판매단가 수정'));fireEvent.change(screen.getByPlaceholderText('단가'),{target:{value:'35'}});await act(async()=>finish({status:'saved'}));expect(screen.getByPlaceholderText('단가')).toHaveValue(35);
});
it('필터 밖·삭제된 거래조건도 실제 요청이 있을 때만 원래 reference로 결과 확인한다',async()=>{
 const reference={companyId:'taebaek' as const,planId:'pending',targetId:'link',itemId:item.id,partnerId:partner.id,direction:'out' as const};let pending:PendingPartnerItemTerms[]=[{reference,description:'참기름 판매단가 확인 필요'}];const inspect=vi.fn(async()=>{pending=[];return {status:'saved'} as const;});render(<ItemManager {...props} items={[]} onReadPendingPartnerItemTerms={()=>pending} onReadPartnerItemTermsReferences={()=>pending.map(row=>({key:row.reference.planId,reference:row.reference,readable:true}))} onInspectPartnerItemTerms={inspect}/>);const panel=await screen.findByRole('region',{name:'처리 결과 확인이 필요한 거래조건'});fireEvent.click(within(panel).getByRole('button',{name:'결과 확인'}));await waitFor(()=>expect(inspect).toHaveBeenCalledExactlyOnceWith(reference));expect(screen.queryByRole('region',{name:'처리 결과 확인이 필요한 거래조건'})).toBeNull();
});

it('요청 중단 뒤에는 현재 값으로 다시 열기를 명시해 새 원문으로 편집한다',async()=>{
 const reference={companyId:'taebaek' as const,planId:'plan',targetId:opening.id,itemId:item.id,partnerId:partner.id,direction:'out' as const};let pending:PendingPartnerItemTerms[]=[];
 const save=vi.fn(async():Promise<PartnerItemTermsOutcome>=>{pending=[{reference,description:'참기름 단가 확인'}];return {status:'unknown',message:'응답 미확인',nextAction:'결과를 확인해 주세요.'};});const cancel=vi.fn(async():Promise<PartnerItemTermsOutcome>=>{pending=[];return {status:'cancelled',message:'요청을 중단했습니다.',nextAction:'현재 값을 다시 열어 주세요.',requiresReopen:true};});
 const view=render(<ItemManager {...props} onSavePartnerItemTerms={save} onReadPendingPartnerItemTerms={()=>pending} onCancelPartnerItemTerms={cancel}/>);openPrice();fireEvent.change(screen.getByPlaceholderText('단가'),{target:{value:'12345'}});fireEvent.click(screen.getByTitle('저장'));await screen.findByText(/응답 미확인/);fireEvent.click(screen.getByRole('button',{name:'요청 중단'}));await screen.findByRole('button',{name:'현재 값으로 다시 열기'});view.rerender(<ItemManager {...props} partnerItems={[{...opening,price:222}]} onSavePartnerItemTerms={save} onReadPendingPartnerItemTerms={()=>pending} onCancelPartnerItemTerms={cancel}/>);fireEvent.click(screen.getByRole('button',{name:'현재 값으로 다시 열기'}));expect(screen.getByPlaceholderText('단가')).toBeEnabled();expect(screen.getByPlaceholderText('단가')).toHaveValue(222);expect(save).toHaveBeenCalledOnce();
});
it('실제 품목관리의 embedded 용역도 UID 변경 뒤 새 초안을 열고 이전 ACK로 닫지 않는다',async()=>{
 const service:Item={...item,type:'service',name:'임가공비'},link:PartnerItem={...opening,Account_Code:'410'};
 let finish!:(outcome:PartnerItemTermsOutcome)=>void;
 const save=vi.fn((_input:PartnerItemTermsInput)=>new Promise<PartnerItemTermsOutcome>(resolve=>{finish=resolve;}));
 const serviceProps={...props,items:[service],partnerItems:[link],accountGroups:[{id:'revenue',name:'수익',type:'수익'} as const],accountCodes:[{id:'410',code:'410',name:'용역매출',groupId:'revenue'}]};
 const view=render(<ItemManager {...serviceProps} onSavePartnerItemTerms={save}/>);
 fireEvent.click(screen.getByRole('button',{name:'거래처별 품목'}));fireEvent.click(screen.getByRole('button',{name:/합성 거래처/}));
 fireEvent.change(await screen.findByLabelText('용역 단가'),{target:{value:'20'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());
 view.rerender(<ItemManager {...serviceProps} requestScopeKey="actor-b" onSavePartnerItemTerms={save}/>);
 expect(screen.getByLabelText('용역 단가')).toBeEnabled();expect(screen.getByLabelText('용역 단가')).toHaveValue(100);
 fireEvent.change(screen.getByLabelText('용역 단가'),{target:{value:'35'}});await act(async()=>finish({status:'saved'}));
 expect(screen.getByLabelText('용역 단가')).toBeEnabled();expect(screen.getByLabelText('용역 단가')).toHaveValue(35);
});

it('다른 사본 정리는 원래 단가초안을 보존하고 현재값으로 명시재열기하여 종결한다',async()=>{
 const reference={companyId:'taebaek' as const,planId:'discard-plan',targetId:opening.id,itemId:item.id,partnerId:partner.id,direction:'out' as const};let pending:PendingPartnerItemTerms[]=[],refs:{key:string;reference:typeof reference;readable:boolean;observedLocalText:string}[]=[];const save=vi.fn(async():Promise<PartnerItemTermsOutcome>=>{pending=[{reference,description:'단가 다른 사본'}];refs=[{key:'copy',reference,readable:true,observedLocalText:'exact-observed-raw'}];return {status:'unknown',message:'응답미확인',nextAction:'조회'};}),discard=vi.fn(async()=>{pending=[];refs=[];return {status:'cleared' as const,message:'이 기기 사본만 정리했습니다.'};});const bindings={onSavePartnerItemTerms:save,onReadPendingPartnerItemTerms:()=>pending,onReadPartnerItemTermsReferences:()=>refs,onDiscardPartnerItemTermsCopy:discard};const view=render(<ItemManager {...props} {...bindings}/>);openPrice();fireEvent.change(screen.getByPlaceholderText('단가'),{target:{value:'12345'}});fireEvent.click(screen.getByTitle('저장'));fireEvent.click(await screen.findByRole('button',{name:'이 기기 사본 정리'}));await waitFor(()=>expect(discard).toHaveBeenCalledWith(reference,'exact-observed-raw'));expect(screen.getByPlaceholderText('단가')).toHaveValue(12345);expect(screen.queryByRole('region',{name:'처리 결과 확인이 필요한 거래조건'})).toBeNull();view.rerender(<ItemManager {...props} {...bindings} partnerItems={[{...opening,price:222}]}/>);fireEvent.click(screen.getByRole('button',{name:'현재 값으로 다시 열기'}));expect(screen.getByPlaceholderText('단가')).toBeEnabled();expect(screen.getByPlaceholderText('단가')).toHaveValue(222);expect(save).toHaveBeenCalledOnce();
});
