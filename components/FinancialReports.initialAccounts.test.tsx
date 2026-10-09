/** @vitest-environment jsdom */
import React from 'react';
import {expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor,act} from '@testing-library/react';
import FinancialReports from './FinancialReports';
import type {AccountCode} from '../src/shared/types';
const api=vi.hoisted(()=>({save:vi.fn(),notice:vi.fn()}));
vi.mock('../src/shared/services/firebaseService',()=>({fetchWhere:async()=>[],saveOpeningBalances:api.save,createOpeningInventory:vi.fn(),createOpeningPartnerBalance:vi.fn()}));
vi.mock('../src/shared/components/appDialog',()=>({appNotice:api.notice}));
const base={companyId:'taebaek' as const,statements:[],cashEntries:[],accounts:[],cashAccounts:[]};
const open=async()=>{await waitFor(()=>expect(screen.getByRole('button',{name:'편집'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'편집'}));};
const fill=()=>{fireEvent.change(screen.getByLabelText('기초 계정 코드'),{target:{value:'122'}});fireEvent.change(screen.getByLabelText('기초 계정명'),{target:{value:'비품'}});};
it('빈 회사는 명시 계정 등록 성공 후 해당 계정 잔액을 저장할 수 있다',async()=>{
 api.save.mockReset();const add=vi.fn(async(_account:AccountCode)=>{});render(<FinancialReports {...base} onAddAccountCode={add}/>);await open();fill();
 fireEvent.click(screen.getByRole('button',{name:'계정 등록'}));await waitFor(()=>expect(add).toHaveBeenCalledTimes(1));
 expect(add.mock.calls[0][0]).toMatchObject({code:'122',name:'비품',type:'자산',normalBalance:'debit'});
 fireEvent.change(await screen.findByLabelText(/122비품/),{target:{value:'12000'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));
 await waitFor(()=>expect(api.save).toHaveBeenCalled());expect(api.save.mock.calls[0][2]).toMatchObject({'122':12000});
});
it('등록 실패는 입력을 보존하고 동일 원문으로 재시도한다',async()=>{
 const add=vi.fn().mockRejectedValueOnce(new Error('연결 실패')).mockResolvedValueOnce(undefined);render(<FinancialReports {...base} onAddAccountCode={add}/>);await open();fill();
 fireEvent.click(screen.getByRole('button',{name:'계정 등록'}));await screen.findByText(/연결 실패/);expect(screen.getByLabelText('기초 계정명')).toHaveValue('비품');
 fireEvent.click(screen.getByRole('button',{name:'계정 등록'}));await waitFor(()=>expect(add).toHaveBeenCalledTimes(2));expect(add.mock.calls[1][0]).toEqual(add.mock.calls[0][0]);
});
it('회사 변경은 초안을 비우고 이전 등록 응답이 새 회사 계정에 들어가지 않는다',async()=>{
 let finish!:()=>void;const add=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));const view=render(<FinancialReports {...base} onAddAccountCode={add}/>);await open();fill();fireEvent.click(screen.getByRole('button',{name:'계정 등록'}));
 view.rerender(<FinancialReports {...base} companyId="punghoe" onAddAccountCode={add}/>);await open();expect(screen.getByLabelText('기초 계정명')).toHaveValue('');
 await act(async()=>finish());expect(screen.queryByLabelText(/122비품/)).not.toBeInTheDocument();
});
it('기존 회사 계정표와 입력행은 그대로 보존하고 빈 회사 등록폼을 끼우지 않는다',async()=>{
 const account={id:'existing',code:'122',name:'기존 비품',type:'자산',normalBalance:'debit'} as AccountCode;
 render(<FinancialReports {...base} accounts={[account]} onAddAccountCode={vi.fn()}/>);await open();expect(screen.getByLabelText(/122기존 비품/)).toBeEnabled();expect(screen.queryByLabelText('기초 계정 코드')).not.toBeInTheDocument();
});
it('같은 초기 설정에서 여러 계정을 명시 등록하고 중복 클릭은 한 번만 송신한다',async()=>{
 let finish!:()=>void;const add=vi.fn<(account:AccountCode)=>Promise<void>>().mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;})).mockResolvedValue(undefined);
 render(<FinancialReports {...base} onAddAccountCode={add}/>);await open();fill();const button=screen.getByRole('button',{name:'계정 등록'});fireEvent.click(button);fireEvent.click(button);expect(add).toHaveBeenCalledTimes(1);
 await act(async()=>finish());expect(screen.getByLabelText(/122비품/)).toBeEnabled();
 fireEvent.change(screen.getByLabelText('기초 계정 코드'),{target:{value:'253'}});fireEvent.change(screen.getByLabelText('기초 계정명'),{target:{value:'미지급금'}});
 fireEvent.change(screen.getByLabelText('기초 계정 종류'),{target:{value:'부채'}});fireEvent.change(screen.getByLabelText('기초 계정 증가 방향'),{target:{value:'credit'}});
 fireEvent.click(screen.getByRole('button',{name:'계정 등록'}));await waitFor(()=>expect(add).toHaveBeenCalledTimes(2));expect(add.mock.calls[1][0]).toMatchObject({id:'opening-account-taebaek-253',code:'253',name:'미지급금',type:'부채',normalBalance:'credit'});
 expect(await screen.findByLabelText(/253미지급금/)).toBeEnabled();expect(screen.getByLabelText(/122비품/)).toBeEnabled();
});
it('331 자동 차액 계정은 송신·잠금 없이 안내하고 다른 코드로 고칠 수 있다',async()=>{
 const add=vi.fn(async(_account:AccountCode)=>{});render(<FinancialReports {...base} onAddAccountCode={add}/>);await open();fill();
 fireEvent.change(screen.getByLabelText('기초 계정 코드'),{target:{value:'331'}});fireEvent.click(screen.getByRole('button',{name:'계정 등록'}));
 expect(add).not.toHaveBeenCalled();expect(screen.getByText(/자본금은 기초잔액 차액으로 자동 계산/)).toBeInTheDocument();expect(screen.getByLabelText('기초 계정 코드')).toBeEnabled();
 fireEvent.change(screen.getByLabelText('기초 계정 코드'),{target:{value:'122'}});fireEvent.click(screen.getByRole('button',{name:'계정 등록'}));await screen.findByLabelText(/122비품/);expect(add).toHaveBeenCalledTimes(1);
});
