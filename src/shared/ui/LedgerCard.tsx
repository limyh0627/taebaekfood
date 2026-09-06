import React from 'react';
import { ChevronRight } from 'lucide-react';

/**
 * **장부 카드 — 손익분석과 현금흐름이 같은 모양을 쓴다.**
 *
 * 두 화면이 같은 일(줄기 하나를 위에서 아래로, 눌러서 펼치기)을 하면서 **모양이 딴판이었다**
 * (2026-09-06 사장님: "이게 통일한거야?"):
 *
 *   손익      흰 카드에 큰 줄이 바로 선다. 눌러서 펼치면 계정과목이 나온다.
 *   현금흐름  **검은 머리띠**로 시작하고, 구역은 회색 띠, 안 접힌다.
 *
 * 손익 쪽을 기준으로 삼는다 — 줄기가 읽히고, 펼치기가 있어 화면이 짧다.
 */
const fmt = (n: number) => n.toLocaleString('ko-KR');

export const LedgerCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">{children}</div>
);

const TONE = { green: 'text-emerald-600', red: 'text-rose-600', slate: 'text-slate-600' } as const;
export type LedgerTone = keyof typeof TONE;

/**
 * 접히는 큰 줄 — 카드의 뼈대다. 부호 · 이름 / 큰 금액 · 곁수치.
 *
 * `곁수치` 는 손익에선 매출 대비 비율(`83%`)이고 현금흐름에선 안 쓴다.
 * **안 쓰면 자리도 안 잡는다** — 처음엔 늘 비워 뒀는데 현금흐름 쪽 금액 오른쪽이
 * 통째로 휑했다(2026-09-06 사장님: "오른쪽에 여백이 너무 많아").
 * 한 카드 안에서는 줄마다 있고 없고가 갈리지 않아 금액 끝은 그대로 맞는다.
 */
export const LedgerLine: React.FC<{
  label: string;
  amount: number;
  sign: '+' | '−' | '=';
  tone: LedgerTone;
  열림: boolean;
  onToggle: () => void;
  곁수치?: string;
  children?: React.ReactNode;
}> = ({ label, amount, sign, tone, 열림, onToggle, 곁수치 = '', children }) => (
  <div className="border-b border-slate-100">
    <button onClick={onToggle}
      className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50/70 transition-colors text-left">
      <span className="flex items-center gap-1.5 text-sm font-bold text-slate-600">
        <ChevronRight size={13} className={`text-slate-300 transition-transform ${열림 ? 'rotate-90' : ''}`} />
        <span className="text-slate-300 w-3">{sign}</span>{label}
      </span>
      <span className={`text-base font-black tabular-nums ${TONE[tone]}`}>
        {fmt(amount)}
        {곁수치 && <span className="text-[10px] font-bold text-slate-400 ml-1.5 w-9 inline-block text-right">{곁수치}</span>}
      </span>
    </button>
    {열림 && <div className="bg-slate-50/60 px-5 pb-3 pt-1 space-y-2">{children}</div>}
  </div>
);

/** 소계 줄 — 매출총이익 · 영업이익, 현금흐름의 총계·기말현금. 안 접힌다. */
export const LedgerResult: React.FC<{
  label: string; amount: number; 곁수치?: string; 강조?: boolean; right?: React.ReactNode;
}> = ({ label, amount, 곁수치 = '', 강조 = false, right }) => (
  <div className={`flex items-center justify-between px-5 py-3 border-b border-slate-100 ${강조 ? 'bg-blue-50' : 'bg-slate-50/70'}`}>
    <span className={`text-sm font-black pl-[18px] ${강조 ? 'text-blue-800' : 'text-slate-800'}`}>
      <span className="text-slate-300 mr-1.5">=</span>{label}
    </span>
    <span className="text-right">
      {right ?? <>
        <span className={`text-base font-black tabular-nums ${강조 ? 'text-blue-700' : 'text-slate-900'}`}>{fmt(amount)}</span>
        {곁수치 && <span className="text-[10px] font-bold text-slate-400 ml-1.5 w-9 inline-block text-right">{곁수치}</span>}
      </>}
    </span>
  </div>
);

/**
 * 펼친 안쪽의 계정 줄 — 코드 · 이름 / 금액.
 *
 * **색을 안 쓴다.** 초록·빨강은 카드의 큰 줄이 더하는 줄인지 빼는 줄인지 가리는 표시다.
 * 안쪽 계정까지 칠하면 온통 색이라 그 표시가 뜻을 잃는다(2026-09-06 사장님:
 * "왜 계정이름이나 숫자에 색이 다 들어가있어"). 손익은 처음부터 회색이었다.
 */
export const LedgerSub: React.FC<{ code: string; name: string; amount: number }> = ({
  code, name, amount,
}) => (
  <div className={`flex items-center justify-between pl-3 text-[11px] ${amount ? 'text-slate-400' : 'text-slate-300'}`}>
    <span><span className="text-slate-300 mr-1.5 tabular-nums">{code}</span>{name}</span>
    <span className="tabular-nums">{fmt(amount)}</span>
  </div>
);
