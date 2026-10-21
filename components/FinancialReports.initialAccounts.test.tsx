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

const openingAccount={id:'scope-account',code:'122',name:'수명 비품',type:'자산',normalBalance:'debit'} as AccountCode;
const scopeBase={...base,accounts:[openingAccount]};
it('기초잔액 A 응답은 B의 새 저장과 금액·날짜 잠금을 해제하지 않는다',async()=>{
 api.save.mockReset();api.notice.mockReset();const finishes:Array<()=>void>=[];api.save.mockImplementation(()=>new Promise<void>(resolve=>finishes.push(resolve)));
 const view=render(<FinancialReports {...scopeBase}/>);await open();fireEvent.change(screen.getByLabelText(/122수명 비품/),{target:{value:'1000'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));expect(api.save).toHaveBeenCalledTimes(1);
 view.rerender(<FinancialReports {...scopeBase} companyId="punghoe"/>);await open();expect(screen.getByRole('button',{name:'저장'})).toBeEnabled();fireEvent.change(screen.getByLabelText(/122수명 비품/),{target:{value:'2000'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));expect(api.save).toHaveBeenCalledTimes(2);
 expect(screen.getByLabelText(/122수명 비품/)).toBeDisabled();expect(screen.getByRole('button',{name:'취소'})).toBeDisabled();
 await act(async()=>finishes[0]());expect(screen.getByLabelText(/122수명 비품/)).toHaveValue('2000');expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();
 await act(async()=>finishes[1]());expect(screen.getByRole('button',{name:'편집'})).toBeEnabled();await open();expect(screen.getByLabelText(/122수명 비품/)).toHaveValue('2000');
});
it('이전 회사 기초잔액 거절은 새 회사에 알림을 띄우지 않는다',async()=>{
 api.save.mockReset();api.notice.mockReset();let reject!:(error:Error)=>void;api.save.mockImplementation(()=>new Promise<void>((_r,j)=>{reject=j;}));const view=render(<FinancialReports {...scopeBase}/>);await open();fireEvent.click(screen.getByRole('button',{name:'저장'}));view.rerender(<FinancialReports {...scopeBase} companyId="punghoe"/>);await act(async()=>reject(new Error('옛 회사 오류')));expect(api.notice).not.toHaveBeenCalled();
});

it('기초잔액 저장 중에는 중복송신과 금액·일자·취소를 잠그고 실패 뒤 입력을 유지한다',async()=>{
 api.save.mockReset();api.notice.mockReset();let reject!:(error:Error)=>void;api.save.mockImplementation(()=>new Promise<void>((_r,j)=>{reject=j;}));const view=render(<FinancialReports {...scopeBase}/>);await open();const amount=screen.getByLabelText(/122수명 비품/);fireEvent.change(amount,{target:{value:'3456'}});const date=view.container.querySelector('input[type="date"]') as HTMLInputElement;fireEvent.change(date,{target:{value:'2026-01-02'}});const save=screen.getByRole('button',{name:'저장'});act(()=>{fireEvent.click(save);fireEvent.click(save);});expect(api.save).toHaveBeenCalledTimes(1);expect(api.save.mock.calls[0]).toEqual(['taebaek','2026-01-02',{'122':3456}]);expect(amount).toBeDisabled();expect(date).toBeDisabled();expect(screen.getByRole('button',{name:'취소'})).toBeDisabled();
 await act(async()=>reject(new Error('현재 저장 거절')));expect(amount).toHaveValue('3456');expect(date).toHaveValue('2026-01-02');expect(save).toBeEnabled();expect(api.notice).toHaveBeenCalledWith(expect.stringContaining('현재 저장 거절'),'기초잔액 저장 실패');
});
it('회사 왕복과 unmount 뒤 기초잔액 응답은 새 편집이나 전역 알림을 건드리지 않는다',async()=>{
 api.save.mockReset();api.notice.mockReset();let finish!:()=>void;api.save.mockImplementationOnce(()=>new Promise<void>(r=>{finish=r;}));const view=render(<FinancialReports {...scopeBase}/>);await open();fireEvent.change(screen.getByLabelText(/122수명 비품/),{target:{value:'111'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));view.rerender(<FinancialReports {...scopeBase} companyId="punghoe"/>);await open();view.rerender(<FinancialReports {...scopeBase}/>);await open();fireEvent.change(screen.getByLabelText(/122수명 비품/),{target:{value:'777'}});await act(async()=>finish());expect(screen.getByLabelText(/122수명 비품/)).toHaveValue('777');expect(screen.getByRole('button',{name:'저장'})).toBeEnabled();
 let reject!:(error:Error)=>void;api.save.mockImplementationOnce(()=>new Promise<void>((_r,j)=>{reject=j;}));fireEvent.click(screen.getByRole('button',{name:'저장'}));view.unmount();await act(async()=>reject(new Error('unmount 뒤 오류')));expect(api.notice).not.toHaveBeenCalled();
});
