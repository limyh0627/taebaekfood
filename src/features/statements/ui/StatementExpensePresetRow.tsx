import React from 'react';
import { Plus, X } from 'lucide-react';
import type { ExpensePreset } from '../../../shared/types';

interface Props {
  presets: ExpensePreset[];
  managing: boolean;
  canAdd: boolean;
  canDelete: boolean;
  onAddRow: (preset: ExpensePreset) => void;
  onCreatePreset: () => void;
  onDeletePreset: (id: string) => void;
  onToggleManaging: () => void;
  onAddBlankRow: () => void;
}

/** 직접입력 표 아래의 행 추가와 자주 쓰는 비용 버튼. */
export default function StatementExpensePresetRow(props: Props) {
  return <tr className="hover:bg-slate-50 transition-colors">
    <td colSpan={10} className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button onClick={props.onAddBlankRow} className="flex items-center gap-1.5 text-xs font-black text-blue-500 hover:text-blue-700 transition-colors">
          <Plus size={12} strokeWidth={3}/>행 추가
        </button>
        <span className="text-slate-200">|</span>
        <span className="text-[10px] font-black text-slate-400">빠른 비용</span>
        {props.presets.map(preset => <span key={preset.id} className="inline-flex items-center">
          <button type="button" onClick={() => props.onAddRow(preset)}
            className="inline-flex items-center gap-1 pl-2.5 pr-2 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-black hover:bg-indigo-100 transition-all">
            {preset.name}{preset.price ? <span className="text-indigo-400 font-bold">{preset.price.toLocaleString()}</span> : null}
          </button>
          {props.managing && <button type="button" onClick={() => props.onDeletePreset(preset.id)} title="삭제"
            className="ml-0.5 text-slate-300 hover:text-rose-500 transition-colors"><X size={12}/></button>}
        </span>)}
        {props.canAdd && <button type="button" onClick={props.onCreatePreset}
          className="inline-flex items-center gap-0.5 px-2 py-1 rounded-full border border-dashed border-slate-300 text-slate-400 text-[11px] font-black hover:border-indigo-300 hover:text-indigo-600 transition-all">
          <Plus size={11} strokeWidth={3}/>항목 저장
        </button>}
        {props.presets.length > 0 && props.canDelete && <button type="button" onClick={props.onToggleManaging}
          className={`text-[10px] font-black transition-colors ${props.managing ? 'text-rose-500' : 'text-slate-300 hover:text-slate-500'}`}>
          {props.managing ? '완료' : '관리'}
        </button>}
      </div>
    </td>
  </tr>;
}
