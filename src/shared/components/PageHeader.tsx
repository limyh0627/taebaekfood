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
  return (
    // 제목과 탭만 헤더 경계 안에 둔다. 업무 행동·복구는 본문 형제로 두어 구분한다.
    // 모바일 제목은 앱바와 중복되므로 숨기되 탭·행동·복구는 그대로 남긴다.
    <div className={`min-w-0 max-w-full flex-col gap-3 ${right || tabs || actions || recovery ? 'flex' : 'hidden md:flex'}`}>
    <div data-page-header-slot="header" className={`min-w-0 max-w-full flex-wrap items-center justify-between gap-3 pb-3 md:pb-4 md:border-b border-slate-200 ${right || tabs ? 'flex' : 'hidden md:flex'}`}>
      <div className={`hidden min-w-0 md:block ${tabs ? 'md:w-auto md:flex-1' : 'md:flex-1'}`}>
        <h2 className="text-base md:text-lg font-black text-slate-800 leading-tight truncate">{title}</h2>
        {subtitle && <p className="text-[11px] md:text-xs text-slate-400 mt-0.5 truncate">{subtitle}</p>}
      </div>
      {right && <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">{right}</div>}
      {tabs && <div data-page-header-slot="tabs" className="ml-auto flex w-full min-w-0 max-w-full flex-wrap items-center justify-end gap-1 md:w-auto md:max-w-full [&>div]:max-w-full [&>div]:[justify-content:safe_flex-end] [&>div>.ml-auto]:ml-0 [&>div>div.flex]:[justify-content:safe_flex-end]">{tabs}</div>}
    </div>
      {actions && <div data-page-header-slot="actions" role="group" aria-label={`${title} 작업`} className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
      {recovery && <div data-page-header-slot="recovery" className="flex w-full min-w-0 flex-wrap items-center gap-2 border-t border-slate-200 pt-2">{recovery}</div>}
    </div>
  );
};

export default PageHeader;
