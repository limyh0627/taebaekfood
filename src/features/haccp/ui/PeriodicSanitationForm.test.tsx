/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({add:vi.fn(),update:vi.fn(),del:vi.fn(),confirm:vi.fn(),pdf:vi.fn(),auth:{currentUser:{uid:"output-test"},onAuthStateChanged:()=>()=>{}},templateCache:false,subs:[] as any[]}));
vi.mock('../../../shared/firebase',()=>({db:{},auth:m.auth}));
vi.mock('firebase/firestore',()=>({collection:(_db:any,name:string)=>({name}),doc:(_db:any,name:string,id:string)=>({name,id}),where:(field:string,op:string,value:string)=>({field,op,value}),query:(ref:any,...constraints:any[])=>({...ref,constraints}),onSnapshot:(ref:any,...args:any[])=>{const next=typeof args[0]==='function'?args[0]:args[1],error=typeof args[0]==='function'?args[1]:args[2];const sub={ref,next,error,options:typeof args[0]==='function'?undefined:args[0],unsubscribe:vi.fn()};m.subs.push(sub);if(ref.id)next({exists:()=>false,metadata:{fromCache:m.templateCache}});return sub.unsubscribe;}}));
vi.mock('../../../shared/services/firebaseService',()=>({addItem:m.add,updateItem:m.update,deleteItem:m.del}));
vi.mock('../../../shared/components/appDialog',()=>({appConfirm:m.confirm}));
vi.mock('../infrastructure/downloadAsPDF',()=>({downloadAsPDF:m.pdf}));
import { PeriodicSanitationForm } from './PeriodicSanitationForm';
import { HaccpCompanyContext } from '../context/HaccpCompanyContext';
beforeEach(()=>{vi.spyOn(window,'alert').mockImplementation(()=>{});m.subs=[];m.templateCache=false;m.auth.currentUser={uid:"output-test"};vi.clearAllMocks();m.add.mockResolvedValue('saved');m.update.mockResolvedValue(undefined);m.confirm.mockResolvedValue(false);});
const sub=()=>m.subs.filter(s=>s.ref.name==='haccp_periodic_sanitation').at(-1);
const deliver=(rows:any[],cache=false)=>act(()=>sub().next({docs:rows.map(row=>({id:row.id,data:()=>row})),metadata:{fromCache:cache}}));
const notes=()=>screen.getByPlaceholderText('특이사항을 입력하세요');
it('서버 조회 전 쓰기를 막고 조회 후 원문 초안·선택기간을 신규 저장한다',async()=>{
 const view=render(<HaccpCompanyContext.Provider value="taebaek"><PeriodicSanitationForm currentUser={{id:'u',name:'합성담당'}} isAdmin/></HaccpCompanyContext.Provider>);const value=(view.container.querySelector('input[type=week]') as HTMLInputElement).value;
 expect(sub().options).toEqual({includeMetadataChanges:true});fireEvent.change(notes(),{target:{value:'보존할 원문'}});deliver([],true);expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();deliver([]);fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.add).toHaveBeenCalledOnce());expect(m.add.mock.calls[0][0]).toBe('haccp_periodic_sanitation');expect(m.add.mock.calls[0][1]).toMatchObject({cycle:'weekly',period:value,specialNotes:'보존할 원문',createdBy:'합성담당',updatedBy:'합성담당'});
});
it('기존 기록 수신은 원래 ID로 수정하고 확인 권한·PDF 거절을 유지한다',async()=>{
 const view=render(<PeriodicSanitationForm currentUser={{id:'u',name:'확인자'}} isAdmin canConfirm/>);const value=(view.container.querySelector('input[type=week]') as HTMLInputElement).value;deliver([{id:'existing',cycle:'weekly',period:value,checkZone:'저장구역',rows:[{result:'',note:'',inspector:''}],specialNotes:'서버원문',createdBy:'원작성자',createdAt:'원일시',updatedBy:'이전',updatedAt:''}]);expect(notes()).toHaveValue('서버원문');fireEvent.change(notes(),{target:{value:'수정원문'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_periodic_sanitation','existing',expect.objectContaining({specialNotes:'수정원문',createdBy:'원작성자',createdAt:'원일시'})));fireEvent.click(screen.getByRole('button',{name:'관리자 확인'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_periodic_sanitation','existing',expect.objectContaining({confirmedBy:'확인자'})));expect(m.pdf).not.toHaveBeenCalled();expect(m.confirm).not.toHaveBeenCalled();const writes=m.update.mock.calls.length;fireEvent.click(screen.getByRole('button',{name:'PDF'}));expect(m.pdf).toHaveBeenCalledWith(expect.any(HTMLElement),expect.any(String),expect.any(AbortSignal));expect(m.update.mock.calls.length).toBe(writes);
});
it('기간 이동 취소는 초안을 보존하고 승인한 과거기간은 읽기 전용이다',async()=>{
 const view=render(<PeriodicSanitationForm isAdmin/>);deliver([]);const date=view.container.querySelector('input[type=week]') as HTMLInputElement,original=date.value;fireEvent.change(notes(),{target:{value:'이동전초안'}});fireEvent.change(date,{target:{value:'2020-W01'}});await act(async()=>{});expect(date).toHaveValue(original);expect(notes()).toHaveValue('이동전초안');m.confirm.mockResolvedValueOnce(true);fireEvent.change(date,{target:{value:'2020-W01'}});await waitFor(()=>expect(date).toHaveValue('2020-W01'));expect(screen.queryByRole('button',{name:'저장'})).toBeNull();expect(m.add).not.toHaveBeenCalled();
});

const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return{promise,resolve};};
it.each(['role','uid','target'])('삭제 확인 뒤 %s 변화는 쓰기를 막는다',async(reason)=>{
 const row={id:'past',cycle:'weekly',period:'2020-W01',rows:[],specialNotes:'',createdBy:'원작성자'};
 const view=render(<PeriodicSanitationForm currentUser={{id:'u',name:'담당'}} isAdmin/>);deliver([row]);fireEvent.click(screen.getByText(/이전 .*기록/));
 const d=deferred<boolean>();m.confirm.mockReturnValue(d.promise);fireEvent.click(screen.getByText('삭제'));
 if(reason==='role')view.rerender(<PeriodicSanitationForm currentUser={{id:'u',name:'담당'}} isAdmin={false}/>);
 if(reason==='uid')m.auth.currentUser={uid:'other'};
 if(reason==='target')deliver([]);
 await act(async()=>d.resolve(true));expect(m.del).not.toHaveBeenCalled();
});
it('양식 조회 오류는 초안을 보존하고 저장 송신을 막는다',()=>{
 render(<PeriodicSanitationForm currentUser={{id:'u',name:'담당'}} isAdmin/>);deliver([]);fireEvent.change(notes(),{target:{value:'원문'}});
 const template=m.subs.find(s=>s.ref.id?.includes('weekly_sanitation'));act(()=>template.error?.(new Error('offline')));
 fireEvent.click(screen.getByRole('button',{name:'저장'}));expect(m.add).not.toHaveBeenCalled();expect(notes()).toHaveValue('원문');
});

