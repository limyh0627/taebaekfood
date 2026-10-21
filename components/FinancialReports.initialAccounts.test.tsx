/** @vitest-environment jsdom */
import React from 'react';
import {beforeEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor,act} from '@testing-library/react';
import FinancialReports from './FinancialReports';
import type {AccountCode} from '../src/shared/types';
const api=vi.hoisted(()=>({save:vi.fn(),notice:vi.fn(),fetch:vi.fn<(...args:unknown[])=>Promise<unknown[]>>(),inventory:vi.fn(),partner:vi.fn()}));
vi.mock('../src/shared/services/firebaseService',()=>({fetchWhere:api.fetch,saveOpeningBalances:api.save,createOpeningInventory:api.inventory,createOpeningPartnerBalance:api.partner}));
vi.mock('../src/shared/components/appDialog',()=>({appNotice:api.notice}));
beforeEach(()=>{api.fetch.mockReset();api.fetch.mockResolvedValue([]);api.inventory.mockReset();api.partner.mockReset();});
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

const inventoryAccount={id:'inventory-account',code:'146',name:'재고자산',type:'자산',normalBalance:'debit'} as AccountCode;
const inventoryRows=[{id:'taebaek-item',companyId:'taebaek',name:'태백 품목',type:'raw',stock:0},{id:'punghoe-item',companyId:'punghoe',name:'풍회 품목',type:'raw',stock:0}] as React.ComponentProps<typeof FinancialReports>['items'];
const inventoryProps={...base,accounts:[inventoryAccount],items:inventoryRows};
function prepareInventory(){api.notice.mockReset();api.fetch.mockImplementation(async(...args)=>[{id:args[2]==='punghoe'?'main-punghoe':'main',date:'2026-01-02',amounts:{}}]);}
async function fillInventory(company:'taebaek'|'punghoe',quantity='10',value='1000',waitEnabled=true){
 await waitFor(()=>expect(screen.getByRole('option',{name:company==='taebaek'?/태백 품목/:/풍회 품목/})).toBeInTheDocument());
 fireEvent.change(screen.getByLabelText('기초 재고 품목'),{target:{value:`${company}-item`}});fireEvent.change(screen.getByLabelText('기초 재고 수량'),{target:{value:quantity}});fireEvent.change(screen.getByLabelText('기초 재고 평가금액'),{target:{value}});
 if(waitEnabled)await waitFor(()=>expect(inventoryButton()).toBeEnabled());
}
function inventoryButton(){return screen.getByLabelText('기초 재고 수량').parentElement!.querySelector('button')!;}
it('재고 기초 A 응답은 B의 새 문서·수량·잠금을 침범하지 않는다',async()=>{
 prepareInventory();let resolve!:(value:string)=>void;api.inventory.mockImplementationOnce(()=>new Promise<string>(r=>{resolve=r;}));const view=render(<FinancialReports {...inventoryProps}/>);await fillInventory('taebaek');fireEvent.click(inventoryButton());expect(api.inventory).toHaveBeenCalledTimes(1);
 view.rerender(<FinancialReports {...inventoryProps} companyId="punghoe"/>);await fillInventory('punghoe','20','2000',false);await act(async()=>resolve('created'));
 expect(screen.getByLabelText('기초 재고 수량')).toHaveValue('20');expect(screen.getByLabelText('기초 재고 품목')).toHaveValue('punghoe-item');expect(api.notice).not.toHaveBeenCalled();await open();expect(screen.getByLabelText(/146재고자산/)).toBeEnabled();
});
it('재고 기초 이전 finally는 새 회사의 진행 중 저장 잠금을 풀지 않는다',async()=>{
 prepareInventory();const finishes:Array<(value:string)=>void>=[];api.inventory.mockImplementation(()=>new Promise<string>(r=>finishes.push(r)));const view=render(<FinancialReports {...inventoryProps}/>);await fillInventory('taebaek');fireEvent.click(inventoryButton());view.rerender(<FinancialReports {...inventoryProps} companyId="punghoe"/>);await fillInventory('punghoe','25','2500');fireEvent.click(inventoryButton());expect(api.inventory).toHaveBeenCalledTimes(2);await act(async()=>finishes[0]('created'));expect(inventoryButton()).toBeDisabled();expect(screen.getByLabelText('기초 재고 수량')).toBeDisabled();expect(screen.getByLabelText('기초 재고 수량')).toHaveValue('25');expect(api.notice).not.toHaveBeenCalled();await act(async()=>finishes[1]('created'));expect(screen.getByLabelText('기초 재고 수량')).toHaveValue('');expect(screen.getByLabelText('기초 재고 수량')).toBeEnabled();
});
it('재고 기초 저장은 같은 tick 중복을 막고 고정한 일자·수량·평가금액만 보낸다',async()=>{
 prepareInventory();let reject!:(error:Error)=>void;api.inventory.mockImplementationOnce(()=>new Promise((_r,j)=>{reject=j;}));render(<FinancialReports {...inventoryProps}/>);await fillInventory('taebaek','1,234.5','12,345');const button=inventoryButton();act(()=>{fireEvent.click(button);fireEvent.click(button);});expect(api.inventory).toHaveBeenCalledExactlyOnceWith('taebaek','2026-01-02','taebaek-item',1234.5,12345);for(const name of ['기초 재고 품목','기초 재고 수량','기초 재고 평가금액'])expect(screen.getByLabelText(name)).toBeDisabled();fireEvent.change(screen.getByLabelText('기초 재고 수량'),{target:{value:'999'}});expect(screen.getByLabelText('기초 재고 수량')).toHaveValue('1,234.5');await act(async()=>reject(Error('현재 저장 오류')));expect(screen.getByLabelText('기초 재고 수량')).toHaveValue('1,234.5');expect(button).toBeEnabled();expect(api.notice).toHaveBeenCalledWith(expect.stringContaining('현재 저장 오류'),'기초 재고 저장 실패');
});
it.each(['created','unchanged'] as const)('재고 기초 현재 %s는 원래 입력 정리 정책을 유지한다',async result=>{
 prepareInventory();api.inventory.mockResolvedValueOnce(result);render(<FinancialReports {...inventoryProps}/>);await fillInventory('taebaek');fireEvent.click(inventoryButton());await waitFor(()=>expect(api.notice).toHaveBeenCalledOnce());await waitFor(()=>expect(screen.getByLabelText('기초 재고 수량')).toBeEnabled());expect(screen.getByLabelText('기초 재고 수량')).toHaveValue(result==='created'?'':'10');expect(screen.getByLabelText('기초 재고 품목')).toHaveValue(result==='created'?'':'taebaek-item');await open();expect(screen.getByLabelText(/146재고자산/)).toBeDisabled();
});
it('재고 기초 성공 알림 대기 뒤 회사 전환은 새 입력을 지우지 않는다',async()=>{
 prepareInventory();let finish!:()=>void;api.inventory.mockResolvedValueOnce('created');api.notice.mockImplementationOnce(()=>new Promise<void>(r=>{finish=r;}));const view=render(<FinancialReports {...inventoryProps}/>);await fillInventory('taebaek');fireEvent.click(inventoryButton());await waitFor(()=>expect(api.notice).toHaveBeenCalledOnce());view.rerender(<FinancialReports {...inventoryProps} companyId="punghoe"/>);await fillInventory('punghoe','99','9900');await act(async()=>finish());expect(screen.getByLabelText('기초 재고 수량')).toHaveValue('99');expect(inventoryButton()).toBeEnabled();
});
it('재고 기초 회사 왕복과 unmount 뒤 오류는 새 화면에 알리지 않는다',async()=>{
 prepareInventory();let reject!:(error:Error)=>void;api.inventory.mockImplementationOnce(()=>new Promise((_r,j)=>{reject=j;}));const view=render(<FinancialReports {...inventoryProps}/>);await fillInventory('taebaek');fireEvent.click(inventoryButton());view.rerender(<FinancialReports {...inventoryProps} companyId="punghoe"/>);await fillInventory('punghoe');view.rerender(<FinancialReports {...inventoryProps}/>);await fillInventory('taebaek','77','7700');await act(async()=>reject(Error('이전 회사 오류')));expect(api.notice).not.toHaveBeenCalled();expect(screen.getByLabelText('기초 재고 수량')).toHaveValue('77');expect(inventoryButton()).toBeEnabled();api.inventory.mockImplementationOnce(()=>new Promise((_r,j)=>{reject=j;}));fireEvent.click(inventoryButton());view.unmount();await act(async()=>reject(Error('unmount 오류')));expect(api.notice).not.toHaveBeenCalled();
});
it('재고 기초 ACK는 같은 회사라도 변경된 기준일 문서의 재고 잠금을 만들지 않는다',async()=>{
 prepareInventory();api.save.mockResolvedValueOnce(undefined);let finish!:(value:string)=>void;api.inventory.mockImplementationOnce(()=>new Promise<string>(r=>{finish=r;}));const view=render(<FinancialReports {...inventoryProps}/>);await fillInventory('taebaek');fireEvent.click(inventoryButton());await open();const date=view.container.querySelector('input[type="date"]')!;fireEvent.change(date,{target:{value:'2026-02-03'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(screen.getByRole('button',{name:'편집'})).toBeEnabled());await act(async()=>finish('created'));expect(api.notice).not.toHaveBeenCalled();expect(screen.getByLabelText('기초 재고 수량')).toHaveValue('10');expect(screen.getByLabelText('기초 재고 품목')).toHaveValue('taebaek-item');expect(inventoryButton()).toBeEnabled();await open();expect(screen.getByLabelText(/146재고자산/)).toBeEnabled();expect(view.container.querySelector('input[type="date"]')).toHaveValue('2026-02-03');
});

const partnerProps={...base,accounts:[openingAccount],partners:[{id:'partner-one',name:'거래처'}] as React.ComponentProps<typeof FinancialReports>['partners']};
function partnerButton(){return screen.getByLabelText('기초 거래처 잔액').parentElement!.querySelector('button')!;}
async function fillPartner(amount='1000',code='108',waitEnabled=true){await waitFor(()=>expect(screen.getByRole('button',{name:'편집'})).toBeEnabled());fireEvent.change(screen.getByLabelText('기초 거래처'),{target:{value:'partner-one'}});fireEvent.change(screen.getByLabelText('기초 잔액 종류'),{target:{value:code}});fireEvent.change(screen.getByLabelText('기초 거래처 잔액'),{target:{value:amount}});if(waitEnabled)await waitFor(()=>expect(partnerButton()).toBeEnabled());}
it('거래처 기초 A 응답은 B의 새 금액을 지우거나 안내하지 않는다',async()=>{
 prepareInventory();let finish!:(value:string)=>void;api.partner.mockImplementationOnce(()=>new Promise<string>(r=>{finish=r;}));const view=render(<FinancialReports {...partnerProps}/>);await fillPartner();fireEvent.click(partnerButton());view.rerender(<FinancialReports {...partnerProps} companyId="punghoe"/>);await fillPartner('2000','251',false);await act(async()=>finish('created'));expect(screen.getByLabelText('기초 거래처 잔액')).toHaveValue('2000');expect(api.notice).not.toHaveBeenCalled();
});
it('거래처 기초 회사 교체는 금액·종류·잠금을 초기화하고 이전 finally는 새 저장을 풀지 않는다',async()=>{
 prepareInventory();const finishes:Array<(value:string)=>void>=[];api.partner.mockImplementation(()=>new Promise<string>(r=>finishes.push(r)));const view=render(<FinancialReports {...partnerProps}/>);await fillPartner('1000','251');fireEvent.click(partnerButton());view.rerender(<FinancialReports {...partnerProps} companyId="punghoe"/>);await waitFor(()=>expect(screen.getByRole('button',{name:'편집'})).toBeEnabled());expect(screen.getByLabelText('기초 거래처 잔액')).toHaveValue('');expect(screen.getByLabelText('기초 잔액 종류')).toHaveValue('108');expect(screen.getByLabelText('기초 거래처')).toHaveValue('');await fillPartner('2500');fireEvent.click(partnerButton());expect(api.partner).toHaveBeenCalledTimes(2);await act(async()=>finishes[0]('created'));expect(screen.getByLabelText('기초 거래처 잔액')).toHaveValue('2500');expect(partnerButton()).toBeDisabled();expect(api.notice).not.toHaveBeenCalled();await act(async()=>finishes[1]('created'));expect(screen.getByLabelText('기초 거래처 잔액')).toHaveValue('');expect(screen.getByLabelText('기초 거래처 잔액')).toBeEnabled();
});
it('거래처 기초는 같은 tick 중복 확인 없이 고정 원문 한 번만 보내고 실패 입력을 유지한다',async()=>{
 prepareInventory();let reject!:(error:Error)=>void;api.partner.mockImplementationOnce(()=>new Promise((_r,j)=>{reject=j;}));render(<FinancialReports {...partnerProps}/>);await fillPartner('12,345','251');const button=partnerButton();act(()=>{fireEvent.click(button);fireEvent.click(button);});expect(api.partner).toHaveBeenCalledExactlyOnceWith('taebaek','2026-01-02','partner-one','251',12345);for(const label of ['기초 거래처','기초 잔액 종류','기초 거래처 잔액'])expect(screen.getByLabelText(label)).toBeDisabled();fireEvent.change(screen.getByLabelText('기초 거래처 잔액'),{target:{value:'9'}});expect(screen.getByLabelText('기초 거래처 잔액')).toHaveValue('12,345');await act(async()=>reject(Error('현재 거절')));expect(partnerButton()).toBeEnabled();expect(screen.getByLabelText('기초 거래처 잔액')).toHaveValue('12,345');expect(api.notice).toHaveBeenCalledWith(expect.stringContaining('현재 거절'),'저장 실패');
});
it.each(['created','unchanged'] as const)('거래처 기초 현재 %s는 기존 금액 정리 정책과 선택을 유지한다',async result=>{
 prepareInventory();api.partner.mockResolvedValueOnce(result);render(<FinancialReports {...partnerProps}/>);await fillPartner('500','251');fireEvent.click(partnerButton());await waitFor(()=>expect(api.notice).toHaveBeenCalledOnce());await waitFor(()=>expect(screen.getByLabelText('기초 거래처 잔액')).toBeEnabled());expect(screen.getByLabelText('기초 거래처 잔액')).toHaveValue(result==='created'?'':'500');expect(screen.getByLabelText('기초 거래처')).toHaveValue('partner-one');expect(screen.getByLabelText('기초 잔액 종류')).toHaveValue('251');
});
it('거래처 기초 성공 알림 대기 중 회사가 바뀌면 새 금액은 보존한다',async()=>{
 prepareInventory();let finish!:()=>void;api.partner.mockResolvedValueOnce('created');api.notice.mockImplementationOnce(()=>new Promise<void>(r=>{finish=r;}));const view=render(<FinancialReports {...partnerProps}/>);await fillPartner();fireEvent.click(partnerButton());await waitFor(()=>expect(api.notice).toHaveBeenCalledOnce());view.rerender(<FinancialReports {...partnerProps} companyId="punghoe"/>);await fillPartner('9000');await act(async()=>finish());expect(screen.getByLabelText('기초 거래처 잔액')).toHaveValue('9000');expect(partnerButton()).toBeEnabled();
});
it('거래처 기초 회사 왕복과 unmount 뒤 오류는 새 입력과 전역 알림을 건드리지 않는다',async()=>{
 prepareInventory();let reject!:(error:Error)=>void;api.partner.mockImplementationOnce(()=>new Promise((_r,j)=>{reject=j;}));const view=render(<FinancialReports {...partnerProps}/>);await fillPartner();fireEvent.click(partnerButton());view.rerender(<FinancialReports {...partnerProps} companyId="punghoe"/>);await fillPartner();view.rerender(<FinancialReports {...partnerProps}/>);await fillPartner('7777');await act(async()=>reject(Error('옛 오류')));expect(api.notice).not.toHaveBeenCalled();expect(screen.getByLabelText('기초 거래처 잔액')).toHaveValue('7777');expect(partnerButton()).toBeEnabled();api.partner.mockImplementationOnce(()=>new Promise((_r,j)=>{reject=j;}));fireEvent.click(partnerButton());view.unmount();await act(async()=>reject(Error('unmount 오류')));expect(api.notice).not.toHaveBeenCalled();
});
it('거래처 기초 기준일 변경 뒤 이전 ACK는 성공 안내·입력 삭제 없이 자기 잠금만 끝낸다',async()=>{
 prepareInventory();api.save.mockResolvedValueOnce(undefined);let finish!:(value:string)=>void;api.partner.mockImplementationOnce(()=>new Promise<string>(r=>{finish=r;}));const view=render(<FinancialReports {...partnerProps}/>);await fillPartner('3000');fireEvent.click(partnerButton());await open();fireEvent.change(view.container.querySelector('input[type="date"]')!,{target:{value:'2026-02-03'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(screen.getByRole('button',{name:'편집'})).toBeEnabled());await act(async()=>finish('created'));expect(api.notice).not.toHaveBeenCalled();expect(screen.getByLabelText('기초 거래처 잔액')).toHaveValue('3000');expect(partnerButton()).toBeEnabled();
});
