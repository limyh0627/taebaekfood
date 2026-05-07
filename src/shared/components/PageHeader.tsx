/**
 * @shared-move  shared/components/PageHeader.tsx
 * 직원 앱·관리자 앱 모두 사용하는 공통 페이지 헤더 컴포넌트
 */
import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, right }) => (
  <div className="flex flex-col gap-1.5 pb-1 sm:flex-row sm:items-center sm:justify-between">
    <div className={`min-w-0 ${right ? 'hidden sm:block' : ''}`}>
      <h2 className="text-2xl font-black text-slate-900 leading-tight">{title}</h2>
      {subtitle && <p className="text-sm text-slate-400 mt-0.5">{subtitle}</p>}
    </div>
    {right && <div className="flex items-center gap-2 overflow-x-auto">{right}</div>}
  </div>
);

export default PageHeader;
