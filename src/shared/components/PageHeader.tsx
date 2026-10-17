import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  recovery?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, right, recovery }) => (
  // 우측 조작이 많으면 줄을 바꾸어 좁은 화면 밖으로 밀리지 않게 한다.
  // 모바일은 제목이 상단 앱바에 있어 숨기되, right(탭)가 있으면 그 라인에 탭만 표시.
  // right가 없으면 모바일에선 헤더 전체 숨김(빈 공간 방지).
  <div className={`min-w-0 max-w-full flex-wrap items-center justify-between gap-3 pb-3 md:pb-4 md:border-b border-slate-200 ${right || recovery ? 'flex' : 'hidden md:flex'}`}>
    <div className="hidden min-w-0 md:block md:flex-1">
      <h2 className="text-base md:text-lg font-black text-slate-800 leading-tight truncate">{title}</h2>
      {subtitle && <p className="text-[11px] md:text-xs text-slate-400 mt-0.5 truncate">{subtitle}</p>}
    </div>
    {right && (
      <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
        {right}
      </div>
    )}
    {recovery && <div className="flex w-full min-w-0 flex-wrap items-center gap-2 border-t border-slate-200 pt-2">{recovery}</div>}
  </div>
);

export default PageHeader;
