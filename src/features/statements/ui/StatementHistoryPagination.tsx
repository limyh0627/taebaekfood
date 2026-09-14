export default function StatementHistoryPagination(props: {
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  const { page, totalPages, totalCount, pageSize, onPage } = props;
  if (totalCount <= pageSize) return null;
  const buttonClass = 'rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-black text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/40 px-4 py-3">
      <span className="text-[11px] font-bold text-slate-400">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalCount)} / {totalCount}건
      </span>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(1)} disabled={page === 1} className={buttonClass}>« 최신</button>
        <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page === 1} className={buttonClass}>‹ 이전</button>
        <span className="rounded-lg bg-slate-700 px-2.5 py-1 text-[11px] font-black text-white">{page} / {totalPages}</span>
        <button onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className={buttonClass}>다음 ›</button>
        <button onClick={() => onPage(totalPages)} disabled={page === totalPages} className={buttonClass}>과거 »</button>
      </div>
    </div>
  );
}
