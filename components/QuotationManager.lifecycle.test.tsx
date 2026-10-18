/** @vitest-environment jsdom */
import React from 'react';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import QuotationManager from './QuotationManager';
import type {Quotation} from '../src/features/quotations/domain/quotation';
import type {QuotationReference} from '../src/shared/quotationCommand';
import {quotationSnapshot} from '../src/shared/quotationCommand';
import type {QuotationScope,QuotationWriteInput,QuotationOpening,QuotationOutcome,QuotationPrepared,PendingQuotation} from '../src/features/quotations/infrastructure/quotationWrites';
const io=vi.hoisted(()=>({auth:{currentUser:{uid:'actor-a'}},subscribe:vi.fn(),capture:vi.fn(),prepare:vi.fn(),apply:vi.fn(),inspect:vi.fn(),cancel:vi.fn(),oldAdd:vi.fn(),oldDelete:vi.fn()}));
let quotes:Quotation[]=[],pending:PendingQuotation[]=[],sequence=0;
const plans=new Map<string,QuotationWriteInput>();
let emit:(rows:Quotation[])=>void=()=>{};
vi.mock('../src/shared/firebase',()=>({auth:io.auth,authReady:Promise.resolve(),db:{},functions:{}}));
vi.mock('../src/shared/services/firebaseService',()=>({subscribeToCollection:io.subscribe,addItem:io.oldAdd,deleteItem:io.oldDelete}));
vi.mock('../src/features/quotations/infrastructure/quotationWrites',async importOriginal=>{
 const actual=await importOriginal<typeof import('../src/features/quotations/infrastructure/quotationWrites')>();
 return {...actual,captureQuotation:io.capture,prepareQuotation:io.prepare,applyQuotation:io.apply,inspectQuotation:io.inspect,cancelQuotation:io.cancel,pendingQuotations:()=>pending,quotationReferences:()=>pending.map(row=>({reference:row.reference,key:row.reference.planId,readable:true}))};
});
const selected:Quotation={id:'원래-견적',companyId:'taebaek',quoteNo:'Q250202-01',date:'2025-02-02',validUntil:'2025-02-10',partnerId:'',partnerName:'기존 문의처',lines:[{name:'기존 품목',spec:'20kg',qty:2.5,price:100,isTaxExempt:true}],totalSupply:250,totalTax:0,totalAmount:250,createdAt:'2025-02-02T00:00:00Z'};
const reference=(scope:QuotationScope,targetId:string):QuotationReference=>({companyId:scope.companyId,targetId,planId:'plan-'+(++sequence)});
const opening=(scope:QuotationScope,quote:Quotation):QuotationOpening=>({reference:reference(scope,quote.id),expectedVersion:'1:000000001',snapshot:quotationSnapshot({...quote,companyId:scope.companyId})});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
beforeEach(()=>{
 vi.clearAllMocks();io.auth.currentUser.uid='actor-a';quotes=[];pending=[];sequence=0;plans.clear();
 io.subscribe.mockImplementation((_name:string,onRows:(rows:Quotation[])=>void)=>{emit=onRows;onRows(quotes);return()=>{};});
 io.capture.mockImplementation(async(scope:QuotationScope,quote:Quotation)=>opening(scope,quote));
 io.prepare.mockImplementation(async(scope:QuotationScope,input:QuotationWriteInput):Promise<QuotationPrepared>=>{const ref=input.opening?.reference??reference(scope,input.targetId);plans.set(ref.planId,input);pending=[...pending.filter(row=>row.reference.planId!==ref.planId),{reference:ref,action:input.action,description:(input.snapshot?.partnerName??'기존 견적')+' 결과 확인'}];return {status:'ready',reference:ref};});
 io.apply.mockImplementation(async(_scope:QuotationScope,ref:QuotationReference):Promise<QuotationOutcome>=>{pending=pending.filter(row=>row.reference.planId!==ref.planId);return {status:'saved'};});
 io.inspect.mockImplementation(async(_scope:QuotationScope,ref:QuotationReference):Promise<QuotationOutcome>=>{pending=pending.filter(row=>row.reference.planId!==ref.planId);return {status:'saved'};});
 io.cancel.mockImplementation(async(_scope:QuotationScope,ref:QuotationReference):Promise<QuotationOutcome>=>{pending=pending.filter(row=>row.reference.planId!==ref.planId);return {status:'cancelled',requiresReopen:true,message:'견적 요청을 중단했습니다.',nextAction:'현재 자료를 다시 열어 주세요.'};});
});
const mount=()=>render(<QuotationManager items={[]} partners={[]} currentUser={{id:'employee',name:'담당자'}}/>);
function fillNew(name='합성 문의처'){
 fireEvent.click(screen.getByRole('button',{name:'견적서 작성'}));
 fireEvent.change(screen.getByPlaceholderText('등록 거래처 검색 또는 업체명 직접 입력'),{target:{value:name}});
 fireEvent.click(screen.getByRole('button',{name:'‘'+name+'’ 미등록 업체명으로 사용'}));
 fireEvent.change(screen.getByPlaceholderText('품목명 직접 입력'),{target:{value:'합성 원료'}});
 fireEvent.change(screen.getByRole('dialog',{name:'견적서 작성'}).querySelector('input[inputmode="numeric"]')!,{target:{value:'100'}});
 fireEvent.click(screen.getByTitle('눌러서 과세·면세를 고르세요'));
 return screen.getByRole('dialog',{name:'견적서 작성'});
}
async function saveNew(name='합성 문의처'){const modal=fillNew(name);fireEvent.click(within(modal).getByRole('button',{name:'저장'}));await waitFor(()=>expect(io.apply).toHaveBeenCalledOnce());return modal;}
it('저장 ACK 전에는 초안·닫기·다른 작성이 보호되고 실 ACK 뒤에만 목록과 모달을 갱신한다',async()=>{
 const gate=deferred<QuotationOutcome>();io.apply.mockImplementation(()=>gate.promise);mount();const modal=await saveNew();
 expect(within(modal).getByPlaceholderText('품목명 직접 입력')).toBeDisabled();expect(screen.getByRole('button',{name:'견적서 작성'})).toBeDisabled();fireEvent.click(within(modal).getByRole('button',{name:'견적서 작성 닫기'}));expect(screen.getByRole('dialog',{name:'견적서 작성'})).toBeInTheDocument();expect(io.apply).toHaveBeenCalledOnce();
 const input=io.prepare.mock.calls[0][1] as QuotationWriteInput;expect(input.snapshot).toMatchObject({id:input.targetId,partnerName:'합성 문의처',totalAmount:100});await act(async()=>{pending=[];gate.resolve({status:'saved'});});expect(screen.queryByRole('dialog',{name:'견적서 작성'})).toBeNull();expect(screen.getByText(input.snapshot!.quoteNo)).toBeInTheDocument();expect(io.oldAdd).not.toHaveBeenCalled();
});
it('전송 전 필수 입력 거절은 초안을 수정할 수 있고 실제 저장 요청이나 실패 목록을 만들지 않는다',async()=>{
 mount();fireEvent.click(screen.getByRole('button',{name:'견적서 작성'}));fireEvent.click(screen.getByRole('button',{name:'저장'}));expect(await screen.findByRole('status')).toHaveTextContent('견적 받을 업체명을 입력하세요.');expect(io.prepare).not.toHaveBeenCalled();expect(io.apply).not.toHaveBeenCalled();expect(screen.getByPlaceholderText('품목명 직접 입력')).toBeEnabled();expect(screen.queryByRole('region',{name:'처리 결과 확인이 필요한 견적'})).toBeNull();
});
it('응답 유실은 최초 ID·번호·원문을 보존하고 보기닫기 후 다른 초안을 옛 결과로 닫지 않는다',async()=>{
 io.apply.mockResolvedValue({status:'unknown',message:'견적 응답 미확인',nextAction:'같은 요청의 결과를 확인해 주세요.'});mount();const modal=await saveNew();await screen.findByText(/견적 응답 미확인/);const first=io.prepare.mock.calls[0][1] as QuotationWriteInput,ref=pending[0].reference;
 expect(within(modal).getByPlaceholderText('품목명 직접 입력')).toBeDisabled();fireEvent.click(within(modal).getByRole('button',{name:'취소'}));const panel=screen.getByRole('region',{name:'처리 결과 확인이 필요한 견적'});fillNew('다른 새 초안');fireEvent.click(within(panel).getByRole('button',{name:'결과 확인'}));await waitFor(()=>expect(io.inspect).toHaveBeenCalledWith({companyId:'taebaek',actorUid:'actor-a'},ref,expect.any(Function)));expect(screen.getByRole('dialog',{name:'견적서 작성'})).toHaveTextContent('다른 새 초안');expect(io.prepare).toHaveBeenCalledOnce();expect(io.apply).toHaveBeenCalledOnce();expect(plans.get(ref.planId)?.snapshot).toBe(first.snapshot);expect(first.snapshot?.id).toBe(first.targetId);
});
it('기존 견적 열림 준비는 입력을 잠그고 이후 구독값으로 최초 원문을 재구성하지 않는다',async()=>{
 quotes=[selected];const gate=deferred<QuotationOpening>();io.capture.mockImplementation(()=>gate.promise);mount();fireEvent.click(screen.getByTitle('견적서 수정'));const modal=screen.getByRole('dialog',{name:'견적서 수정'});expect(within(modal).getByPlaceholderText('품목명 직접 입력')).toBeDisabled();const fixed=opening({companyId:'taebaek',actorUid:'actor-a'},selected);await act(async()=>gate.resolve(fixed));expect(within(modal).getByDisplayValue(selected.date)).toBeEnabled();act(()=>emit([{...selected,partnerName:'나중 구독값'}]));fireEvent.change(within(modal).getByPlaceholderText('규격 직접 입력'),{target:{value:'수정 규격'}});fireEvent.click(within(modal).getByRole('button',{name:'수정 저장'}));await waitFor(()=>expect(io.apply).toHaveBeenCalledOnce());expect(io.prepare.mock.calls[0][1]).toMatchObject({targetId:selected.id,action:'update',opening:fixed,snapshot:{date:selected.date,partnerName:selected.partnerName,lines:[{name:'기존 품목',spec:'수정 규격',qty:2.5}]}});
});
it('복사는 신규 고정 ID와 새 일자를 쓰고 원래 번호·대상을 덮지 않는다',async()=>{
 quotes=[selected];mount();fireEvent.click(screen.getByTitle('이대로 새 견적'));const modal=screen.getByRole('dialog',{name:'견적서 작성'});expect(io.capture).not.toHaveBeenCalled();expect(within(modal).getByDisplayValue('기존 품목')).toBeInTheDocument();fireEvent.click(within(modal).getByRole('button',{name:'저장'}));await waitFor(()=>expect(io.prepare).toHaveBeenCalledOnce());const input=io.prepare.mock.calls[0][1] as QuotationWriteInput;expect(input.action).toBe('create');expect(input.targetId).not.toBe(selected.id);expect(input.snapshot!.quoteNo).not.toBe(selected.quoteNo);expect(selected.date).toBe('2025-02-02');
});
it('같은 회사 UID 교체 뒤 옛 저장 ACK는 새 초안을 닫거나 목록에 원문을 추가하지 않는다',async()=>{
 const gate=deferred<QuotationOutcome>();io.apply.mockImplementation(()=>gate.promise);const view=mount();await saveNew();const old=io.prepare.mock.calls[0][1] as QuotationWriteInput;io.auth.currentUser.uid='actor-b';view.rerender(<QuotationManager items={[]} partners={[]} currentUser={{id:'employee-b',name:'새 담당'}}/>);fillNew('새 계정 초안');await act(async()=>gate.resolve({status:'saved'}));expect(screen.getByRole('dialog',{name:'견적서 작성'})).toHaveTextContent('새 계정 초안');expect(screen.queryByText(old.snapshot!.quoteNo)).toBeNull();
});
it('삭제는 열림·준비 뒤 명시 확인하고 응답 미확인도 창·동일 reference 복구를 보존한다',async()=>{
 quotes=[selected];io.apply.mockResolvedValue({status:'unknown',message:'삭제 응답 미확인',nextAction:'결과를 확인해 주세요.'});mount();fireEvent.click(screen.getByTitle('삭제'));const modal=screen.getByRole('dialog',{name:'견적서 삭제'});await waitFor(()=>expect(within(modal).getByRole('button',{name:'삭제'})).toBeEnabled());expect(io.apply).not.toHaveBeenCalled();fireEvent.click(within(modal).getByRole('button',{name:'삭제'}));await screen.findByText(/삭제 응답 미확인/);expect(io.prepare.mock.calls[0][1]).toMatchObject({action:'delete',targetId:selected.id});const ref=pending[0].reference;fireEvent.click(within(modal).getByRole('button',{name:'확인창 닫기'}));fireEvent.change(screen.getByRole('textbox',{name:'견적 검색'}),{target:{value:'없는 견적'}});const panel=screen.getByRole('region',{name:'처리 결과 확인이 필요한 견적'});fireEvent.click(within(panel).getByRole('button',{name:'결과 확인'}));await waitFor(()=>expect(io.inspect).toHaveBeenCalledWith({companyId:'taebaek',actorUid:'actor-a'},ref,expect.any(Function)));expect(io.apply).toHaveBeenCalledOnce();expect(io.oldDelete).not.toHaveBeenCalled();
});
it('삭제 전 정상 취소는 중단 fence ACK 뒤 준비 원문을 정리하고 실제 삭제를 보내지 않는다',async()=>{
 quotes=[selected];const gate=deferred<QuotationOutcome>();io.cancel.mockImplementation(()=>gate.promise);mount();fireEvent.click(screen.getByTitle('삭제'));const modal=screen.getByRole('dialog',{name:'견적서 삭제'});await waitFor(()=>expect(within(modal).getByRole('button',{name:'삭제'})).toBeEnabled());fireEvent.click(within(modal).getByRole('button',{name:'취소'}));await waitFor(()=>expect(io.cancel).toHaveBeenCalledOnce());expect(screen.getByRole('dialog',{name:'견적서 삭제'})).toBeInTheDocument();expect(within(modal).getByRole('button',{name:'처리 중…'})).toBeDisabled();await act(async()=>{pending=[];gate.resolve({status:'cancelled',requiresReopen:true,message:'삭제 요청을 중단했습니다.'});});expect(screen.queryByRole('dialog',{name:'견적서 삭제'})).toBeNull();expect(screen.queryByRole('region',{name:'처리 결과 확인이 필요한 견적'})).toBeNull();expect(io.apply).not.toHaveBeenCalled();
});
it('옛 견적의 생성시각과 규격이 없어도 삭제 준비와 완료 ACK를 처리한다',async()=>{
 const legacy:Quotation={...selected,lines:selected.lines.map(line=>({...line}))};
 Reflect.deleteProperty(legacy,'createdAt');Reflect.deleteProperty(legacy.lines[0],'spec');quotes=[legacy];mount();
 fireEvent.click(screen.getByTitle('삭제'));const modal=screen.getByRole('dialog',{name:'견적서 삭제'});
 await waitFor(()=>expect(within(modal).getByRole('button',{name:'삭제'})).toBeEnabled());
 expect(io.prepare.mock.calls[0][1]).toMatchObject({action:'delete',targetId:legacy.id});expect(io.apply).not.toHaveBeenCalled();
 fireEvent.click(within(modal).getByRole('button',{name:'삭제'}));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'견적서 삭제'})).toBeNull());
 expect(screen.queryByText(legacy.quoteNo)).toBeNull();expect(io.apply).toHaveBeenCalledOnce();expect(io.oldDelete).not.toHaveBeenCalled();
});
