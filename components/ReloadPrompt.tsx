import React, { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

// 새 버전(서비스워커)이 준비되면 하단에 안내 배너. [업데이트] 누르면 즉시 갱신+새로고침.
//  · 실제 동작은 배포된 PWA에서만(서비스워커 필요). 로컬 dev에선 안 뜸.
//  · 로컬에서 '모양'만 보려면 주소 뒤에 ?pwabanner=1 붙여서 열면 강제로 표시됨.
const ReloadPrompt: React.FC = () => {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const [previewClosed, setPreviewClosed] = useState(false);

  const preview = !previewClosed && typeof location !== 'undefined' && new URLSearchParams(location.search).has('pwabanner');
  const show = needRefresh || preview;
  if (!show) return null;

  const close = () => { setNeedRefresh(false); setPreviewClosed(true); };
  const update = () => {
    if (needRefresh) {
      updateServiceWorker(true);   // 실제: 새 서비스워커 적용 + 자동 새로고침 → 새 버전 로드(배너 사라짐)
    } else {
      // 미리보기(?pwabanner=1): 파라미터를 떼고 새로고침해서 '업데이트되고 배너 사라짐'을 재현
      const url = new URL(location.href);
      url.searchParams.delete('pwabanner');
      location.replace(url.toString());
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[2000] flex justify-center px-3"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}>
      <div className="flex items-center gap-3 w-full max-w-md rounded-2xl bg-slate-900 text-white shadow-2xl px-4 py-3 animate-in fade-in slide-in-from-bottom-4 duration-300">
        <span className="flex-1 text-sm font-bold">✨ 새 버전이 나왔어요.</span>
        <button onClick={update}
          className="shrink-0 text-sm font-black px-3.5 py-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 transition-colors">업데이트</button>
        <button onClick={close} aria-label="닫기"
          className="shrink-0 p-1 text-slate-400 hover:text-white transition-colors">✕</button>
      </div>
    </div>
  );
};

export default ReloadPrompt;
