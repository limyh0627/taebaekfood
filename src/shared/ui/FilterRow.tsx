import React from 'react';
import { Check } from 'lucide-react';

/**
 * 거르는 목록의 한 줄 — 고른 것에 체크가 붙는다.
 *
 * [ItemList](../../../components/ItemList.tsx) 와 [ItemManager](../../../components/ItemManager.tsx)
 * 가 **글자까지 똑같이** 따로 갖고 있었다(2026-09-05). 한쪽만 고치면 같은 필터가
 * 화면마다 다르게 보인다.
 */
const FilterRow: React.FC<{
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** 골랐을 때의 색. 기본은 남색. */
  tone?: string;
}> = ({ on, onClick, children, tone = 'text-indigo-600 bg-indigo-50' }) => (
  <button type="button" onClick={onClick}
    className={`w-full text-left px-3 py-2 text-[11px] font-black transition-colors flex items-center justify-between gap-2 ${
      on ? tone : 'text-slate-500 hover:bg-slate-50'}`}>
    <span className="truncate">{children}</span>
    {on && <Check size={12} className="shrink-0"/>}
  </button>
);

export default FilterRow;
