/** @vitest-environment jsdom */
import React from 'react';
import {cleanup,fireEvent,render,screen,within,act,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import LeaveManager from './LeaveManager';
import type {Employee,LeaveRequest} from '../types';
vi.mock('../src/shared/services/firebaseService',()=>({subscribeToDocument:vi.fn(()=>()=>{}),setDocument:vi.fn()}));
const employee:Employee={id:'emp',companyId:'taebaek',name:'테스트직원',position:'사원',department:'생산팀',joinDate:'2020-01-01',phone:'010-0000-0000',status:'working'};
afterEach(cleanup);
function view(isAdmin=false){const onAddLeaveRequest=vi.fn();const result=render(<LeaveManager companyId="taebaek" currentUser={employee} employees={[employee]} leaveRequests={[]} onAddLeaveRequest={onAddLeaveRequest} onUpdateLeaveStatus={vi.fn()} onUpdateLeave={vi.fn()} isAdmin={isAdmin}/>);return{...result,onAddLeaveRequest};}
it('연차 제목 다음 보기탭과 신청행동을 분리하고 원래 신청서를 연다',()=>{
 const {container,onAddLeaveRequest}=view();const tabs=screen.getByRole('group',{name:'연차 메뉴'}),actions=screen.getByRole('group',{name:'연차 신청 및 확인 작업'});
 expect(tabs.closest('[data-page-header-slot="tabs"]')).not.toBeNull();expect(tabs.compareDocumentPosition(actions)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(screen.getByRole('heading',{name:'연차 신청 및 확인'}).parentElement).toHaveClass('hidden','md:block');
 expect(container.querySelector('[data-page-header-slot="recovery"]')).toBeNull();
 const create=within(actions).getByRole('button',{name:'신규 연차 신청'});expect(create).toHaveClass('h-9');fireEvent.click(create);
 expect(screen.getByRole('dialog',{name:'연차 신청서'})).toBeInTheDocument();expect(onAddLeaveRequest).not.toHaveBeenCalled();
});
it('연락망에서는 신청 행동을 숨기고 관리자 편집 권한과 조회 규격을 보존한다',()=>{
 const {onAddLeaveRequest}=view();fireEvent.click(screen.getByRole('button',{name:'조직도·연락망'}));
 expect(screen.queryByRole('group',{name:'연차 신청 및 확인 작업'})).toBeNull();
 expect(screen.queryByRole('button',{name:'신규 연차 신청'})).toBeNull();expect(screen.queryByRole('button',{name:/편집/})).toBeNull();
 expect(screen.getByPlaceholderText('이름·부서·직급 검색')).toHaveClass('h-10','bg-slate-50');
 fireEvent.click(screen.getByRole('button',{name:'임직원 캘린더'}));expect(screen.getByRole('button',{name:'신규 연차 신청'})).toBeInTheDocument();expect(onAddLeaveRequest).not.toHaveBeenCalled();
});
it('내 휴가 검색과 월 필터의 controlled 값은 유지한다',()=>{
 view();const search=screen.getByPlaceholderText('검색...');expect(search).toHaveClass('h-10','bg-slate-50');fireEvent.change(search,{target:{value:'직원'}});expect(search).toHaveValue('직원');
});
it('관리자는 연락망 편집을 열 수 있고 신청 행동은 조직도에서 생기지 않는다',()=>{
 view(true);fireEvent.click(screen.getByRole('button',{name:'조직도·연락망'}));fireEvent.click(screen.getByRole('button',{name:'편집'}));expect(screen.getByPlaceholderText('직함 (예: 대표이사)')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'신규 연차 신청'})).toBeNull();
});

it('내휴가와 연락처 조회 초기화는 각 검색만 비우고 신청 writer를 호출하지 않는다',()=>{const {onAddLeaveRequest}=view();const query=screen.getByRole('region',{name:'내 휴가 검색조건'}),search=screen.getByPlaceholderText('검색...');fireEvent.change(search,{target:{value:'조건'}});fireEvent.change(screen.getByLabelText('내 휴가 조회월'),{target:{value:'2025-01'}});fireEvent.click(within(query).getByRole('button',{name:'초기화'}));expect(search).toHaveValue('');expect(screen.getByLabelText('내 휴가 조회월')).toHaveValue(new Date().toISOString().slice(0,7));fireEvent.click(screen.getByRole('button',{name:'조직도·연락망'}));const contact=screen.getByPlaceholderText('이름·부서·직급 검색');fireEvent.change(contact,{target:{value:'없는 직원'}});fireEvent.click(within(screen.getByRole('region',{name:'연락처 검색조건'})).getByRole('button',{name:'초기화'}));expect(contact).toHaveValue('');expect(onAddLeaveRequest).not.toHaveBeenCalled();});

