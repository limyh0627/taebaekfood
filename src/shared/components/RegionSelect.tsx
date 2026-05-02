
import React, { useState, useRef, useEffect } from 'react';
import { Search, MapPin, X } from 'lucide-react';

const CITIES = [
  // 특별시·광역시·특별자치시
  '서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시',
  '대전광역시', '울산광역시', '세종특별자치시',
  // 경기도
  '수원시', '성남시', '고양시', '용인시', '부천시', '안산시', '안양시',
  '남양주시', '화성시', '평택시', '의정부시', '시흥시', '파주시', '광명시',
  '김포시', '군포시', '광주시', '이천시', '양주시', '오산시', '구리시',
  '안성시', '포천시', '의왕시', '하남시', '여주시', '동두천시', '과천시',
  // 강원도
  '춘천시', '원주시', '강릉시', '동해시', '태백시', '속초시', '삼척시',
  // 충청북도
  '청주시', '충주시', '제천시',
  // 충청남도
  '천안시', '공주시', '보령시', '아산시', '서산시', '논산시', '계룡시', '당진시',
  // 전라북도
  '전주시', '군산시', '익산시', '정읍시', '남원시', '김제시',
  // 전라남도
  '목포시', '여수시', '순천시', '나주시', '광양시',
  // 경상북도
  '포항시', '경주시', '김천시', '안동시', '구미시', '영주시', '영천시',
  '상주시', '문경시', '경산시',
  // 경상남도
  '창원시', '진주시', '통영시', '사천시', '김해시', '밀양시', '거제시', '양산시',
  // 제주
  '제주시', '서귀포시',
];

interface RegionSelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  compact?: boolean; // 소형 모드 (ClientManager 인라인 편집용)
}

const RegionSelect: React.FC<RegionSelectProps> = ({ value, onChange, className = '', compact = false }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = CITIES.filter(c => c.includes(search));

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (open) {
      setSearch('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const select = (city: string) => {
    onChange(city);
    setOpen(false);
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
  };

  if (compact) {
    return (
      <div ref={ref} className="relative inline-block">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1 border-b border-slate-200 text-[11px] font-bold text-slate-600 bg-transparent outline-none min-w-[80px] hover:border-indigo-400 transition-colors"
        >
          <span className={value ? 'text-slate-700' : 'text-slate-300'}>{value || '지역 선택'}</span>
        </button>
        {open && (
          <div className="absolute left-0 top-full mt-1 z-50 bg-white rounded-xl border border-slate-200 shadow-xl w-52 overflow-hidden">
            <div className="p-2 border-b border-slate-100 flex items-center gap-1.5">
              <Search size={11} className="text-slate-400" />
              <input ref={inputRef} value={search} onChange={e => setSearch(e.target.value)}
                placeholder="도시 검색..." className="flex-1 text-[11px] font-bold outline-none" />
            </div>
            <div className="max-h-44 overflow-y-auto">
              <button type="button" onClick={() => select('')}
                className="w-full px-3 py-1.5 text-left text-[11px] font-bold text-slate-300 hover:bg-slate-50">미지정</button>
              {filtered.map(c => (
                <button key={c} type="button" onClick={() => select(c)}
                  className={`w-full px-3 py-1.5 text-left text-[11px] font-bold hover:bg-indigo-50 hover:text-indigo-600 transition-colors ${value === c ? 'bg-indigo-50 text-indigo-600' : 'text-slate-600'}`}>
                  {c}
                </button>
              ))}
              {filtered.length === 0 && <p className="px-3 py-3 text-[11px] text-slate-300 font-bold">검색 결과 없음</p>}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 transition-all flex items-center justify-between text-left"
      >
        <span className={value ? 'text-slate-800' : 'text-slate-400'}>{value || '지역 선택...'}</span>
        <div className="flex items-center gap-1">
          {value && (
            <span onClick={clear} className="p-0.5 rounded hover:bg-slate-200 transition-all">
              <X size={12} className="text-slate-400" />
            </span>
          )}
          <MapPin size={14} className="text-slate-400" />
        </div>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 z-50 bg-white rounded-2xl border border-slate-200 shadow-2xl w-full overflow-hidden">
          <div className="p-3 border-b border-slate-100 flex items-center gap-2">
            <Search size={14} className="text-slate-400" />
            <input
              ref={inputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="도시명 검색..."
              className="flex-1 text-sm font-bold outline-none bg-transparent"
            />
            {search && (
              <button onClick={() => setSearch('')}><X size={12} className="text-slate-400" /></button>
            )}
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            <button type="button" onClick={() => select('')}
              className="w-full px-4 py-2 text-left text-sm font-bold text-slate-300 hover:bg-slate-50 rounded-xl">
              선택 안 함
            </button>
            {filtered.map(c => (
              <button key={c} type="button" onClick={() => select(c)}
                className={`w-full px-4 py-2 text-left text-sm font-bold rounded-xl transition-colors hover:bg-indigo-50 hover:text-indigo-600 ${value === c ? 'bg-indigo-50 text-indigo-600' : 'text-slate-700'}`}>
                {c}
              </button>
            ))}
            {filtered.length === 0 && <p className="px-4 py-3 text-sm text-slate-300 font-bold">검색 결과 없음</p>}
          </div>
        </div>
      )}
    </div>
  );
};

export default RegionSelect;
