/** @vitest-environment jsdom */
import {act,renderHook} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({confirm:vi.fn()}));
vi.mock('../../../shared/components/appDialog',()=>({appConfirm:m.confirm}));
import {useChecklistDraftControl} from './useChecklistDraftControl';
beforeEach(()=>{m.confirm.mockReset();});
it('깨끗한 초안은 확인 없이 세대를 바꾸고 이전 token을 무효화한다',async()=>{
 const {result}=renderHook(()=>useChecklistDraftControl()),action=vi.fn(),old=result.current.generation.current;
 expect(result.current.current(old)).toBe(true);await act(async()=>result.current.change(action));
 expect(action).toHaveBeenCalledOnce();expect(m.confirm).not.toHaveBeenCalled();expect(result.current.current(old)).toBe(false);expect(result.current.current(old+1)).toBe(true);
});
it('dirty 취소는 원초안·세대를 유지하고 승인할 때만 한 번 전환한다',async()=>{
 const {result}=renderHook(()=>useChecklistDraftControl()),action=vi.fn();result.current.dirty.current=true;m.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
 await act(async()=>result.current.change(action));expect(action).not.toHaveBeenCalled();expect(result.current.dirty.current).toBe(true);expect(result.current.generation.current).toBe(0);
 await act(async()=>result.current.change(action));expect(action).toHaveBeenCalledOnce();expect(result.current.dirty.current).toBe(false);expect(result.current.generation.current).toBe(1);
});
it('저장 중에는 확인 전부터 전환을 막는다',async()=>{
 const {result}=renderHook(()=>useChecklistDraftControl()),action=vi.fn();result.current.busy.current=true;result.current.dirty.current=true;
 await act(async()=>result.current.change(action));expect(action).not.toHaveBeenCalled();expect(m.confirm).not.toHaveBeenCalled();
});
it('확인 중 중복 전환을 막고 승인 전 시작한 저장도 전환을 막는다',async()=>{
 let release!:(value:boolean)=>void;m.confirm.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
 const {result}=renderHook(()=>useChecklistDraftControl()),action=vi.fn();result.current.dirty.current=true;
 const pending=result.current.change(action);await result.current.change(action);expect(m.confirm).toHaveBeenCalledOnce();
 result.current.busy.current=true;await act(async()=>{release(true);await pending;});expect(action).not.toHaveBeenCalled();expect(result.current.dirty.current).toBe(true);
});
it('언마운트 뒤 늦은 승인은 실행되지 않고 이전 token도 무효화된다',async()=>{
 let release!:(value:boolean)=>void;m.confirm.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
 const {result,unmount}=renderHook(()=>useChecklistDraftControl()),control=result.current,action=vi.fn();control.dirty.current=true;const token=control.generation.current,pending=control.change(action);
 unmount();await act(async()=>{release(true);await pending;});expect(action).not.toHaveBeenCalled();expect(control.current(token)).toBe(false);expect(control.active.current).toBe(false);
});
