/** @vitest-environment jsdom */
import React from 'react';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import ProfitAnalysis from './ProfitAnalysis';
import type {AccountGroup,AccountCode} from '../src/shared/types';
import type {SaveOutcome} from '../src/shared/saveOutcome';
const testAuth=vi.hoisted(()=>({currentUser:{uid:'account-actor'}}));
vi.mock('../src/shared/firebase',()=>({auth:testAuth}));
vi.mock('../src/shared/services/firebaseService',()=>({fetchWhere:vi.fn().mockResolvedValue([])}));
vi.mock('recharts',()=>{const Empty=()=>null;return {BarChart:Empty,Bar:Empty,LineChart:Empty,Line:Empty,XAxis:Empty,YAxis:Empty,CartesianGrid:Empty,Tooltip:Empty,ResponsiveContainer:Empty,Legend:Empty,Cell:Empty};});
beforeEach(()=>{testAuth.currentUser.uid='account-actor';});
const group:AccountGroup={id:'expense',name:'업무 비용',type:'비용',plLine:'sgna',cfSection:'operating',note:'유지 메모'};
const second:AccountGroup={id:'asset',name:'자산 그룹',type:'자산'};
const code:AccountCode={id:'code-1',code:'701',name:'업무비',groupId:'expense',type:'비용',normalBalance:'debit',note:'계정 메모'};
const props={companyId:'taebaek' as const,issuedStatements:[],cashEntries:[],accountGroups:[group,second],accountCodes:[code]};
function gate(){let resolve!:(outcome:SaveOutcome)=>void;const promise=new Promise<SaveOutcome>(done=>{resolve=done;});return {promise,resolve};}
function openSettings(){fireEvent.click(screen.getByRole('button',{name:'계정 설정'}));return screen.getByRole('dialog',{name:'계정 설정'});}
it('그룹 Enter 저장은 변경된 plLine null만 보내고 ACK 전 초안과 busy 안내를 유지한다',async()=>{
 const pending=gate(),save=vi.fn<NonNullable<React.ComponentProps<typeof ProfitAnalysis>['onUpdateAccountGroup']>>(()=>pending.promise);render(<ProfitAnalysis {...props} onUpdateAccountGroup={save}/>);openSettings();fireEvent.click(screen.getByRole('button',{name:'업무 비용 그룹 수정'}));fireEvent.change(screen.getByLabelText('계정그룹 손익 줄'),{target:{value:''}});fireEvent.keyDown(screen.getByLabelText('계정그룹 이름'),{key:'Enter'});
 expect(save).toHaveBeenCalledWith(group.id,{plLine:null},expect.objectContaining({companyId:'taebaek',actorUid:'account-actor',isCurrent:expect.any(Function)}));expect(save.mock.calls[0][2].isCurrent()).toBe(true);expect(screen.getByLabelText('계정그룹 이름')).toBeDisabled();expect(screen.getByRole('status')).toHaveTextContent('완료 응답을 기다려');fireEvent.keyDown(screen.getByLabelText('계정그룹 이름'),{key:'Enter'});expect(save).toHaveBeenCalledOnce();await act(async()=>pending.resolve({status:'saved'}));expect(screen.queryByLabelText('계정그룹 이름')).toBeNull();
});
it('손익 줄이 없던 그룹의 이름 수정은 plLine을 생략하고 비표시 정보를 보내지 않는다',async()=>{
 const save=vi.fn().mockResolvedValue({status:'saved'});render(<ProfitAnalysis {...props} onUpdateAccountGroup={save}/>);openSettings();fireEvent.click(screen.getByRole('button',{name:'자산 그룹 그룹 수정'}));fireEvent.change(screen.getByLabelText('계정그룹 이름'),{target:{value:'새 자산 이름'}});fireEvent.click(screen.getByRole('button',{name:'계정그룹 수정 저장'}));await waitFor(()=>expect(screen.queryByLabelText('계정그룹 이름')).toBeNull());expect(save.mock.calls[0][1]).toEqual({name:'새 자산 이름'});
});
it('계정 버튼 저장의 unknown은 입력과 이유를 남기고 같은 값만 명시 재저장한다',async()=>{
 const save=vi.fn().mockResolvedValueOnce({status:'unknown',message:'저장 응답 미확인',nextAction:'다시 저장하면 입력한 항목이 이 값으로 저장됩니다.'}).mockResolvedValue({status:'saved'});render(<ProfitAnalysis {...props} onUpdateAccountCode={save}/>);openSettings();fireEvent.click(screen.getByRole('button',{name:'업무비 계정 수정'}));fireEvent.change(screen.getByPlaceholderText('계정명'),{target:{value:'새 업무비'}});fireEvent.click(screen.getByRole('button',{name:'계정과목 수정 저장'}));const retry=await screen.findByRole('button',{name:'같은 입력 다시 저장'});expect(screen.getByPlaceholderText('계정명')).toHaveValue('새 업무비');expect(screen.getByRole('status')).toHaveTextContent('저장 응답 미확인');fireEvent.click(retry);await waitFor(()=>expect(screen.queryByPlaceholderText('계정명')).toBeNull());expect(save.mock.calls.map(call=>call.slice(0,2))).toEqual([[code.id,{name:'새 업무비'}],[code.id,{name:'새 업무비'}]]);
});
it('계정 그룹 선택도 같은 async 저장 경계로 보내고 ACK를 기다린다',async()=>{
 const pending=gate(),save=vi.fn(()=>pending.promise);render(<ProfitAnalysis {...props} onUpdateAccountCode={save}/>);openSettings();fireEvent.change(screen.getByRole('combobox',{name:'업무비 계정 그룹'}),{target:{value:'asset'}});expect(save).toHaveBeenCalledWith(code.id,{groupId:'asset'},expect.objectContaining({actorUid:'account-actor'}));expect(screen.queryByPlaceholderText('계정명')).toBeNull();expect(screen.queryByPlaceholderText('코드')).toBeNull();expect(screen.getByRole('combobox',{name:'수정 계정 그룹'})).toBeDisabled();await act(async()=>pending.resolve({status:'saved'}));expect(screen.queryByRole('combobox',{name:'수정 계정 그룹'})).toBeNull();
});
it('명시 편집 취소 뒤 옛 ACK는 새 그룹 초안을 닫지 않는다',async()=>{
 const pending=gate(),save=vi.fn(()=>pending.promise);render(<ProfitAnalysis {...props} onUpdateAccountGroup={save}/>);openSettings();fireEvent.click(screen.getByRole('button',{name:'업무 비용 그룹 수정'}));fireEvent.change(screen.getByLabelText('계정그룹 이름'),{target:{value:'옛 수정'}});fireEvent.click(screen.getByRole('button',{name:'계정그룹 수정 저장'}));fireEvent.click(screen.getByRole('button',{name:'계정 편집 취소'}));fireEvent.click(screen.getByRole('button',{name:'자산 그룹 그룹 수정'}));fireEvent.change(screen.getByLabelText('계정그룹 이름'),{target:{value:'새 초안'}});await act(async()=>pending.resolve({status:'saved'}));expect(screen.getByLabelText('계정그룹 이름')).toHaveValue('새 초안');expect(save).toHaveBeenCalledOnce();
});
it('주업무 ACK 뒤 갱신 실패는 편집을 종료하고 계정창 밖에도 새로고침 안내를 남긴다',async()=>{
 const save=vi.fn().mockResolvedValue({status:'partial',reason:'followup-unconfirmed',committedIds:[group.id],unconfirmedIds:[],message:'계정 저장은 완료됐습니다.',nextAction:'화면을 새로고침해 주세요.'});render(<ProfitAnalysis {...props} onUpdateAccountGroup={save}/>);const modal=openSettings();fireEvent.click(screen.getByRole('button',{name:'업무 비용 그룹 수정'}));fireEvent.change(screen.getByLabelText('계정그룹 이름'),{target:{value:'수정 이름'}});fireEvent.click(screen.getByRole('button',{name:'계정그룹 수정 저장'}));await waitFor(()=>expect(screen.queryByLabelText('계정그룹 이름')).toBeNull());expect(within(modal).getByRole('status')).toHaveTextContent('저장은 완료');fireEvent.click(screen.getByRole('button',{name:'계정 설정 닫기'}));expect(screen.getByRole('status')).toHaveTextContent('새로고침');expect(save).toHaveBeenCalledOnce();
});
it('저장 연결이 사라지면 성공 종료하지 않고 이유와 잠긴 저장을 보인다',()=>{
 const save=vi.fn().mockResolvedValue({status:'saved'}),view=render(<ProfitAnalysis {...props} onUpdateAccountGroup={save}/>);openSettings();fireEvent.click(screen.getByRole('button',{name:'업무 비용 그룹 수정'}));fireEvent.change(screen.getByLabelText('계정그룹 이름'),{target:{value:'변경 초안'}});view.rerender(<ProfitAnalysis {...props}/>);expect(screen.getByRole('button',{name:'계정그룹 수정 저장'})).toBeDisabled();expect(screen.getByRole('status')).toHaveTextContent('연결되지 않았습니다');expect(save).not.toHaveBeenCalled();
});
it('같은 회사 UID 교체 뒤 늦은 저장 ACK는 새 편집을 유지한다',async()=>{
 const pending=gate(),save=vi.fn(()=>pending.promise),view=render(<ProfitAnalysis {...props} onUpdateAccountGroup={save}/>);openSettings();fireEvent.click(screen.getByRole('button',{name:'업무 비용 그룹 수정'}));fireEvent.change(screen.getByLabelText('계정그룹 이름'),{target:{value:'이전 계정'}});fireEvent.click(screen.getByRole('button',{name:'계정그룹 수정 저장'}));testAuth.currentUser.uid='account-other';view.rerender(<ProfitAnalysis {...props} onUpdateAccountGroup={save}/>);fireEvent.click(screen.getByRole('button',{name:'자산 그룹 그룹 수정'}));fireEvent.change(screen.getByLabelText('계정그룹 이름'),{target:{value:'새 계정 초안'}});await act(async()=>pending.resolve({status:'saved'}));expect(screen.getByLabelText('계정그룹 이름')).toHaveValue('새 계정 초안');
});

