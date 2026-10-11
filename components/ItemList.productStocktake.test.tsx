/** @vitest-environment jsdom */
import React from 'react';
import {beforeEach,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,within} from '@testing-library/react';
import ItemList from './ItemList';
import {appConfirm} from '../src/shared/components/appDialog';
import type {Item} from '../src/shared/types';
const memory=vi.hoisted(()=>({item:null as any,writes:0,lose:false,fail:false,uid:'u',companyId:'taebaek',beforeRead:null as null|(()=>void),readWait:null as Promise<void>|null}));
vi.mock('../src/shared/firebase',()=>({db:{},storage:{},functions:{},authReady:Promise.resolve(),auth:{get currentUser(){return {uid:memory.uid,getIdTokenResult:async()=>({claims:{companyId:memory.companyId}})};}}}));
vi.mock('../src/shared/services/firebaseService',()=>({fetchCollection:vi.fn().mockResolvedValue([]),subscribeToCollection:vi.fn(()=>()=>{}),addItem:vi.fn()}));
vi.mock('../src/shared/components/appDialog',()=>({appConfirm:vi.fn().mockResolvedValue(true)}));
vi.mock('firebase/firestore',async(importOriginal)=>({...await importOriginal<typeof import('firebase/firestore')>(),doc:(_db:unknown,...parts:string[])=>({path:parts.join('/')}),runTransaction:async(_db:unknown,fn:any)=>{
 let patch:any;const result=await fn({get:async()=>{const wait=memory.readWait;memory.readWait=null;if(wait)await wait;memory.beforeRead?.();return {exists:()=>true,data:()=>JSON.parse(JSON.stringify(memory.item))};},update:(_ref:unknown,data:any)=>{if(memory.fail)throw Error('쓰기 실패');patch=data;}});
 if(patch){memory.item={...memory.item,...patch};memory.writes++;if(memory.lose){memory.lose=false;throw Error('응답 유실');}}return result;
}}));
const product={id:'p',companyId:'taebaek',name:'실사제품',type:'product',unit:'개',spec:'1kg',stock:3,minStock:0,lots:[{id:'l',qtyIn:3,qtyRemaining:3,unitKg:1,kgIn:3,kgRemaining:3,status:'active'}]} as Item;
function element(companyId:'taebaek'|'punghoe'='taebaek'){return <ItemList companyId={companyId} items={[product]} orderRequests={[]} confirmedOrders={[]} inboundPartners={[]} rawMaterialLedger={[]} partners={[]} isAdmin currentUser={{id:'employee',name:'관리자'}}
 onUpdateItem={vi.fn()} onAddItem={vi.fn()} onAddOrderRequest={vi.fn()} onRemoveOrderRequest={vi.fn()} onUpdateOrderRequestQty={vi.fn()} onToggleConfirmRequestQty={vi.fn()} onConfirmRequest={vi.fn()} onConfirmRequests={vi.fn()} onBulkAddConfirmedOrders={vi.fn()} onConfirmAllRequests={vi.fn()} onFinishConfirmedOrder={vi.fn()} onUpdateConfirmedQty={vi.fn()} onRemoveConfirmedOrder={vi.fn()} onEditProduct={vi.fn()} onDeleteItem={vi.fn()} onAddAdjustmentRequest={vi.fn()} onAddRawMaterialEntry={vi.fn()} onDeleteRawMaterialEntry={vi.fn()}/>;}
