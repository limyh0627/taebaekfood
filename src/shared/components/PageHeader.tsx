import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, right }) => (
  <div>
    {/* 제목 헤더 (구분선은 제목 아래) — 모바일(md 미만)은 상단 앱바에 제목이 있어 숨김 */}
    <div className="min-w-0 hidden md:block pb-3 md:pb-4 border-b border-slate-200">
      <h2 className="text-base md:text-lg font-black text-slate-800 leading-tight truncate">{title}</h2>
      {subtitle && <p className="text-[11px] md:text-xs text-slate-400 mt-0.5 truncate">{subtitle}</p>}
    </div>
    {/* 액션 버튼은 헤더 구분선 아래 별도 줄 */}
    {right && (
      <div className="flex items-center gap-2 flex-wrap md:justify-end md:pt-3 -mb-1 pb-1 overflow-x-auto md:overflow-visible no-scrollbar">
        {right}
      </div>
    )}
  </div>
);

export default PageHeader;
