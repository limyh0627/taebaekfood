/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({user:{uid:'a'} as {uid:string}|null,listeners:new Set<(user:{uid:string}|null)=>void>(),subs:[] as any[]}));
vi.mock('../../../shared/firebase',()=>({db:{},auth:{get currentUser(){return m.user;},onAuthStateChanged:(fn:(u:{uid:string}|null)=>void)=>{m.listeners.add(fn);return()=>m.listeners.delete(fn);}}}));
vi.mock('firebase/firestore',()=>({collection:(_:unknown,name:string)=>name,where:(...args:any[])=>args,query:(...args:any[])=>args,onSnapshot:(ref:any,options:any,next:any,error:any)=>{const sub={ref,options,next,error,stop:vi.fn()};m.subs.push(sub);return sub.stop;}}));
import {useHaccpMonthlyRecord} from './useHaccpMonthlyRecord';
interface Rec{id?:string;month:string;revisionCount:number;value:string;confirmedAt?:string;confirmedBy?:string}
const opts={companyId:'taebaek' as const,currentUserId:'employee',isAdmin:true,canConfirm:true,currentMonth:'2026-10',collectionName:'haccp_incoming',createDraft:()=>({value:''}),readDraft:(r:Rec)=>({value:r.value})};
const pending=<T,>()=>{let resolve!:(v:T)=>void;let reject!:(v:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const sub=()=>m.subs.at(-1);const deliver=(rows:Rec[]=[],cache=false)=>act(()=>sub().next({docs:rows.map(r=>({id:r.id,data:()=>r})),metadata:{fromCache:cache}}));
const rec=(id='id',revisionCount=1,value='server'):Rec=>({id,month:'2026-10',revisionCount,value});
const setup=()=>renderHook(props=>useHaccpMonthlyRecord<Rec,{value:string}>(props),{initialProps:opts});
beforeEach(()=>{m.user={uid:'a'};m.listeners.clear();m.subs=[];});
it('로딩 편집은 허용하고 캐시/서버빈조회·오류·실제retry를 구분한다',()=>{
 const h=setup();act(()=>h.result.current.editDraft({value:'입력'}));expect(h.result.current.draft.value).toBe('입력');expect(h.result.current.canSave).toBe(false);deliver([],true);expect(h.result.current.readState).toBe('cache');deliver();expect(h.result.current.canSave).toBe(true);
 const old=sub();act(()=>old.error({code:'unavailable'}));expect(h.result.current.readState).toBe('error');act(()=>h.result.current.retryRead());expect(old.stop).toHaveBeenCalledOnce();act(()=>old.next({docs:[],metadata:{fromCache:false}}));expect(h.result.current.readState).toBe('loading');deliver();expect(h.result.current.draft.value).toBe('입력');
});
it('pristine 수신만 채우고 dirty 및 다른월 snapshot은 본문을 덮지 않는다',()=>{
 const h=setup();deliver([rec()]);expect(h.result.current.draft.value).toBe('server');act(()=>h.result.current.editDraft({value:'dirty'}));deliver([rec('id',2,'remote'),{...rec('other'),month:'2026-09'}]);expect(h.result.current.draft.value).toBe('dirty');
});
it('같은월no-op·다른월무prompt와 과거직원/admin·미래정책을 유지한다',()=>{
 const h=setup();deliver();act(()=>h.result.current.editDraft({value:'same'}));act(()=>h.result.current.selectMonth('2026-10'));expect(h.result.current.draft.value).toBe('same');act(()=>h.result.current.selectMonth('2020-01'));expect(h.result.current.canEdit).toBe(true);h.rerender({...opts,isAdmin:false});expect(h.result.current.canEdit).toBe(false);act(()=>h.result.current.selectMonth('2027-01'));expect(h.result.current.canEdit).toBe(true);
});
it('동tick save/confirm을 직렬화하고 처리중입력·선택과 중복송신을 막는다',async()=>{
 const h=setup();deliver([rec()]);const d=pending<{id:string;record:Rec}>(),write=vi.fn(()=>d.promise);let p!:Promise<void>;
 act(()=>{p=h.result.current.runSave(write);void h.result.current.runConfirm(write);void h.result.current.runSave(write);h.result.current.editDraft({value:'침범'});h.result.current.selectMonth('2020-01');});expect(write).toHaveBeenCalledOnce();expect(h.result.current.month).toBe('2026-10');expect(h.result.current.draft.value).toBe('server');await act(async()=>{d.resolve({id:'id',record:rec('id',2)});await p;});expect(h.result.current.busy).toBe(false);
});
it('신규ACK는query없이ID/revision을 유지하고 늦은snapshot으로 역행하지 않는다',async()=>{
 const h=setup();deliver();await act(async()=>h.result.current.runSave(async()=>({id:'new',record:rec('new',3,'local')})));expect(h.result.current.currentRecord?.id).toBe('new');let context:any;await act(async()=>h.result.current.runSave(async c=>{context=c;return{id:'new',record:rec('new',4,'newer')};}));expect(context.currentRecord.revisionCount).toBe(3);deliver([rec('new',1,'stale')]);expect(h.result.current.currentRecord?.revisionCount).toBe(4);expect(h.result.current.draft.value).toBe('');deliver([rec('new',4,'joined')]);expect(h.result.current.draft.value).toBe('joined');
});
it.each(['관측-소실-ACK','관측-ACK-소실','ACK-관측-소실'])('%s 뒤 자기ID예외는 부활하지 않는다',async order=>{
 const h=setup();deliver();const d=pending<{id:string;record:Rec}>();let p!:Promise<void>;act(()=>{p=h.result.current.runSave(()=>d.promise);});for(const event of order.split('-')){if(event==='관측')deliver([rec('seen')]);if(event==='소실')deliver();if(event==='ACK')await act(async()=>{d.resolve({id:'seen',record:rec('seen')});await p;});}expect(h.result.current.currentRecord?.id).toBe('seen');expect(h.result.current.canSave).toBe(false);const write=vi.fn();await act(async()=>h.result.current.runSave(write));expect(write).not.toHaveBeenCalled();expect(h.result.current.error).toContain('현재 목록');
});
it('신규dirty중기존기록도착은초안보존·중복차단·명시기록열기로 전환한다',()=>{
 const h=setup();act(()=>h.result.current.editDraft({value:'newdraft'}));deliver([rec()]);expect(h.result.current.collision).toBe(true);expect(h.result.current.draft.value).toBe('newdraft');expect(h.result.current.canSave).toBe(false);act(()=>h.result.current.openObservedRecord());expect(h.result.current.currentRecord?.id).toBe('id');expect(h.result.current.draft.value).toBe('server');
});
it('정상ACK는조회오류중에도유지하고retry가쓰기를재전송하지않는다',async()=>{
 const h=setup();deliver();const d=pending<{id:string;record:Rec}>(),write=vi.fn(()=>d.promise);let p!:Promise<void>;act(()=>{p=h.result.current.runSave(write);});act(()=>sub().error({}));await act(async()=>{d.resolve({id:'new',record:rec('new')});await p;});expect(h.result.current.currentRecord?.id).toBe('new');expect(h.result.current.readState).toBe('error');act(()=>h.result.current.retryRead());deliver();expect(h.result.current.canSave).toBe(true);expect(write).toHaveBeenCalledOnce();
});
it('명백거절후원문·원인/다음행동과재조회뒤사용자재진행을허용한다',async()=>{
 const h=setup();deliver();act(()=>h.result.current.editDraft({value:'kept'}));await act(async()=>h.result.current.runSave(async()=>{throw{code:'permission-denied'};}));expect(h.result.current.error).toContain('권한');expect(h.result.current.draft.value).toBe('kept');expect(h.result.current.canSave).toBe(false);act(()=>h.result.current.selectMonth('2026-11'));act(()=>h.result.current.selectMonth('2026-10'));expect(h.result.current.canSave).toBe(false);act(()=>h.result.current.retryRead());deliver();expect(h.result.current.canSave).toBe(true);await act(async()=>h.result.current.runSave(async()=>({id:'retry-id',record:rec('retry-id')})));expect(h.result.current.currentRecord?.id).toBe('retry-id');
});
it('unknown은빈재조회·월왕복으로새add를허용하지않고원요청을보존한다',async()=>{
 const h=setup();deliver();act(()=>h.result.current.editDraft({value:'unknown draft'}));await act(async()=>h.result.current.runSave(async()=>{throw{code:'unavailable'};}));expect(h.result.current.recovery).toBe('unknown');act(()=>h.result.current.retryRead());deliver();expect(h.result.current.canSave).toBe(false);const write=vi.fn();await act(async()=>h.result.current.runSave(write));expect(write).not.toHaveBeenCalled();act(()=>h.result.current.selectMonth('2026-11'));act(()=>h.result.current.selectMonth('2026-10'));expect(h.result.current.canSave).toBe(false);expect(h.result.current.draft.value).toBe('unknown draft');
});
it('UID ABA·owner교체뒤oldACK/finally는새draft와잠금을건드리지않는다',async()=>{
 const h=setup();deliver();const a=pending<{id:string;record:Rec}>(),b=pending<{id:string;record:Rec}>();let pa!:Promise<void>,pb!:Promise<void>;act(()=>{pa=h.result.current.runSave(()=>a.promise);});act(()=>{m.user={uid:'b'};for(const fn of [...m.listeners])fn(m.user);});act(()=>{m.user={uid:'a'};for(const fn of [...m.listeners])fn(m.user);});deliver();act(()=>h.result.current.editDraft({value:'new owner'}));act(()=>{pb=h.result.current.runSave(()=>b.promise);});await act(async()=>{a.resolve({id:'old',record:rec('old')});await pa;});expect(h.result.current.busy).toBe(true);expect(h.result.current.draft.value).toBe('new owner');await act(async()=>{b.resolve({id:'fresh',record:rec('fresh')});await pb;});expect(h.result.current.currentRecord?.id).toBe('fresh');
});
it('현재월save는관리자표시만사라져도정상ID유지·confirm은최신권한으로격리한다',async()=>{
 const h=setup();deliver();const d=pending<{id:string;record:Rec}>();let p!:Promise<void>;act(()=>{p=h.result.current.runSave(()=>d.promise);});h.rerender({...opts,isAdmin:false});await act(async()=>{d.resolve({id:'new',record:rec('new')});await p;});expect(h.result.current.currentRecord?.id).toBe('new');const c=pending<{id:string;record:Rec}>();act(()=>{p=h.result.current.runConfirm(()=>c.promise);});h.rerender({...opts,isAdmin:false,canConfirm:false});await act(async()=>{c.resolve({id:'new',record:{...rec('new'),confirmedAt:'ack',confirmedBy:'admin'}});await p;});expect(h.result.current.currentRecord?.confirmedAt).toBeUndefined();expect(h.result.current.busy).toBe(false);
});
it('unmount 뒤 callback/ACK는상태를변경하지않고구독을정리한다',async()=>{
 const h=setup();deliver();const old=sub(),d=pending<{id:string;record:Rec}>();let p!:Promise<void>;act(()=>{p=h.result.current.runSave(()=>d.promise);});h.unmount();await act(async()=>{d.resolve({id:'late',record:rec('late')});await p;});expect(old.stop).toHaveBeenCalledOnce();expect(m.listeners.size).toBe(0);
});
it('동일ID가다른월로이동하면현재선택월대상으로송신하지않는다',async()=>{
 const h=setup();deliver([rec()]);deliver([{...rec(),month:'2026-09'}]);expect(h.result.current.canSave).toBe(false);const writer=vi.fn();await act(async()=>h.result.current.runSave(writer));expect(writer).not.toHaveBeenCalled();expect(h.result.current.error).toContain('현재 목록');
});
it('확인ACKoverlay는늦은미확인snapshot으로역행하지않는다',async()=>{
 const h=setup();deliver([rec()]);await act(async()=>h.result.current.runConfirm(async()=>({id:'id',record:{...rec(),confirmedAt:'ack',confirmedBy:'admin'}})));deliver([rec()]);expect(h.result.current.currentRecord?.confirmedAt).toBe('ack');deliver([{...rec(),confirmedAt:'ack',confirmedBy:'admin'}]);expect(h.result.current.currentRecord?.confirmedBy).toBe('admin');
});

it('확인ACK는미저장dirty본문을저장완료로바꾸지않는다',async()=>{
 const h=setup();deliver([rec()]);act(()=>h.result.current.editDraft({value:'unsaved'}));await act(async()=>h.result.current.runConfirm(async()=>({id:'id',record:{...rec(),confirmedAt:'confirmed',confirmedBy:'admin'}})));deliver([{...rec(),confirmedAt:'confirmed',confirmedBy:'admin'}]);expect(h.result.current.draft.value).toBe('unsaved');
});
it('정상ACK후다른월왕복에도확정ID/revision/저장본문을유지한다',async()=>{
 const h=setup();deliver();act(()=>h.result.current.editDraft({value:'savedbody'}));await act(async()=>h.result.current.runSave(async()=>({id:'new',record:rec('new',3,'savedbody')})));act(()=>h.result.current.editDraft({value:'not-saved'}));act(()=>h.result.current.selectMonth('2026-11'));act(()=>h.result.current.selectMonth('2026-10'));expect(h.result.current.currentRecord?.id).toBe('new');expect(h.result.current.currentRecord?.revisionCount).toBe(3);expect(h.result.current.draft.value).toBe('savedbody');let context:any;await act(async()=>h.result.current.runSave(async c=>{context=c;return{id:'new',record:rec('new',4,'savedbody')};}));expect(context.currentRecord.id).toBe('new');
});
it('서버확인뒤캐시로돌아오면송신과정본합류를막는다',async()=>{
 const h=setup();deliver();await act(async()=>h.result.current.runSave(async()=>({id:'new',record:rec('new',3,'savedbody')})));deliver([rec('new',3,'cachebody')],true);expect(h.result.current.readState).toBe('cache');expect(h.result.current.canSave).toBe(false);expect(h.result.current.currentRecord?.value).toBe('savedbody');deliver([rec('new',1,'oldserver')]);expect(h.result.current.currentRecord?.revisionCount).toBe(3);
});
it.each(['관측-소실-ACK','관측-ACK-소실','ACK-관측-소실'])('월왕복도 %s 관측이력을되살리지않는다',async order=>{
 const h=setup();deliver();const d=pending<{id:string;record:Rec}>();let p!:Promise<void>;act(()=>{p=h.result.current.runSave(()=>d.promise);});for(const event of order.split('-')){if(event==='관측')deliver([rec('seen')]);if(event==='소실')deliver();if(event==='ACK')await act(async()=>{d.resolve({id:'seen',record:rec('seen')});await p;});}act(()=>h.result.current.selectMonth('2026-11'));act(()=>h.result.current.selectMonth('2026-10'));expect(h.result.current.currentRecord?.id).toBe('seen');expect(h.result.current.canSave).toBe(false);
});
