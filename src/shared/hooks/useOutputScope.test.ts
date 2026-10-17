/** @vitest-environment jsdom */
import {act,renderHook} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({auth:{currentUser:{uid:'first'} as {uid:string}|null,onAuthStateChanged:vi.fn()},callback:null as null|((user:{uid:string}|null)=>void),stop:vi.fn()}));
vi.mock('../firebase',()=>({auth:m.auth}));
import {useOutputScope} from './useOutputScope';
beforeEach(()=>{m.auth.currentUser={uid:'first'};m.stop.mockClear();m.auth.onAuthStateChanged.mockImplementation(callback=>{m.callback=callback;return m.stop;});});
it('회사·view·UID 변경과 unmount는 이전 출력 수명을 즉시 끝낸다',()=>{
 const hook=renderHook(({company,view})=>useOutputScope(company,view),{initialProps:{company:'taebaek',view:'a'}});const first=hook.result.current();expect(first.aborted).toBe(false);
 hook.rerender({company:'punghoe',view:'a'});expect(first.aborted).toBe(true);const second=hook.result.current();hook.rerender({company:'punghoe',view:'b'});expect(second.aborted).toBe(true);
 const third=hook.result.current();m.auth.currentUser={uid:'second'};act(()=>m.callback?.(m.auth.currentUser));expect(third.aborted).toBe(true);hook.rerender({company:'punghoe',view:'b'});const fourth=hook.result.current();expect(fourth.aborted).toBe(false);hook.unmount();expect(fourth.aborted).toBe(true);expect(m.stop).toHaveBeenCalled();
});
it('초기 무인증과 callback 전 UID 불일치도 출력하지 않는다',()=>{
 m.auth.currentUser=null;const hook=renderHook(()=>useOutputScope('taebaek','a'));expect(hook.result.current().aborted).toBe(true);hook.unmount();
 m.auth.currentUser={uid:'first'};const next=renderHook(()=>useOutputScope('taebaek','a'));const getter=next.result.current;m.auth.currentUser={uid:'other'};expect(getter().aborted).toBe(true);next.unmount();
});
it('StrictMode의 재설정 뒤에도 현재 인증 화면은 새 출력 수명을 쓴다',async()=>{
 const React=await import('react');const hook=renderHook(()=>useOutputScope('taebaek','a'),{wrapper:({children})=>React.createElement(React.StrictMode,null,children)});expect(hook.result.current().aborted).toBe(false);const signal=hook.result.current();hook.unmount();expect(signal.aborted).toBe(true);
});
