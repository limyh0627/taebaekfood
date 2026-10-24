/** @vitest-environment jsdom */
import React from 'react';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({subs:[] as any[],set:vi.fn()}));
vi.mock('../../../shared/firebase',()=>({db:{},auth:{currentUser:{uid:'actor-a'}}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:()=>vi.fn()}));
vi.mock('../../../shared/services/firebaseService',()=>({setDocument:m.set,addItem:vi.fn(),updateItem:vi.fn(),deleteItem:vi.fn()}));
vi.mock('firebase/firestore',()=>({doc:(_:unknown,collection:string,id:string)=>({collection,id}),collection:(_:unknown,collection:string)=>({collection}),where:vi.fn(),query:vi.fn(),onSnapshot:(ref:any,next:any,error:any)=>{const stop=vi.fn();m.subs.push({ref,stop,next,error});next({exists:()=>true,data:()=>({cols:['첫째','둘째'],zones:[{name:'첫째',standard:'기준1'},{name:'둘째',standard:'기준2'}],items:[{item:'첫째',standard:'기준1'},{item:'둘째',standard:'기준2'}]})});return stop;}}));
import {PersonalHygieneTemplateEditor,TempZoneTemplateEditor,SanitationTemplateEditor,PeriodicSanitationTemplateEditor,ClosingChecklistTemplateEditor} from './ChecklistTemplateEditors';
import {PersonalHygieneTemplateEditor as LegacyPersonal,TempZoneTemplateEditor as LegacyTemp,SanitationTemplateEditor as LegacySanitation} from '../../../../components/HaccpChecklist';
import {HaccpCompanyContext} from '../context/HaccpCompanyContext';
beforeEach(()=>{m.subs=[];m.set.mockReset().mockResolvedValue(undefined);});
const cases=[{name:'개인',element:<PersonalHygieneTemplateEditor/>,key:'personal_hygiene',field:'cols'}, {name:'온도',element:<TempZoneTemplateEditor/>,key:'temp_zones',field:'zones'}, {name:'위생',element:<SanitationTemplateEditor/>,key:'sanitation',field:'items'}, {name:'주간',element:<PeriodicSanitationTemplateEditor cycle="weekly"/>,key:'weekly_sanitation',field:'items'}, {name:'마감',element:<ClosingChecklistTemplateEditor/>,key:'closing_checklist',field:'items'}];
it.each(cases)('$name 편집기는 회사별 원 문서에 수정·아래 이동 순서를 그대로 저장한다',async({element,key,field})=>{
 render(<HaccpCompanyContext.Provider value="punghoe">{element}</HaccpCompanyContext.Provider>);
 expect(m.subs[0].ref).toEqual({collection:'haccp_templates',id:`punghoe--${key}`});
 fireEvent.click(screen.getByRole('button',{name:/편집/}));fireEvent.change(screen.getByDisplayValue('첫째'),{target:{value:'수정첫째'}});fireEvent.click(screen.getAllByRole('button',{name:'↓'})[0]);
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.set).toHaveBeenCalledOnce());
 const values=field==='cols'?['둘째','수정첫째']:field==='zones'?[{name:'둘째',standard:'기준2'},{name:'수정첫째',standard:'기준1'}]:[{item:'둘째',standard:'기준2'},{item:'수정첫째',standard:'기준1'}];
 expect(m.set).toHaveBeenCalledWith('haccp_templates',`punghoe--${key}`,{[field]:values});
});
it('기존 공개 편집기3은 새 함수와 동일하고 취소는 저장하지 않는다',()=>{
 expect(LegacyPersonal).toBe(PersonalHygieneTemplateEditor);expect(LegacyTemp).toBe(TempZoneTemplateEditor);expect(LegacySanitation).toBe(SanitationTemplateEditor);
 render(<PersonalHygieneTemplateEditor/>);fireEvent.click(screen.getByRole('button',{name:/편집/}));fireEvent.change(screen.getByDisplayValue('첫째'),{target:{value:'아직 저장 안 함'}});fireEvent.click(screen.getByRole('button',{name:'취소'}));expect(m.set).not.toHaveBeenCalled();
});
it('월간 정책으로 전환할 때 이전 문서 구독을 해지하고 원 월간키로 조회한다',()=>{
 const view=render(<PeriodicSanitationTemplateEditor cycle="weekly"/>);view.rerender(<PeriodicSanitationTemplateEditor cycle="monthly"/>);
 expect(m.subs[0].stop).toHaveBeenCalledOnce();expect(m.subs[1].ref.id).toBe('monthly_sanitation');view.unmount();expect(m.subs[1].stop).toHaveBeenCalledOnce();
});

it('편집 중 새 구독값은 원초안을 덮지 않고 취소하면 최신값을 표시한다',()=>{
 render(<PersonalHygieneTemplateEditor/>);fireEvent.click(screen.getByRole('button',{name:/편집/}));
 fireEvent.change(screen.getByDisplayValue('첫째'),{target:{value:'내 초안'}});
 act(()=>m.subs[0].next({exists:()=>true,data:()=>({cols:['서버 최신']})}));
 expect(screen.getByDisplayValue('내 초안')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'취소'}));expect(screen.getByText('서버 최신')).toBeTruthy();
});
it('저장 대기 중 입력과 취소를 잠가 최초 원문을 유지한다',async()=>{
 let finish!:()=>void;m.set.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
 render(<PersonalHygieneTemplateEditor/>);fireEvent.click(screen.getByRole('button',{name:/편집/}));fireEvent.click(screen.getByRole('button',{name:'저장'}));
 expect((screen.getByDisplayValue('첫째') as HTMLInputElement).disabled).toBe(true);
 expect((screen.getByRole('button',{name:'취소'}) as HTMLButtonElement).disabled).toBe(true);
 await act(async()=>finish());
});

it('구독 오류 뒤 다시 조회 버튼으로 재구독하여 정상 저장한다',async()=>{
 render(<PersonalHygieneTemplateEditor/>);act(()=>m.subs[0].error(new Error('offline')));
 expect((screen.getByRole('button',{name:/편집/}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'다시 조회'}));expect(m.subs[0].stop).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByRole('button',{name:/편집/}));fireEvent.click(screen.getByRole('button',{name:'저장'}));
 await waitFor(()=>expect(m.set).toHaveBeenCalledOnce());expect(screen.queryByRole('alert')).toBeNull();
});
