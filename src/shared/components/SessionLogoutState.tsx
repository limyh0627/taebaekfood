import React from 'react';
import ActionButton from './ActionButton';

export interface SessionLogoutStateProps {
  state: 'pending' | 'failed' | 'checking' | 'checkpoint-failed';
  error: string;
  onRetry: () => void;
  onReturn?: () => void;
}

export default function SessionLogoutState({ state, error, onRetry,onReturn }: SessionLogoutStateProps) {
  const checkpoint=state==='checking'||state==='checkpoint-failed';
  if(checkpoint)return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/20 p-5"><section role={state==='checking'?'status':'alert'} className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-6"><h1 className="text-lg font-bold">{state==='checking'?'작업 입력 보관 중':'입력 보관 확인 필요'}</h1><p className="whitespace-pre-wrap break-words text-sm">{state==='checking'?'등록된 작업 입력을 이 기기에 보관하고 있습니다. 아직 로그아웃하지 않았습니다.':error}</p>{state==='checkpoint-failed'&&<><ActionButton onClick={onRetry}>다시 보관하고 로그아웃</ActionButton><ActionButton onClick={onReturn}>작업으로 돌아가기</ActionButton></>}</section></div>;
  const pending = state === 'pending';
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-5 py-10 font-sans text-slate-800">
      <section className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="session-logout-title">
        <div role={pending ? 'status' : 'alert'} className="space-y-3">
          <h1 id="session-logout-title" className="text-lg font-bold">
            {pending ? '로그아웃 확인 중' : '로그아웃 확인 필요'}
          </h1>
          {pending ? (
            <p className="text-sm leading-relaxed text-slate-600">로그아웃 결과를 확인하고 있습니다. 잠시 기다려 주세요.</p>
          ) : (
            <>
              <p className="text-sm leading-relaxed text-slate-600">로그아웃을 확인하지 못했습니다. 이유를 확인하고 다시 시도해 주세요.</p>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{error || '로그인 상태를 확인하지 못했습니다.'}</p>
            </>
          )}
        </div>
        {!pending && <ActionButton onClick={onRetry}>다시 로그아웃</ActionButton>}
      </section>
    </main>
  );
}