it('그룹 이동 미확인 뒤 선택한 그룹을 표시하고 원래 그룹으로 돌려 명시 저장한다',async()=>{
 const save=vi.fn().mockResolvedValueOnce({status:'unknown',message:'그룹 변경 미확인',nextAction:'다시 저장하면 선택한 그룹으로 저장됩니다.'}).mockResolvedValue({status:'saved'});render(<ProfitAnalysis {...props} onUpdateAccountCode={save}/>);openSettings();fireEvent.change(screen.getByRole('combobox',{name:'업무비 계정 그룹'}),{target:{value:'asset'}});await screen.findByRole('button',{name:'같은 입력 다시 저장'});expect(screen.getByRole('combobox',{name:'수정 계정 그룹'})).toHaveValue('asset');fireEvent.change(screen.getByRole('combobox',{name:'수정 계정 그룹'}),{target:{value:'expense'}});fireEvent.click(screen.getByRole('button',{name:'계정과목 수정 저장'}));await waitFor(()=>expect(screen.queryByPlaceholderText('계정명')).toBeNull());expect(save.mock.calls.map(call=>call.slice(0,2))).toEqual([[code.id,{groupId:'asset'}],[code.id,{groupId:'expense'}]]);
});

it('이름이 비어 있는 기존 계정의 그룹 이동은 이름 검증 없이 그룹만 저장한다',async()=>{
 const save=vi.fn().mockResolvedValue({status:'saved'}),legacy={...code,id:'legacy-empty',code:'702',name:''};render(<ProfitAnalysis {...props} accountCodes={[legacy]} onUpdateAccountCode={save}/>);openSettings();fireEvent.change(screen.getByRole('combobox',{name:'702 계정 그룹'}),{target:{value:'asset'}});await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(save).toHaveBeenCalledWith('legacy-empty',{groupId:'asset'},expect.objectContaining({companyId:'taebaek',actorUid:'account-actor'}));expect(screen.queryByPlaceholderText('계정명')).toBeNull();expect(screen.queryByPlaceholderText('코드')).toBeNull();
});
