/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({add:vi.fn(),update:vi.fn(),del:vi.fn(),confirm:vi.fn(),pdf:vi.fn(),subs:[] as any[]}));
vi.mock('../../../shared/firebase',()=>({db:{},auth:{currentUser:{uid:'output-test'},onAuthStateChanged:()=>()=>{}}}));
vi.mock('firebase/firestore',()=>({collection:(_db:any,name:string)=>({name}),doc:(_db:any,name:string,id:string)=>({name,id}),where:(field:string,op:string,value:string)=>({field,op,value}),query:(ref:any,...constraints:any[])=>({...ref,constraints}),onSnapshot:(ref:any,...args:any[])=>{const next=typeof args[0]==='function'?args[0]:args[1],error=typeof args[0]==='function'?args[1]:args[2];const sub={ref,next,error,options:typeof args[0]==='function'?undefined:args[0],unsubscribe:vi.fn()};m.subs.push(sub);if(ref.id)next({exists:()=>false});return sub.unsubscribe;}}));
vi.mock('../../../shared/services/firebaseService',()=>({addItem:m.add,updateItem:m.update,deleteItem:m.del}));
vi.mock('../../../shared/components/appDialog',()=>({appConfirm:m.confirm}));
vi.mock('../infrastructure/downloadAsPDF',()=>({downloadAsPDF:m.pdf}));
import { ClosingChecklistForm } from './ClosingChecklistForm';
import { HaccpCompanyContext } from '../context/HaccpCompanyContext';
beforeEach(()=>{vi.spyOn(window,'alert').mockImplementation(()=>{});m.subs=[];vi.clearAllMocks();m.add.mockResolvedValue('saved');m.update.mockResolvedValue(undefined);m.confirm.mockResolvedValue(false);});
const sub=()=>m.subs.filter(s=>s.ref.name==='haccp_closing_checklist').at(-1);
const deliver=(rows:any[],cache=false)=>act(()=>sub().next({docs:rows.map(row=>({id:row.id,data:()=>row})),metadata:{fromCache:cache}}));
const notes=()=>screen.getByPlaceholderText('특이사항을 입력하세요');
it('서버 조회 전 쓰기를 막고 조회 후 원문 초안·선택기간을 신규 저장한다',async()=>{
 const view=render(<HaccpCompanyContext.Provider value="taebaek"><ClosingChecklistForm currentUser={{id:'u',name:'합성담당'}} isAdmin/></HaccpCompanyContext.Provider>);const value=(view.container.querySelector('input[type=date]') as HTMLInputElement).value;
 expect(sub().options).toEqual({includeMetadataChanges:true});fireEvent.change(notes(),{target:{value:'보존할 원문'}});deliver([],true);expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();deliver([]);fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.add).toHaveBeenCalledOnce());expect(m.add.mock.calls[0][0]).toBe('haccp_closing_checklist');expect(m.add.mock.calls[0][1]).toMatchObject({checkDate:value,specialNotes:'보존할 원문',createdBy:'합성담당',updatedBy:'합성담당'});
});
it('기존 기록 수신은 원래 ID로 수정하고 확인 권한·PDF 거절을 유지한다',async()=>{
 const view=render(<ClosingChecklistForm currentUser={{id:'u',name:'확인자'}} isAdmin canConfirm/>);const value=(view.container.querySelector('input[type=date]') as HTMLInputElement).value;deliver([{id:'existing',checkDate:value,checkZone:'저장구역',rows:[{result:'',note:'',inspector:''}],specialNotes:'서버원문',createdBy:'원작성자',createdAt:'원일시',updatedBy:'이전',updatedAt:''}]);expect(notes()).toHaveValue('서버원문');fireEvent.change(notes(),{target:{value:'수정원문'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_closing_checklist','existing',expect.objectContaining({specialNotes:'수정원문',createdBy:'원작성자',createdAt:'원일시'})));fireEvent.click(screen.getByRole('button',{name:'관리자 확인'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_closing_checklist','existing',expect.objectContaining({confirmedBy:'확인자'})));expect(m.pdf).not.toHaveBeenCalled();expect(m.confirm).not.toHaveBeenCalled();const writes=m.update.mock.calls.length;fireEvent.click(screen.getByRole('button',{name:'PDF'}));expect(m.pdf).toHaveBeenCalledWith(expect.any(HTMLElement),expect.any(String),expect.any(AbortSignal));expect(m.update.mock.calls.length).toBe(writes);
});
it('기간 이동 취소는 초안을 보존하고 승인한 과거기간은 읽기 전용이다',async()=>{
 const view=render(<ClosingChecklistForm isAdmin/>);deliver([]);const date=view.container.querySelector('input[type=date]') as HTMLInputElement,original=date.value;fireEvent.change(notes(),{target:{value:'이동전초안'}});fireEvent.change(date,{target:{value:'2020-01-01'}});await act(async()=>{});expect(date).toHaveValue(original);expect(notes()).toHaveValue('이동전초안');m.confirm.mockResolvedValueOnce(true);fireEvent.change(date,{target:{value:'2020-01-01'}});await waitFor(()=>expect(date).toHaveValue('2020-01-01'));expect(screen.queryByRole('button',{name:'저장'})).toBeNull();expect(m.add).not.toHaveBeenCalled();
});
