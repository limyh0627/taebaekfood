import React from 'react';
import { usingFirebaseEmulators } from '../firebase';

/** 운영 화면과 혼동해 실제 주문을 잘못 넣지 않도록 테스트 모드를 항상 표시한다. */
export default function LocalTestBanner() {
  if (!usingFirebaseEmulators) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[9999] flex h-7 items-center justify-center bg-amber-400 px-3 text-[11px] font-black text-amber-950 shadow-sm">
      로컬 테스트 · 운영 DB 미연결
    </div>
  );
}
