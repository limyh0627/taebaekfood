/** @vitest-environment jsdom */
import React from 'react';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import StatementCompanyDialog,{type StatementCompanyDialogProps} from './StatementCompanyDialog';
import {companyInfoOpening,type CompanyInfoReference} from '../../../shared/companyInfoCommand';
import type {CompanyInfoOperationEntry,CompanyInfoOutcome} from '../infrastructure/companyInfoWrites';
const testAuth=vi.hoisted(()=>({currentUser:{uid:'company-actor'}}));
vi.mock('../../../shared/firebase',()=>({auth:testAuth}));
beforeEach(()=>{testAuth.currentUser.uid='company-actor';});
const initial={name:'태백식품',ceoName:'임',bizNo:'1',bizType:'제조',bizItem:'식품',address:'옛 주소',phone:'1',adminPassword:'비표시 원문'};
const saved={status:'saved',requestFinalized:true} as const;
const scope={companyId:'taebaek' as const,actorUid:'company-actor'};
const open:NonNullable<StatementCompanyDialogProps['onOpenCompanyInfo']>=async(row,context)=>({reference:{companyId:context.companyId,planId:context.planId},actorUid:context.actorUid,opening:companyInfoOpening(row),expectedVersion:'1:000000001'});
const ports={onOpenCompanyInfo:open,onReadCompanyInfoOperations:async()=>[]};
const ready=()=>act(async()=>{await Promise.resolve();});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
function entry(reference:CompanyInfoReference,raw='관측 A'):CompanyInfoOperationEntry{return {key:reference.planId,reference,status:'valid',description:'회사정보 보관 원문',observedLocalText:raw,observedReferenceText:'참조 원문'};}
describe('전표 회사정보 설정 창',()=>{
 it('변경한 표시 항목만 전송하고 ACK 전에는 유지한 뒤 한 번 닫는다',async()=>{
  const gate=deferred<CompanyInfoOutcome>(),save=vi.fn(()=>gate.promise),close=vi.fn();render(<StatementCompanyDialog {...scope} {...ports} initial={initial} onSave={save} onClose={close}/>);await ready();
  fireEvent.change(screen.getByLabelText('사업장 주소'),{target:{value:'새 주소'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));
  expect(save).toHaveBeenCalledWith({address:'새 주소'},expect.objectContaining({opening:expect.objectContaining({opening:companyInfoOpening(initial)}),planId:expect.any(String)}));expect(close).not.toHaveBeenCalled();expect(screen.getByLabelText('사업장 주소')).toBeDisabled();expect(screen.getByRole('button',{name:'저장 중…'})).toBeDisabled();expect(screen.queryByDisplayValue(initial.adminPassword)).toBeNull();
  await act(async()=>gate.resolve(saved));expect(close).toHaveBeenCalledOnce();
 });
 it('옛 태백 계좌 fallback은 표시만 하고 다른 변경에 섞어 보내지 않는다',async()=>{
  const raw={name:'태백식품',ceoName:'임기주',bizNo:'139-04-37157',bizType:'제조 도소매',bizItem:'참기름 외',address:'안산'},save=vi.fn().mockResolvedValue(saved),close=vi.fn(),capture=vi.fn(open);render(<StatementCompanyDialog {...scope} {...ports} onOpenCompanyInfo={capture} initial={raw} onSave={save} onClose={close}/>);await ready();
  expect(screen.getByLabelText('계좌번호')).toHaveValue('농협 351-0526-3164-13 ; 임기주(태백식품)');expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();expect(capture.mock.calls[0][0]).not.toHaveProperty('bankAccount');
  fireEvent.change(screen.getByLabelText('전화번호'),{target:{value:'새 전화'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(save.mock.calls[0][0]).toEqual({phone:'새 전화'});
 });
 it('응답 미확인은 입력과 원인을 보존하고 같은 원문 요청만 명시 재시도한다',async()=>{
  let rows:CompanyInfoOperationEntry[]=[];const save=vi.fn<NonNullable<StatementCompanyDialogProps['onSave']>>(async(_patch,context)=>{rows=[entry({companyId:context.companyId,planId:context.planId})];return {status:'unknown',message:'응답 유실',nextAction:'같은 요청의 결과를 확인해 주세요.'};}),retry=vi.fn(async()=>{rows=[];return saved;}),close=vi.fn();
  render(<StatementCompanyDialog {...scope} {...ports} onReadCompanyInfoOperations={async()=>rows} onRetryCompanyInfoOperation={retry} initial={initial} onSave={save} onClose={close}/>);await ready();
  fireEvent.change(screen.getByLabelText('사업장 주소'),{target:{value:'미확인 주소'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));const button=await screen.findByRole('button',{name:'같은 요청 재시도'});expect(screen.getByRole('status')).toHaveTextContent('응답 유실');expect(close).not.toHaveBeenCalled();expect(screen.getByLabelText('사업장 주소')).toHaveValue('미확인 주소');expect(screen.getByLabelText('사업장 주소')).toBeDisabled();
  fireEvent.click(button);await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(save).toHaveBeenCalledOnce();expect(save.mock.calls[0][0]).toEqual({address:'미확인 주소'});expect(retry).toHaveBeenCalledWith(expect.objectContaining({planId:save.mock.calls[0][1].planId}),expect.any(Object));
 });
 it('은행 입력을 지우면 명시 빈문자열만 보내고 외부 구독으로 초안을 덮지 않는다',async()=>{
  const save=vi.fn().mockResolvedValue(saved),close=vi.fn(),view=render(<StatementCompanyDialog {...scope} {...ports} initial={{...initial,bankAccount:'기존 계좌'}} onSave={save} onClose={close}/>);await ready();
  fireEvent.change(screen.getByLabelText('계좌번호'),{target:{value:''}});view.rerender(<StatementCompanyDialog {...scope} {...ports} initial={{...initial,bankAccount:'외부 갱신 계좌'}} onSave={save} onClose={close}/>);expect(screen.getByLabelText('계좌번호')).toHaveValue('');fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(save.mock.calls[0][0]).toEqual({bankAccount:''});
 });
 it('저장 포트가 없으면 값을 바꿔도 성공으로 닫지 않는다',async()=>{
  const close=vi.fn();render(<StatementCompanyDialog {...scope} {...ports} initial={initial} onClose={close}/>);await ready();fireEvent.change(screen.getByLabelText('사업장 주소'),{target:{value:'새 주소'}});expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();expect(screen.getByRole('status')).toHaveTextContent(/저장/);expect(close).not.toHaveBeenCalled();
 });
 it('저장 중 명시 닫기는 송신 취소를 주장하지 않고 늦은 ACK가 새 창을 닫지 않는다',async()=>{
  const gate=deferred<CompanyInfoOutcome>(),close=vi.fn(),view=render(<StatementCompanyDialog key="first" {...scope} {...ports} initial={initial} onSave={()=>gate.promise} onClose={close}/>);await ready();fireEvent.change(screen.getByLabelText('사업장 주소'),{target:{value:'옛 입력'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));expect(screen.getByRole('status')).toHaveTextContent('취소되지 않습니다');fireEvent.click(screen.getByRole('button',{name:'보기 닫기'}));expect(close).toHaveBeenCalledOnce();
  view.rerender(<StatementCompanyDialog key="second" {...scope} {...ports} initial={initial} onSave={vi.fn().mockResolvedValue(saved)} onClose={close}/>);await ready();fireEvent.change(screen.getByLabelText('사업장 주소'),{target:{value:'새 창 입력'}});await act(async()=>gate.resolve(saved));expect(close).toHaveBeenCalledOnce();expect(screen.getByLabelText('사업장 주소')).toHaveValue('새 창 입력');
 });
 it('미확인 송신의 실제 완료 뒤 현재 값으로 다시 열어 원래 값 복귀를 새 요청으로 저장한다',async()=>{
  let rows:CompanyInfoOperationEntry[]=[];const close=vi.fn(),save=vi.fn<NonNullable<StatementCompanyDialogProps['onSave']>>(async(_patch,context)=>{if(save.mock.calls.length===1){rows=[entry({companyId:context.companyId,planId:context.planId})];return {status:'unknown',message:'응답 유실',nextAction:'결과 확인'};}return saved;}),inspect=vi.fn(async()=>{rows=[];return saved;});
  const view=render(<StatementCompanyDialog key="first" {...scope} {...ports} onReadCompanyInfoOperations={async()=>rows} onInspectCompanyInfoOperation={inspect} initial={initial} onSave={save} onClose={close}/>);await ready();fireEvent.change(screen.getByLabelText('상호 (회사명)'),{target:{value:'미확인 새 상호'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));fireEvent.click(await screen.findByRole('button',{name:'결과 확인'}));await waitFor(()=>expect(close).toHaveBeenCalledOnce());
  view.rerender(<StatementCompanyDialog key="second" {...scope} {...ports} initial={{...initial,name:'미확인 새 상호'}} onSave={save} onClose={close}/>);await ready();fireEvent.change(screen.getByLabelText('상호 (회사명)'),{target:{value:initial.name}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(close).toHaveBeenCalledTimes(2));expect(save.mock.calls.map(call=>call[0])).toEqual([{name:'미확인 새 상호'},{name:initial.name}]);expect(save.mock.calls[0][1].planId).not.toBe(save.mock.calls[1][1].planId);
 });
 it('로그인 UID가 맞지 않으면 저장 불가 원인을 보이고 전송하지 않는다',async()=>{
  const save=vi.fn();render(<StatementCompanyDialog {...scope} {...ports} actorUid="other-actor" initial={initial} onSave={save} onClose={vi.fn()}/>);await ready();expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();expect(screen.getByRole('status')).toHaveTextContent(/로그인/);expect(save).not.toHaveBeenCalled();
 });
});
it('명시 이력 조회는 빈 페이지 cursor를 보존하고 과거 완료로 현재 초안을 닫지 않는다',async()=>{
 const ref={companyId:'taebaek' as const,planId:'old'},result={version:1 as const,reference:ref,actorUid:scope.actorUid,status:'applied' as const,requestHash:'a'.repeat(64),message:'과거 저장 완료'},history=vi.fn<NonNullable<StatementCompanyDialogProps['onListCompanyInfoHistory']>>().mockResolvedValueOnce({version:1,companyId:'taebaek',actorUid:scope.actorUid,entries:[],nextCursor:'a'.repeat(64)}).mockResolvedValue({version:1,companyId:'taebaek',actorUid:scope.actorUid,entries:[{result,createdAt:'2026-10-19T00:00:00.000Z'}],nextCursor:null}),close=vi.fn(),inspect=vi.fn().mockResolvedValue(saved);
 render(<StatementCompanyDialog {...scope} {...ports} initial={initial} onSave={vi.fn().mockResolvedValue(saved)} onListCompanyInfoHistory={history} onInspectCompanyInfoOperation={inspect} onClose={close}/>);await ready();expect(history).not.toHaveBeenCalled();fireEvent.change(screen.getByLabelText('사업장 주소'),{target:{value:'새 초안'}});fireEvent.click(screen.getByRole('button',{name:'서버 처리 이력 확인'}));fireEvent.click(await screen.findByRole('button',{name:'다음 이력 확인'}));fireEvent.click(await screen.findByRole('button',{name:'이 요청 결과 확인'}));await waitFor(()=>expect(inspect).toHaveBeenCalled());expect(screen.getByLabelText('사업장 주소')).toHaveValue('새 초안');expect(close).not.toHaveBeenCalled();expect(history.mock.calls[1][1]).toBe('a'.repeat(64));
});
it('손상 사본은 관측 raw만 명시 정리하며 업무 저장이나 현재 초안을 종결하지 않는다',async()=>{
 const ref={companyId:'taebaek' as const,planId:'damaged'},row={...entry(ref),status:'corrupt' as const},discard=vi.fn().mockResolvedValue({status:'saved'}),save=vi.fn().mockResolvedValue(saved),close=vi.fn();
 render(<StatementCompanyDialog {...scope} {...ports} onReadCompanyInfoOperations={async()=>[row]} onDiscardCompanyInfoCopy={discard} initial={initial} onSave={save} onClose={close}/>);await ready();fireEvent.change(screen.getByLabelText('사업장 주소'),{target:{value:'새 초안'}});const region=screen.getByRole('region',{name:'회사정보 요청 복구'});expect(within(region).queryByRole('button',{name:'같은 요청 재시도'})).toBeNull();fireEvent.click(within(region).getByRole('button',{name:'이 기기 사본 정리'}));await waitFor(()=>expect(discard).toHaveBeenCalledWith(ref,'관측 A','참조 원문',expect.any(Object)));expect(screen.getByLabelText('사업장 주소')).toHaveValue('새 초안');expect(close).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
});
it('확정 거절 뒤에는 외부 구독으로 초안을 덮지 않고 명시 현재 값 재열기에서만 새 원문을 잡는다',async()=>{
 const capture=vi.fn(open),save=vi.fn().mockResolvedValue({status:'rejected',requestFinalized:true,requiresReopen:true,message:'선택 뒤 회사정보가 바뀌었습니다.',nextAction:'현재 값으로 다시 열어 주세요.'}),close=vi.fn();
 const view=render(<StatementCompanyDialog {...scope} {...ports} onOpenCompanyInfo={capture} initial={initial} onSave={save} onClose={close}/>);await ready();fireEvent.change(screen.getByLabelText('사업장 주소'),{target:{value:'기존 초안'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await screen.findByText(/선택 뒤 회사정보가 바뀌었습니다/);
 view.rerender(<StatementCompanyDialog {...scope} {...ports} onOpenCompanyInfo={capture} initial={{...initial,address:'실제 최신 주소'}} onSave={save} onClose={close}/>);expect(screen.getByLabelText('사업장 주소')).toHaveValue('기존 초안');
 fireEvent.click(screen.getByRole('button',{name:'현재 값으로 다시 열기'}));await waitFor(()=>expect(screen.getByLabelText('사업장 주소')).toHaveValue('실제 최신 주소'));expect(capture).toHaveBeenCalledTimes(2);expect(save).toHaveBeenCalledOnce();expect(close).not.toHaveBeenCalled();
});
it('업무 ACK 후 사본 정리가 미확정인 partial은 창과 원문을 유지하고 같은 요청 확인으로만 종결한다',async()=>{
 let rows:CompanyInfoOperationEntry[]=[];const save=vi.fn<NonNullable<StatementCompanyDialogProps['onSave']>>(async(_patch,context)=>{rows=[entry({companyId:context.companyId,planId:context.planId})];return {status:'partial',reason:'followup-unconfirmed',committedIds:['taebaek'],unconfirmedIds:[],message:'저장은 완료됐지만 사본 정리를 확인하지 못했습니다.',nextAction:'같은 요청의 결과를 확인해 남은 사본만 정리해 주세요.'};}),inspect=vi.fn(async()=>{rows=[];return saved;}),close=vi.fn();
 render(<StatementCompanyDialog {...scope} {...ports} onReadCompanyInfoOperations={async()=>rows} onInspectCompanyInfoOperation={inspect} initial={initial} onSave={save} onClose={close}/>);await ready();fireEvent.change(screen.getByLabelText('사업장 주소'),{target:{value:'사본 보존 주소'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));const button=await screen.findByRole('button',{name:'결과 확인'});expect(screen.getByLabelText('사업장 주소')).toHaveValue('사본 보존 주소');expect(screen.getByLabelText('사업장 주소')).toBeDisabled();expect(close).not.toHaveBeenCalled();
 fireEvent.click(button);await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(save).toHaveBeenCalledOnce();
});

it('본문없는 참조 사본도 화면에서 관측한 A를 넘겨 클릭 전 바뀐 B를 정리하지 않는다',async()=>{
 const ref={companyId:'taebaek' as const,planId:'only-reference'};
 let rows:CompanyInfoOperationEntry[]=[{key:'sidecar',reference:ref,status:'missing',description:'참조 사본 A',observedLocalText:null,observedReferenceText:'참조 A'}];
 const discard=vi.fn().mockResolvedValue({status:'rejected',message:'관측한 참조 사본이 바뀌어 정리하지 않았습니다.'}),close=vi.fn();
 render(<StatementCompanyDialog {...scope} {...ports} onReadCompanyInfoOperations={async()=>rows} onDiscardCompanyInfoCopy={discard} initial={initial} onSave={vi.fn().mockResolvedValue(saved)} onClose={close}/>);await ready();
 const button=screen.getByRole('button',{name:'이 기기 사본 정리'});rows=[{...rows[0],description:'참조 사본 B',observedReferenceText:'참조 B'}];fireEvent.click(button);
 await waitFor(()=>expect(discard).toHaveBeenCalledWith(ref,null,'참조 A',expect.any(Object)));expect(close).not.toHaveBeenCalled();expect(screen.getByRole('status')).toHaveTextContent('정리하지 않았습니다');
});
it('미확인 저장 뒤 서버 이력 0건을 조회하면 원인과 조회 완료·미처리 확정 아님을 함께 표시한다',async()=>{
 let rows:CompanyInfoOperationEntry[]=[];const save=vi.fn<NonNullable<StatementCompanyDialogProps['onSave']>>(async(_patch,context)=>{rows=[entry({companyId:context.companyId,planId:context.planId})];return {status:'unknown',message:'저장 응답을 확인하지 못했습니다.',nextAction:'같은 요청 결과를 확인해 주세요.'};});
 const history=vi.fn<NonNullable<StatementCompanyDialogProps['onListCompanyInfoHistory']>>().mockResolvedValue({version:1,companyId:'taebaek',actorUid:scope.actorUid,entries:[],nextCursor:null});
 render(<StatementCompanyDialog {...scope} {...ports} onReadCompanyInfoOperations={async()=>rows} onSave={save} onListCompanyInfoHistory={history} initial={initial} onClose={vi.fn()}/>);await ready();fireEvent.change(screen.getByLabelText('사업장 주소'),{target:{value:'미확인 주소'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await screen.findByRole('button',{name:'결과 확인'});fireEvent.click(screen.getByRole('button',{name:'서버 처리 이력 확인'}));
 await screen.findByText(/이번 조회에서 0건을 확인했습니다/);expect(screen.getByText(/저장 응답을 확인하지 못했습니다/)).toBeInTheDocument();expect(screen.getByText(/조회 목록이 없다고 미처리로 확정할 수는 없습니다/)).toBeInTheDocument();expect(screen.getByLabelText('사업장 주소')).toHaveValue('미확인 주소');expect(save).toHaveBeenCalledOnce();
});
