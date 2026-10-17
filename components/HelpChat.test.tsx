/** @vitest-environment jsdom */
import React, {useState} from 'react';
import ModalShell from '../src/shared/components/ModalShell';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ ask: vi.fn(), authChange: null as null | ((user: any) => void) }));
vi.mock('../src/shared/firebase', () => ({ auth: {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_: unknown, callback: any) => { m.authChange = callback; return () => {}; } }));
vi.mock('../src/shared/services/helpChatService', () => ({ askHelp: m.ask, helpChatError: () => '연결을 확인한 뒤 다시 시도해 주세요.' }));
import HelpChat from './HelpChat';
const props = { companyId: 'taebaek', userId: 'u', mode: 'admin' as const, currentView: 'statement', onClose: vi.fn(), onNavigate: vi.fn() };
const answer = { answer: '전표 메뉴에서 확인하세요.', sources: [{ id: 'statement', title: '전표', navId: 'statement' }], knowledgeVersion: 'v1' };
const enter = () => { fireEvent.change(screen.getByLabelText('질문'), { target: { value: '전표가 실패했어요' } }); fireEvent.click(screen.getByRole('button', { name: '질문 보내기' })); };
beforeEach(() => { m.ask.mockReset(); props.onClose.mockClear(); props.onNavigate.mockClear(); });
it('모바일 폭 dialog와 AI 범위를 표시하고 빠른 중복 전송을 막는다', async () => {
  let finish!: (value: any) => void; m.ask.mockImplementation(() => new Promise(done => { finish = done; }));
  render(<HelpChat {...props} />); enter();
  fireEvent.submit(screen.getByLabelText('질문').closest('form')!);
  expect(m.ask).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('dialog')).toHaveClass('w-full');
  expect(screen.getByText(/회사의 주문·재고·금액은 조회하지 않습니다/)).toBeInTheDocument();
  await act(async () => finish(answer));
  fireEvent.click(screen.getByRole('button', { name: '전표 열기' }));
  expect(props.onNavigate).toHaveBeenCalledWith('statement');
});
it('실패한 질문을 보존하고 사용자가 다시 시도한다', async () => {
  m.ask.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(answer);
  render(<HelpChat {...props} />); enter();
  await screen.findByRole('alert');
  expect(screen.getByLabelText('질문')).toHaveValue('전표가 실패했어요');
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  await screen.findByText(answer.answer);
  expect(m.ask).toHaveBeenCalledTimes(2);
});
it.each(['company', 'user', 'mode', 'view', 'clear', 'auth'])('%s 변경 후 늦은 답변과 이전 질문을 버린다', async change => {
  let finish!: (value: any) => void; m.ask.mockImplementation(() => new Promise(done => { finish = done; }));
  const view = render(<HelpChat {...props} />); enter();
  if (change === 'clear') fireEvent.click(screen.getByRole('button', { name: '대화 비우기' }));
  else if (change === 'auth') act(() => m.authChange?.({ uid: 'other' }));
  else view.rerender(<HelpChat {...props} {...(change === 'company' ? { companyId: 'other' } : change === 'user' ? { userId: 'other' } : change === 'mode' ? { mode: 'staff' as const } : { currentView: 'orders' })} />);
  await act(async () => finish(answer));
  expect(screen.queryByText(answer.answer)).not.toBeInTheDocument();
  expect(screen.getByLabelText('질문')).toHaveValue('');
});
it('닫기와 Escape로 닫고 후행 답변을 렌더하지 않는다', async () => {
  let finish!: (value: any) => void; m.ask.mockImplementation(() => new Promise(done => { finish = done; }));
  render(<HelpChat {...props} />); enter();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(props.onClose).toHaveBeenCalledTimes(1);
  await act(async () => finish(answer));
  expect(screen.queryByText(answer.answer)).not.toBeInTheDocument();
});
it('초기화 뒤 새 질문 답변을 오래된 응답이 덮어쓰지 않는다', async () => {
  let oldFinish!: (value: any) => void;
  m.ask.mockImplementationOnce(() => new Promise(done => { oldFinish = done; })).mockResolvedValueOnce({ ...answer, answer: '새 질문 답변' });
  render(<HelpChat {...props} />); enter();
  fireEvent.click(screen.getByRole('button', { name: '대화 비우기' }));
  enter(); await screen.findByText('새 질문 답변');
  await act(async () => oldFinish(answer));
  expect(screen.queryByText(answer.answer)).not.toBeInTheDocument();
  expect(screen.getByText('새 질문 답변')).toBeInTheDocument();
});
it('답변의 HTML은 실행하지 않고 글자로만 표시한다', async () => {
  m.ask.mockResolvedValue({ ...answer, answer: '<img src=x onerror=alert(1)>' });
  render(<HelpChat {...props} />); enter();
  await screen.findByText('<img src=x onerror=alert(1)>');
  expect(screen.getByRole('dialog').querySelector('img')).toBeNull();
});
it.each(['success', 'failure'] as const)('키보드 전송의 %s 중에도 초점을 대화 안에 유지하고 입력으로 돌려준다', async result => {
  let finish!: (value: any) => void, fail!: (value: any) => void;
  m.ask.mockImplementation(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  render(<HelpChat {...props} />);
  const input = screen.getByLabelText('질문');
  fireEvent.change(input, { target: { value: '실패 복구 방법' } });
  const send = screen.getByRole('button', { name: '질문 보내기' });
  send.focus(); expect(send).toHaveFocus();
  fireEvent.submit(input.closest('form')!);
  const close = screen.getByRole('button', { name: '도움말 닫기' });
  expect(close).toHaveFocus();
  expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(close, { key: 'Tab' });
  expect(screen.getByRole('button', { name: '대화 비우기' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
  expect(close).toHaveFocus();
  await act(async () => { if (result === 'success') finish(answer); else fail(new Error('offline')); });
  expect(input).toHaveFocus(); expect(input).not.toBeDisabled();
  if (result === 'failure') expect(input).toHaveValue('실패 복구 방법');
});
it('도움말을 닫으면 열었던 버튼으로 초점을 돌려준다', () => {
  const outside = document.createElement('button'); outside.textContent = '도움말 열기'; document.body.appendChild(outside); outside.focus();
  const view = render(<HelpChat {...props} />);
  expect(screen.getByLabelText('질문')).toHaveFocus();
  view.unmount(); expect(outside).toHaveFocus(); outside.remove();
});
it('실제 작성 모달 위에서 질문·근거 차단·Escape 닫기를 해도 초안과 작성창을 보존한다',async()=>{
 const parentEscape=vi.fn(),writingClose=vi.fn(),navigate=vi.fn(()=>false);
 const rects=vi.spyOn(HTMLElement.prototype,'getClientRects').mockReturnValue([{}] as any);
 function Host(){const [open,setOpen]=useState(false);return <div onKeyDown={event=>{if(event.key==='Escape')parentEscape();}}><ModalShell title="작성창" layer={1090} onClose={writingClose}><input aria-label="작성 원문" defaultValue="보존할 초안"/></ModalShell><button onClick={()=>setOpen(true)}>공통 도움말</button>{open&&<HelpChat {...props} onClose={()=>setOpen(false)} onNavigate={navigate}/>}</div>;}
 try{
  m.ask.mockResolvedValue(answer);render(<Host/>);const writing=screen.getByLabelText('작성 원문');writing.focus();
  fireEvent.click(screen.getByRole('button',{name:'공통 도움말'}));const input=screen.getByLabelText('질문');expect(input).toHaveFocus();
  expect(screen.getByRole('dialog',{name:'사용법 도움말'}).parentElement).toHaveStyle({zIndex:2110});enter();
  fireEvent.click(await screen.findByRole('button',{name:'전표 열기'}));expect(navigate).toHaveBeenCalled();expect(screen.getByRole('status')).toHaveTextContent('현재 열려 있는 창을 유지했습니다');
  expect(writing).toHaveValue('보존할 초안');expect(writingClose).not.toHaveBeenCalled();
  fireEvent.keyDown(input,{key:'Escape'});expect(screen.queryByRole('dialog',{name:'사용법 도움말'})).toBeNull();expect(screen.getByRole('dialog',{name:'작성창'})).toBeInTheDocument();expect(writing).toHaveFocus();expect(parentEscape).not.toHaveBeenCalled();
 }finally{rects.mockRestore();}
});
it('다음 답변 대기 중 근거 이동을 거절해도 답변과 전송 상태를 정상 완료한다', async () => {
 let finish!: (value: typeof answer) => void;
 m.ask.mockResolvedValueOnce(answer).mockImplementationOnce(() => new Promise(done => { finish = done; }));
 render(<HelpChat {...props} onNavigate={() => false} />); enter();
 await screen.findByText(answer.answer); enter();
 fireEvent.click(screen.getByRole('button', { name: '전표 열기' }));
 expect(screen.getByRole('status')).toHaveTextContent('현재 열려 있는 창을 유지했습니다');
 await act(async () => finish({ ...answer, answer: '두 번째 답변' }));
 expect(screen.getByText('두 번째 답변')).toBeInTheDocument();
 expect(screen.getByLabelText('질문')).not.toBeDisabled();
 fireEvent.change(screen.getByLabelText('질문'), { target: { value: '다음 질문' } });
 expect(screen.getByRole('button', { name: '질문 보내기' })).not.toBeDisabled();
});