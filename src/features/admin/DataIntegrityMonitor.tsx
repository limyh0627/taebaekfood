import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, LoaderCircle, RotateCcw, Search, ShieldCheck, XCircle } from 'lucide-react';
import type { IntegrityArea, IntegrityAuditInput, IntegritySeverity } from './dataIntegrityAudit';
import { auditDataIntegrity } from './dataIntegrityAudit';

const AREAS: IntegrityArea[] = ['작업완료·BOM', '입고·재고', '전표·서류', '판매일지·수불부'];
const label: Record<IntegritySeverity, string> = { error: '오류', warning: '확인 필요', info: '참고' };
const color: Record<IntegritySeverity, string> = { error: 'bg-rose-50 text-rose-700 border-rose-200', warning: 'bg-amber-50 text-amber-700 border-amber-200', info: 'bg-slate-50 text-slate-600 border-slate-200' };

const DataIntegrityMonitor: React.FC<IntegrityAuditInput & { onRefresh?: () => void; loading?: boolean }> = props => {
  const today = useMemo(() => new Date().toLocaleDateString('sv-SE'), []);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const issues = useMemo(() => props.loading ? [] : auditDataIntegrity({
    ...props,
    dateFrom: from,
    dateTo: to,
  }), [props, from, to]);
  const [area, setArea] = useState<IntegrityArea | '전체'>('전체');
  const [query, setQuery] = useState('');
  const shown = issues.filter(issue => (area === '전체' || issue.area === area) && `${issue.title} ${issue.detail} ${issue.reference || ''}`.toLowerCase().includes(query.toLowerCase()));
  const errors = issues.filter(issue => issue.severity === 'error').length;
  const warnings = issues.filter(issue => issue.severity === 'warning').length;
  if (props.loading) return <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-slate-500"><LoaderCircle className="animate-spin text-indigo-500" size={32} /><p className="font-bold">재고·원장 자료를 같은 시점으로 맞춰 불러오는 중입니다.</p><p className="text-xs">모두 도착하기 전에는 오류를 계산하지 않습니다.</p></div>;
  return <div className="space-y-4 pb-10">
    <div className="flex flex-col gap-3 md:flex-row md:items-end"><div><h1 className="text-xl font-black text-slate-900">데이터 점검</h1><p className="mt-1 text-sm text-slate-500">하루 동안 저장된 처리 근거를 서로 대조합니다. 이 화면에서는 데이터를 변경하지 않습니다.</p></div><div className="flex flex-wrap items-center gap-2 md:ml-auto"><input aria-label="점검 시작일" type="date" value={from} onChange={e => setFrom(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700" /><span className="text-slate-400">~</span><input aria-label="점검 종료일" type="date" value={to} onChange={e => setTo(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700" />{props.onRefresh && <button type="button" onClick={props.onRefresh} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 hover:border-indigo-300 hover:text-indigo-600"><RotateCcw size={14} />새로고침</button>}</div></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{AREAS.map(name => { const rows = issues.filter(i => i.area === name); const bad = rows.filter(i => i.severity === 'error').length; return <button key={name} onClick={() => setArea(name)} className={`rounded-2xl border bg-white p-4 text-left transition ${area === name ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-300'}`}><div className="flex items-center justify-between"><span className="text-sm font-bold text-slate-700">{name}</span>{bad ? <XCircle size={18} className="text-rose-500" /> : <CheckCircle2 size={18} className="text-emerald-500" />}</div><div className="mt-3 text-2xl font-black text-slate-900">{rows.length}<span className="ml-1 text-xs font-medium text-slate-400">건</span></div></button>; })}</div>
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row md:items-center"><div className="flex items-center gap-2 text-sm font-bold text-slate-700"><ShieldCheck size={18} className="text-indigo-600" /> 오류 {errors}건 · 확인 필요 {warnings}건</div><div className="relative md:ml-auto md:w-80"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="주문번호·전표번호·내용 검색" className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-indigo-400" /></div>{(area !== '전체' || query) && <button onClick={() => { setArea('전체'); setQuery(''); }} className="text-xs font-bold text-slate-500 hover:text-indigo-600">필터 초기화</button>}</div>
      {shown.length === 0 ? <div className="flex flex-col items-center gap-2 px-6 py-16 text-center"><CheckCircle2 size={34} className="text-emerald-500" /><p className="font-bold text-slate-800">현재 조건에서 발견된 문제가 없습니다.</p></div> : <div className="divide-y divide-slate-100">{shown.map(issue => <div key={issue.id} className="p-4 md:flex md:items-start md:gap-4"><div className={`mb-2 inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-black ${color[issue.severity]}`}>{issue.severity === 'error' ? <XCircle size={12} /> : issue.severity === 'warning' ? <AlertTriangle size={12} /> : <Info size={12} />}{label[issue.severity]}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2"><p className="text-sm font-black text-slate-800">{issue.title}</p><span className="text-xs font-bold text-indigo-600">{issue.area}</span></div><p className="mt-1 text-sm leading-6 text-slate-600">{issue.detail}</p></div><div className="mt-2 shrink-0 text-xs text-slate-400 md:mt-0 md:text-right">{issue.reference && <div className="font-bold text-slate-600">{issue.reference}</div>}{issue.date && <div className="mt-1">{issue.date.slice(0, 10)}</div>}</div></div>)}</div>}
    </div>
    <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-800">입고 기록에는 과거 재고의 전후 수량이 저장되지 않은 시기가 있어, 기록이 존재해도 당시 재고 반영까지 완전히 증명할 수 없는 건이 있습니다. 이후에는 입고 작업번호와 전후 재고를 함께 저장해야 이 부분도 자동 확정할 수 있습니다.</div>
  </div>;
};
export default DataIntegrityMonitor;
