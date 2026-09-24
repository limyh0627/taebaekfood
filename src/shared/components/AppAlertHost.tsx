import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import AlertModalShell, { alertToneClass, type AlertTone } from './AlertModalShell';

interface AppAlert {
  id: number;
  title: string;
  message: string;
  tone: AlertTone;
}

const classify = (message: string): Omit<AppAlert, 'id' | 'message'> => {
  if (/실패|오류|못했|없습니다|필요합니다|주의|경고/.test(message)) return { title: '확인 필요', tone: 'rose' };
  if (/완료|저장했|처리했|성공/.test(message)) return { title: '처리 완료', tone: 'emerald' };
  return { title: '알림', tone: 'indigo' };
};

/** 기존 브라우저 alert까지 앱 안의 같은 알림창으로 받는다. */
const AppAlertHost: React.FC = () => {
  const [queue, setQueue] = useState<AppAlert[]>([]);
  const sequence = useRef(0);
  const dismissed = useRef(new WeakSet<AppAlert>());
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (advanceTimer.current) clearTimeout(advanceTimer.current); }, []);
  const current = queue[0];
  const close = () => {
    if (!current || dismissed.current.has(current)) return;
    dismissed.current.add(current);
    // 다음 알림이 첫 알림의 더블클릭으로 사라지지 않도록 전환을 잠시 늦춘다.
    advanceTimer.current = setTimeout(() => {
      setQueue(items => items[0] === current ? items.slice(1) : items);
      advanceTimer.current = null;
    }, 300);
  };

  useEffect(() => {
    const nativeAlert = window.alert.bind(window);
    window.alert = (value?: unknown) => {
      const message = String(value ?? '');
      const style = classify(message);
      setQueue(current => [...current, { id: ++sequence.current, message, ...style }]);
    };
    return () => { window.alert = nativeAlert; };
  }, []);

  if (!current) return null;
  const Icon = current.tone === 'rose' ? AlertCircle : current.tone === 'emerald' ? CheckCircle2 : Info;
  const toneClass = alertToneClass(current.tone);
  return (
    <AlertModalShell
      title={current.title}
      tone={current.tone}
      icon={Icon}
      onClose={close}
      footer={(
        <button type="button" onClick={close} className={`w-full rounded-xl py-3 text-sm font-black text-white ${toneClass.단추}`}>
          확인
        </button>
      )}
    >
      <p className="whitespace-pre-line break-words text-sm font-bold leading-6 text-slate-700">{current.message}</p>
    </AlertModalShell>
  );
};

export default AppAlertHost;
