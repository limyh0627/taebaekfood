
import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmModalProps {
  message: string;
  subMessage?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  message,
  subMessage,
  confirmText = '삭제',
  cancelText = '취소',
  onConfirm,
  onCancel,
}) => (
  <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onCancel} />
    <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
      <div className="p-6">
        <div className="flex items-start gap-4">
          <div className="p-2.5 bg-rose-50 rounded-2xl shrink-0">
            <AlertTriangle size={22} className="text-rose-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-slate-900 leading-snug">{message}</p>
            {subMessage && (
              <p className="text-xs text-slate-400 font-medium mt-1">{subMessage}</p>
            )}
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 transition-all shrink-0">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="px-6 pb-6 flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl text-sm hover:bg-slate-200 transition-all"
        >
          {cancelText}
        </button>
        <button
          onClick={() => { onConfirm(); }}
          className="flex-1 py-2.5 bg-rose-500 text-white font-black rounded-xl text-sm hover:bg-rose-600 transition-all"
        >
          {confirmText}
        </button>
      </div>
    </div>
  </div>
);

export default ConfirmModal;
