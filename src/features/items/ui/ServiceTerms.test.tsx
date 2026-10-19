/** @vitest-environment jsdom */
import React from 'react';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import type {Item,PartnerItem,AccountCode,AccountGroup} from '../../../shared/types';
import type {PartnerItemTermsInput,PartnerItemTermsOutcome} from '../infrastructure/partnerItemTermsWrites';
import {ServiceTerms} from './ServiceTerms';
import {ServiceTerms as LegacyServiceTerms} from '../../../../components/ItemManager';
const item:Item={id:'service',name:'합성용역',type:'service',stock:0,minStock:0,unit:'건',image:''};
const value:PartnerItem={id:'original-link',itemId:item.id,partnerId:'partner',Direction:'in',price:10,taxType:'면세',Account_Code:'540'};
const props={item,partnerId:'partner',direction:'in' as const,value,accountGroups:[{id:'expense',name:'비용',type:'비용'}] as AccountGroup[],accountCodes:[{id:'ac',code:'540',name:'외주가공비',groupId:'expense'}] as AccountCode[]};
it('기존 export와 같고 원본과 수정값을 분리하며 ACK까지 입력·연속 저장을 잠근다',async()=>{
 expect(LegacyServiceTerms).toBe(ServiceTerms);let finish!:(outcome:PartnerItemTermsOutcome)=>void;const save=vi.fn((_input:PartnerItemTermsInput)=>new Promise<PartnerItemTermsOutcome>(resolve=>{finish=resolve;}));render(<ServiceTerms {...props} onSave={save}/>);fireEvent.change(screen.getByLabelText('용역 단가'),{target:{value:'20'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(save.mock.calls[0][0]).toMatchObject({target:{existingLinkId:value.id,opening:value},terms:{price:20,taxType:'면세',Account_Code:'540'}});expect(screen.getByLabelText('용역 단가')).toBeDisabled();expect(screen.getByRole('button',{name:'저장 중…'})).toBeDisabled();await act(async()=>finish({status:'saved'}));expect(screen.getByRole('button',{name:'거래조건 수정'})).toBeEnabled();
});
it('확정 사전 거절은 초안·최초 원본을 유지하고 구독값이 바뀌어도 기대 원문을 바꾸지 않는다',async()=>{
 const save=vi.fn<(input:PartnerItemTermsInput)=>Promise<PartnerItemTermsOutcome>>().mockResolvedValueOnce({status:'rejected',message:'입력 확인',nextAction:'수정해 주세요.'}).mockResolvedValue({status:'saved'});const view=render(<ServiceTerms {...props} onSave={save}/>);fireEvent.change(screen.getByLabelText('용역 단가'),{target:{value:'20'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await screen.findByText(/입력 확인/);view.rerender(<ServiceTerms {...props} value={{...value,price:999}} onSave={save}/>);expect(screen.getByLabelText('용역 단가')).toHaveValue(20);fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(2));expect(save.mock.calls[1][0].target.opening?.price).toBe(10);
});
it('void 결과는 성공으로 처리하지 않고 초안과 원문을 잠가 보존한다',async()=>{
 const save=vi.fn().mockResolvedValue(undefined);render(<ServiceTerms {...props} onSave={save}/>);fireEvent.click(screen.getByRole('button',{name:'저장'}));expect(await screen.findByRole('status')).toHaveTextContent('거래조건 저장 결과를 확인하지 못했습니다.');
});

it('동일회사 UID가 바뀌면 용역 새 초안은 열리고 이전 ACK가 지우지 않는다',async()=>{
 let finish!:(outcome:PartnerItemTermsOutcome)=>void;const save=vi.fn((_input:PartnerItemTermsInput)=>new Promise<PartnerItemTermsOutcome>(resolve=>{finish=resolve;}));
 const view=render(<ServiceTerms {...props} requestScopeKey="actor-a" onSave={save}/>);fireEvent.change(screen.getByLabelText('용역 단가'),{target:{value:'20'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());
 view.rerender(<ServiceTerms {...props} requestScopeKey="actor-b" onSave={save}/>);expect(screen.getByLabelText('용역 단가')).toBeEnabled();fireEvent.change(screen.getByLabelText('용역 단가'),{target:{value:'35'}});await act(async()=>finish({status:'saved'}));expect(screen.getByLabelText('용역 단가')).toHaveValue(35);
});

it('용역 복구도 관측사본 정리만 호출하며 원행의 현재값 수정은 별도 명시한다',async()=>{
 const reference={companyId:'taebaek' as const,planId:'service-copy',targetId:value.id,itemId:item.id,partnerId:'partner',direction:'in' as const};let stored=true;const discard=vi.fn(async()=>{stored=false;return {status:'cleared' as const,message:'용역 기기사본만 정리'};}),save=vi.fn(async():Promise<PartnerItemTermsOutcome>=>({status:'saved'}));render(<ServiceTerms {...props} onSave={save} onReadPendingPartnerItemTerms={()=>stored?[{reference,description:'용역 원문 확인'}]:[]} onReadPartnerItemTermsReferences={()=>stored?[{key:'service-copy',reference,readable:true,observedLocalText:'service-observed'}]:[]} onDiscardPartnerItemTermsCopy={discard}/>);fireEvent.click(screen.getByRole('button',{name:'이 기기 사본 정리'}));await waitFor(()=>expect(discard).toHaveBeenCalledWith(reference,'service-observed'));expect(screen.getByLabelText('용역 단가')).toHaveValue(10);expect(save).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'거래조건 수정'}));expect(screen.getByLabelText('용역 단가')).toBeEnabled();expect(screen.queryByRole('region',{name:'처리 결과 확인이 필요한 거래조건'})).toBeNull();
});

it('별도읽기 pending A와 references B가 달라도 표시와 정리는 B의 한 관측행을 사용한다',async()=>{
 const reference={companyId:'taebaek' as const,planId:'snapshot',targetId:value.id,itemId:item.id,partnerId:'partner',direction:'in' as const},discard=vi.fn(async()=>({status:'cleared' as const,message:'사본만'}));render(<ServiceTerms {...props} onReadPendingPartnerItemTerms={()=>[{reference,description:'A 옛 단가 10',observedLocalText:'raw-A'}]} onReadPartnerItemTermsReferences={()=>[{key:'snapshot',reference,readable:true,description:'B 관측 단가 20',observedLocalText:'raw-B'}]} onDiscardPartnerItemTermsCopy={discard}/>);const row=screen.getByText(/B 관측 단가 20/).closest('div')!;expect(screen.queryByText(/A 옛 단가 10/)).toBeNull();fireEvent.click(within(row).getByRole('button',{name:'이 기기 사본 정리'}));await waitFor(()=>expect(discard).toHaveBeenCalledWith(reference,'raw-B'));
});

it('결과조회 부분성공은 사본정리 실패원인과 다음행동을 유지하고 재열기 성공으로 덮지 않는다',async()=>{
 const reference={companyId:'taebaek' as const,planId:'partial-inspect',targetId:value.id,itemId:item.id,partnerId:'partner',direction:'in' as const};const inspect=vi.fn(async():Promise<PartnerItemTermsOutcome>=>({status:'partial',reason:'followup-unconfirmed',committedIds:[value.id],unconfirmedIds:[],message:'거래조건은 저장됐지만 기기 사본 정리를 확인하지 못했습니다.',nextAction:'다시 저장하지 말고 같은 요청의 결과 확인 또는 사본 정리를 선택해 주세요.'}));render(<ServiceTerms {...props} onReadPendingPartnerItemTerms={()=>[{reference,description:'정리 실패 요청'}]} onReadPartnerItemTermsReferences={()=>[{key:'partial',reference,readable:true,observedLocalText:'partial-raw'}]} onInspectPartnerItemTerms={inspect}/>);fireEvent.click(screen.getByRole('button',{name:'결과 확인'}));await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('기기 사본 정리를 확인하지 못했습니다'));expect(screen.getByRole('status')).toHaveTextContent('다시 저장하지 말고');expect(screen.getByRole('status')).not.toHaveTextContent('현재 자료를 다시 열어');expect(screen.queryByRole('button',{name:'거래조건 수정'})).toBeNull();expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();expect(screen.getByRole('button',{name:'이 기기 사본 정리'})).toBeEnabled();expect(screen.getByRole('button',{name:'결과 확인'})).toBeEnabled();
});
