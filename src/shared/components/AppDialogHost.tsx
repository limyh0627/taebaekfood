import React, { useEffect, useRef, useState } from 'react';
import ConfirmModal from './ConfirmModal';
import ModalShell from './ModalShell';
import { subscribeAppDialog, type AppDialogRequest } from './appDialog';

/** 동기 브라우저 창 대신 앱 안에서 순서대로 확인·문자 입력을 받는다. */
const AppDialogHost: React.FC = () => {
  const [queue, setQueue] = useState<AppDialogRequest[]>([]);
  const [inputState, setInputState] = useState<{ request: AppDialogRequest; value: string } | null>(null);
  const resolved = useRef(new WeakSet<AppDialogRequest>());
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => subscribeAppDialog(request => setQueue(current => [...current, request])), []);
  useEffect(() => () => { if (advanceTimer.current) clearTimeout(advanceTimer.current); }, []);

  const current = queue[0];
  const input = current?.kind === 'prompt'
    ? (inputState?.request === current ? inputState.value : current.defaultValue ?? '')
    : '';

  const finish = (value: boolean | string | null) => {
    if (!current || resolved.current.has(current)) return;
    resolved.current.add(current);
    if (current.kind === 'confirm') current.resolve(Boolean(value));
    else if (current.kind === 'notice') current.resolve();
    else current.resolve(typeof value === 'string' ? value : null);
    // 연속 물리 클릭이 다음 확인창에 닿지 않도록 이전 창을 잠시 유지한다.
    advanceTimer.current = setTimeout(() => {
      setQueue(items => items[0] === current ? items.slice(1) : items);
      advanceTimer.current = null;
    }, 300);
  };

  if (!current) return null;
  if (current.kind === 'confirm' || current.kind === 'notice') {
    return (
      <ConfirmModal
        title={current.title ?? '확인'}
        tone={current.kind === 'notice' ? 'amber' : current.tone ?? 'rose'}
        message={current.message}
        confirmOnly={current.kind === 'notice'}
        confirmText={current.kind === 'notice' ? '확인' : current.confirmText ?? '확인'}
        cancelText={current.kind === 'notice' ? undefined : current.cancelText ?? '취소'}
        onConfirm={() => finish(true)}
        onCancel={() => finish(false)}
      />
    );
  }

  return (
    <ModalShell
      title={current.title}
      onClose={() => finish(null)}
      footer={(
        <div className="flex gap-2">
          <button type="button" onClick={() => finish(null)} className="flex-1 rounded-xl bg-slate-100 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-200">취소</button>
          <button type="button" onClick={() => finish(input)} className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-black text-white hover:bg-indigo-700">{current.confirmText ?? '확인'}</button>
        </div>
      )}
    >
      {current.message && <p className="mb-3 whitespace-pre-line text-sm font-medium leading-6 text-slate-600">{current.message}</p>}
      <input
        autoFocus
        value={input}
        placeholder={current.placeholder}
        onChange={event => setInputState({ request: current, value: event.target.value })}
        onKeyDown={event => { if (event.key === 'Enter') finish(input); }}
        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
      />
    </ModalShell>
  );
};

export default AppDialogHost;
