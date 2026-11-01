/** @vitest-environment jsdom */
import React from 'react';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import AdminChecklist from './AdminChecklist';
import type {PendingStatementEdit} from '../src/shared/types';
const edit:PendingStatementEdit={id:'pending',statementId:'stmt',statementDocNo:'261008-1',statementType:'매입',partnerName:'거래처',createdAt:'2026-10-08T00:00:00Z',createdBy:'직원',status:'pending',proposedData:{tradeDate:'2026-10-08',partnerId:'p',partnerName:'거래처',totalSupply:100,totalTax:0,totalAmount:100,items:[]}};
const base={leaveRequests:[],adjustmentRequests:[],employees:[],onLeaveAction:vi.fn().mockResolvedValue({status:"saved"}),onUpdateAdjustmentStatus:vi.fn(),onProcessAdjustment:vi.fn(),pendingStatementEdits:[edit]};
afterEach(cleanup);
it('승인을 기다리는 동안 승인·반려 중복을 차단한다',async()=>{let resolve!:()=>void;const approve=vi.fn(()=>new Promise<void>(done=>{resolve=done;}));render(<AdminChecklist {...base} onApproveStatementEdit={approve}/>);const button=screen.getByRole('button',{name:'승인'});fireEvent.click(button);fireEvent.click(button);expect(approve).toHaveBeenCalledExactlyOnceWith(edit);expect((button as HTMLButtonElement).disabled).toBe(true);expect((screen.getByRole('button',{name:'거절'}) as HTMLButtonElement).disabled).toBe(true);resolve();await waitFor(()=>expect((button as HTMLButtonElement).disabled).toBe(false));});
it('실패는 요청을 보존하고 오류를 표시하여 다시 승인할 수 있다',async()=>{const approve=vi.fn().mockRejectedValueOnce(new Error('서버 승인 실패')).mockResolvedValue(undefined);render(<AdminChecklist {...base} onApproveStatementEdit={approve}/>);fireEvent.click(screen.getByRole('button',{name:'승인'}));await waitFor(()=>expect(screen.getByRole('alert').textContent).toBe('서버 승인 실패'));expect(screen.getByText('261008-1')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'승인'}));await waitFor(()=>expect(approve).toHaveBeenCalledTimes(2));});
it('관리자 확인사항 탭은 헤더에서 기존 대기 수와 승인 동선을 유지한다',()=>{
 const approve=vi.fn();const {container}=render(<AdminChecklist {...base} onApproveStatementEdit={approve}/>);
 const tabs=container.querySelector('[data-page-header-slot="tabs"]')!;expect(tabs).not.toBeNull();expect(screen.getByRole('heading',{name:'관리자 확인사항'}).compareDocumentPosition(tabs)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(container.querySelector('[data-page-header-slot="actions"]')).toBeNull();expect(container.querySelector('[data-page-header-slot="recovery"]')).toBeNull();
 expect(screen.getByRole('button',{name:/거래명세서/}).closest('[data-page-header-slot="tabs"]')).toBe(tabs);
 fireEvent.click(screen.getByRole('button',{name:/재고/}));expect(screen.queryByText('261008-1')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/거래명세서/}));expect(screen.getByText('261008-1')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'승인'}));expect(approve).toHaveBeenCalledExactlyOnceWith(edit);
});
it('대기 표시는 탭과 같은 헤더 줄에서 감싸지고 확인 섹션은 흰색 경계로 구분한다',()=>{
 const {container}=render(<AdminChecklist {...base}/>);const tabs=container.querySelector('[data-page-header-slot="tabs"]')!;
 const pending=screen.getByText('대기 중 1건');expect(tabs).toContainElement(pending);expect(pending.parentElement).toHaveClass('bg-white','ml-auto');
 for(const pattern of [/^반품$/,/^선입고 이력/,/^전표 수정/,/^발주 예정$/]){
  const label=screen.getByText(pattern,{selector:'span'});expect(label.closest('td')).toHaveClass('bg-white','border-slate-200');expect(label).toHaveClass('text-xs','font-semibold','text-slate-700');
 }
});

it('OEM 품목별 조건은 저장 총액을 표시하고 총액 0이면 전표 발행을 막으며 기존 kg 단가는 보존한다',()=>{const process=vi.fn();const snapshot={version:2,companyId:'taebaek',partnerId:'p',rows:[{itemId:'a'},{itemId:'b'}],bulk:[]};const common={status:'pending',type:'oem_fee',originalQuantity:500,requestedQuantity:500,requestedAt:'2026-10-08T00:00:00Z',reason:'',unit:'kg'};const requests=[{...common,id:'v2',itemId:'a',itemName:'V2 외주',oemFeeSnapshotV2:snapshot,oemTotal:0},{...common,id:'v1',itemId:'b',itemName:'기존 외주',oemFeePerKg:300,oemTotal:150000}] as any;render(<AdminChecklist {...base} adjustmentRequests={requests} onProcessAdjustment={process}/>);fireEvent.click(screen.getByRole('button',{name:/재고/}));expect(screen.getByText('품목별 조건 · 2개 품목')).toBeInTheDocument();expect(screen.getByText('전표 발행 불필요 (총액 0원)')).toBeInTheDocument();expect(screen.getByText('500kg × 300')).toBeInTheDocument();const buttons=screen.getAllByRole('button',{name:'전표 발행'});expect(buttons[0]).toBeDisabled();fireEvent.click(buttons[0]);expect(process).not.toHaveBeenCalled();fireEvent.click(buttons[1]);expect(process).toHaveBeenCalledExactlyOnceWith(requests[1]);});
