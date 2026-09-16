import React from 'react';
import { Save } from 'lucide-react';

interface Props {
  type: '매출' | '매입';
  totalAmount: number;
  balance: number;
  formatAmount: (value: number) => string;
  overLabel: string;
  onSettle: () => void;
}

/** 조회 중인 전표의 수금·지불 결과. 거래처 전체 내역은 원장에서 보고 여기에는 요약만 둔다. */
export default function StatementSettlementSummary(props: Props) {
  const paid = props.totalAmount - props.balance;
  const label = props.type === '매출' ? '수금' : '지불';
  const balanceColor = props.balance < 0
    ? (props.type === '매출' ? 'text-rose-600' : 'text-blue-600')
    : props.balance === 0 ? 'text-slate-400'
    : (props.type === '매출' ? 'text-blue-600' : 'text-rose-600');

  return <div className="flex-shrink-0 border-t border-slate-100 bg-slate-50 px-5 py-3 space-y-2">
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">이 전표 {label}</span>
      <div className="flex items-center gap-3 text-xs">
        <span className="text-slate-500">합계 <b className="text-slate-800">{props.formatAmount(props.totalAmount)}</b></span>
        <span className="text-slate-500">{label} <b className="text-emerald-700">{props.formatAmount(paid)}</b></span>
        <span className={`font-black ${balanceColor}`}>
          {props.balance < 0 ? `${props.overLabel} ${props.formatAmount(Math.abs(props.balance))}` : `잔액 ${props.formatAmount(props.balance)}`}
        </span>
      </div>
    </div>
    {props.balance > 0 && <button onClick={props.onSettle}
      className={`text-[10px] font-black px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${props.type === '매입' ? 'bg-rose-50 text-rose-600 hover:bg-rose-100' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}>
      <Save size={10}/>{label} 처리
    </button>}
  </div>;
}
