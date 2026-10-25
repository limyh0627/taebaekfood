/** @vitest-environment jsdom */
import {act, renderHook} from '@testing-library/react';
import {beforeEach, expect, it, vi} from 'vitest';
const m=vi.hoisted(()=>({user:{uid:'a'} as {uid:string}|null,listeners:new Set<(user:{uid:string}|null)=>void>()}));
vi.mock('../../../shared/firebase',()=>({auth:{get currentUser(){return m.user;},onAuthStateChanged:(callback:(user:{uid:string}|null)=>void)=>{m.listeners.add(callback);return()=>m.listeners.delete(callback);}}}));
import {useHaccpRecordEditor} from './useHaccpRecordEditor';
interface Record {id?:string;value:string}
const options={companyId:'taebaek' as const,currentUserId:'employee',isAdmin:true,canConfirm:true,getKey:(record:Record)=>record.id??'new',getRevision:()=>0,mergeConfirmed:(base:Record)=>base};
const deferred=()=>{let resolve!:(value:Record|null|void)=>void;let reject!:(error:unknown)=>void;const promise=new Promise<Record|null|void>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const ready=(h:{result:{current:ReturnType<typeof useHaccpRecordEditor<Record>>}})=>act(()=>{h.result.current.readSuccess('records');h.result.current.readSuccess('template');});
beforeEach(()=>{m.user={uid:'a'};m.listeners.clear();});
it('최초조회/조회오류는 편집송신을 막고 명시retry와두조회성공으로 회복한다',async()=>{
 const h=renderHook(()=>useHaccpRecordEditor<Record>(options));const write=vi.fn();act(()=>h.result.current.select({value:'아직'}));await act(async()=>h.result.current.run('save',undefined,()=>true,write));expect(write).not.toHaveBeenCalled();
 act(()=>h.result.current.readFailure('records'));expect(h.result.current.readError).toContain('다시 조회');const revision=h.result.current.readRevision;act(()=>h.result.current.retryRead());expect(h.result.current.readRevision).toBe(revision+1);ready(h);act(()=>h.result.current.select({value:'정상'}));expect(h.result.current.selected?.value).toBe('정상');
});
it('같은 tick 저장과 확인/삭제를 하나의 잠금으로 막고 편집선택도 차단한다',async()=>{
 const h=renderHook(()=>useHaccpRecordEditor<Record>(options));ready(h);act(()=>{h.result.current.observeRecords([{id:'a',value:'원문'}],true);h.result.current.select({id:'a',value:'원문'});});const d=deferred(),write=vi.fn(()=>d.promise);let p!:Promise<void>;
 act(()=>{p=h.result.current.run('save','a',()=>true,write);void h.result.current.run('confirm','a',()=>true,write);void h.result.current.run('delete','b',()=>true,write);h.result.current.edit({value:'침범'});h.result.current.select(null);});
 expect(write).toHaveBeenCalledOnce();expect(h.result.current.selected?.value).toBe('원문');await act(async()=>{d.resolve({id:'a',value:'ACK'});await p;});expect(h.result.current.selected?.value).toBe('ACK');expect(h.result.current.busy).toBe(false);
});
it('실패는 원초안과 한국어이유를 유지하고 명시재시도한다',async()=>{
 const h=renderHook(()=>useHaccpRecordEditor<Record>(options));ready(h);act(()=>h.result.current.select({value:'초안'}));await act(async()=>h.result.current.run('save',undefined,()=>true,async()=>{throw {code:'unavailable'};}));expect(h.result.current.error).toContain('네트워크');expect(h.result.current.selected?.value).toBe('초안');expect(h.result.current.busy).toBe(false);await act(async()=>h.result.current.run('save',undefined,()=>true,async()=>({id:'saved',value:'초안'})));expect(h.result.current.selected?.id).toBe('saved');
});
it('선택세대가바뀐뒤옛버튼은새선택을편집하거나저장하지않는다',async()=>{
 const h=renderHook(()=>useHaccpRecordEditor<Record>(options));ready(h);act(()=>{h.result.current.observeRecords([{id:'a',value:'A'}],true);h.result.current.select({id:'a',value:'A'});});const old=h.result.current;act(()=>{h.result.current.observeRecords([{id:'b',value:'B'}],true);h.result.current.select({id:'b',value:'B'});});const write=vi.fn();act(()=>old.edit({value:'침범'}));await act(async()=>old.run('save','a',()=>true,write));expect(write).not.toHaveBeenCalled();expect(h.result.current.selected?.value).toBe('B');
});
it('확인대기뒤현재권한과동적대상조건이바뀌면work의송신검사가false다',async()=>{
 const h=renderHook(({canConfirm})=>useHaccpRecordEditor<Record>({...options,canConfirm}),{initialProps:{canConfirm:true}});ready(h);act(()=>{h.result.current.observeRecords([{id:'a',value:'A'}],true);h.result.current.select({id:'a',value:'A'});});let finish!:()=>void;const wait=new Promise<void>(r=>{finish=r;});const send=vi.fn();let p!:Promise<void>;act(()=>{p=h.result.current.run('confirm','a',()=>true,async current=>{await wait;if(current())send();});});h.rerender({canConfirm:false});await act(async()=>{finish();await p;});expect(send).not.toHaveBeenCalled();expect(h.result.current.busy).toBe(false);
});
it('렌더없는UID교체/getUid의명시undefined는fallback없이송신0이다',async()=>{
 let uid:string|undefined='a';const h=renderHook(()=>useHaccpRecordEditor<Record>({...options,getUid:()=>uid}));ready(h);act(()=>h.result.current.select({value:'A'}));uid=undefined;const write=vi.fn();await act(async()=>h.result.current.run('save',undefined,()=>true,write));expect(write).not.toHaveBeenCalled();
});
it('UID왕복이벤트는옛오류와ACK를새초안에반영하지않는다',async()=>{
 const h=renderHook(()=>useHaccpRecordEditor<Record>(options));ready(h);act(()=>h.result.current.select({value:'A'}));const d=deferred();let p!:Promise<void>;act(()=>{p=h.result.current.run('save',undefined,()=>true,()=>d.promise);});
 act(()=>{m.user={uid:'b'};m.listeners.forEach(f=>f(m.user));m.user={uid:'a'};m.listeners.forEach(f=>f(m.user));});ready(h);act(()=>h.result.current.select({value:'새A'}));await act(async()=>{d.reject(new Error('old'));await p;});expect(h.result.current.selected?.value).toBe('새A');expect(h.result.current.error).toBe('');
});
it('회사왕복새run중oldfinally는새잠금해제0이고해제owner조회오류0이다',async()=>{
 const h=renderHook(({companyId}:{companyId:'taebaek'|'punghoe'})=>useHaccpRecordEditor<Record>({...options,companyId}),{initialProps:{companyId:'taebaek' as 'taebaek'|'punghoe'}});ready(h);act(()=>h.result.current.select({value:'A'}));const old=h.result.current,d=deferred(),fresh=deferred();let p!:Promise<void>;act(()=>{p=h.result.current.run('save',undefined,()=>true,()=>d.promise);});h.rerender({companyId:'punghoe'});h.rerender({companyId:'taebaek'});ready(h);act(()=>h.result.current.select({value:'new'}));let q!:Promise<void>;act(()=>{q=h.result.current.run('save',undefined,()=>true,()=>fresh.promise);});await act(async()=>{d.resolve({value:'old'});await p;old.readFailure('records');});expect(h.result.current.busy).toBe(true);expect(h.result.current.readError).toBe('');await act(async()=>{fresh.resolve();await q;});
});
it('unmount뒤외부완료와읽기오류는버려지고listener를해제한다',async()=>{
 const h=renderHook(()=>useHaccpRecordEditor<Record>(options));ready(h);act(()=>h.result.current.select({value:'A'}));const old=h.result.current,d=deferred();let p!:Promise<void>;act(()=>{p=old.run('save',undefined,()=>true,()=>d.promise);});h.unmount();await act(async()=>{d.reject(new Error('late'));await p;old.readFailure('records');});expect(m.listeners.size).toBe(0);
});

it('확인 대기 중 조회 오류가 나면 승인 뒤 후속송신하지 않는다',async()=>{
 const h=renderHook(()=>useHaccpRecordEditor<Record>(options));ready(h);act(()=>{h.result.current.observeRecords([{id:'a',value:'원문'}],true);h.result.current.select({id:'a',value:'원문'});});let finish!:()=>void;const wait=new Promise<void>(resolve=>{finish=resolve;}),send=vi.fn();let p!:Promise<void>;
 act(()=>{p=h.result.current.run('delete','a',()=>true,async current=>{await wait;if(current())send();});});act(()=>h.result.current.readFailure('records'));await act(async()=>{finish();await p;});expect(send).not.toHaveBeenCalled();
});

it('읽기오류와 겹친 저장오류는 조회회복 뒤에도 원초안과 처리미확인안내를 유지한다',async()=>{
 const h=renderHook(()=>useHaccpRecordEditor<Record>(options));ready(h);act(()=>h.result.current.select({value:'초안'}));const d=deferred();let p!:Promise<void>;act(()=>{p=h.result.current.run('save',undefined,()=>true,()=>d.promise);});act(()=>h.result.current.readFailure('records'));await act(async()=>{d.reject({code:'unavailable'});await p;});ready(h);expect(h.result.current.readError).toBe('');expect(h.result.current.error).toContain('처리 결과를 확인하지 못했습니다');expect(h.result.current.selected?.value).toBe('초안');
});

it('송신중 조회오류여도 알려진 저장ACK의 id는 보존해 새 생성으로 되돌리지 않는다',async()=>{
 const h=renderHook(()=>useHaccpRecordEditor<Record>(options));ready(h);act(()=>h.result.current.select({value:'초안'}));const d=deferred();let p!:Promise<void>;act(()=>{p=h.result.current.run('save',undefined,()=>true,()=>d.promise);});act(()=>h.result.current.readFailure('records'));await act(async()=>{d.resolve({id:'known-id',value:'초안'});await p;});expect(h.result.current.selected?.id).toBe('known-id');expect(h.result.current.readReady).toBe(false);ready(h);expect(h.result.current.selected?.id).toBe('known-id');
});

it('정상삭제 송신뒤 자기조회에서 대상이 없어져도 현재 선택은 ACK에서 닫는다',async()=>{
 const h=renderHook(()=>useHaccpRecordEditor<Record>(options));ready(h);act(()=>{h.result.current.observeRecords([{id:'a',value:'선택'}],true);h.result.current.select({id:'a',value:'선택'});});let targetExists=true;const d=deferred();let p!:Promise<void>;act(()=>{p=h.result.current.run('delete','a',()=>targetExists,()=>d.promise);});targetExists=false;await act(async()=>{d.resolve(null);await p;});expect(h.result.current.selected).toBeNull();
});

it('동일actor의 저장ACK id는 저장가능한 일반직원으로 역할변경돼도 보존한다',async()=>{
 const h=renderHook(({isAdmin})=>useHaccpRecordEditor<Record>({...options,isAdmin}),{initialProps:{isAdmin:true}});ready(h);act(()=>h.result.current.select({value:'초안'}));let allowed=true;const d=deferred();let p!:Promise<void>;act(()=>{p=h.result.current.run('save',undefined,()=>allowed,()=>d.promise);});allowed=false;h.rerender({isAdmin:false});await act(async()=>{d.resolve({id:'known',value:'초안'});await p;});expect(h.result.current.selected?.id).toBe('known');
});
interface KeyRecord {id?:string;key:string;value:string;revision:number;confirmedBy?:string;confirmedAt?:string;deletedId?:string}
const keyedOptions={...options,getKey:(r:KeyRecord)=>r.key,getRevision:(r:KeyRecord)=>r.revision,mergeConfirmed:(base:KeyRecord,result:KeyRecord)=>({...base,confirmedBy:result.confirmedBy,confirmedAt:result.confirmedAt})};
const keyed=()=>renderHook(()=>useHaccpRecordEditor<KeyRecord>(keyedOptions));
const row=(id='a',key='today',value='saved',revision=0):KeyRecord=>({id,key,value,revision});
const keyReady=(h:ReturnType<typeof keyed>,rows:KeyRecord[]=[])=>act(()=>{h.result.current.observeRecords(rows,true);h.result.current.readSuccess('template');});
it('정상ACK는오늘/이력왕복에ID본문revision을보존하고미저장편집은버린다',async()=>{
 const h=keyed();keyReady(h);act(()=>h.result.current.select({...row(),id:undefined,value:'A'}));await act(async()=>h.result.current.run('save',undefined,()=>true,async()=>row('known','today','A',2)));act(()=>h.result.current.edit(r=>({...r!,value:'B'})));act(()=>h.result.current.select({...row('past','past'),id:undefined}));act(()=>h.result.current.select({...row(),id:undefined,value:'default'}));expect(h.result.current.selected).toMatchObject({id:'known',value:'A',revision:2});keyReady(h,[row('known','today','old',1)]);act(()=>h.result.current.select(row('known','today','old',1)));expect(h.result.current.selected?.revision).toBe(2);
});
it.each(['save','server'])('확인ACK는%s확정본문A에메타만보존하고현재dirtyB는승격하지않는다',async base=>{
 const h=keyed();keyReady(h,base==='server'?[row()]:[]);act(()=>h.result.current.select(base==='server'?row():{...row(),id:undefined}));if(base==='save')await act(async()=>h.result.current.run('save',undefined,()=>true,async()=>row()));act(()=>h.result.current.edit(r=>({...r!,value:'dirtyB'})));await act(async()=>h.result.current.run('confirm','a',()=>true,async()=>({...row(),value:'dirtyB',confirmedAt:'ACK',confirmedBy:'admin'})));expect(h.result.current.selected?.value).toBe('dirtyB');act(()=>h.result.current.select({...row('past','past'),id:undefined}));act(()=>h.result.current.select({...row(),id:undefined}));expect(h.result.current.selected).toMatchObject({id:'a',value:'saved',confirmedAt:'ACK'});
});
it.each(['관측-소실-ACK','관측-ACK-소실','ACK-관측-소실'])('%s뒤key왕복에서도미관측예외부활0',async order=>{
 const h=keyed();keyReady(h);act(()=>h.result.current.select({...row(),id:undefined}));let finish!:(r:KeyRecord)=>void,p!:Promise<void>;const wait=new Promise<KeyRecord>(r=>{finish=r;});act(()=>{p=h.result.current.run('save',undefined,()=>true,()=>wait);});for(const event of order.split('-')){if(event==='관측')keyReady(h,[row()]);if(event==='소실')keyReady(h,[]);if(event==='ACK')await act(async()=>{finish(row());await p;});}act(()=>h.result.current.select({...row('past','past'),id:undefined}));act(()=>h.result.current.select({...row(),id:undefined}));const write=vi.fn();await act(async()=>h.result.current.run('save','a',()=>true,write));expect(write).not.toHaveBeenCalled();expect(h.result.current.error).toContain('현재 목록');
});
it('현재cache/누락준비상태는송신0·정상ACK는cache와분리보존한다',async()=>{
 const h=keyed();keyReady(h);act(()=>h.result.current.select({...row(),id:undefined}));let finish!:(r:KeyRecord)=>void,p!:Promise<void>;const wait=new Promise<KeyRecord>(r=>{finish=r;});act(()=>{p=h.result.current.run('save',undefined,()=>true,()=>wait);});act(()=>h.result.current.observeRecords([],false));await act(async()=>{finish(row());await p;});expect(h.result.current.selected?.id).toBe('a');expect(h.result.current.readReady).toBe(false);keyReady(h);act(()=>h.result.current.readPending('template'));const write=vi.fn();await act(async()=>h.result.current.run('confirm','a',()=>true,write));expect(write).not.toHaveBeenCalled();expect(h.result.current.readError).toBe('');
});
it('다른ID같은key는자동덮기0·이유와명시server선택으로진행한다',async()=>{
 const h=keyed();keyReady(h);act(()=>h.result.current.select({...row(),id:undefined,value:'newdraft'}));keyReady(h,[row('other')]);const write=vi.fn();await act(async()=>h.result.current.run('save',undefined,()=>true,write));expect(write).not.toHaveBeenCalled();expect(h.result.current.selected?.value).toBe('newdraft');expect(h.result.current.error).toContain('같은 날짜');act(()=>h.result.current.openServerRecord());expect(h.result.current.selected?.id).toBe('other');
});
it('정상삭제envelope만기억하며옛snapshot재선택이ID를부활시키지않는다',async()=>{
 const h=keyed();keyReady(h,[row()]);act(()=>h.result.current.select(row()));await act(async()=>h.result.current.run('delete','a',()=>true,async()=>({deletedId:'a',selected:null})));expect(h.result.current.selected).toBeNull();keyReady(h,[row()]);act(()=>h.result.current.select(row()));expect(h.result.current.selected).toBeNull();act(()=>h.result.current.select({...row(),id:undefined}));const write=vi.fn();await act(async()=>h.result.current.run('save',undefined,()=>true,write));expect(write).not.toHaveBeenCalled();keyReady(h,[]);await act(async()=>h.result.current.run('save',undefined,()=>true,async()=>row('new')));expect(h.result.current.selected?.id).toBe('new');
});
it('비선택삭제는현재미관측ACK예외를지우지않고취소도삭제기억을만들지않는다',async()=>{
 const h=keyed();keyReady(h,[row('past','past')]);act(()=>h.result.current.select({...row(),id:undefined}));await act(async()=>h.result.current.run('save',undefined,()=>true,async()=>row()));await act(async()=>h.result.current.run('delete','past',()=>true,async()=>{}));expect(h.result.current.isDeleted('past')).toBe(false);await act(async()=>h.result.current.run('delete','past',()=>true,async()=>({deletedId:'past',selected:undefined})));expect(h.result.current.selected?.id).toBe('a');const write=vi.fn(async()=>row('a','today','updated',1));await act(async()=>h.result.current.run('save','a',()=>true,write));expect(write).toHaveBeenCalledOnce();
});
it('save원문의동명deletedId숨은필드는삭제ACK가아니다',async()=>{
 const h=keyed();keyReady(h);act(()=>h.result.current.select({...row(),id:undefined}));await act(async()=>h.result.current.run('save',undefined,()=>true,async()=>({...row(),deletedId:'hidden'})));expect(h.result.current.selected?.id).toBe('a');expect(h.result.current.isDeleted('hidden')).toBe(false);
});
it('확인송신뒤목록소실에도송신전확정본문을기반으로메타만보존한다',async()=>{
 const h=keyed();keyReady(h,[row()]);act(()=>h.result.current.select(row()));act(()=>h.result.current.edit(r=>({...r!,value:'dirtyB'})));let finish!:(r:KeyRecord)=>void,p!:Promise<void>;const wait=new Promise<KeyRecord>(r=>{finish=r;});act(()=>{p=h.result.current.run('confirm','a',()=>true,()=>wait);});keyReady(h,[]);await act(async()=>{finish({...row(),value:'dirtyB',confirmedAt:'ACK',confirmedBy:'admin'});await p;});act(()=>h.result.current.select({...row('past','past'),id:undefined}));act(()=>h.result.current.select({...row(),id:undefined,value:'default'}));expect(h.result.current.selected).toMatchObject({id:'a',value:'saved',confirmedAt:'ACK'});
});
it('높은서버revision뒤확인은최신확정본문을보존하고dirty를저장본문으로승격하지않는다',async()=>{
 const h=keyed();keyReady(h);act(()=>h.result.current.select({...row(),id:undefined,value:'A'}));await act(async()=>h.result.current.run('save',undefined,()=>true,async()=>row('a','today','A',0)));keyReady(h,[row('a','today','B',1)]);act(()=>h.result.current.select(row('a','today','B',1)));expect(h.result.current.selected?.value).toBe('B');act(()=>h.result.current.edit(r=>({...r!,value:'dirtyC'})));await act(async()=>h.result.current.run('confirm','a',()=>true,async()=>({...row('a','today','dirtyC',1),confirmedAt:'ACK',confirmedBy:'admin'})));expect(h.result.current.selected?.value).toBe('dirtyC');act(()=>h.result.current.select({...row('past','past'),id:undefined}));act(()=>h.result.current.select(row('a','today','B',1)));expect(h.result.current.selected).toMatchObject({value:'B',revision:1,confirmedAt:'ACK'});
});

it.each(['higher','lower','absent'])('confirm waiting %s keeps latest confirmed body',async event=>{
 const h=keyed();keyReady(h);act(()=>h.result.current.select({...row(),id:undefined,value:'A'}));await act(async()=>h.result.current.run('save',undefined,()=>true,async()=>row('a','today','A',0)));keyReady(h,[row('a','today','B',1)]);act(()=>h.result.current.select(row('a','today','B',1)));act(()=>h.result.current.edit(r=>({...r!,value:'dirtyC'})));let finish!:(r:KeyRecord)=>void,p!:Promise<void>;const wait=new Promise<KeyRecord>(r=>{finish=r;});act(()=>{p=h.result.current.run('confirm','a',()=>true,()=>wait);});keyReady(h,event==='absent'?[]:[event==='higher'?row('a','today','D',2):row('a','today','A',0)]);await act(async()=>{finish({...row('a','today','dirtyC',1),confirmedAt:'ACK',confirmedBy:'admin'});await p;});expect(h.result.current.selected?.value).toBe('dirtyC');act(()=>h.result.current.select({...row('past','past'),id:undefined}));act(()=>h.result.current.select({...row(),id:undefined}));expect(h.result.current.selected).toMatchObject({value:event==='higher'?'D':'B',revision:event==='higher'?2:1,confirmedAt:'ACK'});
});

it('자기ID와다른ID동일key중복은saveconfirm을막고실목록삭제후재개한다',async()=>{const h=keyed();keyReady(h,[row(),row('other')]);act(()=>h.result.current.select(row()));const write=vi.fn();await act(async()=>h.result.current.run('save','a',()=>true,write));await act(async()=>h.result.current.run('confirm','a',()=>true,write));expect(write).not.toHaveBeenCalled();expect(h.result.current.selected?.id).toBe('a');expect(h.result.current.error).toContain('관리자 확인');expect(h.result.current.error).toContain('같은 점검 기록이 여러 개');expect(h.result.current.error).not.toContain('현재 목록');await act(async()=>h.result.current.run('delete','other',()=>true,async()=>({deletedId:'other',selected:undefined})));await act(async()=>h.result.current.run('save','a',()=>true,async()=>row()));expect(h.result.current.selected?.id).toBe('a');});
