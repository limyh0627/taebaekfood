// @vitest-environment jsdom
import React from 'react';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import ProfitAnalysis from './ProfitAnalysis';
const state=vi.hoisted(()=>({save:vi.fn(),notice:vi.fn(),uid:'actor',listeners:new Set<(user:any)=>void>()}));
vi.mock('../src/shared/services/firebaseService',()=>({fetchWhere:vi.fn().mockResolvedValue([])}));
vi.mock('../src/features/admin/partnerMonthlyPdf',()=>({savePartnerMonthlyPdf:state.save}));
vi.mock('../src/shared/components/appDialog',()=>({appNotice:state.notice,appConfirm:vi.fn()}));
vi.mock('../src/shared/firebase',()=>({db:{},authReady:Promise.resolve(),auth:{get currentUser(){return{uid:state.uid};},onAuthStateChanged:(fn:(user:any)=>void)=>{state.listeners.add(fn);return()=>state.listeners.delete(fn);}}}));
const props={issuedStatements:[],cashEntries:[],initialTab:'partners' as const};
beforeEach(()=>{state.uid='actor';state.save.mockReset().mockResolvedValue(undefined);state.notice.mockReset();});
it('실제 월간 출력 버튼은 선택 월과 전체 정산 행 및 회사 수명 signal을 공용 미리보기로 보낸다',async()=>{
 render(<ProfitAnalysis {...props}/>);fireEvent.change(screen.getByLabelText('거래처별 정산 PDF 월 선택'),{target:{value:'2026-08'}});
 fireEvent.click(screen.getByRole('button',{name:'거래처별 월간 정산 PDF'}));await waitFor(()=>expect(state.save).toHaveBeenCalledOnce());
 expect(state.save.mock.calls[0]).toEqual(['2026-08',[],expect.any(AbortSignal)]);expect(state.save.mock.calls[0][2].aborted).toBe(false);
});
it('준비 중 중복 클릭을 막고 월·회사·UID 전환과 닫힘은 이전 문서를 취소한다',async()=>{
 let finish!:()=>void;state.save.mockImplementation(()=>new Promise<void>(r=>{finish=r;}));
 const view=render(<ProfitAnalysis {...props} companyId="taebaek"/>);
 const click=()=>fireEvent.click(screen.getByRole('button',{name:'거래처별 월간 정산 PDF'}));click();click();expect(state.save).toHaveBeenCalledOnce();
 const first=state.save.mock.calls[0][2];fireEvent.change(screen.getByLabelText('거래처별 정산 PDF 월 선택'),{target:{value:'2026-08'}});expect(first.aborted).toBe(true);await act(async()=>finish());
 click();const second=state.save.mock.calls[1][2];view.rerender(<ProfitAnalysis {...props} companyId="punghoe"/>);expect(second.aborted).toBe(true);await act(async()=>finish());
 click();const third=state.save.mock.calls[2][2];act(()=>{state.uid='other';state.listeners.forEach(fn=>fn({uid:'other'}));});expect(third.aborted).toBe(true);await act(async()=>finish());
 view.rerender(<ProfitAnalysis {...props} companyId="punghoe"/>);click();const fourth=state.save.mock.calls[3][2];view.unmount();expect(fourth.aborted).toBe(true);await act(async()=>finish());
});
it('준비 실패는 안내하고 다시 시도할 수 있으며 취소 뒤 늦은 실패는 안내하지 않는다',async()=>{
 state.save.mockRejectedValueOnce(Error('capture'));const view=render(<ProfitAnalysis {...props}/>);
 const click=()=>fireEvent.click(screen.getByRole('button',{name:'거래처별 월간 정산 PDF'}));click();await waitFor(()=>expect(state.notice).toHaveBeenCalledOnce());
 click();await waitFor(()=>expect(state.save).toHaveBeenCalledTimes(2));
 let reject!:(e:Error)=>void;state.save.mockImplementation(()=>new Promise((_r,r)=>{reject=r;}));click();view.unmount();await act(async()=>reject(Error('late')));expect(state.notice).toHaveBeenCalledOnce();
});
