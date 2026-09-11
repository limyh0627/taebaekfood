import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { matchesSearch } from '../hangul';

/**
 * **초성으로 찾는 드롭다운 — 생긴 건 브라우저 것 그대로.**
 *
 * 2026-09-12 사장님: "초성되게 해야돼 니가 비슷하게 그려 그럼".
 *
 * 왜 직접 그리나 — `<select>` 의 **펼친 목록은 브라우저가 그린다.** 그 안에는 아무것도 못 넣어서
 * 검색칸을 붙일 자리가 없다. 전에 `<input list=...>` 로 바꿔 봤더니 ▾ 가 사라지고 크롬이 ✕ 를
 * 따로 그려, 같은 줄에 선 칸들이 제각각으로 보였다(사장님: "왜 다르냐고").
 *
 * 그래서 **닫힌 모양은 `<select>` 와 같은 글꼴·높이·테두리·▾ 로 맞추고**, 펼친 목록만 우리가 그린다.
 * 목록 모양도 크롬 것을 따라간다 — 흰 바탕, 얇은 테두리, 고른 줄은 짙은 회색에 흰 글씨.
 *
 * 짧은 목록에는 검색칸을 안 띄운다(`searchThreshold`) — 여덟 줄은 눈으로 찾는 게 빠르고,
 * 그래야 검색 필드·정렬이 **전과 똑같이** 동작한다.
 *
 * 담는 칸이 `overflow-hidden` 이면 목록이 잘리므로 **body 로 내보내 띄운다**(포털).
 * 자리는 단추의 위치에서 잰다 — 화면 아래가 모자라면 위로 뒤집는다.
 */
export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: readonly SearchableSelectOption[];
  disabled?: boolean;
  /** `<select>` 에 주던 것과 **같은 문자열**을 준다 — 그래야 옆 칸과 한 모양이다. */
  className?: string;
  /** 이보다 길면 검색칸을 띄운다. 기본 8. */
  searchThreshold?: number;
  ariaLabel?: string;
}

const SearchableSelect: React.FC<SearchableSelectProps> = ({
  value, onChange, options, disabled, className = '', searchThreshold = 8, ariaLabel,
}) => {
  const 단추 = useRef<HTMLButtonElement>(null);
  const 검색칸 = useRef<HTMLInputElement>(null);
  const 목록 = useRef<HTMLDivElement>(null);
  const [열림, set열림] = useState(false);
  const [찾는말, set찾는말] = useState('');
  const [커서, set커서] = useState(0);
  const [자리, set자리] = useState<{ top: number; left: number; width: number; 위로: boolean }>(
    { top: 0, left: 0, width: 0, 위로: false });

  const 고른것 = options.find(option => option.value === value);
  const 검색쓰나 = options.length > searchThreshold;

  const 걸린것 = useMemo(
    () => (찾는말 ? options.filter(option => matchesSearch(option.label, 찾는말)) : [...options]),
    [options, 찾는말]);

  const 자리재기 = useCallback(() => {
    const rect = 단추.current?.getBoundingClientRect();
    if (!rect) return;
    //  아래가 240px 도 안 남으면 위로 뒤집는다 — 화면 밖으로 나가면 고를 수가 없다
    const 위로 = window.innerHeight - rect.bottom < 240 && rect.top > window.innerHeight - rect.bottom;
    set자리({
      top: 위로 ? rect.top - 2 : rect.bottom + 2,
      left: Math.max(4, Math.min(rect.left, window.innerWidth - rect.width - 4)),
      width: rect.width,
      위로,
    });
  }, []);

  useLayoutEffect(() => { if (열림) 자리재기(); }, [열림, 자리재기]);

  //  스크롤·창 크기가 바뀌면 단추와 목록이 어긋난다 — 따라다니게 다시 잰다
  useEffect(() => {
    if (!열림) return;
    const 다시 = () => 자리재기();
    window.addEventListener('scroll', 다시, true);
    window.addEventListener('resize', 다시);
    return () => {
      window.removeEventListener('scroll', 다시, true);
      window.removeEventListener('resize', 다시);
    };
  }, [열림, 자리재기]);

  const 열기 = () => {
    if (disabled) return;
    set찾는말('');
    set커서(Math.max(0, options.findIndex(option => option.value === value)));
    set열림(true);
  };
  const 닫기 = () => { set열림(false); 단추.current?.focus(); };
  const 고르기 = (골라진: string) => { onChange(골라진); set열림(false); 단추.current?.focus(); };

  //  검색칸이 없을 때(짧은 목록)도 글쇠로 움직일 수 있어야 한다 — 목록에 초점을 준다
  useEffect(() => {
    if (!열림) return;
    if (검색쓰나) 검색칸.current?.focus();
    else 목록.current?.focus();
  }, [열림, 검색쓰나]);

  //  고른 줄이 보이게 — 거래처가 예순 곳이면 열자마자 아래쪽에 있을 수 있다
  useEffect(() => {
    if (!열림) return;
    목록.current?.querySelector<HTMLElement>(`[data-idx="${커서}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [열림, 커서]);

  const 글쇠 = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!걸린것.length) return;
      const 걸음 = event.key === 'ArrowDown' ? 1 : -1;
      set커서(이전 => (이전 + 걸음 + 걸린것.length) % 걸린것.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (걸린것[커서]) 고르기(걸린것[커서].value);
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      set열림(false);
    }
  };

  return (
    <>
      <button
        ref={단추} type="button" disabled={disabled} onClick={열기}
        aria-haspopup="listbox" aria-expanded={열림} aria-label={ariaLabel}
        className={`${className} flex appearance-none items-center justify-between gap-1 text-left`}
      >
        <span className={`truncate ${고른것 ? '' : 'text-slate-400'}`}>{고른것?.label ?? ''}</span>
        <ChevronDown size={14} className="shrink-0" aria-hidden="true" />
      </button>

      {열림 && createPortal(
        <>
          <div className="fixed inset-0 z-[900]" onMouseDown={닫기} />
          <div
            style={{
              left: 자리.left, width: Math.max(자리.width, 150),
              ...(자리.위로 ? { bottom: window.innerHeight - 자리.top } : { top: 자리.top }),
            }}
            className="fixed z-[901] overflow-hidden rounded-md border border-slate-300 bg-white shadow-xl"
          >
            {검색쓰나 && (
              <div className="border-b border-slate-100 px-2.5 py-1.5">
                <input
                  ref={검색칸} type="text" value={찾는말}
                  onChange={event => { set찾는말(event.target.value); set커서(0); }}
                  onKeyDown={글쇠}
                  className="h-6 w-full bg-transparent text-xs font-bold text-slate-700 outline-none placeholder:font-bold placeholder:text-slate-400"
                />
              </div>
            )}
            <div
              ref={목록} role="listbox" tabIndex={-1} onKeyDown={글쇠}
              className="max-h-60 overflow-y-auto py-1 outline-none"
            >
              {걸린것.length === 0 ? (
                <p className="px-3 py-2 text-xs font-bold text-slate-400">찾는 게 없습니다</p>
              ) : 걸린것.map((option, idx) => (
                <button
                  key={option.value} type="button" data-idx={idx} role="option"
                  aria-selected={option.value === value}
                  onMouseEnter={() => set커서(idx)}
                  onClick={() => 고르기(option.value)}
                  className={`block w-full truncate px-3 py-1.5 text-left text-xs font-bold ${
                    idx === 커서 ? 'bg-slate-700 text-white'
                      : option.value === value ? 'bg-slate-100 text-slate-900'
                      : 'text-slate-700'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
};

export default SearchableSelect;
