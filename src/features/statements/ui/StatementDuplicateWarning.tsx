import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { IssuedStatement } from '../../../../types';
import AlertModalShell from '../../../shared/components/AlertModalShell';

interface Props {
  statement: IssuedStatement;
  formatAmount: (value: number) => string;
  onOpenExisting: () => void;
  onReissue: () => void;
  onClose: () => void;
}

export default function StatementDuplicateWarning(props: Props) {
  return <AlertModalShell title="이미 발행된 전표" tone="amber" icon={CheckCircle2} onClose={props.onClose} footer={<>
      <div className="flex gap-2">
        <button onClick={props.onOpenExisting} className="flex-1 py-2.5 rounded-xl bg-slate-700 text-white text-xs font-black hover:bg-slate-800">기존 전표 보기</button>
        <button onClick={props.onReissue} className="flex-1 py-2.5 rounded-xl bg-rose-100 text-rose-700 text-xs font-black hover:bg-rose-200">그래도 재발행</button>
      </div>
      <button onClick={props.onClose} className="mt-2 w-full text-center text-[11px] text-slate-400 hover:text-slate-600">취소</button>
    </>}>
      <p className="mb-3 text-[11px] text-slate-500">중복 발행 대신 기존 전표를 확인하세요.</p>
      <div className="bg-amber-50 rounded-2xl px-4 py-3 space-y-1">
        <p className="text-[11px] font-bold text-amber-800">{props.statement.partnerName} · {props.statement.tradeDate}</p>
        <p className="text-[10px] text-amber-600">문서번호: {props.statement.docNo}</p>
        <p className="text-[10px] text-amber-600">합계: {props.formatAmount(props.statement.totalAmount)}원</p>
      </div>
  </AlertModalShell>;
}
