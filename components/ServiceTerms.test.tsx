/** @vitest-environment jsdom */
import React from 'react';
import {expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {ServiceTerms} from './ItemManager';
import type {Item,AccountCode,AccountGroup} from '../src/shared/types';
import type {PartnerItemTermsInput,PartnerItemTermsOutcome} from '../src/features/items/infrastructure/partnerItemTermsWrites';
const item:Item={id:'fee',name:'임가공비',type:'service',stock:0,minStock:0,unit:'건',image:''};
const groups:AccountGroup[]=[{id:'expense',name:'비용',type:'비용'},{id:'revenue',name:'수익',type:'수익'}];
const codes:AccountCode[]=[{id:'540',code:'540',name:'외주가공비',groupId:'expense'},{id:'410',code:'410',name:'용역매출',groupId:'revenue'}];
const saved=async(_input:PartnerItemTermsInput):Promise<PartnerItemTermsOutcome>=>({status:'saved'});
it.each([['in','540','과세'],['out','410','면세']] as const)('용역 %s 조건은 맞는 계정과 별도 수정값만 typed 저장한다',async(direction,code,taxType)=>{
 const save=vi.fn(saved);render(<ServiceTerms item={item} partnerId="partner" direction={direction} accountCodes={codes} accountGroups={groups} onSave={save}/>);
 expect(screen.queryByRole('option',{name:new RegExp(direction==='in'?'410':'540')})).toBeNull();fireEvent.change(screen.getByLabelText('용역 단가'),{target:{value:'22000'}});fireEvent.change(screen.getByLabelText('용역 과세 여부'),{target:{value:taxType}});fireEvent.change(screen.getByLabelText('용역 계정과목'),{target:{value:code}});fireEvent.click(screen.getByRole('button',{name:'저장'}));
 await waitFor(()=>expect(save).toHaveBeenCalledExactlyOnceWith({target:{itemId:item.id,partnerId:'partner',direction,opening:null},terms:{price:22000,taxType,Account_Code:code}}));
});
it('용역의 기존 양수·과세·계정 필수 검증은 0원과 빈 값 저장을 막는다',async()=>{
 const save=vi.fn(saved);render(<ServiceTerms item={item} partnerId="partner" direction="in" accountCodes={codes} accountGroups={groups} onSave={save}/>);fireEvent.click(screen.getByRole('button',{name:'저장'}));expect(await screen.findByRole('status')).toHaveTextContent('용역 단가, 과세 여부, 계정과목을 모두 선택해 주세요.');fireEvent.change(screen.getByLabelText('용역 단가'),{target:{value:'0'}});fireEvent.change(screen.getByLabelText('용역 과세 여부'),{target:{value:'과세'}});fireEvent.change(screen.getByLabelText('용역 계정과목'),{target:{value:'540'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));expect(save).not.toHaveBeenCalled();
});
