/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ItemList from './ItemList';
import type { CompanyId, Item, ReturnRequest } from '../src/shared/types';
import { returnBusinessText } from '../src/shared/returnBusinessEvidence';
const state=vi.hoisted(()=>({uid:'auth-a',confirm:vi.fn(),quantityPending:vi.fn(),cancellationPending:vi.fn()}));
vi.mock('../src/shared/firebase',()=>({db:{},storage:{},functions:{},authReady:Promise.resolve(),auth:{get currentUser(){return {uid:state.uid};}}}));
vi.mock('../src/shared/services/firebaseService',()=>({fetchCollection:vi.fn().mockResolvedValue([]),subscribeToCollection:vi.fn(()=>()=>{}),addItem:vi.fn()}));
vi.mock('../src/shared/components/appDialog',()=>({appConfirm:state.confirm}));
vi.mock('../src/shared/services/pendingFlowQuantityService',()=>({hasPendingReturnQuantity:state.quantityPending,resumePendingReturnQuantity:vi.fn()}));
vi.mock('../src/shared/services/returnRequestCancellation',()=>({hasPendingReturnCancellation:state.cancellationPending,cancelReturnRequest:vi.fn(),resumeReturnCancellation:vi.fn()}));
const item:Item={id:'p1',companyId:'taebaek',name:'기름',type:'product',unit:'병',stock:10,minStock:0,image:''};
const request=(id='return-1',companyId:CompanyId='taebaek'):ReturnRequest=>({id,companyId,partnerId:'partner',partnerName:`거래처-${id}`,status:'pending',createdAt:'2026-10-11T01:00:00Z',returnType:'매입',totalAmount:110,items:[{itemId:'p1',name:'기름',quantity:2,price:55,reason:'기타',isResellable:false}]});
const noop=vi.fn();
const props=(rows:ReturnRequest[],extra:Partial<React.ComponentProps<typeof ItemList>>={}):React.ComponentProps<typeof ItemList>=>({companyId:'taebaek',currentUser:{id:state.uid,name:'관리자'},isAdmin:true,items:[item],partners:[],orderRequests:[],confirmedOrders:[],receivedOrders:[],returnRequests:rows,inboundPartners:[],rawMaterialLedger:[],returnContent:<div>새 반품 접수 폼</div>,onProcessReturn:vi.fn().mockResolvedValue(undefined),onResumeReturn:vi.fn().mockResolvedValue(undefined),
onUpdateItem:noop,onAddItem:noop,onAddOrderRequest:noop,onRemoveOrderRequest:noop,onUpdateOrderRequestQty:noop,onToggleConfirmRequestQty:noop,onConfirmRequest:noop,onConfirmRequests:noop,onBulkAddConfirmedOrders:noop,onConfirmAllRequests:noop,onFinishConfirmedOrder:noop,onUpdateConfirmedQty:noop,onRemoveConfirmedOrder:noop,onEditProduct:noop,onDeleteItem:noop,onAddAdjustmentRequest:noop,onAddRawMaterialEntry:noop,onDeleteRawMaterialEntry:noop,...extra});
const flow=()=>fireEvent.click(screen.getByRole('button',{name:'입고/반품'}));
const open=(id='return-1')=>fireEvent.click(screen.getByText(`거래처-${id}`).closest('tr')!);
const process=()=>fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'반품 처리'}));
function deferred<T>(){let resolve!:(v:T)=>void;let reject!:(error:Error)=>void;const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};}
function preserve(row:ReturnRequest){localStorage.setItem(`return-pending:${row.companyId}:${row.id}:${state.uid}`,JSON.stringify({version:2,fingerprint:returnBusinessText(row),command:{operationId:'return-op',returnRequestId:row.id,tradeDate:'2026-10-11',expectedPartnerRevision:0,releaseId:'release-test',expectedBusinessHash:'a'.repeat(64)}}));}
beforeEach(()=>{localStorage.clear();state.uid='auth-a';state.confirm.mockReset().mockResolvedValue(true);state.quantityPending.mockReset().mockReturnValue(false);state.cancellationPending.mockReset().mockReturnValue(false);});
describe('실제 입고·반품 행의 원문 처리',()=>{
 it('특정 행 작업은 그 상세만 열고 선택 원문을 확인 후 처리한다',async()=>{
  const first=request(),second=request('return-2'),p=props([first,second]);render(<ItemList {...p}/>);flow();
  const row=within(screen.getByText(second.partnerName).closest('tr')!);fireEvent.click(row.getByRole('button',{name:'반품 처리'}));
  expect(screen.getByRole('dialog')).toHaveAccessibleName('반품 상세');expect(screen.queryByText('새 반품 접수 폼')).not.toBeInTheDocument();expect(state.confirm).not.toHaveBeenCalled();process();
  await waitFor(()=>expect(p.onProcessReturn).toHaveBeenCalledExactlyOnceWith(second));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(p.onResumeReturn).not.toHaveBeenCalled();
 });
 it('상단 새 접수 버튼은 기존 폼을 그대로 연다',()=>{render(<ItemList {...props([request()])}/>);flow();fireEvent.click(screen.getAllByRole('button',{name:'반품 처리'})[0]);expect(screen.getByText('새 반품 접수 폼')).toBeInTheDocument();});
 it('원전표 없는 정상 접수도 같은 callback에 원문 그대로 전달한다',async()=>{const row=request(),p=props([row]);render(<ItemList {...p}/>);flow();open();process();await waitFor(()=>expect(p.onProcessReturn).toHaveBeenCalledWith(row));});
 it('확인 중 중복 클릭은 한 번만 승인·처리한다',async()=>{const answer=deferred<boolean>(),p=props([request()]);state.confirm.mockReturnValue(answer.promise);render(<ItemList {...p}/>);flow();open();process();process();expect(state.confirm).toHaveBeenCalledOnce();await act(async()=>{answer.resolve(true);await answer.promise;});await waitFor(()=>expect(p.onProcessReturn).toHaveBeenCalledOnce());});
 it('확인 취소는 상세·원문을 유지하고 쓰지 않는다',async()=>{const p=props([request()]);state.confirm.mockResolvedValue(false);render(<ItemList {...p}/>);flow();open();process();await waitFor(()=>expect(within(screen.getByRole('dialog')).getByRole('button',{name:'반품 처리'})).toBeEnabled());expect(p.onProcessReturn).not.toHaveBeenCalled();});
 it.each(['totalAmount','partnerId','linkedStatementId','quantity'] as const)('승인 중 %s 변경은 다른 원문을 처리하지 않는다',async field=>{
  const row=request(),answer=deferred<boolean>(),p=props([row]);state.confirm.mockReturnValue(answer.promise);const view=render(<ItemList {...p}/>);flow();open();process();
  const changed=field==='quantity'?{...row,items:[{...row.items[0],quantity:9}]}:{...row,[field]:field==='totalAmount'?220:'changed'};
  view.rerender(<ItemList {...props([changed],{onProcessReturn:p.onProcessReturn})}/>);await act(async()=>{answer.resolve(true);await answer.promise;});expect(p.onProcessReturn).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('변경');
 });
 it('확인 중 닫고 새 상세를 열면 이전 승인이 새 요청을 처리하지 않는다',async()=>{
  const answer=deferred<boolean>(),p=props([request(),request('return-2')]);state.confirm.mockReturnValue(answer.promise);render(<ItemList {...p}/>);flow();open();process();fireEvent.click(screen.getByRole('button',{name:'반품 상세 닫기'}));open('return-2');await act(async()=>{answer.resolve(true);await answer.promise;});expect(p.onProcessReturn).not.toHaveBeenCalled();expect(screen.getByRole('dialog')).toHaveTextContent('거래처-return-2');
 });
 it.each(['company','uid','role'] as const)('%s 전환 뒤 이전 승인으로 처리하지 않는다',async mode=>{
  const answer=deferred<boolean>(),row=request(),p=props([row]);state.confirm.mockReturnValue(answer.promise);const view=render(<ItemList {...p}/>);flow();open();process();
  if(mode==='uid')state.uid='auth-b';view.rerender(<ItemList {...props([row],mode==='company'?{companyId:'punghoe',items:[{...item,companyId:'punghoe'}],returnRequests:[]} : mode==='role'?{isAdmin:false}:{currentUser:{id:'auth-b',name:'새사용자'}})}/>);
  await act(async()=>{answer.resolve(true);await answer.promise;});expect(p.onProcessReturn).not.toHaveBeenCalled();
 });
 it('실패는 상세와 원문을 남기고 같은 승인 원문으로 재시도한다',async()=>{
  const row=request(),p=props([row]);(p.onProcessReturn as any).mockRejectedValueOnce(new Error('연결 실패'));render(<ItemList {...p}/>);flow();open();process();await screen.findByRole('alert');expect(screen.getByRole('alert')).toHaveTextContent('연결 실패');process();await waitFor(()=>expect(p.onProcessReturn).toHaveBeenCalledTimes(2));expect((p.onProcessReturn as any).mock.calls).toEqual([[row],[row]]);
 });
 it('처리된 이력은 보존 명령 결과 확인만 하고 새 원문을 보내지 않는다',async()=>{
  const original=request();preserve(original);const processed={...original,status:'processed' as const,processedAt:'2026-10-12T01:00:00Z',totalAmount:999},p=props([processed]);render(<ItemList {...p}/>);flow();fireEvent.click(screen.getByRole('button',{name:'이력'}));fireEvent.click(screen.getByRole('button',{name:'이전 처리 결과 확인'}));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'이전 처리 결과 확인'}));await waitFor(()=>expect(p.onResumeReturn).toHaveBeenCalledExactlyOnceWith(original.id));expect(p.onProcessReturn).not.toHaveBeenCalled();
 });
 it('응답 유실 후 processed 구독·재마운트에서도 같은 결과 확인 진입이 남는다',async()=>{
  const original=request(),gate=deferred<void>(),p=props([original]);(p.onProcessReturn as any).mockImplementationOnce(()=>{preserve(original);return gate.promise;});const view=render(<ItemList {...p}/>);flow();open();process();await waitFor(()=>expect(p.onProcessReturn).toHaveBeenCalledOnce());
  const processed={...original,status:'processed' as const,processedAt:'2026-10-12T01:00:00Z'};view.rerender(<ItemList {...props([processed],{onProcessReturn:p.onProcessReturn,onResumeReturn:p.onResumeReturn})}/>);
  await act(async()=>{gate.reject(new Error('응답 유실'));await gate.promise.catch(()=>{});});expect(within(screen.getByRole('dialog')).getByRole('button',{name:'이전 처리 결과 확인'})).toBeEnabled();view.unmount();render(<ItemList {...props([processed],{onResumeReturn:p.onResumeReturn})}/>);flow();fireEvent.click(screen.getByRole('button',{name:'이력'}));open();fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'이전 처리 결과 확인'}));await waitFor(()=>expect(p.onResumeReturn).toHaveBeenCalledWith(original.id));
 });
 it('손상된 보존 원문은 새 처리로 대체하지 않고 표시·차단한다',()=>{
  const row=request();localStorage.setItem(`return-pending:taebaek:${row.id}:${state.uid}`,'broken');const p=props([row]);render(<ItemList {...p}/>);flow();open();expect(screen.getByRole('alert')).toHaveTextContent('저장된 반품');expect(within(screen.getByRole('dialog')).getByRole('button',{name:'이전 처리 결과 확인'})).toBeDisabled();expect(p.onProcessReturn).not.toHaveBeenCalled();expect(localStorage.getItem(`return-pending:taebaek:${row.id}:${state.uid}`)).toBe('broken');
 });
 it.each(['quantity','cancellation'] as const)('%s 미확정 작업 중 반품 처리하지 않는다',mode=>{state[mode==='quantity'?'quantityPending':'cancellationPending'].mockReturnValue(true);const p=props([request()]);render(<ItemList {...p}/>);flow();open();expect(within(screen.getByRole('dialog')).getByRole('button',{name:'반품 처리'})).toBeDisabled();expect(p.onProcessReturn).not.toHaveBeenCalled();});
 it('직원은 신규 반품처리 버튼 없이 상세만 읽는다',()=>{const p=props([request()],{isAdmin:false});render(<ItemList {...p}/>);flow();open();expect(within(screen.getByRole('dialog')).queryByRole('button',{name:'반품 처리'})).not.toBeInTheDocument();expect(p.onProcessReturn).not.toHaveBeenCalled();});
 it('다른 UID의 pending는 현재 요청의 재개로 섞이지 않는다',()=>{const row=request();preserve(row);state.uid='auth-b';render(<ItemList {...props([row])}/>);flow();open();expect(within(screen.getByRole('dialog')).getByRole('button',{name:'반품 처리'})).toBeEnabled();expect(within(screen.getByRole('dialog')).queryByRole('button',{name:'이전 처리 결과 확인'})).not.toBeInTheDocument();});
});


