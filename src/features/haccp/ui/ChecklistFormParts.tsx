import React from 'react';

export const TH = 'border border-slate-400 bg-slate-100 p-1.5 text-xs font-bold text-center';

export const TD = 'border border-slate-400 p-1.5 text-xs text-center';

export const TDL = 'border border-slate-400 p-1.5 text-xs text-left';

export const FormHeader: React.FC<{ title: string; company?: string; date?: string }> = ({
  title, company = '태백식품', date,
}) => (
  <div className="mb-4">
    <div className="flex items-center justify-between border-b-2 border-slate-600 pb-2">
      <div className="text-base font-black text-slate-800">{title}</div>
      <div className="text-xs text-slate-500">{company} | {date ?? new Date().toLocaleDateString('ko-KR')}</div>
    </div>
  </div>
);

export const SignBox: React.FC<{ labels?: string[] }> = ({ labels = ['작성자', '확인자', '관리자'] }) => (
  <div className="flex gap-2 mt-3 justify-end">
    {labels.map(l => (
      <div key={l} className="border border-slate-400 text-center w-20">
        <div className="bg-slate-100 text-xs font-bold py-0.5 border-b border-slate-400">{l}</div>
        <div className="h-8" />
      </div>
    ))}
  </div>
);
