import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, right }) => (
  <div className="flex items-center justify-between pb-4 border-b border-slate-200">
    <div className="min-w-0">
      <h2 className="text-lg font-black text-slate-800 leading-tight">{title}</h2>
      {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
    </div>
    {right && <div className="flex items-center gap-2 shrink-0 overflow-x-auto">{right}</div>}
  </div>
);

export default PageHeader;
