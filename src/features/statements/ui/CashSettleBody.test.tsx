/** @vitest-environment jsdom */
import React from 'react';
import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {SettleBody} from './CashSettleBody';
import type {Props} from '../domain/cashEntryModal';
const stmt={id:'statement',type:'매출',partnerId:'partner',partnerName:'합성 거래처',tradeDate:'2026-08-28',totalAmount:1000} as any;
function props():Props & {stmt:typeof stmt}{return {stmt,mode:{kind:'수금지불',stmt},companyId:'taebaek',partners:[],accountCodes:[],cashAccounts:[],accountId:'',onAccountId:vi.fn(),partnerBalances:new Map([['partner',{receivable:100,payable:0}]]),getBalance:()=>100,latestStatement:()=>undefined,onClose:vi.fn(),onSettle:vi.fn(),onSaveEdit:vi.fn()};}
it('복구 금액·날짜를 유지하고 최신 전표에 초과 확인 뒤 전달한다',()=>{
 const p=props(),live={...stmt,note:'최신 원문'};p.initialSettle={amount:150,date:'2026-08-29'};p.latestStatement=()=>live;render(<SettleBody {...p}/>);
 expect(screen.getByDisplayValue('150')).toBeInTheDocument();expect(screen.getByDisplayValue('2026-08-29')).toBeInTheDocument();
 fireEvent.change(screen.getByPlaceholderText('예: 1차 분할'),{target:{value:'  분할 수금  '}});fireEvent.click(screen.getByRole('button',{name:'저장'}));expect(p.onSettle).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'계속 진행'}));expect(p.onSettle).toHaveBeenCalledExactlyOnceWith(live,{amount:150,date:'2026-08-29',method:'계좌이체',note:'분할 수금',scope:'stmt'});
});
it('거래처 범위 선택은 금액만 바꾸고 전표 날짜를 보존한다',()=>{
 const p=props();p.partnerBalances.set('partner',{receivable:400,payable:0});render(<SettleBody {...p}/>);
 fireEvent.click(screen.getByRole('button',{name:/거래처 잔액/}));expect(screen.getByDisplayValue('400')).toBeInTheDocument();expect(screen.getByDisplayValue('2026-08-28')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'저장'}));expect(p.onSettle).toHaveBeenCalledWith(stmt,expect.objectContaining({amount:400,date:'2026-08-28',scope:'partner'}));
});