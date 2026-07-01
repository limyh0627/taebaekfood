import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, right }) => (
  <div className="flex flex-col gap-2.5 pb-3 md:pb-4 md:border-b border-slate-200">
    {/* 모바일(md 미만)은 상단 앱바에 화면 제목이 이미 있어 여기선 숨김 — 앱바와 동일 브레이크포인트 */}
    <div className="min-w-0 hidden md:block">
      <h2 className="text-base md:text-lg font-black text-slate-800 leading-tight truncate">{title}</h2>
      {subtitle && <p className="text-[11px] md:text-xs text-slate-400 mt-0.5 truncate">{subtitle}</p>}
    </div>
    {right && (
      <div className="flex items-center gap-2 flex-wrap md:justify-end -mb-1 pb-1 overflow-x-auto md:overflow-visible no-scrollbar">
        {right}
      </div>
    )}
  </div>
);

export default PageHeader;
