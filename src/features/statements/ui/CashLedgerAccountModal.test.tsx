/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
vi.mock('../../../shared/components/appDialog',()=>({appConfirm:vi.fn(async()=>true),appNotice:vi.fn(async()=>{})}));
vi.mock('../../../shared/services/confirmedCashBalance',()=>({saveConfirmedCashBalance:vi.fn()}));
import { AccountModal } from './CashLedgerAccountModal';
import type { CashAccount, CashEntry } from '../../../shared/types';
const account:CashAccount={id:'bank',companyId:'taebaek',name:'합성통장',type:'통장',active:true,openingDate:'2026-01-01',openingBalance:1000,createdAt:''};
const base={companyId:'taebaek' as const,accounts:[account],cashEntries:[] as CashEntry[],onClose:vi.fn(),onAdd:vi.fn(),onUpdate:vi.fn()};
it('계좌 추가의 중복 저장을 막고 실패 초안과 동일 계좌 ID를 재사용한다',async()=>{
 let fail!:(e:Error)=>void;const add=vi.fn().mockImplementationOnce(()=>new Promise((_,reject)=>{fail=reject;})).mockResolvedValue(undefined);render(<AccountModal {...base} accounts={[]} onAdd={add}/>);fireEvent.change(screen.getByPlaceholderText('기업은행 1234-56'),{target:{value:'새통장'}});const button=screen.getByRole('button',{name:'추가'});fireEvent.click(button);fireEvent.click(button);expect(add).toHaveBeenCalledOnce();await act(async()=>fail(Error('실패')));expect(screen.getByPlaceholderText('기업은행 1234-56')).toHaveValue('새통장');fireEvent.click(screen.getByRole('button',{name:'추가'}));await waitFor(()=>expect(add).toHaveBeenCalledTimes(2));expect(add.mock.calls[1][0].id).toBe(add.mock.calls[0][0].id);expect(add.mock.calls[1][0]).toMatchObject({name:'새통장',type:'통장',openingBalance:0});
});
it('회사 key 변경은 이전 계좌 상세와 수정 초안을 새 회사에 남기지 않는다',()=>{
 const view=render(<AccountModal {...base} onCorrect={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:/합성통장/}));fireEvent.change(screen.getByLabelText('계좌 이름'),{target:{value:'이전회사초안'}});view.rerender(<AccountModal {...base} companyId="punghoe" accounts={[{...account,companyId:'punghoe',name:'다른통장'}]} onCorrect={vi.fn()}/>);expect(screen.queryByDisplayValue('이전회사초안')).toBeNull();expect(screen.queryByLabelText('계좌 이름')).toBeNull();expect(screen.getByRole('button',{name:/다른통장/})).toBeInTheDocument();
});
it('다른회사·대체줄을 잔액에서 제외하고 원래 계좌 객체로 현재잔액을 수정한다',async()=>{
 const correct=vi.fn().mockResolvedValue(undefined),cash={id:'cash',companyId:'taebaek',cashAccountId:'bank',date:'2026-01-02',dir:'출금',amount:110,createdAt:''} as CashEntry;render(<AccountModal {...base} cashEntries={[cash,{...cash,id:'other',companyId:'punghoe',amount:777},{...cash,id:'offset',dir:'대체',amount:999}]} onCorrect={correct}/>);fireEvent.click(screen.getByRole('button',{name:/합성통장/}));expect(screen.getByLabelText('현재 잔액')).toHaveValue('890');fireEvent.change(screen.getByLabelText('계좌 이름'),{target:{value:'수정통장'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(correct).toHaveBeenCalledWith(account,'수정통장',account.openingDate,890));
});
