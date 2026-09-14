import React, { useRef } from 'react';
import { CalendarDays } from 'lucide-react';

/**
 * **표 안에서 날짜를 고치는 단추 한 벌** — 주문 리스트와 전표 목록이 같은 것을 쓴다.
 *
 * 2026-09-15 사장님: "캘린더도 주문 쪽에서 쓰던거 그대로 들고오지".
 * 주문 리스트의 출고예정일 칸(`EditableDeliveryDate`)이 쓰던 모양을 그대로 옮겼다 —
 * 전표 쪽에 비슷한 것을 새로 그렸더니 같은 일이 두 모양이 됐다.
 *
 * **투명한 `date` 칸을 칸 전체에 깔지 않는다.** 표 안에서는 누른 자리에 따라 연·월·일 조각만
 * 잡혀(브라우저마다 다르다) 달력이 안 열리는 일이 있었다. 눈에 보이는 단추를 따로 두고,
 * **사람이 누른 그 순간에** 브라우저 달력을 직접 연다(`showPicker`) — 데스크톱 크롬이
 * 그렇게 해야 열린다(2026-09-14 사장님: "달력이 데스크톱에선 눌러도 안 열린다").
 * 막히면 `click()` 으로 물러선다.
 */
interface Props {
  /** 읽어 주는 이름 — `출고예정일` · `전표일자` */
  label: string;
  /** `YYYY-MM-DD` (뒤에 시각이 붙어 있어도 된다) */
  value: string;
  onChange: (next: string) => void;
  /** 단추에 적을 글 — 안 주면 `YY.MM.DD` */
  text?: string;
  disabled?: boolean;
  /** 칸을 꽉 채울까(주문 리스트) 글자만큼만 할까(전표 목록) */
  block?: boolean;
}

const 짧은날짜 = (value: string) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
};

const DateChipButton: React.FC<Props> = ({ label, value, onChange, text, disabled = false, block = false }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const openPicker = () => {
    const input = inputRef.current;
    if (!input || disabled) return;
    input.focus({ preventScroll: true });
    try { input.showPicker?.(); } catch { input.click(); }
  };

  return (
    <div className={`relative ${block ? 'w-full' : 'inline-block'}`}>
      <button
        type="button"
        onClick={event => { event.stopPropagation(); openPicker(); }}
        disabled={disabled}
        aria-label={`${label} 수정`}
        className={`flex h-7 items-center justify-start gap-1.5 rounded-md border border-slate-200 bg-slate-100 px-1.5 text-[10px] font-black tabular-nums text-indigo-600 transition-colors enabled:hover:bg-slate-200 disabled:cursor-default disabled:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${block ? 'w-full' : ''}`}
      >
        <CalendarDays size={11} className="shrink-0 opacity-70" aria-hidden="true" />
        <span className="whitespace-nowrap">{text ?? 짧은날짜(value)}</span>
      </button>
      <input
        ref={inputRef}
        type="date"
        value={String(value).slice(0, 10)}
        onChange={event => { if (event.target.value) onChange(event.target.value); }}
        onClick={event => event.stopPropagation()}
        className="pointer-events-none absolute bottom-0 left-1/2 h-px w-px -translate-x-1/2 opacity-0"
        aria-label={label}
        tabIndex={-1}
      />
    </div>
  );
};

export default DateChipButton;
