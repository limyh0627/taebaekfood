import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../src/shared/firebase';
import { askHelp, helpChatError, type HelpChatResponse, type HelpChatScope } from '../src/shared/services/helpChatService';

export interface HelpChatProps extends HelpChatScope { currentView?: string; onClose: () => void; onNavigate?: (navId: string) => void | boolean }
type Turn = { question: string; response: HelpChatResponse };
export default function HelpChat({ companyId, userId, mode, currentView, onClose, onNavigate }: HelpChatProps) {
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [navigationNotice,setNavigationNotice]=useState('');
  const generation = useRef(0);
  const inFlight = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null);
  const scope = `${companyId}:${userId}:${mode}:${currentView ?? ''}`;
  const [displayScope, setDisplayScope] = useState(scope);
  const sameDisplayScope = displayScope === scope;
  const liveScope = useRef(scope);
  liveScope.current = scope;
  const clear = () => { generation.current++; inFlight.current = false; setDisplayScope(scope); setBusy(false); setError(''); setNavigationNotice(''); setQuestion(''); setTurns([]); };
  useEffect(() => {
    return () => previousFocus.current?.focus();
  }, []);
  useEffect(() => { clear(); input.current?.focus(); return () => { generation.current++; inFlight.current = false; }; }, [scope]);
  useEffect(() => onAuthStateChanged(auth, user => { if (user?.uid !== userId) clear(); }), [userId]);
  // 비활성화한 입력·전송 버튼은 초점을 잃으므로 DOM 갱신 후 유효한 조작으로 옮긴다.
  useLayoutEffect(() => { if (busy) closeButton.current?.focus(); else input.current?.focus(); }, [busy]);
  const close = () => { generation.current++; onClose(); };
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlight.current || !question.trim()) return;
    inFlight.current = true;
    const ticket = ++generation.current;
    const sentScope = scope;
    const sentQuestion = question.trim();
    setBusy(true); setError('');
    // 최근 대화만 보내며 긴 이전 답변은 다음 질문의 입력 한도 안으로 줄인다.
    const history = turns.slice(-3).flatMap(turn => [{ role: 'user' as const, text: turn.question.slice(0, 2000) }, { role: 'assistant' as const, text: turn.response.answer.slice(0, 2000) }]);
    while (history.length && history.reduce((sum, message) => sum + message.text.length, sentQuestion.length) > 8000) history.splice(0, 2);
    const current = () => ticket === generation.current && sentScope === liveScope.current;
    try {
      const response = await askHelp({ question: sentQuestion, history, mode, ...(currentView ? { currentView } : {}) }, { companyId, userId, mode });
      if (!current()) return;
      setTurns(old => [...old.slice(-19), { question: sentQuestion, response }]); setQuestion('');
    } catch (failure) { if (current()) setError(helpChatError(failure)); }
    finally { if (current()) { inFlight.current = false; setBusy(false); } }
  };
  const keyboard = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key !== 'Tab') return;
    event.stopPropagation();
    const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []);
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  return <div className="fixed inset-0 z-[2110] flex items-center justify-center bg-black/30 p-3" style={{zIndex:2110}} onKeyDown={keyboard}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="help-chat-title" className="flex max-h-[90dvh] w-full max-w-xl flex-col rounded-xl border border-slate-200 bg-white text-slate-800 shadow-lg">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 p-4"><h2 id="help-chat-title" className="font-bold">사용법 도움말</h2><div className="flex gap-3"><button type="button" onClick={clear} className="text-sm underline">대화 비우기</button><button ref={closeButton} type="button" onClick={close} aria-label="도움말 닫기">닫기</button></div></header>
      <div className="overflow-y-auto p-4 space-y-4"><p className="text-sm text-slate-600">앱 사용법과 오류 복구를 AI가 안내합니다. 회사의 주문·재고·금액은 조회하지 않습니다. 입력한 질문과 최근 대화는 답변을 위해 AI 서버로 전송됩니다.</p>
        {(!sameDisplayScope || turns.length === 0) && <p className="text-sm">예: 전표 저장에 실패하면 어떻게 하나요?</p>}
        <div aria-live="polite" className="space-y-4">{sameDisplayScope && turns.map((turn, index) => <section key={index} className="border-t border-slate-200 pt-3"><p className="whitespace-pre-wrap break-words font-semibold">{turn.question}</p><p className="mt-2 whitespace-pre-wrap break-words">{turn.response.answer}</p>{turn.response.sources.length > 0 && <ul aria-label="안내 근거" className="mt-2 space-y-1 text-sm">{turn.response.sources.map(source => <li key={source.id}>{source.navId && onNavigate ? <button type="button" className="underline" onClick={() => { if(onNavigate(source.navId!)===false){setNavigationNotice('현재 열려 있는 창을 유지했습니다. 관련 메뉴로 이동하려면 그 창을 마친 뒤 다시 선택해 주세요.');return;}generation.current++;setNavigationNotice(''); }}>{source.title} 열기</button> : source.title}</li>)}</ul>}</section>)}</div>
        {sameDisplayScope && error && <p role="alert" className="text-sm">{error}</p>}
        {sameDisplayScope && navigationNotice && <p role="status" className="text-sm">{navigationNotice}</p>}
      </div>
      <form onSubmit={send} className="border-t border-slate-200 p-4"><label htmlFor="help-chat-question" className="text-sm font-semibold">질문</label><textarea ref={input} id="help-chat-question" rows={3} maxLength={2000} value={sameDisplayScope ? question : ''} disabled={busy && sameDisplayScope} onChange={event => { setQuestion(event.target.value); setError(''); }} className="mt-2 w-full rounded border border-slate-300 p-2" placeholder="앱에서 하려는 작업을 적어 주세요" /><div className="mt-2 flex items-center justify-between gap-3"><span className="text-xs text-slate-500">{sameDisplayScope ? question.length : 0}/2000</span><button type="submit" disabled={!sameDisplayScope || busy || !question.trim()} className="rounded border border-slate-300 px-4 py-2 disabled:opacity-50">{busy ? '답변 중…' : error ? '다시 시도' : '질문 보내기'}</button></div></form>
    </div>
  </div>;
}
