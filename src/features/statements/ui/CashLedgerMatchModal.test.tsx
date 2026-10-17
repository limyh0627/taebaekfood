/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MatchModal } from './CashLedgerMatchModal';
import type { CashEntry, IssuedStatement, Settlement } from '../../../shared/types';
const entry={id:'cash',companyId:'taebaek',cashAccountId:'bank',partnerId:'p',partnerName:'합성거래처',date:'2026-10-17',dir:'입금',amount:100,accountCode:'108',createdAt:''} as CashEntry;
const statement={id:'stmt',companyId:'taebaek',partnerId:'p',partnerName:'합성거래처',tradeDate:'2026-10-17',type:'매출',docNo:'261017-001',totalAmount:100,totalSupply:100,totalTax:0,issuedAt:'',orderId:'',items:[{name:'합성상품',spec:'',qty:1,price:100,supply:100,tax:0,total:100,accountCode:'800'}]} as IssuedStatement;
const base={entry,statements:[statement],settlements:[] as Settlement[],cashEntries:[entry],onClose:vi.fn(),onAdd:vi.fn(),onDelete:vi.fn()};
it('매칭 대기 중 중복과 닫기를 막고 실패 후 원래 전표로 다시 시도한다',async()=>{
 let fail!:(e:Error)=>void;const add=vi.fn().mockImplementationOnce(()=>new Promise((_,reject)=>{fail=reject;})).mockResolvedValue(undefined),close=vi.fn();render(<MatchModal {...base} onAdd={add} onClose={close}/>);const button=screen.getByRole('button',{name:/100 상계/});fireEvent.click(button);fireEvent.click(button);expect(add).toHaveBeenCalledOnce();expect(button).toBeDisabled();screen.getAllByRole('button').filter(b=>b.getAttribute('aria-label')?.includes('닫기')).forEach(b=>fireEvent.click(b));expect(close).not.toHaveBeenCalled();await act(async()=>fail(Error('합성실패')));expect(screen.getByRole('alert')).toHaveTextContent('합성실패');fireEvent.click(button);await waitFor(()=>expect(add).toHaveBeenCalledTimes(2));expect(add.mock.calls[1][0]).toMatchObject({cashEntryId:'cash',statementId:'stmt',amount:100});
});
it('기존 매칭 해제 실패는 같은 연결과 화면을 보존한다',async()=>{
 const remove=vi.fn().mockRejectedValueOnce(Error('연결변경')).mockResolvedValue(undefined);render(<MatchModal {...base} settlements={[{id:'link',cashEntryId:'cash',statementId:'stmt',amount:60,createdAt:''}]} onDelete={remove}/>);const button=screen.getByRole('button',{name:'261017-001 매칭 해제'});fireEvent.click(button);await screen.findByRole('alert');expect(button).toBeInTheDocument();fireEvent.click(button);await waitFor(()=>expect(remove).toHaveBeenCalledTimes(2));expect(remove.mock.calls.map(c=>c[0])).toEqual(['link','link']);
});