it('신청은 ACK를 기다리고 중복을 막으며 알림 부분실패는 신청 재전송 없이 안내한다',async()=>{let finish!:(v:any)=>void;const submit=vi.fn((_request:LeaveRequest)=>new Promise<any>(resolve=>finish=resolve));render(<LeaveManager companyId="taebaek" currentUser={employee} employees={[employee]} leaveRequests={[]} onAddLeaveRequest={submit} onUpdateLeaveStatus={vi.fn()} onUpdateLeave={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'신규 연차 신청'}));fireEvent.change(screen.getByPlaceholderText('휴가 사유를 작성해 주세요.'),{target:{value:'보존할 신청'}});const button=screen.getByRole('button',{name:'신청 완료'});fireEvent.click(button);fireEvent.click(button);expect(submit).toHaveBeenCalledOnce();expect(screen.getByRole('dialog',{name:'연차 신청서'})).toBeVisible();fireEvent.click(within(screen.getByRole('dialog',{name:'연차 신청서'})).getByRole('button',{name:'취소'}));expect(screen.getByRole('dialog',{name:'연차 신청서'})).toBeVisible();expect(screen.getByRole('alert')).toHaveTextContent('확인하는 중');const id=submit.mock.calls[0][0].id;await act(async()=>finish({status:'partial',reason:'followup-unconfirmed',committedIds:[id],unconfirmedIds:[],message:'신청 저장 완료, 알림 미확인',nextAction:'신청을 다시 보내지 마세요.'}));expect(screen.queryByRole('dialog',{name:'연차 신청서'})).toBeNull();expect(screen.getByRole('status')).toHaveTextContent('알림 미확인');expect(submit).toHaveBeenCalledOnce();});
it('신청 미확정은 초안과 같은 ID를 보존하고 결과 확인만 허용한다',async()=>{const submit=vi.fn().mockRejectedValue(Error('응답유실')),inspect=vi.fn().mockResolvedValue({status:'saved'});render(<LeaveManager companyId="taebaek" currentUser={employee} employees={[employee]} leaveRequests={[]} onAddLeaveRequest={submit} onInspectLeaveRequest={inspect} onUpdateLeaveStatus={vi.fn()} onUpdateLeave={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'신규 연차 신청'}));fireEvent.change(screen.getByPlaceholderText('휴가 사유를 작성해 주세요.'),{target:{value:'원문'}});fireEvent.click(screen.getByRole('button',{name:'신청 완료'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('저장 결과'));expect(screen.getByDisplayValue('원문')).toBeInTheDocument();expect(screen.getByRole('button',{name:'신청 완료'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'저장 결과 확인'}));await waitFor(()=>expect(screen.queryByRole('dialog',{name:'연차 신청서'})).toBeNull());expect(inspect).toHaveBeenCalledWith(submit.mock.calls[0][0].id);expect(submit).toHaveBeenCalledOnce();});
it('재로드 보관 요청은 새 번호로 제출하지 않고 원문 확인으로 복원한다',()=>{const pending={id:'retained',employeeId:employee.id,employeeName:employee.name,type:'연차' as const,startDate:'2026-10-20',endDate:'2026-10-20',reason:'보관 원문',status:'pending' as const,requestedAt:'2026-10-18',daysUsed:1};render(<LeaveManager companyId="taebaek" currentUser={employee} employees={[employee]} leaveRequests={[]} onAddLeaveRequest={vi.fn()} onReadPendingLeaveRequests={()=>[pending]} onInspectLeaveRequest={vi.fn()} onUpdateLeaveStatus={vi.fn()} onUpdateLeave={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:/보관된 휴가 신청 확인/}));expect(screen.getByDisplayValue('보관 원문')).toBeInTheDocument();expect(screen.getByRole('button',{name:'신청 완료'})).toBeDisabled();});
