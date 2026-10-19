/** @vitest-environment jsdom */
import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import StatementCompanyDialog from './StatementCompanyDialog';
const testAuth=vi.hoisted(()=>({currentUser:{uid:'company-actor'}}));
vi.mock('../../../shared/firebase',()=>({auth:testAuth}));
beforeEach(()=>{testAuth.currentUser.uid='company-actor';});
const initial={name:'태백식품',ceoName:'임',bizNo:'1',bizType:'제조',bizItem:'식품',address:'옛 주소',phone:'1',adminPassword:'비표시 원문'};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
const scope={companyId:'taebaek' as const,actorUid:'company-actor'};
describe('전표 회사정보 설정 창',()=>{
 it('변경한 표시 항목만 전송하고 ACK 전에는 유지한 뒤 한 번 닫는다',async()=>{
  const gate=deferred<void>(),save=vi.fn(()=>gate.promise),close=vi.fn();render(<StatementCompanyDialog {...scope} initial={initial} onSave={save} onClose={close}/>);
  fireEvent.change(screen.getByLabelText('사업장 주소'),{target:{value:'새 주소'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));
  expect(save).toHaveBeenCalledWith({address:'새 주소'});expect(close).not.toHaveBeenCalled();expect(screen.getByLabelText('사업장 주소')).toBeDisabled();expect(screen.getByRole('button',{name:'저장 중…'})).toBeDisabled();
  await act(async()=>gate.resolve());expect(close).toHaveBeenCalledOnce();
 });
 it('옛 태백 계좌 fallback은 표시만 하고 다른 변경에 섞어 보내지 않는다',async()=>{
  const save=vi.fn(),close=vi.fn();render(<StatementCompanyDialog {...scope} initial={{name:'태백식품',ceoName:'임기주',bizNo:'139-04-37157',bizType:'제조 도소매',bizItem:'참기름 외',address:'안산'}} onSave={save} onClose={close}/>);
  expect(screen.getByLabelText('계좌번호')).toHaveValue('농협 351-0526-3164-13 ; 임기주(태백식품)');expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('전화번호'),{target:{value:'새 전화'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(save).toHaveBeenCalledWith({phone:'새 전화'});
 });
 it('응답 미확인은 입력과 원인을 보존하고 같은 입력 재저장 또는 수정 저장을 명시한다',async()=>{
  const save=vi.fn().mockRejectedValueOnce(new Error('응답 유실')).mockResolvedValue(undefined),close=vi.fn();render(<StatementCompanyDialog {...scope} initial={initial} onSave={save} onClose={close}/>);
  fireEvent.change(screen.getByLabelText('사업장 주소'),{target:{value:'미확인 주소'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));const retry=await screen.findByRole('button',{name:'같은 입력 다시 저장'});expect(screen.getByRole('status')).toHaveTextContent(/다시/);expect(close).not.toHaveBeenCalled();expect(screen.getByLabelText('사업장 주소')).toHaveValue('미확인 주소');
  fireEvent.click(retry);await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(save.mock.calls).toEqual([[{address:'미확인 주소'}],[{address:'미확인 주소'}]]);
 });
 it('은행 입력을 지우면 명시 빈문자열만 보내고 외부 구독으로 초안을 덮지 않는다',async()=>{
  const save=vi.fn(),close=vi.fn(),view=render(<StatementCompanyDialog {...scope} initial={{...initial,bankAccount:'기존 계좌'}} onSave={save} onClose={close}/>);
  fireEvent.change(screen.getByLabelText('계좌번호'),{target:{value:''}});view.rerender(<StatementCompanyDialog {...scope} initial={{...initial,bankAccount:'외부 갱신 계좌'}} onSave={save} onClose={close}/>);expect(screen.getByLabelText('계좌번호')).toHaveValue('');fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(save).toHaveBeenCalledWith({bankAccount:''});
 });
 it('저장 포트가 없으면 값을 바꿔도 성공으로 닫지 않는다',()=>{
  const close=vi.fn();render(<StatementCompanyDialog {...scope} initial={initial} onClose={close}/>);fireEvent.change(screen.getByLabelText('사업장 주소'),{target:{value:'새 주소'}});const save=screen.getByRole('button',{name:'저장'});expect(save).toBeDisabled();expect(screen.getByRole('status')).toHaveTextContent(/저장/);fireEvent.click(save);expect(close).not.toHaveBeenCalled();
 });
 it('저장 중 명시 닫기는 송신 취소를 주장하지 않고 늦은 ACK가 새 창을 닫지 않는다',async()=>{
  const gate=deferred<void>(),close=vi.fn(),view=render(<StatementCompanyDialog key="first" {...scope} initial={initial} onSave={()=>gate.promise} onClose={close}/>);fireEvent.change(screen.getByLabelText('사업장 주소'),{target:{value:'옛 입력'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));expect(screen.getByRole('status')).toHaveTextContent('취소되지 않습니다');fireEvent.click(screen.getByRole('button',{name:'닫기'}));expect(close).toHaveBeenCalledOnce();
  view.rerender(<StatementCompanyDialog key="second" {...scope} initial={initial} onSave={vi.fn()} onClose={close}/>);fireEvent.change(screen.getByLabelText('사업장 주소'),{target:{value:'새 창 입력'}});await act(async()=>gate.resolve());expect(close).toHaveBeenCalledOnce();expect(screen.getByLabelText('사업장 주소')).toHaveValue('새 창 입력');
 });
});
 it('미확인 송신 뒤 원래 값으로 되돌려도 서버에 그 값을 명시해 저장할 수 있다',async()=>{
  const save=vi.fn().mockRejectedValueOnce(new Error('응답 유실')).mockResolvedValue(undefined),close=vi.fn();render(<StatementCompanyDialog {...scope} initial={initial} onSave={save} onClose={close}/>);
  fireEvent.change(screen.getByLabelText('상호 (회사명)'),{target:{value:'미확인 새 상호'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await screen.findByRole('button',{name:'같은 입력 다시 저장'});
  fireEvent.change(screen.getByLabelText('상호 (회사명)'),{target:{value:initial.name}});const saveOriginal=screen.getByRole('button',{name:'저장'});expect(saveOriginal).toBeEnabled();fireEvent.click(saveOriginal);await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(save.mock.calls).toEqual([[{name:'미확인 새 상호'}],[{name:initial.name}]]);
 });

 it('로그인 UID가 맞지 않으면 저장 불가 원인을 보이고 전송하지 않는다',()=>{
  const save=vi.fn();render(<StatementCompanyDialog {...scope} actorUid="other-actor" initial={initial} onSave={save} onClose={vi.fn()}/>);fireEvent.change(screen.getByLabelText('사업장 주소'),{target:{value:'새 주소'}});expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();expect(screen.getByRole('status')).toHaveTextContent(/로그인/);expect(save).not.toHaveBeenCalled();
 });
