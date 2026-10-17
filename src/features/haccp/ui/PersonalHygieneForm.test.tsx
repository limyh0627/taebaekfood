/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({add:vi.fn(),update:vi.fn(),del:vi.fn(),confirm:vi.fn(),pdf:vi.fn(),records:null as null|((s:any)=>void),unsub:vi.fn(),where:vi.fn((...args:any[])=>args)}));
vi.mock('../../../shared/firebase',()=>({db:{},auth:{currentUser:{uid:'output-test'},onAuthStateChanged:()=>()=>{}}}));
vi.mock('firebase/firestore',()=>({collection:vi.fn((_,n)=>({kind:'collection',n})),doc:vi.fn((_,n,id)=>({kind:'doc',n,id})),query:vi.fn((source,...args)=>({...source,args})),where:m.where,onSnapshot:vi.fn((source,cb)=>{if(source.kind==='doc')cb({exists:()=>true,data:()=>({cols:['건강']})});else{m.records=cb;cb({docs:[]});}return m.unsub;})}));
vi.mock('../../../shared/services/firebaseService',()=>({addItem:m.add,updateItem:m.update,deleteItem:m.del}));
vi.mock('../../../shared/components/appDialog',()=>({appConfirm:m.confirm}));
vi.mock('../infrastructure/downloadAsPDF',()=>({downloadAsPDF:m.pdf}));
import { PersonalHygieneForm } from './PersonalHygieneForm';
import { HaccpCompanyContext } from '../context/HaccpCompanyContext';
import { todayStr } from '../domain/haccpDate';
beforeEach(()=>{vi.clearAllMocks();m.add.mockResolvedValue('new');m.update.mockResolvedValue(undefined);m.confirm.mockResolvedValue(false);});
it('선택된 이름 행만 필수검사하고 신규·수정차수·관리자확인 인자를 보존한다',async()=>{
 render(<PersonalHygieneForm isAdmin canConfirm currentUser={{id:'u',name:'관리자'}}/>);fireEvent.click(screen.getByRole('button',{name:/오늘 개인위생 점검/}));expect(screen.getByRole('button',{name:'저장 먼저'})).toBeDisabled();fireEvent.change(screen.getAllByPlaceholderText('성명')[0],{target:{value:'작업자'}});fireEvent.click(screen.getAllByRole('button',{name:'O'})[0]);fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.add).toHaveBeenCalledOnce());expect(m.add.mock.calls[0][0]).toBe('haccp_personal_hygiene');expect(m.add.mock.calls[0][1]).toMatchObject({checkDate:todayStr(),createdBy:'관리자',revisionCount:0});await screen.findByRole('button',{name:'관리자 확인'});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_personal_hygiene','new',expect.objectContaining({revisionCount:1})));fireEvent.click(screen.getByRole('button',{name:'관리자 확인'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_personal_hygiene','new',expect.objectContaining({confirmedBy:'관리자'})));
});
it('미완료 검사 확인을 막고 비관리자 본인 행만 체크할 수 있다',()=>{
 render(<PersonalHygieneForm currentUser={{id:'u',name:'본인'}}/>);fireEvent.click(screen.getByRole('button',{name:/오늘 개인위생 점검/}));expect(screen.queryByPlaceholderText('성명')).toBeNull();const buttons=screen.getAllByRole('button',{name:'O'});expect(buttons[0]).not.toBeDisabled();expect(buttons[1]).toBeDisabled();fireEvent.click(buttons[0]);expect(buttons[0]).toHaveClass('bg-emerald-500');expect(m.update).not.toHaveBeenCalled();
});
it('이전 기록 삭제 취소는 자료를 유지하고 PDF에는 선택일 영역만 전달한다',async()=>{
 render(<PersonalHygieneForm isAdmin/>);act(()=>m.records?.({docs:[{id:'past',data:()=>({checkDate:'2020-01-01',rows:[{name:'과거',checks:{건강:'O'},note:''}],inspector:'이전',revisionCount:0})}]}));fireEvent.click(screen.getByRole('button',{name:/이전 점검 기록/}));const date=screen.getByText('2020-01-01');const card=date.parentElement!;fireEvent.click(card.querySelector('button')!);await waitFor(()=>expect(m.confirm).toHaveBeenCalledOnce());expect(m.del).not.toHaveBeenCalled();fireEvent.click(card);expect(screen.queryByRole('button',{name:'저장'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'PDF'}));expect(m.pdf.mock.calls[0][1]).toBe('개인위생점검표_2020-01-01.pdf');expect(m.pdf.mock.calls[0][0]).toContainElement(screen.getByText('개인위생점검표'));
});
it('회사 전환은 기록과 템플릿 두 구독을 해제한다',()=>{
 const view=render(<HaccpCompanyContext.Provider value="taebaek"><PersonalHygieneForm/></HaccpCompanyContext.Provider>);view.rerender(<HaccpCompanyContext.Provider value="punghoe"><PersonalHygieneForm/></HaccpCompanyContext.Provider>);expect(m.where).toHaveBeenCalledWith('companyId','==','punghoe');expect(m.unsub).toHaveBeenCalledTimes(2);view.unmount();expect(m.unsub).toHaveBeenCalledTimes(4);
});
it('저장된 이름 행의 미완료 검사는 확인을 막고 같은 체크 재클릭은 빈 값으로 되돌린다',()=>{
 render(<PersonalHygieneForm isAdmin canConfirm/>);act(()=>m.records?.({docs:[{id:'today',data:()=>({checkDate:todayStr(),rows:[{name:'작업자',checks:{건강:''},note:''},{name:'',checks:{건강:''},note:''}],inspector:'',revisionCount:0})}]}));fireEvent.click(screen.getByRole('button',{name:/오늘 개인위생 점검/}));expect(screen.getByRole('button',{name:'항목 미완료'})).toBeDisabled();const check=screen.getAllByRole('button',{name:'O'})[0];fireEvent.click(check);expect(screen.getByRole('button',{name:'관리자 확인'})).not.toBeDisabled();fireEvent.click(check);expect(screen.getByRole('button',{name:'항목 미완료'})).toBeDisabled();expect(m.update).not.toHaveBeenCalled();
});