const templateSub=()=>m.subs.filter(s=>s.ref.id?.includes('weekly_sanitation')).at(-1);
const existing=(value:string)=>({id:'existing',cycle:'weekly',period:value,checkZone:'구역',rows:[],specialNotes:'서버원문',createdBy:'원작성자',createdAt:'원시각'});
it('양식 재조회는 서버확인 전 쓰기를 막고 이전 callback과 초안은 격리한다',async()=>{
 render(<PeriodicSanitationForm currentUser={{id:'u',name:'담당'}} isAdmin/>);deliver([]);fireEvent.change(notes(),{target:{value:'보존'}});
 const old=templateSub();act(()=>old.error(new Error('offline')));expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'양식 다시 조회'}));
 act(()=>{templateSub().error(new Error('again'));});fireEvent.click(screen.getByRole('button',{name:'양식 다시 조회'}));
 act(()=>old.next({exists:()=>false,metadata:{fromCache:false}}));expect(notes()).toHaveValue('보존');
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.add).toHaveBeenCalledOnce());
});
it('신규 정상 ID는 조회오류와 관리자표시 해제에도 보존하고 snapshot 전 수정·확인한다',async()=>{
 const d=deferred<string>();m.add.mockReturnValue(d.promise);const view=render(<PeriodicSanitationForm currentUser={{id:'u',name:'담당'}} isAdmin canConfirm/>);deliver([]);
 fireEvent.change(notes(),{target:{value:'저장원문'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));act(()=>sub().error(new Error('read')));
 view.rerender(<PeriodicSanitationForm currentUser={{id:'u',name:'담당'}} isAdmin={false} canConfirm/>);await act(async()=>d.resolve('known'));
 expect(notes()).toHaveValue('저장원문');fireEvent.click(screen.getByRole('button',{name:'다시 조회'}));deliver([]);
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_periodic_sanitation','known',expect.objectContaining({specialNotes:'저장원문'})));
 fireEvent.click(screen.getByRole('button',{name:'관리자 확인'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_periodic_sanitation','known',expect.objectContaining({confirmedBy:'담당'})));expect(m.add).toHaveBeenCalledTimes(1);
});
it('관측된 기존 대상이 없어지면 수정과 확인을 송신하지 않는다',()=>{
 const view=render(<PeriodicSanitationForm currentUser={{id:'u',name:'담당'}} isAdmin canConfirm/>);const value=(view.container.querySelector('input[type=week]') as HTMLInputElement).value;deliver([existing(value)]);deliver([]);
 fireEvent.click(screen.getByRole('button',{name:'저장'}));fireEvent.click(screen.getByRole('button',{name:'관리자 확인'}));expect(m.update).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('현재 목록에서 선택 기록을 확인하지 못했습니다');expect(screen.getByRole('alert')).toHaveTextContent('다른 기간이나 기록을 선택');expect(notes()).toHaveValue('서버원문');
});
it('계정 교체 뒤 이전 정상응답과 finally는 새 저장 초안과 잠금을 건드리지 않는다',async()=>{
 const a=deferred<string>(),b=deferred<string>();m.add.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
 const view=render(<PeriodicSanitationForm currentUser={{id:'a',name:'A'}} isAdmin/>);deliver([]);fireEvent.click(screen.getByRole('button',{name:'저장'}));
 view.rerender(<PeriodicSanitationForm currentUser={{id:'b',name:'B'}} isAdmin/>);deliver([]);fireEvent.change(notes(),{target:{value:'B초안'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));
 await act(async()=>a.resolve('old'));expect(notes()).toHaveValue('B초안');expect(notes()).toBeDisabled();await act(async()=>b.resolve('new'));expect(notes()).toBeEnabled();expect(m.add).toHaveBeenCalledTimes(2);
});
it('같은 회사 실제 UID 교체는 옛 구독을 해제하고 새 입력에서 재조회한다',()=>{
 const view=render(<PeriodicSanitationForm currentUser={{id:'u',name:'담당'}} isAdmin/>);deliver([]);fireEvent.change(notes(),{target:{value:'옛초안'}});const old=sub();
 m.auth.currentUser={uid:'other'};view.rerender(<PeriodicSanitationForm currentUser={{id:'u',name:'담당'}} isAdmin/>);expect(old.unsubscribe).toHaveBeenCalledOnce();expect(notes()).toHaveValue('');
 act(()=>old.next({docs:[],metadata:{fromCache:false}}));expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();deliver([]);expect(screen.getByRole('button',{name:'저장'})).toBeEnabled();
});
it('관리자 확인 응답 전 권한을 잃어도 현재 busy는 해제하고 확인 표시는 억제한다',async()=>{
 const d=deferred<void>();m.update.mockReturnValue(d.promise);const view=render(<PeriodicSanitationForm currentUser={{id:'u',name:'담당'}} isAdmin canConfirm/>);const value=(view.container.querySelector('input[type=week]') as HTMLInputElement).value;deliver([existing(value)]);
 fireEvent.click(screen.getByRole('button',{name:'관리자 확인'}));view.rerender(<PeriodicSanitationForm currentUser={{id:'u',name:'담당'}} isAdmin canConfirm={false}/>);await act(async()=>d.resolve());expect(notes()).toBeEnabled();expect(screen.queryByText(/담당 확인완료/)).toBeNull();
});
it('자기 삭제 snapshot이 먼저 와도 정상응답 뒤 잠금을 정리한다',async()=>{
 const d=deferred<void>();m.del.mockReturnValue(d.promise);m.confirm.mockResolvedValue(true);const view=render(<PeriodicSanitationForm currentUser={{id:'u',name:'담당'}} isAdmin/>);const value=(view.container.querySelector('input[type=week]') as HTMLInputElement).value;deliver([existing(value),{...existing(value),id:'past',period:'2020-W01'}]);
 fireEvent.click(screen.getByText(/이전 .*기록/));fireEvent.click(screen.getByText('2020-W01'));await act(async()=>{});fireEvent.click(screen.getByText(/이전 .*기록/));fireEvent.click(screen.getByText('삭제'));await waitFor(()=>expect(m.del).toHaveBeenCalledOnce());deliver([]);await act(async()=>d.resolve());expect(notes().closest('fieldset')).not.toHaveAttribute('disabled');expect(screen.queryByText(/삭제 결과를 확인하지 못했습니다/)).toBeNull();
});
it('계정 교체 중 옛 초안폐기 승인은 새 선택을 바꾸지 않고 기존 확인 직렬화를 보존한다',async()=>{
 const a=deferred<boolean>(),b=deferred<boolean>();m.confirm.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
 const view=render(<PeriodicSanitationForm currentUser={{id:'a',name:'A'}} isAdmin/>);deliver([]);const date=view.container.querySelector('input[type=week]') as HTMLInputElement,original=date.value;
 fireEvent.change(notes(),{target:{value:'A초안'}});fireEvent.change(date,{target:{value:'2020-W01'}});
 view.rerender(<PeriodicSanitationForm currentUser={{id:'b',name:'B'}} isAdmin/>);deliver([]);fireEvent.change(notes(),{target:{value:'B초안'}});fireEvent.change(date,{target:{value:'2020-W02'}});
 expect(m.confirm).toHaveBeenCalledTimes(1);await act(async()=>a.resolve(true));expect(date).toHaveValue(original);
 fireEvent.change(date,{target:{value:'2020-W03'}});expect(m.confirm).toHaveBeenCalledTimes(2);
 await act(async()=>b.resolve(false));expect(notes()).toHaveValue('B초안');expect(date).toHaveValue(original);
});
it('양식 오류와 독립한 기존 기록 삭제는 서버 조회 뒤 허용한다',async()=>{
 m.confirm.mockResolvedValue(true);render(<PeriodicSanitationForm currentUser={{id:'u',name:'담당'}} isAdmin/>);deliver([{id:'past',cycle:'weekly',period:'2020-W01',rows:[],specialNotes:''}]);act(()=>templateSub().error(new Error('template')));
 fireEvent.click(screen.getByText(/이전 .*기록/));fireEvent.click(screen.getByText('삭제'));await waitFor(()=>expect(m.del).toHaveBeenCalledOnce());
});

it('주간과 월간 양식 오류는 선택한 cycle에만 저장 gate를 적용한다',()=>{
 render(<PeriodicSanitationForm currentUser={{id:'u',name:'담당'}} isAdmin/>);deliver([]);const month=m.subs.find(s=>s.ref.id?.includes('monthly_sanitation'));act(()=>month.error(new Error('month')));expect(screen.getByRole('button',{name:'저장'})).toBeEnabled();fireEvent.click(screen.getByRole('button',{name:'월간 점검표'}));expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();expect(screen.getByRole('button',{name:'양식 다시 조회'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'주간 점검표'}));expect(screen.getByRole('button',{name:'저장'})).toBeEnabled();
});

it('캐시만 받은 양식은 정본 완료가 아니며 서버 양식 부재 확인 뒤 기본양식을 저장한다',async()=>{
 m.templateCache=true;render(<PeriodicSanitationForm currentUser={{id:'u',name:'담당'}} isAdmin/>);deliver([]);fireEvent.change(notes(),{target:{value:'캐시중초안'}});expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();expect(m.add).not.toHaveBeenCalled();
 act(()=>templateSub().next({exists:()=>false,metadata:{fromCache:false}}));expect(notes()).toHaveValue('캐시중초안');fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.add).toHaveBeenCalledOnce());
});

it('ACK 전에 목록으로 관측된 신규 ID는 이후 대상 소실에서 fallback으로 살아나지 않는다',async()=>{
 const d=deferred<string>();m.add.mockReturnValue(d.promise);const view=render(<PeriodicSanitationForm currentUser={{id:'u',name:'담당'}} isAdmin canConfirm/>);const value=(view.container.querySelector('input[type=week]') as HTMLInputElement).value;deliver([]);
 fireEvent.change(notes(),{target:{value:'보존할초안'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));deliver([{...existing(value),id:'known',specialNotes:'보존할초안'}]);await act(async()=>d.resolve('known'));deliver([]);
 fireEvent.click(screen.getByRole('button',{name:'저장'}));fireEvent.click(screen.getByRole('button',{name:'관리자 확인'}));expect(m.update).not.toHaveBeenCalled();expect(notes()).toHaveValue('보존할초안');expect(screen.getByRole('alert')).toHaveTextContent('입력은 보존했습니다');
});

it('관측 뒤 소실된 ID는 늦은 신규 ACK로 임시 예외가 부활하지 않는다',async()=>{
 const d=deferred<string>();m.add.mockReturnValue(d.promise);const view=render(<PeriodicSanitationForm currentUser={{id:'u',name:'담당'}} isAdmin canConfirm/>);const value=(view.container.querySelector('input[type=week]') as HTMLInputElement).value;deliver([]);
 fireEvent.change(notes(),{target:{value:'늦은ACK초안'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));deliver([{...existing(value),id:'seen',specialNotes:'늦은ACK초안'}]);deliver([]);await act(async()=>d.resolve('seen'));
 fireEvent.click(screen.getByRole('button',{name:'저장'}));fireEvent.click(screen.getByRole('button',{name:'관리자 확인'}));expect(m.update).not.toHaveBeenCalled();expect(notes()).toHaveValue('늦은ACK초안');expect(screen.getByRole('alert')).toHaveTextContent('현재 목록에서 선택 기록을 확인하지 못했습니다');expect(m.add).toHaveBeenCalledOnce();
});

it('초안 폐기 취소는 현재 선택의 미관측 ACK 예외를 유지한다',async()=>{
 const view=render(<PeriodicSanitationForm currentUser={{id:'u',name:'담당'}} isAdmin/>);deliver([]);fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.add).toHaveBeenCalledOnce());await waitFor(()=>expect(screen.getByRole('button',{name:'저장'})).toBeEnabled());
 fireEvent.change(notes(),{target:{value:'취소보존'}});const date=view.container.querySelector('input[type=week]') as HTMLInputElement,original=date.value;fireEvent.change(date,{target:{value:'2020-W01'}});await act(async()=>{});expect(date).toHaveValue(original);
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_periodic_sanitation','saved',expect.objectContaining({specialNotes:'취소보존'})));
});
