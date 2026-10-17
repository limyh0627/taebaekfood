import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  tabs?: React.ReactNode;
  actions?: React.ReactNode;
  recovery?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, right, tabs, actions, recovery }) => {
  const structured = !!(tabs || actions);
  return (
    // 기존 right 소비자는 제목 옆 배치를 그대로 쓴다. 전환한 화면만 탭과 행동을 전폭 별도 줄로 둔다.
    // 모바일 제목은 앱바와 중복되므로 숨기되 탭·행동·복구는 그대로 남긴다.
    <div className={`min-w-0 max-w-full flex-wrap items-center justify-between gap-3 pb-3 md:pb-4 md:border-b border-slate-200 ${right || tabs || actions || recovery ? 'flex' : 'hidden md:flex'}`}>
      <div className={`hidden min-w-0 md:block ${structured ? 'w-full' : 'md:flex-1'}`}>
        <h2 className="text-base md:text-lg font-black text-slate-800 leading-tight truncate">{title}</h2>
        {subtitle && <p className="text-[11px] md:text-xs text-slate-400 mt-0.5 truncate">{subtitle}</p>}
      </div>
      {right && <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">{right}</div>}
      {tabs && <div data-page-header-slot="tabs" className="flex w-full min-w-0 flex-wrap items-center justify-start gap-1">{tabs}</div>}
      {actions && <div data-page-header-slot="actions" role="group" aria-label={`${title} 작업`} className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
      {recovery && <div data-page-header-slot="recovery" className="flex w-full min-w-0 flex-wrap items-center gap-2 border-t border-slate-200 pt-2">{recovery}</div>}
    </div>
  );
};

export default PageHeader;
