import {webcrypto,createHash} from 'node:crypto';
/** @vitest-environment jsdom */
import React from 'react';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,it,expect,vi} from 'vitest';
import ItemList from './ItemList';
import type {CompanyId,Item,PurchaseOrder,ReturnRequest} from '../src/shared/types';
import {updatePendingFlowQuantity} from '../src/shared/services/pendingFlowQuantityService';
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=(v:any)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const state=vi.hoisted(()=>({uid:'auth-a',company:'taebaek',call:vi.fn()}));
vi.mock('../src/shared/firebase',()=>({db:{},storage:{},functions:{},authReady:Promise.resolve(),auth:{get currentUser(){return {uid:state.uid,getIdTokenResult:async()=>({claims:{companyId:state.company,isAdmin:true}})};}}}));
vi.mock('firebase/functions',()=>({httpsCallable:()=>state.call}));
vi.mock('../src/shared/services/firebaseService',()=>({fetchCollection:vi.fn().mockResolvedValue([]),subscribeToCollection:vi.fn(()=>()=>{}),addItem:vi.fn()}));
const noop=vi.fn();
const item: Item={id:'p1',name:'기름',companyId:'taebaek',type:'product',unit:'병',stock:10,minStock:0,image:''};
const po=(companyId:CompanyId):PurchaseOrder=>({id:`po-${companyId}`,companyId,itemId:item.id,itemName:item.name,quantity:2,status:'invoiced',partnerName:`공급업체-${companyId}`,createdAt:'2026-10-01',items:[{itemId:item.id,name:item.name,quantity:2,unit:'병'}]});
const props=(companyId:CompanyId):React.ComponentProps<typeof ItemList>=>({companyId,items:[{...item,companyId}],partners:[],orderRequests:[],confirmedOrders:[po(companyId)],inboundPartners:[],rawMaterialLedger:[],
 onUpdateItem:noop,onAddItem:noop,onUpdateOrderRequestQty:noop,onToggleConfirmRequestQty:noop,onConfirmRequest:noop,onConfirmRequests:noop,onBulkAddConfirmedOrders:noop,onConfirmAllRequests:noop,onFinishConfirmedOrder:noop,onUpdateConfirmedQty:noop,onRemoveConfirmedOrder:noop,onEditProduct:noop,onDeleteItem:noop,onAddAdjustmentRequest:noop,onAddRawMaterialEntry:noop,onDeleteRawMaterialEntry:noop});

const request=(companyId:CompanyId,quantity=2):ReturnRequest=>({id:'r1',companyId,partnerId:'partner',partnerName:'반품-'+companyId,returnType:'매입',status:'pending',totalAmount:quantity*55,createdAt:'2026-10-09T00:00:00Z',createdBy:'관리자',payableAccountCode:'253',items:[{itemId:'p1',name:'기름',quantity,price:50,reason:'기타',isResellable:true,supply:quantity*50,tax:quantity*5,accountCode:'540'}]});
const viewProps=(companyId:CompanyId,quantity=2)=>({...props(companyId),confirmedOrders:[],returnRequests:[request(companyId,quantity)],onUpdatePendingFlowQty:(type:'입고'|'반품',id:string,updates:{itemId:string;previousQuantity:number;quantity:number}[])=>updatePendingFlowQuantity(companyId,type,id,updates)});
const key='erp:return-quantity:taebaek:auth-a:r1';
function preserve(){localStorage.setItem(key,JSON.stringify({companyId:'taebaek',requestId:'r1',operationId:'rq-original',updates:[{itemId:'p1',previousQuantity:2,quantity:3}]}));}
function openReturn(companyId:CompanyId){fireEvent.click(screen.getByRole('button',{name:'입고/반품'}));fireEvent.click(screen.getByText('반품-'+companyId));}
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);localStorage.clear();state.uid='auth-a';state.company='taebaek';state.call.mockReset();state.call.mockImplementation(async command=>({data:{status:'duplicate',requestId:command.requestId,operationId:command.operationId,requestHash:hash(command)}}));vi.spyOn(window,'alert').mockImplementation(()=>{});});
it('unknown 후 닫기·최신 수량 재열기에서 실제 이전 원문 재개 버튼이 접근된다',async()=>{
 state.call.mockRejectedValueOnce(Error('unknown'));const view=render(<ItemList {...viewProps('taebaek')}/>);openReturn('taebaek');fireEvent.change(screen.getByLabelText('기름 수량'),{target:{value:'3'}});fireEvent.click(screen.getByRole('button',{name:'수량 저장'}));await waitFor(()=>expect(screen.getByRole('button',{name:'이전 수량 수정 확인'})).toBeEnabled());const original=state.call.mock.calls[0][0];fireEvent.click(screen.getByRole('button',{name:'반품 상세 닫기'}));view.rerender(<ItemList {...viewProps('taebaek',3)}/>);fireEvent.click(screen.getByText('반품-taebaek'));expect(screen.getByLabelText('기름 수량')).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'이전 수량 수정 확인'}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(state.call.mock.calls[1][0]).toEqual(original);expect(localStorage.getItem(key)).toBeNull();
});
it('이전 회사 재개 늦은 성공은 새 회사 상세를 닫지 않는다',async()=>{
 preserve();let finish!:(value:unknown)=>void;state.call.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const view=render(<ItemList {...viewProps('taebaek')}/>);openReturn('taebaek');fireEvent.click(screen.getByRole('button',{name:'이전 수량 수정 확인'}));await waitFor(()=>expect(state.call).toHaveBeenCalledTimes(1));const command=state.call.mock.calls[0][0];state.company='punghoe';view.rerender(<ItemList {...viewProps('punghoe')}/>);openReturn('punghoe');await act(async()=>{finish({data:{status:'duplicate',requestId:'r1',operationId:command.operationId,requestHash:hash(command)}});});expect(screen.getByRole('dialog')).toBeInTheDocument();expect(localStorage.getItem(key)).not.toBeNull();expect(window.alert).not.toHaveBeenCalled();
});
it('UID 변경·늦은 오류는 다른 로그인 상세와 원문을 유지한다',async()=>{
 preserve();let reject!:(error:Error)=>void;state.call.mockImplementationOnce(()=>new Promise((_resolve,fail)=>{reject=fail;}));const view=render(<ItemList {...viewProps('taebaek')}/>);openReturn('taebaek');fireEvent.click(screen.getByRole('button',{name:'이전 수량 수정 확인'}));await waitFor(()=>expect(state.call).toHaveBeenCalledTimes(1));state.uid='auth-b';view.rerender(<ItemList {...viewProps('taebaek')}/>);await act(async()=>{reject(Error('late'));});expect(screen.getByRole('dialog')).toBeInTheDocument();expect(localStorage.getItem(key)).not.toBeNull();expect(window.alert).not.toHaveBeenCalled();
});
