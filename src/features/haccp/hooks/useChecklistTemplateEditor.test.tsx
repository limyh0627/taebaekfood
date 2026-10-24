/** @vitest-environment jsdom */
import {act, renderHook} from '@testing-library/react';
import {beforeEach, expect, it, vi} from 'vitest';
const m = vi.hoisted(() => ({user: {uid: 'a'} as {uid: string} | null, subs: [] as any[], listeners: [] as any[], set: vi.fn()}));
vi.mock('../../../shared/firebase', () => ({db: {}, auth: {get currentUser() {return m.user;}}}));
vi.mock('firebase/auth', () => ({onAuthStateChanged: (_: unknown, callback: any) => {m.listeners.push(callback); return vi.fn();}}));
vi.mock('firebase/firestore', () => ({doc: (_: unknown, c: string, id: string) => ({c,id}), onSnapshot: (ref: any, next: any, error: any) => {
 const stop = vi.fn(); m.subs.push({ref,next,error,stop}); return stop;
}}));
vi.mock('../../../shared/services/firebaseService', () => ({setDocument: m.set}));
import {useChecklistTemplateEditor} from './useChecklistTemplateEditor';
const options = {companyId: 'taebaek' as const, templateKey: 'personal_hygiene', field: 'cols', defaults: ['기본'], valid: (row: string) => Boolean(row.trim()), emptyMessage: '비었음'};
const emit = (rows: string[], index = m.subs.length - 1) => act(() => m.subs[index].next({exists: () => true, data: () => ({cols: rows})}));
const deferred = () => {let resolve!: () => void; let reject!: (error: Error) => void; const promise = new Promise<void>((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject};};
beforeEach(() => {m.user={uid:'a'};m.subs=[];m.listeners=[];m.set.mockReset().mockResolvedValue(undefined);});
it('첫 조회 오류는 기본값 저장을 막고 명시 재구독 후 저장한다', async () => {
 const h=renderHook(()=>useChecklistTemplateEditor(options));
 act(()=>m.subs[0].error(new Error('network')));act(()=>h.result.current.open());await act(async()=>h.result.current.save());
 expect(m.set).not.toHaveBeenCalled();expect(h.result.current.ready).toBe(false);
 act(()=>h.result.current.retry());expect(m.subs[0].stop).toHaveBeenCalledOnce();emit(['최신']);
 act(()=>h.result.current.open());await act(async()=>h.result.current.save());expect(m.set).toHaveBeenCalledWith('haccp_templates','personal_hygiene',{cols:['최신']});
});
it('같은 tick 저장은 한 번이고 대기중 setter 취소는 차단한다', async()=>{
 const d=deferred();m.set.mockReturnValue(d.promise);const h=renderHook(()=>useChecklistTemplateEditor(options));emit(['원문']);act(()=>h.result.current.open());
 let first!:Promise<void>;act(()=>{first=h.result.current.save();void h.result.current.save();h.result.current.change(['침범']);h.result.current.cancel();});
 expect(m.set).toHaveBeenCalledOnce();expect(h.result.current.rows).toEqual(['원문']);expect(h.result.current.editing).toBe(true);
 await act(async()=>{d.resolve();await first;});expect(h.result.current.editing).toBe(false);
});
it('실패 원초안을 보존하고 명시 재시도한다',async()=>{
 m.set.mockRejectedValueOnce(new Error('lost'));const h=renderHook(()=>useChecklistTemplateEditor(options));emit(['원문']);act(()=>{h.result.current.open();h.result.current.change(['초안']);});
 await act(async()=>h.result.current.save());expect(h.result.current.rows).toEqual(['초안']);expect(h.result.current.error).toContain('입력 내용은 유지');expect(h.result.current.editing).toBe(true);
 await act(async()=>h.result.current.save());expect(h.result.current.editing).toBe(false);
});
it('편집중 snapshot은 초안을 보존하고 취소만 최신 정본을 채택한다',()=>{
 const h=renderHook(()=>useChecklistTemplateEditor(options));emit(['처음']);act(()=>{h.result.current.open();h.result.current.change(['초안']);});emit(['새 서버']);expect(h.result.current.rows).toEqual(['초안']);act(()=>h.result.current.cancel());expect(h.result.current.rows).toEqual(['새 서버']);
});
it('회사왕복 뒤 옛 ACK와 finally는 새 초안과 새 저장을 해제하지 않는다',async()=>{
 const a=deferred(),b=deferred();m.set.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
 const h=renderHook(({companyId}:{companyId:'taebaek'|'punghoe'})=>useChecklistTemplateEditor({...options,companyId}),{initialProps:{companyId:'taebaek' as 'taebaek'|'punghoe'}});emit(['A']);act(()=>h.result.current.open());let old!:Promise<void>;act(()=>{old=h.result.current.save();});h.rerender({companyId:'punghoe'});h.rerender({companyId:'taebaek'});emit(['새A']);act(()=>h.result.current.open());let fresh!:Promise<void>;act(()=>{fresh=h.result.current.save();});
 await act(async()=>{a.resolve();await old;});expect(h.result.current.saving).toBe(true);expect(h.result.current.editing).toBe(true);expect(h.result.current.rows).toEqual(['새A']);await act(async()=>{b.resolve();await fresh;});
});
it('렌더없는 실제 UID 교체는 송신과 옛 callback을 막고 ABA도 새 owner다',async()=>{
 const h=renderHook(()=>useChecklistTemplateEditor(options));emit(['A']);act(()=>h.result.current.open());const old=h.result.current;m.user={uid:'b'};await act(async()=>old.save());expect(m.set).not.toHaveBeenCalled();
 act(()=>m.listeners[0](m.user));m.user={uid:'a'};act(()=>m.listeners.at(-1)(m.user));emit(['새A']);act(()=>h.result.current.open());old.change(['침범']);expect(h.result.current.rows).toEqual(['새A']);
});
it('unmount 뒤 오류와 ACK는 새 편집에 영향을 주지 않는다',async()=>{
 const d=deferred();m.set.mockReturnValue(d.promise);const h=renderHook(()=>useChecklistTemplateEditor(options));emit(['A']);act(()=>h.result.current.open());let pending!:Promise<void>;act(()=>{pending=h.result.current.save();});h.unmount();await act(async()=>{d.reject(new Error('late'));await pending;});expect(m.subs[0].stop).toHaveBeenCalledOnce();
});

it('재조회 뒤 해지된 이전 구독의 늦은 오류는 새 ready를 바꾸지 않는다',()=>{
 const h=renderHook(()=>useChecklistTemplateEditor(options));act(()=>m.subs[0].error(new Error('first')));act(()=>h.result.current.retry());emit(['새 정본']);
 act(()=>m.subs[0].error(new Error('late')));expect(h.result.current.ready).toBe(true);expect(h.result.current.error).toBe('');
});
