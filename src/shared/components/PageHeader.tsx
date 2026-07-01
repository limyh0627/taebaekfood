import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, right }) => (
  <div className="flex flex-col gap-2.5 pb-3 sm:pb-4 sm:border-b border-slate-200">
    {/* 모바일은 상단 앱바에 화면 제목이 이미 있어 여기선 숨김 */}
    <div className="min-w-0 hidden sm:block">
      <h2 className="text-base sm:text-lg font-black text-slate-800 leading-tight truncate">{title}</h2>
      {subtitle && <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5 truncate">{subtitle}</p>}
    </div>
    {right && (
      <div className="flex items-center gap-2 flex-wrap sm:justify-end -mb-1 pb-1 overflow-x-auto sm:overflow-visible no-scrollbar">
        {right}
      </div>
    )}
  </div>
);

export default PageHeader;
