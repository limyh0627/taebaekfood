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
  <div className="flex items-center justify-between gap-4 pb-1">
    <div className="min-w-0">
      <h2 className="text-2xl font-black text-slate-900 leading-tight">{title}</h2>
      {subtitle && <p className="text-sm text-slate-400 mt-0.5">{subtitle}</p>}
    </div>
    {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
  </div>
);

export default PageHeader;
