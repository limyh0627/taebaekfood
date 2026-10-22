/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, within, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ command: vi.fn(),uid:'u',confirm:vi.fn() }));
vi.mock('../src/shared/services/returnRequestSubmission', () => ({ returnSubmissionActorUid: () => m.uid, getPendingReturnSubmission: () => null, resumeReturnSubmission: vi.fn(), submitReturnRequest: (_company: string, data: unknown) => m.command({collection:'returnRequests',data}) }));
vi.mock('../src/shared/services/firebaseService', () => ({ subscribeToCollection: () => () => {} }));
vi.mock('firebase/firestore', () => ({ where: () => ({}) }));
vi.mock('../src/shared/components/appDialog',()=>({appConfirm:m.confirm}));
import ReturnManager from './ReturnManager';
import type { IssuedStatement, Item, Partner } from '../src/shared/types';
beforeEach(() => { m.uid='u'; m.command.mockReset(); m.confirm.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('완제품 폐기 반품은 원전표 금액과 선택 사유를 보존한다', async () => {
  const item = { id: 'p', companyId: 'taebaek', name: '완제품', type: 'product', unit: '개', stock: 5, minStock: 0, image: '', lots: [{ id: 'lot', supplierName: '합성 공급처', kgIn: 5, kgRemaining: 5, receivedDate: '2026-10-01', status: 'active', createdAt: '2026-10-01T00:00:00Z' }] } as Item;
  const source = { id: 'sale', companyId: 'taebaek', partnerId: 'c', type: '매출', tradeDate: '2026-10-01', docNo: '원매출', totalSupply: 200, totalTax: 20, totalAmount: 220,
    items: [{ itemId: 'p', name: '완제품', qty: 2, supply: 200, tax: 20, total: 220, accountCode: '404' }] } as IssuedStatement;
  render(<ReturnManager companyId="taebaek" items={[item]} partners={[{ id: 'c', companyId: 'taebaek', name: '고객', partnerType: '매출처' } as Partner]} orders={[]} issuedStatements={[source]} currentUser={{ id: 'u', name: '관리자' }} isAdmin onProcessReturn={vi.fn()} />);
  fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'c' } });
  fireEvent.change(screen.getAllByRole('combobox')[2], { target: { value: 'sale' } });
  fireEvent.click(screen.getByRole('button', { name: /품목 추가/ }));
  fireEvent.change(screen.getAllByRole('combobox')[3], { target: { value: 'p' } });
  fireEvent.change(screen.getAllByPlaceholderText('0')[0], { target: { value: '1' } });
  fireEvent.change(screen.getAllByRole('combobox')[4], { target: { value: '품질불량' } });
  fireEvent.click(screen.getByRole('button', { name: '재판매' }));
  expect(screen.getByText('₩110')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /반품 접수/ }));
  await waitFor(() => expect(m.command).toHaveBeenCalledOnce());
  expect(m.command.mock.calls[0][0]).toMatchObject({ collection: 'returnRequests', data: { totalAmount: 110,
    items: [{ quantity: 1, price: 110, reason: '품질불량', isResellable: false }] } });
});

it('반품 관리 탭을 헤더에 두고 이력 조회만 검색조건으로 표시한다',()=>{
 render(<ReturnManager companyId="taebaek" items={[]} partners={[]} orders={[]} issuedStatements={[]} currentUser={{id:'u',name:'관리자'}} isAdmin onProcessReturn={vi.fn()}/>);
 const title=screen.getByRole('heading',{name:'반품 관리'}),history=screen.getByRole('button',{name:'이력'});expect(history.closest('[data-page-header-slot="tabs"]')).not.toBeNull();expect(title.compareDocumentPosition(history)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(screen.queryByRole('region',{name:'검색조건'})).toBeNull();fireEvent.click(history);expect(screen.getByRole('region',{name:'검색조건'})).toBeInTheDocument();const from=screen.getByLabelText('반품 조회 시작일');fireEvent.change(from,{target:{value:'2026-10-01'}});expect(from).toHaveValue('2026-10-01');fireEvent.change(from,{target:{value:'2025-01-01'}});fireEvent.click(within(screen.getByRole('region',{name:'검색조건'})).getByRole('button',{name:'초기화'}));expect(from).not.toHaveValue('2025-01-01');fireEvent.click(screen.getByRole('button',{name:'접수'}));expect(screen.queryByRole('region',{name:'검색조건'})).toBeNull();
});
it.each(['actor-change','cancel','accepted','rejected'] as const)('원전표 없는 접수 확인의 %s 결과는 최초 actor와 초안을 보호한다',async mode=>{
 m.uid='u';m.command.mockReset();m.confirm.mockReset();let approve!:(value:boolean)=>void;m.confirm.mockImplementation(()=>new Promise(r=>{approve=r;}));if(mode==='rejected')m.command.mockRejectedValueOnce(Error('접수 거절'));else m.command.mockResolvedValue(undefined);vi.spyOn(window,'alert').mockImplementation(()=>{});
 const item:Item={id:'p',companyId:'taebaek',name:'완제품',type:'product',spec:'1개',unit:'개',stock:5,minStock:0,image:''};
 const source:IssuedStatement={id:'sale',companyId:'taebaek',orderId:'',partnerId:'c',partnerName:'고객',type:'매출',tradeDate:'2026-10-01',docNo:'원매출',issuedAt:'2026-10-01T00:00:00Z',totalSupply:200,totalTax:20,totalAmount:220,items:[{itemId:'p',name:'완제품',spec:'',qty:2,price:100,supply:200,tax:20,total:220,isTaxExempt:false,accountCode:'404'}]};
 render(<ReturnManager companyId="taebaek" items={[item]} partners={[{id:'c',companyId:'taebaek',name:'고객',partnerType:'매출처'} as Partner]} orders={[]} issuedStatements={[source]} currentUser={{id:'u',name:'관리자'}} isAdmin onProcessReturn={vi.fn()}/>);
 fireEvent.change(screen.getAllByRole('combobox')[0],{target:{value:'c'}});fireEvent.click(screen.getByRole('button',{name:/품목 추가/}));fireEvent.change(screen.getAllByRole('combobox')[3],{target:{value:'p'}});fireEvent.change(screen.getAllByPlaceholderText('0')[0],{target:{value:'1'}});fireEvent.change(screen.getByLabelText('완제품 공급가'),{target:{value:'100'}});fireEvent.change(screen.getByLabelText('완제품 세액'),{target:{value:'10'}});fireEvent.change(screen.getByLabelText('완제품 발생 계정'),{target:{value:'404'}});
 fireEvent.click(screen.getByRole('button',{name:/반품 접수/}));expect(m.confirm).toHaveBeenCalledOnce();if(mode==='actor-change')m.uid='other';await act(async()=>approve(mode!=='cancel'));
 if(mode==='actor-change'||mode==='cancel'){expect(m.command).not.toHaveBeenCalled();expect(screen.getAllByPlaceholderText('0')[0]).toHaveValue(1);}else{await waitFor(()=>expect(m.command).toHaveBeenCalledOnce());expect(m.command.mock.calls[0][0].data).toMatchObject({companyId:'taebaek',partnerId:'c',returnType:'매출',totalAmount:110,items:[{itemId:'p',quantity:1,supply:100,tax:10,accountCode:'404'}]});if(mode==='rejected')expect(screen.getAllByPlaceholderText('0')[0]).toHaveValue(1);}
 m.uid='u';
});