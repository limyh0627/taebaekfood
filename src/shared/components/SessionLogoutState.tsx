import React from 'react';
import ActionButton from './ActionButton';

export interface SessionLogoutStateProps {
  state: 'pending' | 'failed';
  error: string;
  onRetry: () => void;
}

export default function SessionLogoutState({ state, error, onRetry }: SessionLogoutStateProps) {
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
