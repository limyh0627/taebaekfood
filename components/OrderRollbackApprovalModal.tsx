import React from 'react';
import { AlertTriangle, ArchiveRestore, X } from 'lucide-react';
import { statusLabel } from '../src/shared/orderStatusStyle';
import type { Order, OrderStatus } from '../types';
import type { RollbackPlan } from '../src/features/admin/rollbackSummary';

interface Props {
  order: Order;
  targetStatus: OrderStatus;
  plan: RollbackPlan;
  saving?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const OrderRollbackApprovalModal: React.FC<Props> = ({ order, targetStatus, plan, saving, onCancel, onConfirm }) => (
  <div className="fixed inset-0 z-[2100] flex items-end justify-center bg-slate-900/55 p-0 backdrop-blur-sm md:items-center md:p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="rollback-title" className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl md:rounded-2xl">
      <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600"><ArchiveRestore size={20} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h2 id="rollback-title" className="text-base font-black text-slate-900">주문 상태와 재고를 원복할까요?</h2>
          <p className="mt-1 truncate text-xs font-medium text-slate-500">{order.partnerName} · {statusLabel(order.status)} → {statusLabel(targetStatus)}</p>
        </div>
        <button type="button" onClick={onCancel} disabled={saving} aria-label="원복 승인 닫기" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-40"><X size={17} /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {plan.legacyEvidenceWarning && <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-800"><AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden="true" /><span><strong className="block text-amber-900">원복 근거 부족</strong>{plan.warnings[0]}</span></div>}
        <div>
          <h3 className="mb-2 text-xs font-black text-slate-700">품목별 재고 증감</h3>
          {plan.adjustments.length ? <div className="overflow-hidden rounded-xl border border-slate-200">
            {plan.adjustments.filter(row => row.delta !== 0).map((row, index) => <div key={`${row.reason}-${row.itemId}-${index}`} className="grid grid-cols-[1fr_auto] gap-3 border-b border-slate-100 px-3 py-2.5 text-xs last:border-b-0"><span className="min-w-0"><span className="block truncate font-bold text-slate-700">{row.name}</span><span className="text-[10px] font-medium text-slate-400">{row.reason}</span></span><strong className={`self-center tabular-nums ${row.delta > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{row.delta > 0 ? '+' : ''}{Math.round(row.delta * 1000) / 1000}{row.unit}</strong></div>)}
          </div> : <p className="rounded-xl bg-slate-50 px-3 py-3 text-xs font-medium text-slate-500">표시할 품목 재고 증감이 없습니다.</p>}
        </div>
        <p className="text-[11px] font-medium leading-5 text-slate-500">승인하면 품목 체크, 주문 상태, 재고, 로트와 원료수불부를 하나의 원복 작업으로 처리하고 승인 이력을 남깁니다.</p>
      </div>
      <footer className="flex gap-2 border-t border-slate-200 px-5 pb-[calc(.75rem+env(safe-area-inset-bottom))] pt-3 md:pb-3">
        <button type="button" onClick={onCancel} disabled={saving} className="min-h-10 flex-1 rounded-lg bg-slate-100 px-4 text-sm font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-40">취소</button>
        <button type="button" onClick={onConfirm} disabled={saving} className="min-h-10 flex-1 rounded-lg bg-rose-600 px-4 text-sm font-black text-white hover:bg-rose-700 disabled:cursor-wait disabled:opacity-50">{saving ? '원복 처리 중…' : plan.legacyEvidenceWarning ? '경고 확인 후 원복' : '원복 승인'}</button>
      </footer>
    </section>
  </div>
);

export default OrderRollbackApprovalModal;
