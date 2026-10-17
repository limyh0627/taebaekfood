/** @vitest-environment jsdom */
import React from 'react';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import type {Item,PartnerItem,AccountCode,AccountGroup} from '../../../shared/types';
import {ServiceTerms} from './ServiceTerms';
import {ServiceTerms as LegacyServiceTerms} from '../../../../components/ItemManager';
const props={item:{id:'service',name:'합성용역',type:'service'} as Item,partnerId:'partner',direction:'in' as const,accountGroups:[{id:'expense',type:'비용'}] as AccountGroup[],accountCodes:[{id:'ac',code:'540',name:'외주가공비',groupId:'expense'}] as AccountCode[]};
it('기존 export와 같고 최초 연결 ID·미지 필드·방향을 유지하며 연속 저장을 막는다',async()=>{
 expect(LegacyServiceTerms).toBe(ServiceTerms);let finish!:()=>void;const save=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 const value={id:'original-link',price:10,taxType:'면세',Account_Code:'540',legacyMarker:'원문'} as unknown as PartnerItem;
 render(<ServiceTerms {...props} value={value} onSave={save}/>);fireEvent.change(screen.getByRole('spinbutton',{name:'용역 단가'}),{target:{value:'20'}});
 const button=screen.getByRole('button',{name:'저장'});fireEvent.click(button);fireEvent.click(button);expect(save).toHaveBeenCalledOnce();
 expect(save).toHaveBeenCalledWith(expect.objectContaining({id:'original-link',legacyMarker:'원문',itemId:'service',partnerId:'partner',Direction:'in',price:20}));expect(button).toBeDisabled();await act(async()=>finish());expect(button).toBeEnabled();
});
it('실패는 입력을 보존하고 다시 저장할 수 있다',async()=>{
 const alert=vi.spyOn(window,'alert').mockImplementation(()=>{}),save=vi.fn().mockRejectedValueOnce(Error('합성 거절')).mockResolvedValue(undefined);
 try {render(<ServiceTerms {...props} value={{price:10,taxType:'면세',Account_Code:'540'} as PartnerItem} onSave={save}/>);
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(alert).toHaveBeenCalledWith(expect.stringContaining('합성 거절')));expect(screen.getByRole('spinbutton',{name:'용역 단가'})).toHaveValue(10);
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(2));
 } finally {alert.mockRestore();}
});
