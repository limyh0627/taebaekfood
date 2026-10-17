/** @vitest-environment jsdom */
import React from 'react';
import {fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({order:null as unknown,subs:[] as any[],set:vi.fn()}));
vi.mock('../../../shared/firebase',()=>({db:{}}));
vi.mock('../../../shared/services/firebaseService',()=>({setDocument:m.set,addItem:vi.fn(),updateItem:vi.fn(),deleteItem:vi.fn()}));
vi.mock('firebase/firestore',()=>({doc:(_:unknown,collection:string,id:string)=>({collection,id}),onSnapshot:(ref:unknown,next:any)=>{const stop=vi.fn();m.subs.push({ref,stop});next({exists:()=>true,data:()=>({order:m.order})});return stop;},collection:vi.fn(),query:vi.fn(),where:vi.fn()}));
import {useHaccpCompany} from '../context/HaccpCompanyContext';
const Probe=({kind,...props}:any)=><div data-testid="form" data-kind={kind}><span data-testid="company">{useHaccpCompany()}</span><span data-testid="props">{JSON.stringify(props)}</span><input aria-label="합성 초안" defaultValue=""/></div>;
vi.mock('./OverviewForm',()=>({OverviewForm:(props:any)=><Probe kind="overview" {...props}/>}));
vi.mock('./DailyForm',()=>({DailyForm:(props:any)=><Probe kind="daily" {...props}/>}));
vi.mock('./CleaningForm',()=>({CleaningForm:(props:any)=><Probe kind="cleaning" {...props}/>}));
vi.mock('./PestForm',()=>({PestForm:(props:any)=><Probe kind="pest" {...props}/>}));
vi.mock('./TempForm',()=>({TempForm:(props:any)=><Probe kind="temp" {...props}/>}));
vi.mock('./CCPHeatForm',()=>({default:(props:any)=><Probe kind="heat" {...props}/>}));
vi.mock('./CCPMetalForm',()=>({default:(props:any)=><Probe kind="metal" {...props}/>}));
vi.mock('./IncomingForm',()=>({IncomingForm:(props:any)=><Probe kind="incoming" {...props}/>}));
vi.mock('./SanitationForm',()=>({SanitationForm:(props:any)=><Probe kind="sanitation" {...props}/>}));
vi.mock('./PersonalHygieneForm',()=>({PersonalHygieneForm:(props:any)=><Probe kind="personal" {...props}/>}));
vi.mock('./PeriodicSanitationForm',()=>({PeriodicSanitationForm:(props:any)=><Probe kind="periodic" {...props}/>}));
vi.mock('./ClosingChecklistForm',()=>({ClosingChecklistForm:(props:any)=><Probe kind="closing" {...props}/>}));
vi.mock('./ChecklistTemplateEditors',()=>({DRAG_HANDLE_CLASS:'original',PersonalHygieneTemplateEditor:()=> <span data-testid="editor">개인 편집</span>,TempZoneTemplateEditor:()=> <span data-testid="editor">온도 편집</span>,SanitationTemplateEditor:()=> <span data-testid="editor">위생 편집</span>,PeriodicSanitationTemplateEditor:()=> <span data-testid="editor">주기 편집</span>,ClosingChecklistTemplateEditor:()=> <span data-testid="editor">마감 편집</span>}));
import HaccpChecklist,{StaffChecklistView} from '../../../../components/HaccpChecklist';
beforeEach(()=>{m.order=null;m.subs=[];m.set.mockReset();});
const user={id:'test',name:'합성 담당'};
it('관리자12 기본탭과 폼별 기존 권한·사용자 props를 유지한다',()=>{
 render(<HaccpChecklist companyId="taebaek" isAdmin currentUser={user}/>);
 expect(screen.getAllByRole('button')).toHaveLength(12);expect(screen.getByTestId('form')).toHaveAttribute('data-kind','overview');
 fireEvent.click(screen.getByRole('button',{name:'입고검사일지'}));expect(JSON.parse(screen.getByTestId('props').textContent!)).toEqual({currentUser:user,isAdmin:true,canConfirm:false});
 fireEvent.click(screen.getByRole('button',{name:'작업장 위생점검표'}));expect(JSON.parse(screen.getByTestId('props').textContent!).canConfirm).toBe(true);
});
it('직원5 기본탭·권한을 유지하며 탭 이동과 가짜 드래그로 쓰지 않는다',()=>{
 render(<StaffChecklistView companyId="punghoe" isAdmin={false} currentUser={user}/>);
 expect(screen.getAllByRole('button')).toHaveLength(5);expect(screen.getByTestId('form')).toHaveAttribute('data-kind','sanitation');expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
 const buttons=screen.getAllByRole('button');for(const button of buttons)expect(button).not.toHaveAttribute('draggable');
 fireEvent.dragStart(buttons[0],{dataTransfer:{setData:vi.fn()}});fireEvent.dragEnter(buttons[1]);fireEvent.dragEnd(buttons[0]);
 fireEvent.click(screen.getByRole('button',{name:'온도관리 일지'}));expect(JSON.parse(screen.getByTestId('props').textContent!).canConfirm).toBe(false);expect(m.set).not.toHaveBeenCalled();expect(screen.getByTestId('company')).toHaveTextContent('punghoe');
});
it.each(['admin','staff'] as const)('%s의 회사 key 변경은 탭·입력·구독을 함께 초기화한다',mode=>{
 const Entry=mode==='admin'?HaccpChecklist:StaffChecklistView;
 const view=render(<Entry companyId="taebaek" isAdmin={false} currentUser={user}/>);fireEvent.click(screen.getByRole('button',{name:'온도관리 일지'}));fireEvent.change(screen.getByLabelText('합성 초안'),{target:{value:'이전 회사 초안'}});
 view.rerender(<Entry companyId="punghoe" isAdmin={false} currentUser={user}/>);
 expect(m.subs[0].stop).toHaveBeenCalledOnce();expect(m.subs[1].ref.id).toBe(mode==='admin'?'punghoe--haccp_tab_order':'punghoe--staff_tab_order');
 expect(screen.getByTestId('form')).toHaveAttribute('data-kind',mode==='admin'?'overview':'sanitation');expect(screen.getByLabelText('합성 초안')).toHaveValue('');expect(screen.getByTestId('company')).toHaveTextContent('punghoe');view.unmount();expect(m.subs[1].stop).toHaveBeenCalledOnce();
});
it('알 수 없는 저장 탭은 버리고 나머지 기본탭을 원순서로 보충한다',()=>{
 m.order=['unknown','temp','daily'];render(<HaccpChecklist companyId="taebaek" isAdmin/>);
 const buttons=screen.getAllByRole('button');expect(buttons).toHaveLength(12);expect(buttons[0]).toHaveTextContent('온도관리 일지');expect(buttons[1]).toHaveTextContent('일반위생관리');expect(buttons[2]).toHaveTextContent('사후평가 점검표');
});
it.each(['admin','staff'] as const)('%s 관리자 드래그는 종료 시 기존 문서에 순서를 한 번 저장한다',mode=>{
 const Entry=mode==='admin'?HaccpChecklist:StaffChecklistView;render(<Entry companyId="punghoe" isAdmin/>);
 const buttons=screen.getAllByRole('button'),transfer={setData:vi.fn(),effectAllowed:''};
 fireEvent.dragStart(buttons[0],{dataTransfer:transfer});fireEvent.dragEnter(buttons[1]);expect(m.set).not.toHaveBeenCalled();fireEvent.dragEnd(buttons[0]);
 expect(m.set).toHaveBeenCalledOnce();expect(m.set).toHaveBeenCalledWith('haccp_templates',mode==='admin'?'punghoe--haccp_tab_order':'punghoe--staff_tab_order',{order:expect.any(Array)});
 const order=m.set.mock.calls[0][2].order;expect(order.slice(0,2)).toEqual(mode==='admin'?['daily','overview']:['weekly-sanitation','sanitation']);expect(order).toHaveLength(mode==='admin'?12:5);
});
