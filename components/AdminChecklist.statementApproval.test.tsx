/** @vitest-environment jsdom */
import React from 'react';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import AdminChecklist from './AdminChecklist';
import type {PendingStatementEdit} from '../src/shared/types';
const edit:PendingStatementEdit={id:'pending',statementId:'stmt',statementDocNo:'261008-1',statementType:'매입',partnerName:'거래처',createdAt:'2026-10-08T00:00:00Z',createdBy:'직원',status:'pending',proposedData:{tradeDate:'2026-10-08',partnerId:'p',partnerName:'거래처',totalSupply:100,totalTax:0,totalAmount:100,items:[]}};
const base={leaveRequests:[],adjustmentRequests:[],employees:[],onUpdateLeaveStatus:vi.fn(),onUpdateAdjustmentStatus:vi.fn(),onProcessAdjustment:vi.fn(),pendingStatementEdits:[edit]};
afterEach(cleanup);
it('승인을 기다리는 동안 승인·반려 중복을 차단한다',async()=>{let resolve!:()=>void;const approve=vi.fn(()=>new Promise<void>(done=>{resolve=done;}));render(<AdminChecklist {...base} onApproveStatementEdit={approve}/>);const button=screen.getByRole('button',{name:'승인'});fireEvent.click(button);fireEvent.click(button);expect(approve).toHaveBeenCalledExactlyOnceWith(edit);expect((button as HTMLButtonElement).disabled).toBe(true);expect((screen.getByRole('button',{name:'거절'}) as HTMLButtonElement).disabled).toBe(true);resolve();await waitFor(()=>expect((button as HTMLButtonElement).disabled).toBe(false));});
it('실패는 요청을 보존하고 오류를 표시하여 다시 승인할 수 있다',async()=>{const approve=vi.fn().mockRejectedValueOnce(new Error('서버 승인 실패')).mockResolvedValue(undefined);render(<AdminChecklist {...base} onApproveStatementEdit={approve}/>);fireEvent.click(screen.getByRole('button',{name:'승인'}));await waitFor(()=>expect(screen.getByRole('alert').textContent).toBe('서버 승인 실패'));expect(screen.getByText('261008-1')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'승인'}));await waitFor(()=>expect(approve).toHaveBeenCalledTimes(2));});
