/** @vitest-environment jsdom */
import React from 'react';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
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
