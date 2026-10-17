/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({add:vi.fn(),update:vi.fn(),pdf:vi.fn(),snap:null as null|((s:any)=>void),unsub:vi.fn(),where:vi.fn((...args:any[])=>args)}));
vi.mock('../../../shared/firebase',()=>({db:{},auth:{currentUser:{uid:'output-test'},onAuthStateChanged:()=>()=>{}}}));
vi.mock('firebase/firestore',()=>({collection:vi.fn((_,n)=>n),query:vi.fn((...args)=>args),where:m.where,onSnapshot:vi.fn((_,cb)=>{m.snap=cb;cb({docs:[]});return m.unsub;})}));
vi.mock('../../../shared/services/firebaseService',()=>({addItem:m.add,updateItem:m.update}));
vi.mock('../infrastructure/downloadAsPDF',()=>({downloadAsPDF:m.pdf}));
import { CleaningForm } from './CleaningForm';
import { HaccpCompanyContext } from '../context/HaccpCompanyContext';
const month=new Date().toISOString().slice(0,7);
beforeEach(()=>{vi.clearAllMocks();m.add.mockResolvedValue('new');m.update.mockResolvedValue(undefined);});
it('기계·구역 기본행과 행별 수정·추가를 신규 저장 계약 그대로 보낸다',async()=>{
 render(<CleaningForm currentUser={{id:'u',name:'작업자'}}/>);const methods=screen.getAllByPlaceholderText('세척방법 기재');const second=(methods[1] as HTMLInputElement).value;fireEvent.change(methods[0],{target:{value:'합성방법'}});expect(methods[1]).toHaveValue(second);fireEvent.click(screen.getAllByRole('button',{name:'+ 행 추가'})[0]);fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.add).toHaveBeenCalledOnce());const [collection,payload]=m.add.mock.calls[0];expect(collection).toBe('haccp_cleaning');expect(payload).toMatchObject({month,createdBy:'작업자',updatedBy:'작업자',revisionCount:0});expect(payload.machineRows[0].cleanMethod).toBe('합성방법');expect(payload.areaRows.length).toBeGreaterThan(0);expect(payload.machineRows.length).toBe(methods.length+1);
});
it('기록 수신 후 수정 차수와 확인권한의 서비스 인자를 보존한다',async()=>{
 render(<CleaningForm currentUser={{id:'u',name:'확인자'}} canConfirm/>);act(()=>m.snap?.({docs:[{id:'rec',data:()=>({month,machineRows:[],areaRows:[],revisionCount:2,updatedBy:'이전'})}]}));fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_cleaning','rec',expect.objectContaining({revisionCount:3,machineRows:[],areaRows:[]})));fireEvent.click(screen.getByRole('button',{name:'관리자 확인'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_cleaning','rec',expect.objectContaining({confirmedBy:'확인자'})));
});
it('직원 과거월은 저장·추가를 숨기고 두 PDF의 별도 영역·파일명을 유지한다',()=>{
 render(<CleaningForm/>);fireEvent.change(screen.getByLabelText(/관리월/),{target:{value:'2020-01'}});expect(screen.getByText('읽기 전용')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'저장'})).toBeNull();expect(screen.queryByRole('button',{name:'+ 행 추가'})).toBeNull();expect(within(screen.getAllByRole('table')[0]).getAllByRole('combobox')[0]).toBeDisabled();screen.getAllByRole('button',{name:'PDF 저장'}).forEach(button=>fireEvent.click(button));expect(m.pdf.mock.calls.map(c=>c[1])).toEqual(['HACCP_기계세척소독일지_2020-01.pdf','HACCP_구역청소일지_2020-01.pdf']);expect(m.pdf.mock.calls[0][0]).not.toBe(m.pdf.mock.calls[1][0]);
});
it('회사별 구독 인자와 cleanup을 보존한다',()=>{
 const view=render(<HaccpCompanyContext.Provider value="taebaek"><CleaningForm/></HaccpCompanyContext.Provider>);view.rerender(<HaccpCompanyContext.Provider value="punghoe"><CleaningForm/></HaccpCompanyContext.Provider>);expect(m.where).toHaveBeenCalledWith('companyId','==','punghoe');expect(m.unsub).toHaveBeenCalledOnce();view.unmount();expect(m.unsub).toHaveBeenCalledTimes(2);
});
it('회사 변경과 화면 해제는 두 출력 영역의 이전 미리보기 수명을 끝낸다',()=>{
 const view=render(<HaccpCompanyContext.Provider value="taebaek"><CleaningForm/></HaccpCompanyContext.Provider>);fireEvent.click(screen.getAllByRole('button',{name:'PDF 저장'})[0]);const first=m.pdf.mock.calls[0][2] as AbortSignal;expect(first.aborted).toBe(false);view.rerender(<HaccpCompanyContext.Provider value="punghoe"><CleaningForm/></HaccpCompanyContext.Provider>);expect(first.aborted).toBe(true);fireEvent.click(screen.getAllByRole('button',{name:'PDF 저장'})[1]);const second=m.pdf.mock.calls[1][2] as AbortSignal;view.unmount();expect(second.aborted).toBe(true);expect(m.add).not.toHaveBeenCalled();expect(m.update).not.toHaveBeenCalled();
});
