/** @vitest-environment jsdom */
import React from 'react';
import {act,fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {EditBody} from './CashEditBody';
import type {Props} from '../domain/cashEntryModal';
const state=vi.hoisted(()=>({auth:{currentUser:{uid:'first'}},confirm:vi.fn()}));
vi.mock('../../../shared/firebase',()=>({auth:state.auth}));
vi.mock('../../../shared/components/appDialog',()=>({appConfirm:state.confirm}));
const entry={id:'cash',companyId:'taebaek',dir:'출금',date:'2026-08-01',amount:110,lines:[{accountCode:'260',amount:100},{accountCode:'951',amount:10}],note:'원문'} as any;
function props():Props & {entry:typeof entry}{return {entry,mode:{kind:'수정',entry},companyId:'taebaek',partners:[],accountCodes:[],cashAccounts:[{id:'bank',name:'합성 통장',type:'통장',openingDate:'2026-08-02'}],accountId:'',onAccountId:vi.fn(),partnerBalances:new Map(),getBalance:()=>0,latestStatement:()=>undefined,onClose:vi.fn(),onSettle:vi.fn(),onSaveEdit:vi.fn(),onAssignCashAccount:vi.fn()};}
beforeEach(()=>{state.auth.currentUser={uid:'first'};state.confirm.mockReset().mockResolvedValue(true);});
it('직접 편집 모듈도 분할 원문·금액을 보존하고 저장 중 중복·닫기를 막는다',async()=>{
 let finish!:()=>void;const p=props();p.onSaveEdit=vi.fn(()=>new Promise<void>(r=>finish=r));render(<EditBody {...p}/>);const save=screen.getByRole('button',{name:'저장'});fireEvent.click(save);fireEvent.click(save);fireEvent.click(screen.getByRole('button',{name:'자금 전표 수정 닫기'}));expect(p.onSaveEdit).toHaveBeenCalledTimes(1);expect(p.onClose).not.toHaveBeenCalled();expect(p.onSaveEdit).toHaveBeenCalledWith(entry,expect.objectContaining({amount:'110',date:'2026-08-01'}),[{accountCode:'260',amount:'100',note:''},{accountCode:'951',amount:'10',note:''}],undefined,undefined);await act(async()=>finish());expect(save).toBeEnabled();
});
it.each(['uid','company','entry','unmount'])('통장 지정 확인 중 %s 변경은 이전 요청을 전송하지 않는다',async kind=>{
 let finish!:(v:boolean)=>void;state.confirm.mockImplementation(()=>new Promise<boolean>(r=>finish=r));const p=props();const view=render(<EditBody {...p}/>);fireEvent.change(screen.getByLabelText('계좌 미지정 · 통장 선택'),{target:{value:'bank'}});fireEvent.click(screen.getByRole('button',{name:'계좌 지정'}));
 if(kind==='uid')state.auth.currentUser={uid:'second'};if(kind==='company')view.rerender(<EditBody {...p} companyId="punghoe"/>);if(kind==='entry')view.rerender(<EditBody {...p} entry={{...entry,id:'different'}}/>);if(kind==='unmount')view.unmount();await act(async()=>finish(true));expect(p.onAssignCashAccount).not.toHaveBeenCalled();
});