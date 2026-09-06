import React from 'react';

/**
 * **골라 넣는 칸 — 딱지가 아니라 드롭다운.**
 *
 * 품목 등록의 타입·서브타입·카테고리·단위가 죄다 딱지(버튼)였다. 갈래가 늘면 줄이
 * 늘어 폼이 화면 두 개를 먹고, 폰에서는 딱지가 두 줄·세 줄로 접혔다
 * (2026-09-06 사장님: "드롭다운으로 바꾸고").
 *
 * 고른 값 하나만 보이면 되는 자리다 — 목록은 열었을 때만 있으면 된다.
 * 안 고른 상태는 `빈값이름`(예: '선택 안 함')으로 둔다 — 서브타입·카테고리는 안 고를 수 있다.
 */
export const PickRow: React.FC<{
  label: string;
  icon?: React.ReactNode;
  value: string;
  options: readonly { key: string; label: string }[];
  onPick: (key: string) => void;
  /** 빈 값을 고를 수 있나. 고르면 '' 이 들어간다. */
  빈값이름?: string;
  disabled?: boolean;
}> = ({ label, icon, value, options, onPick, 빈값이름, disabled }) => (
  <div className="space-y-2">
    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
      {icon}{label}
    </label>
    <select
      value={value}
      disabled={disabled}
      onChange={e => onPick(e.target.value)}
      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50 cursor-pointer"
    >
      {빈값이름 !== undefined && <option value="">{빈값이름}</option>}
      {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
    </select>
  </div>
);

export default PickRow;