it('이전 처리의 늦은 실패가 새 상세의 원문·버튼을 바꾸지 않는다',async()=>{
 const gate=deferred<void>(),p=props([request(),request('return-2')]);(p.onProcessReturn as any).mockReturnValueOnce(gate.promise);render(<ItemList {...p}/>);flow();open();process();await waitFor(()=>expect(p.onProcessReturn).toHaveBeenCalledOnce());fireEvent.click(screen.getByRole('button',{name:'반품 상세 닫기'}));open('return-2');await act(async()=>{gate.reject(new Error('이전 요청 오류'));await gate.promise.catch(()=>{});});expect(screen.getByRole('dialog')).toHaveTextContent('거래처-return-2');expect(screen.queryByRole('alert')).not.toBeInTheDocument();expect(within(screen.getByRole('dialog')).getByRole('button',{name:'반품 처리'})).toBeEnabled();
});
it('UID 전환 뒤 이전 처리 실패는 새 사용자 상세를 잠그지 않는다',async()=>{
 const gate=deferred<void>(),rows=[request(),request('return-2')],p=props(rows);(p.onProcessReturn as any).mockReturnValueOnce(gate.promise);const view=render(<ItemList {...p}/>);flow();open();process();await waitFor(()=>expect(p.onProcessReturn).toHaveBeenCalledOnce());state.uid='auth-b';view.rerender(<ItemList {...props(rows)}/>);fireEvent.click(screen.getByRole('button',{name:'반품 상세 닫기'}));open('return-2');await act(async()=>{gate.reject(new Error('이전 사용자 오류'));await gate.promise.catch(()=>{});});expect(screen.queryByRole('alert')).not.toBeInTheDocument();expect(within(screen.getByRole('dialog')).getByRole('button',{name:'반품 처리'})).toBeEnabled();
});

it('관리자 역할을 껐다 다시 켜도 이전 확인은 새 승인으로 재사용하지 않는다',async()=>{
 const answer=deferred<boolean>(),row=request(),p=props([row]);state.confirm.mockReturnValue(answer.promise);const view=render(<ItemList {...p}/>);flow();open();process();view.rerender(<ItemList {...props([row],{isAdmin:false,onProcessReturn:p.onProcessReturn})}/>);view.rerender(<ItemList {...props([row],{isAdmin:true,onProcessReturn:p.onProcessReturn})}/>);await act(async()=>{answer.resolve(true);await answer.promise;});expect(p.onProcessReturn).not.toHaveBeenCalled();expect(within(screen.getByRole('dialog')).getByRole('button',{name:'반품 처리'})).toBeEnabled();
});