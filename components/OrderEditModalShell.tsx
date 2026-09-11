import React from 'react';
import { Edit2, X } from 'lucide-react';
import ModalActionFooter from '../src/shared/components/ModalActionFooter';

interface OrderEditModalShellProps {
  title: string;
  partnerName: string;
  context: string;
  onClose: () => void;
  onSave: () => void;
  saveDisabled?: boolean;
  children: React.ReactNode;
}

const OrderEditModalShell: React.FC<OrderEditModalShellProps> = ({
  title,
  partnerName,
  context,
  onClose,
  onSave,
  saveDisabled = false,
  children,
}) => (
  <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm md:items-center md:p-4" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-labelledby="order-edit-modal-title" className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl md:max-h-[88vh] md:rounded-2xl" onClick={event => event.stopPropagation()}>
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-indigo-600" aria-hidden="true"><Edit2 size={17} /></span>
          <div className="min-w-0">
            <h3 id="order-edit-modal-title" className="text-[17px] font-black leading-6 text-slate-900">{title}</h3>
            <p className="mt-0.5 truncate text-xs font-bold text-slate-600">{partnerName}</p>
            <p className="mt-0.5 truncate text-[11px] font-medium text-slate-500">{context}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" aria-label={`${title} 닫기`}><X size={18} /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">{children}</div>

      <ModalActionFooter
        onCancel={onClose}
        onPrimary={onSave}
        primaryLabel="변경 저장"
        primaryDisabled={saveDisabled}
      />
    </div>
  </div>
);

export default OrderEditModalShell;
