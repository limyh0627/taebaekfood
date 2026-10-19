// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { TaxonomyRow } from '../../../shared/taxonomy';
import { useTaxonomyOrder } from './useTaxonomyOrder';
import { prepareTaxonomyTypeOrder, prepareTaxonomyRowOrder, TaxonomyOrderNotStartedError, type commitTaxonomyOrder } from '../infrastructure/taxonomyOrderWrites';
const auth=vi.hoisted(()=>({currentUser:{uid:'A'}}));
vi.mock('../../../shared/firebase',()=>({auth,authReady:Promise.resolve(),db:{}}));
const rows:TaxonomyRow[]=[{id:'type-a',kind:'type',key:'product',label:'이름초안',order:0},{id:'type-b',kind:'type',key:'goods',label:'상품',order:1},{id:'sub-a',kind:'subtype',parent:'product',label:'낱개',order:0},{id:'sub-b',kind:'subtype',parent:'product',label:'박스',order:1}];
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(reason:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
const ports=()=>({prepareType:prepareTaxonomyTypeOrder,prepareRow:prepareTaxonomyRowOrder,commit:vi.fn<typeof commitTaxonomyOrder>(async plan=>plan.ackRows as TaxonomyRow[])});
beforeEach(()=>{auth.currentUser.uid='A';});
it('실제 이동 준비는 순서만 ACK하고 저장 전 표시를 변경하지 않는다',async()=>{
 const p=ports(),gate=deferred<TaxonomyRow[]>();p.commit.mockImplementation(()=>gate.promise);const ack=vi.fn();const {result}=renderHook(()=>useTaxonomyOrder({companyId:'taebaek',actorUid:'A',rows,onOrderAck:ack,ports:p}));let run!:Promise<boolean>;act(()=>{run=result.current.moveRow(rows[2],1,'subtype','product');});expect(ack).not.toHaveBeenCalled();expect(result.current.busy).toBe(true);await act(async()=>{gate.resolve([{id:'sub-b',order:0},{id:'sub-a',order:1}] as TaxonomyRow[]);await run;});expect(ack).toHaveBeenCalledExactlyOnceWith([{id:'sub-b',order:0},{id:'sub-a',order:1}]);
});
it('같은 틱 이동과 이름 저장은 같은 동기 잠금을 공유한다',async()=>{
 const p=ports(),gate=deferred<TaxonomyRow[]>();p.commit.mockImplementation(()=>gate.promise);const write=vi.fn(),ack=vi.fn();const {result}=renderHook(()=>useTaxonomyOrder({companyId:'taebaek',actorUid:'A',rows,onOrderAck:ack,ports:p}));let run!:Promise<boolean>;act(()=>{run=result.current.moveType('product',1);});act(()=>{void result.current.moveType('goods',-1);void result.current.runAction(write);});expect(p.commit).toHaveBeenCalledOnce();expect(write).not.toHaveBeenCalled();const plan=p.commit.mock.calls[0][0];expect(plan.operations.every(op=>!!op.id)).toBe(true);expect(plan.ackRows.find(row=>row.id==='type-a')).toEqual({id:'type-a',order:1});await act(async()=>{gate.resolve([{id:'sub-b',order:0},{id:'sub-a',order:1}] as TaxonomyRow[]);await run;});
});
it('미확정은 자동 재송신0이고 새 조회 ACK 뒤 별도 명시 이동만 허용한다',async()=>{
 const p=ports();p.commit.mockRejectedValueOnce(Error('lost'));const ack=vi.fn();const {result}=renderHook(()=>useTaxonomyOrder({companyId:'taebaek',actorUid:'A',rows,onOrderAck:ack,ports:p}));await act(()=>result.current.moveType('product',1));expect(result.current.needsReload).toBe(true);expect(ack).not.toHaveBeenCalled();expect(result.current.error).toContain('현재 순서를 확인');expect(result.current.error).toContain('이전 저장이 뒤늦게 반영');await act(()=>result.current.moveType('product',1));expect(p.commit).toHaveBeenCalledOnce();act(()=>{expect(result.current.markReloaded(rows)).toBe(true);});await act(()=>result.current.moveType('product',1));expect(p.commit).toHaveBeenCalledTimes(2);
});
it('미송신 검증 거절은 원인을 표시하고 재조회 강제를 추가하지 않는다',async()=>{
 const p=ports();p.commit.mockRejectedValueOnce(new TaxonomyOrderNotStartedError('500개 초과'));const {result}=renderHook(()=>useTaxonomyOrder({companyId:'taebaek',actorUid:'A',rows,onOrderAck:vi.fn(),ports:p}));await act(()=>result.current.moveType('product',1));expect(result.current.error).toBe('500개 초과');expect(result.current.needsReload).toBe(false);
});
it('확인 await 후 scope가 바뀌면 공용 context가 송신을 차단한다',async()=>{
 const p=ports(),confirm=deferred<boolean>(),write=vi.fn();const {result,rerender}=renderHook(({uid})=>useTaxonomyOrder({companyId:'taebaek',actorUid:uid,rows,onOrderAck:vi.fn(),ports:p}),{initialProps:{uid:'A'}});let run!:Promise<boolean>;act(()=>{run=result.current.runAction(async ctx=>{if(await confirm.promise && ctx.isCurrent())write();});});auth.currentUser.uid='B';rerender({uid:'B'});await act(async()=>{confirm.resolve(true);await run;});expect(write).not.toHaveBeenCalled();
});
it('이전 ACK·오류·finally는 새 scope 작업과 표시를 건드리지 않는다',async()=>{
 const p=ports(),old=deferred<TaxonomyRow[]>(),fresh=deferred<TaxonomyRow[]>();p.commit.mockImplementationOnce(()=>old.promise).mockImplementationOnce(()=>fresh.promise);const ack=vi.fn();const {result,rerender}=renderHook(({uid})=>useTaxonomyOrder({companyId:'taebaek',actorUid:uid,rows,onOrderAck:ack,ports:p}),{initialProps:{uid:'A'}});let a!:Promise<boolean>,b!:Promise<boolean>;act(()=>{a=result.current.moveType('product',1);});auth.currentUser.uid='B';rerender({uid:'B'});act(()=>{b=result.current.moveType('product',1);});await act(async()=>{old.reject(Error('old'));await a;});expect(result.current.busy).toBe(true);expect(result.current.error).toBe('');expect(ack).not.toHaveBeenCalled();await act(async()=>{fresh.resolve(rows);await b;});expect(ack).toHaveBeenCalledOnce();
});
it('busy 동안 재조회 완료를 주장하거나 lock을 풀 수 없다',async()=>{
 const gate=deferred<TaxonomyRow[]>(),p=ports();const {result}=renderHook(()=>useTaxonomyOrder({companyId:'taebaek',actorUid:'A',rows,onOrderAck:vi.fn(),ports:p}));let run!:Promise<boolean>;act(()=>{run=result.current.runAction(()=>gate.promise);});act(()=>{expect(result.current.markReloaded(rows)).toBe(false);});expect(result.current.busy).toBe(true);await act(async()=>{gate.resolve([{id:'sub-b',order:0},{id:'sub-a',order:1}] as TaxonomyRow[]);await run;});
});

it('기본 계획 라벨 대신 실제 TX ACK의 기존 라벨과 숨김을 전달한다',async()=>{
 const p=ports(),actual:TaxonomyRow[]=[{id:'existing',kind:'type',key:'service',label:'다른 관리자가 저장한 이름',hidden:true,order:0}];p.commit.mockResolvedValueOnce(actual);const ack=vi.fn();
 const {result}=renderHook(()=>useTaxonomyOrder({companyId:'taebaek',actorUid:'A',rows,onOrderAck:ack,ports:p}));await act(()=>result.current.moveType('service',-1));expect(ack).toHaveBeenCalledExactlyOnceWith(actual);
});
