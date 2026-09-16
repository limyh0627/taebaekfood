import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { IssuedStatement } from '../../../../types';

interface Props {
  statement: IssuedStatement;
  formatAmount: (value: number) => string;
  onOpenExisting: () => void;
  onReissue: () => void;
  onClose: () => void;
}

export default function StatementDuplicateWarning(props: Props) {
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={props.onClose}>
    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center flex-shrink-0"><CheckCircle2 size={20} className="text-amber-600"/></div>
        <div><p className="font-black text-slate-800 text-sm">이미 발행된 전표입니다</p><p className="text-[11px] text-slate-400 mt-0.5">중복 발행 대신 기존 전표를 확인하세요.</p></div>
      </div>
      <div className="bg-amber-50 rounded-2xl px-4 py-3 space-y-1">
        <p className="text-[11px] font-bold text-amber-800">{props.statement.partnerName} · {props.statement.tradeDate}</p>
        <p className="text-[10px] text-amber-600">문서번호: {props.statement.docNo}</p>
        <p className="text-[10px] text-amber-600">합계: {props.formatAmount(props.statement.totalAmount)}원</p>
      </div>
      <div className="flex gap-2">
        <button onClick={props.onOpenExisting} className="flex-1 py-2.5 rounded-xl bg-slate-700 text-white text-xs font-black hover:bg-slate-800">기존 전표 보기</button>
        <button onClick={props.onReissue} className="flex-1 py-2.5 rounded-xl bg-rose-100 text-rose-700 text-xs font-black hover:bg-rose-200">그래도 재발행</button>
      </div>
      <button onClick={props.onClose} className="w-full text-center text-[11px] text-slate-400 hover:text-slate-600">취소</button>
    </div>
  </div>;
}
