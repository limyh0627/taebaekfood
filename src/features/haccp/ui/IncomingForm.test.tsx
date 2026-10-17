/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({add:vi.fn(),update:vi.fn(),pdf:vi.fn(),snap:null as null|((s:any)=>void),unsub:vi.fn(),where:vi.fn((...args:any[])=>args)}));
vi.mock('../../../shared/firebase',()=>({db:{},auth:{currentUser:{uid:'output-test'},onAuthStateChanged:()=>()=>{}}}));
vi.mock('firebase/firestore',()=>({collection:vi.fn((_,name)=>name),where:m.where,query:vi.fn((...args)=>args),onSnapshot:vi.fn((_,cb)=>{m.snap=cb;cb({docs:[]});return m.unsub;})}));
vi.mock('../../../shared/services/firebaseService',()=>({addItem:m.add,updateItem:m.update}));
vi.mock('../infrastructure/downloadAsPDF',()=>({downloadAsPDF:m.pdf}));
import { IncomingForm } from './IncomingForm';
import { HaccpCompanyContext } from '../context/HaccpCompanyContext';
const month=new Date().toISOString().slice(0,7);
const row={date:'',inboundPartner:'원문업체',material:'참깨',materialType:'원료',quantity:'2.50',unit:'kg',lotNo:'LOT',expDate:'',appearance:'',packaging:'',label:'',certAvail:'',result:'',corrective:'',inspector:''};
const receive=(data:any)=>act(()=>m.snap?.({docs:[{id:'record',data:()=>data}]}));
beforeEach(()=>{vi.clearAllMocks();m.add.mockResolvedValue('new');m.update.mockResolvedValue(undefined);});
it('신규 저장은 기존 컬렉션·행·작성자·revision 계약을 유지한다',async()=>{
 render(<IncomingForm currentUser={{id:'u',name:'합성작성자'}}/>);fireEvent.click(screen.getByRole('button',{name:'행 추가'}));const rows=screen.getByRole('table').querySelectorAll('tbody tr');const fields=rows[0].querySelectorAll('input');fireEvent.change(fields[1],{target:{value:'공급업체'}});fireEvent.change(fields[2],{target:{value:'2.50'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.add).toHaveBeenCalledOnce());const [collection,payload]=m.add.mock.calls[0];expect(collection).toBe('haccp_incoming');expect(payload).toMatchObject({month,createdBy:'합성작성자',updatedBy:'합성작성자',revisionCount:0});expect(payload.rows).toHaveLength(2);expect(payload.rows[0]).toMatchObject({inboundPartner:'공급업체',quantity:'2.50',unit:'kg'});expect(payload.rows[1].inboundPartner).toBe('');
});
it('수신 기록은 편집 초안을 채우고 수정 revision과 관리자 확인을 그대로 보낸다',async()=>{
 render(<IncomingForm currentUser={{id:'u',name:'확인자'}} canConfirm/>);receive({month,rows:[row],revisionCount:3,updatedBy:'이전'});expect(screen.getByDisplayValue('원문업체')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_incoming','record',expect.objectContaining({revisionCount:4,updatedBy:'확인자',rows:[row]})));fireEvent.click(screen.getByRole('button',{name:'관리자 확인'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_incoming','record',expect.objectContaining({confirmedBy:'확인자'})));
});
it('과거월 직원은 읽기 전용이고 PDF에는 선택 월의 인쇄 영역만 준다',()=>{
 render(<IncomingForm/>);fireEvent.change(screen.getByLabelText(/관리월/),{target:{value:'2020-01'}});expect(screen.getByText('읽기 전용')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'저장'})).toBeNull();expect(screen.queryByRole('button',{name:'행 추가'})).toBeNull();expect(screen.queryByRole('button',{name:'관리자 확인'})).toBeNull();expect(within(screen.getByRole('table')).getAllByRole('combobox')[0]).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'PDF'}));const [element,file]=m.pdf.mock.calls[0];expect(file).toBe('HACCP_입고검사일지_2020-01.pdf');expect(element).toContainElement(screen.getByText('원료·부자재 입고검사일지'));expect(m.add).not.toHaveBeenCalled();
});
it('회사 context는 동일 where 값과 구독 해제를 유지한다',()=>{
 const view=render(<HaccpCompanyContext.Provider value="taebaek"><IncomingForm/></HaccpCompanyContext.Provider>);expect(m.where).toHaveBeenCalledWith('companyId','==','taebaek');view.rerender(<HaccpCompanyContext.Provider value="punghoe"><IncomingForm/></HaccpCompanyContext.Provider>);expect(m.unsub).toHaveBeenCalledOnce();expect(m.where).toHaveBeenCalledWith('companyId','==','punghoe');view.unmount();expect(m.unsub).toHaveBeenCalledTimes(2);
});
