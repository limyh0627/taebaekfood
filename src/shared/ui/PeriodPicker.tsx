import React from 'react';

export type Period = '1M' | '3M' | '6M' | '1Y' | 'custom';

/**
 * **기간 고르개 — 손익분석과 현금흐름이 같은 것을 쓴다.**
 *
 * 두 화면이 같은 상태(`period`·`selectedYear`·`selectedQuarter`…)를 공유하면서
 * 고르개는 **각자 그리고 있었다.** 그래서 나란히 놓고 보면 딴 화면 같았다
 * (2026-09-06 사장님: "현금흐름 분석 ui 손익비용분석이랑 통일성 있게"):
 *
 *   딱지 크기   손익 `px-3 py-1.5` · 현금흐름 `px-2.5 py-1`
 *   이름        같은 `'1Y'` 를 손익은 **당년**, 현금흐름은 **연간**이라 불렀다
 *   자리        손익은 **왼쪽 맨 앞**, 현금흐름은 오른쪽 맨 끝
 *   당월        손익에만 있었다
 *
 * 손익 쪽을 기준으로 삼는다 — 거기 주석에 왜 그 자리인지가 적혀 있다:
 * *"기간 갈래를 왼쪽 맨 앞에 둔다 — 화면이 어느 기간인지가 먼저 읽혀야 한다."*
 */
export interface PeriodPickerProps {
  period: Period;
  setPeriod: (p: Period) => void;
  years: readonly number[];
  selectedYear: number;
  setSelectedYear: (y: number) => void;
  selectedQuarter: 1 | 2 | 3 | 4;
  setSelectedQuarter: (q: 1 | 2 | 3 | 4) => void;
  selectedHalf: 1 | 2;
  setSelectedHalf: (h: 1 | 2) => void;
  customStart: string;
  setCustomStart: (v: string) => void;
  customEnd: string;
  setCustomEnd: (v: string) => void;
  quarterAvailable: (q: 1 | 2 | 3 | 4) => boolean;
  halfAvailable: (h: 1 | 2) => boolean;
  yearlyAvailable?: boolean;
  /**
   * '당월'을 넣을까. 현금흐름은 **월별/기간 모드**가 따로 있어서 당월이 겹친다 —
   * 거기서는 뺀다. 없는 갈래를 그리면 같은 일을 두 자리에서 하게 된다.
   */
  당월?: boolean;
}

const 갈래버튼 = (고름: boolean, 잠김: boolean) =>
  `px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
    잠김 ? 'text-slate-300 cursor-not-allowed'
      : 고름 ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'
  }`;

const 작은버튼 = (고름: boolean) =>
  `px-2.5 py-1 rounded-lg text-xs font-black transition-all ${
    고름 ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'
  }`;

const 통 = 'flex bg-slate-100 rounded-xl p-0.5 gap-0.5';
const 입력 = 'bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm font-black outline-none cursor-pointer';

export const PeriodPicker: React.FC<PeriodPickerProps> = ({
  period, setPeriod, years, selectedYear, setSelectedYear,
  selectedQuarter, setSelectedQuarter, selectedHalf, setSelectedHalf,
  customStart, setCustomStart, customEnd, setCustomEnd,
  quarterAvailable, halfAvailable, yearlyAvailable = true, 당월 = true,
}) => {
  //  '당년' 한 이름으로 쓴다 — 같은 값을 화면마다 달리 부르면 같은 것인 줄 모른다.
  const 갈래 = ([
    ...(당월 ? [['1M', '당월'] as const] : []),
    ['3M', '분기'], ['6M', '반기'], ['1Y', '당년'], ['custom', '기간'],
  ] as const satisfies readonly (readonly [Period, string])[]);

  const 잠김 = (v: Period) =>
    (v === '1Y' && !yearlyAvailable) ||
    (v === '6M' && !halfAvailable(1) && !halfAvailable(2)) ||
    (v === '3M' && !([1, 2, 3, 4] as const).some(quarterAvailable));

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <div className={통}>
        {갈래.map(([val, label]) => {
          const off = 잠김(val);
          return (
            <button key={val} disabled={off} onClick={() => !off && setPeriod(val)}
              className={갈래버튼(period === val, off)}>
              {label}
            </button>
          );
        })}
      </div>

      {period !== 'custom' && (
        <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))} className={입력}>
          {years.map(y => <option key={y} value={y}>{y}년</option>)}
        </select>
      )}

      {period === '3M' && (
        <div className={통}>
          {([1, 2, 3, 4] as const).filter(quarterAvailable).map(q => (
            <button key={q} onClick={() => setSelectedQuarter(q)} className={작은버튼(selectedQuarter === q)}>
              {q}분기
            </button>
          ))}
        </div>
      )}

      {period === '6M' && (
        <div className={통}>
          {([1, 2] as const).filter(halfAvailable).map(h => (
            <button key={h} onClick={() => setSelectedHalf(h)} className={작은버튼(selectedHalf === h)}>
              {h === 1 ? '상반기' : '하반기'}
            </button>
          ))}
        </div>
      )}

      {period === 'custom' && (
        /* 날짜로 고른다 — 전표 화면과 같은 모양. 셈은 달 단위라 고른 날짜가 걸친 달을 쓴다. */
        <div className="flex items-center gap-1">
          <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className={입력} />
          <span className="text-slate-400 text-xs font-black">~</span>
          <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className={입력} />
        </div>
      )}
    </div>
  );
};

export default PeriodPicker;
