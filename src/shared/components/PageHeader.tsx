import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, right }) => (
  // 제목(글씨)과 우측 슬롯(탭)을 같은 라인에 둔다. 구분선은 그 아래.
  // 모바일은 제목이 상단 앱바에 있어 숨기되, right(탭)가 있으면 그 라인에 탭만 표시.
  // right가 없으면 모바일에선 헤더 전체 숨김(빈 공간 방지).
  <div className={`items-center justify-between gap-3 pb-3 md:pb-4 md:border-b border-slate-200 ${right ? 'flex' : 'hidden md:flex'}`}>
    <div className="min-w-0 hidden md:block">
      <h2 className="text-base md:text-lg font-black text-slate-800 leading-tight truncate">{title}</h2>
      {subtitle && <p className="text-[11px] md:text-xs text-slate-400 mt-0.5 truncate">{subtitle}</p>}
    </div>
    {right && (
      <div className="flex items-center gap-2 shrink-0 ml-auto overflow-x-auto no-scrollbar">
        {right}
      </div>
    )}
  </div>
);

export default PageHeader;