function view(){return render(element());}
async function open(){fireEvent.click(screen.getAllByText('실사제품')[0]);fireEvent.click(await screen.findByRole('button',{name:'실사 반영'}));return screen.findByRole('heading',{name:'재고 실사'});}
beforeEach(()=>{localStorage.clear();memory.item=JSON.parse(JSON.stringify(product));memory.writes=0;memory.lose=false;memory.fail=false;memory.uid='u';memory.companyId='taebaek';memory.beforeRead=null;memory.readWait=null;});
it('응답 유실 후 재마운트는 최초 수량으로 결과만 확인하고 중간 출고 재고를 덮지 않는다',async()=>{
 const first=view();await open();const modal=screen.getByRole('heading',{name:'재고 실사'}).closest('[role="dialog"]')!;
 fireEvent.change(within(modal as HTMLElement).getAllByRole('spinbutton')[0],{target:{value:'5'}});memory.lose=true;
 fireEvent.click(screen.getByRole('button',{name:'실사 반영'}));await screen.findByText(/응답 유실/);expect(memory.writes).toBe(1);expect(localStorage.length).toBe(1);
 memory.item.stock=2;memory.item.minStock=7;memory.item.lots=[{...memory.item.lots[0],qtyRemaining:2,kgRemaining:2}];const original=JSON.stringify(memory.item);first.unmount();
 view();await open();expect(screen.getByText(/보존된 최초 실사 5/)).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'실사 결과 확인'}));
 await waitFor(()=>expect(localStorage.length).toBe(0));expect(JSON.stringify(memory.item)).toBe(original);expect(memory.writes).toBe(1);
});
it('쓰기 실패는 원문을 남기고 조회 재시도에서 새 target을 적용하지 않는다',async()=>{
 view();await open();memory.fail=true;fireEvent.click(screen.getByRole('button',{name:'실사 반영'}));await screen.findByText(/쓰기 실패/);
 memory.fail=false;fireEvent.click(screen.getByRole('button',{name:'실사 결과 확인'}));await screen.findByText(/저장 근거를 찾지 못했습니다/);expect(memory.writes).toBe(0);expect(localStorage.length).toBe(1);
 fireEvent.click(screen.getByRole('button',{name:'보존 요청 폐기 후 새 실사'}));await waitFor(()=>expect(localStorage.length).toBe(0));fireEvent.click(screen.getByRole('button',{name:'실사 반영'}));await waitFor(()=>expect(memory.writes).toBe(1));
});
it('정리 실패 후에도 원문을 보존하고 결과 재확인은 추가 실사를 만들지 않는다',async()=>{
 view();await open();const remove=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw Error('원문 정리 실패');});
 fireEvent.click(screen.getByRole('button',{name:'실사 반영'}));await screen.findByText(/원문 정리 실패/);expect(memory.writes).toBe(1);expect(localStorage.length).toBe(1);remove.mockRestore();
 fireEvent.click(screen.getByRole('button',{name:'실사 결과 확인'}));await waitFor(()=>expect(localStorage.length).toBe(0));expect(memory.writes).toBe(1);
});
it('최초 영속 저장 실패는 실제 UI에서 거래를 실행하지 않는다',async()=>{
 view();await open();const set=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('저장 공간 부족');});
 try{fireEvent.click(screen.getByRole('button',{name:'실사 반영'}));await screen.findByText(/저장 공간 부족/);expect(memory.writes).toBe(0);expect(localStorage.length).toBe(0);}finally{set.mockRestore();}
});
it('거래 읽기 중 UID가 바뀌면 이전 회사 요청의 재고를 쓰지 않는다',async()=>{
 view();await open();memory.beforeRead=()=>{memory.beforeRead=null;memory.uid='new-user';};
 fireEvent.click(screen.getByRole('button',{name:'실사 반영'}));await waitFor(()=>expect(memory.uid).toBe('new-user'));await new Promise(resolve=>setTimeout(resolve,15));
 expect(memory.writes).toBe(0);expect(localStorage.length).toBe(1);expect(memory.item.stock).toBe(3);
});

it('폐기 확인 중 회사가 바뀌면 옛 요청을 삭제하지 않는다',async()=>{
 const rendered=view();await open();memory.fail=true;fireEvent.click(screen.getByRole('button',{name:'실사 반영'}));await screen.findByText(/쓰기 실패/);
 let finish!:(value:boolean)=>void;vi.mocked(appConfirm).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 fireEvent.click(screen.getByRole('button',{name:'보존 요청 폐기 후 새 실사'}));const original=localStorage.getItem(localStorage.key(0)!);
 rendered.rerender(element('punghoe'));finish(true);await new Promise(resolve=>setTimeout(resolve,20));
 expect(localStorage.length).toBe(1);expect(localStorage.getItem(localStorage.key(0)!)).toBe(original);expect(memory.writes).toBe(0);
});

it('저장 대기 중 닫았다 다시 연 새 실사 모달은 이전 busy에 잠기지 않는다',async()=>{
 view();await open();let finish!:()=>void;memory.readWait=new Promise(resolve=>{finish=resolve;});fireEvent.click(screen.getByRole('button',{name:'실사 반영'}));
 await waitFor(()=>expect(localStorage.length).toBe(1));await waitFor(()=>expect(memory.readWait).toBeNull());
 const dialog=screen.getByRole('heading',{name:'재고 실사'}).closest('[role="dialog"]')!;fireEvent.click(within(dialog as HTMLElement).getByRole('button',{name:'취소'}));
 await open();expect(screen.getByRole('button',{name:'실사 결과 확인'})).not.toBeDisabled();finish();await waitFor(()=>expect(memory.writes).toBe(1));expect(screen.getByRole('button',{name:'실사 결과 확인'})).not.toBeDisabled();
});
