import React from 'react';
import { History, X, CirclePlus, ArrowRightLeft, CheckCircle2, Tag, MessageSquare, Truck, TriangleAlert } from 'lucide-react';
import type { OrderActivityRow } from '../src/shared/orderActivityLog';

/**
 * **이 주문에 누가 무엇을 언제 했나** — 주문 수정 창 머리의 '로그' 단추가 띄운다.
 * 2026-09-14 사장님: "주문 넣은 사람 일시 라벨이나 작업완료 등의 상태변경 누가하고 언제 했는지".
 *
 * 목록은 `buildOrderActivityLog` 가 만든다 — 여기는 **그리기만** 한다.
 */
interface Props {
  partnerName: string;
  rows: OrderActivityRow[];
  loading: boolean;
  error?: string;
  onClose: () => void;
}

const 아이콘 = {
  create: CirclePlus, status: ArrowRightLeft, line: CheckCircle2,
  label: Tag, note: MessageSquare, ship: Truck, fail: TriangleAlert,
} as const;

const 색 = {
  create: 'bg-indigo-50 text-indigo-600', status: 'bg-slate-100 text-slate-600',
  line: 'bg-emerald-50 text-emerald-600', label: 'bg-amber-50 text-amber-600',
  note: 'bg-sky-50 text-sky-600', ship: 'bg-violet-50 text-violet-600',
  fail: 'bg-rose-50 text-rose-600',
} as const;

/** `2026-09-14T08:03:11.000Z` → `26.09.14 17:03` — 초는 버린다(줄이 길어지기만 한다). */
export const 로그시각 = (iso?: string) => {
  if (!iso) return '시각 미기록';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '시각 미기록';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getFullYear() % 100)}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const OrderActivityLogModal: React.FC<Props> = ({ partnerName, rows, loading, error, onClose }) => (
  <div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm md:items-center md:p-4" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-labelledby="order-log-title" className="flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl md:max-h-[80vh] md:rounded-2xl" onClick={event => event.stopPropagation()}>
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600" aria-hidden="true"><History size={17} /></span>
          <div className="min-w-0">
            <h3 id="order-log-title" className="text-[17px] font-black leading-6 text-slate-900">주문 로그</h3>
            <p className="mt-0.5 truncate text-xs font-bold text-slate-600">{partnerName}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" aria-label="주문 로그 닫기"><X size={18} /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {error && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600">{error}</p>}
        <ol className="space-y-2.5">
          {rows.map((row, index) => {
            const Icon = 아이콘[row.kind];
            return (
              <li key={`${row.at ?? 'no-at'}-${index}`} className="flex items-start gap-2.5">
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${색[row.kind]}`} aria-hidden="true"><Icon size={13} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold leading-5 text-slate-900">{row.what}</p>
                  <p className="text-[11px] font-medium leading-4 text-slate-500">
                    {로그시각(row.at)} · {row.who}
                  </p>
                  {row.detail && <p className="mt-0.5 break-words text-[11px] font-medium leading-4 text-slate-400">{row.detail}</p>}
                </div>
              </li>
            );
          })}
        </ol>
        {/*  **상태 변경 기록은 따로 읽어 온다** — 다 읽기 전에는 주문 문서에 있는 것만 보인다.
             그 사이를 빈 화면으로 두면 "로그가 없다"로 오해한다. */}
        {loading && <p className="mt-3 text-[11px] font-bold text-slate-400">상태 변경 기록을 불러오는 중…</p>}
        {/*  **없는 것은 없다고 적는다.** 품목 수량·추가·삭제는 지금 사람과 시각을 남기지 않는다.
             적어 두지 않으면 "왜 안 보이지" 하고 찾아 헤매게 된다. */}
        <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] font-medium leading-4 text-slate-400">
          품목 수량·추가·삭제는 아직 누가 했는지 남지 않습니다. 주문 등록 · 상태 변경 · 품목 작업완료 ·
          라벨 · 제조일 · 비고 · 출고 확인만 기록됩니다.
        </p>
      </div>
    </div>
  </div>
);

export default OrderActivityLogModal;
