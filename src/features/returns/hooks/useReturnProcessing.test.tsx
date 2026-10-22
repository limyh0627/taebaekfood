/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useReturnProcessing } from './useReturnProcessing';
import type { CompanyId, ReturnRequest } from '../../../shared/types';
const m = vi.hoisted(() => ({ uid: 'actor', confirm: vi.fn() }));
vi.mock('../../../shared/services/returnRequestSubmission', () => ({ returnSubmissionActorUid: () => m.uid }));
vi.mock('../../../shared/components/appDialog', () => ({ appConfirm: m.confirm }));
const row: ReturnRequest = { id: 'r', companyId: 'taebaek', partnerId: 'p', partnerName: '거래처', items: [{ itemId: 'i', name: '품목', quantity: 1, price: 100, reason: '기타', isResellable: true }], totalAmount: 100, status: 'pending', createdAt: '2026-10-22' };
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
beforeEach(() => { m.uid='actor'; m.confirm.mockReset(); vi.spyOn(window,'alert').mockImplementation(()=>{}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function setup() {
  const save = vi.fn().mockResolvedValue(undefined);
  const initial = { companyId: 'taebaek' as CompanyId, isAdmin: true, requests: [structuredClone(row)], onProcessReturn: save };
  const hook = renderHook(options => useReturnProcessing(options), { initialProps: initial });
  return { ...hook, save, initial };
}
it('확인전 동기 잠금과 원문 스냅샷을 유지한다', async () => {
  const confirm=deferred<boolean>(); m.confirm.mockReturnValue(confirm.promise); const h=setup(); let first!:Promise<void>;
  act(()=>{first=h.result.current.process(row); void h.result.current.process(row);});
  expect(m.confirm).toHaveBeenCalledOnce(); expect(h.result.current.busy).toBe(true);
  await act(async()=>{confirm.resolve(true);await first;}); expect(h.save).toHaveBeenCalledExactlyOnceWith(row); expect(h.result.current.busy).toBe(false);
});
it.each(['cancel','confirm-error','save-error'] as const)('%s 이후 현재행 명시재시도가 가능하다', async mode => {
  const h=setup(); if(mode==='confirm-error')m.confirm.mockRejectedValueOnce(Error('확인 오류')); else m.confirm.mockResolvedValueOnce(mode!=='cancel');
  if(mode==='save-error')h.save.mockRejectedValueOnce(Error('처리 오류'));
  await act(async()=>h.result.current.process(row)); expect(h.result.current.busy).toBe(false);
  m.confirm.mockResolvedValueOnce(true); await act(async()=>h.result.current.process(row)); expect(h.save).toHaveBeenCalledTimes(mode==='save-error'?2:1);
});
it.each(['uid','admin','missing','business','processed','cancelled'] as const)('%s 변경은 확인 뒤 송신을 막는다', async mode => {
  const confirm=deferred<boolean>();m.confirm.mockReturnValue(confirm.promise);const h=setup();let run!:Promise<void>;
  act(()=>{run=h.result.current.process(row);});
  if(mode==='uid')m.uid='other';
  else h.rerender({...h.initial,isAdmin:mode!=='admin',requests:mode==='missing'?[]:[{...row,...(mode==='business'?{totalAmount:101}:mode==='processed'?{status:'processed' as const}:mode==='cancelled'?{cancelledAt:'now'}:{})}]});
  await act(async()=>{confirm.resolve(true);await run;});expect(h.save).not.toHaveBeenCalled();
});
it('무관 메타 갱신은 원문 처리를 막지 않는다',async()=>{
  const confirm=deferred<boolean>();m.confirm.mockReturnValue(confirm.promise);const h=setup();let run!:Promise<void>;act(()=>{run=h.result.current.process(row);});
  h.rerender({...h.initial,requests:[{...row,createdBy:'새 표시'}]}); await act(async()=>{confirm.resolve(true);await run;});expect(h.save).toHaveBeenCalledExactlyOnceWith(row);
});
it('회사 또는 UID 왕복 뒤 옛 finally는 새 실행 잠금을 풀지 않는다',async()=>{
  m.confirm.mockResolvedValue(true);const old=deferred<void>();const fresh=deferred<void>();const h=setup();h.save.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);let a!:Promise<void>;let b!:Promise<void>;
  await act(async()=>{a=h.result.current.process(row);await Promise.resolve();});
  m.uid='other';h.rerender(h.initial);m.uid='actor';h.rerender(h.initial);
  await act(async()=>{b=h.result.current.process(row);await Promise.resolve();});
  await act(async()=>{old.reject(Error('옛 실패'));await a;});expect(h.result.current.busy).toBe(true);expect(window.alert).not.toHaveBeenCalled();
  await act(async()=>{fresh.resolve();await b;});expect(h.result.current.busy).toBe(false);
});
it('unmount 뒤 확인 승인은 송신하지 않는다',async()=>{
 const confirm=deferred<boolean>();m.confirm.mockReturnValue(confirm.promise);const h=setup();let run!:Promise<void>;act(()=>{run=h.result.current.process(row);});h.unmount();confirm.resolve(true);await run;expect(h.save).not.toHaveBeenCalled();
});
it('회사 전환과 복귀 뒤 예전 처리 포트는 실행되지 않는다',async()=>{
 const h=setup();const previous=h.result.current.process;
 h.rerender({...h.initial,companyId:'punghoe',requests:[]});
 h.rerender(h.initial);m.confirm.mockResolvedValue(true);
 await act(async()=>previous(row));expect(m.confirm).not.toHaveBeenCalled();expect(h.save).not.toHaveBeenCalled();
});
it.each(['admin','business'] as const)('송신 뒤 %s 변경 후 옛 오류는 현재 화면에 표시하지 않는다',async mode=>{
 m.confirm.mockResolvedValue(true);const pending=deferred<void>();const h=setup();h.save.mockReturnValue(pending.promise);let run!:Promise<void>;
 await act(async()=>{run=h.result.current.process(row);await Promise.resolve();});
 h.rerender({...h.initial,isAdmin:mode!=='admin',requests:[{...row,totalAmount:mode==='business'?200:100}]});
 await act(async()=>{pending.reject(Error('옛 오류'));await run;});expect(window.alert).not.toHaveBeenCalled();expect(h.result.current.busy).toBe(false);
});
