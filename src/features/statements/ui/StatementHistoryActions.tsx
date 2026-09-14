import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, RotateCw, Save } from 'lucide-react';

/** 조회 결과의 발행 도구. 드롭다운의 열림/바깥 클릭 상태는 이 UI 안에서 끝낸다. */
/*  **단추는 바탕색 없이 테두리로**(2026-09-15 사장님: "버튼 바탕색 빼") — 셋이 나란히
    진하게 칠해져 있어 화면에서 제일 먼저 눈에 들어왔는데, 늘 누르는 것이 아니다.
    갈래는 글자색이 알려 준다(거래명세서 남색 · 일반전표 청록 · 템플릿 보라). */
export default function StatementHistoryActions(props: {
  resultCount: number;
  fetching: boolean;
  onCreateSale: () => void;
  onCreatePurchase: () => void;
  onCreateCash: () => void;
  onOpenRecurring?: () => void;
  onOpenCompany: () => void;
}) {
  const { resultCount, fetching, onCreateSale, onCreatePurchase, onCreateCash, onOpenRecurring, onOpenCompany } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [menuOpen]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
      <h3 className="text-xs font-black text-slate-800">
        조회 결과 <span className="text-indigo-600">{resultCount}건</span>
        {fetching && <span className="ml-2 animate-pulse text-[11px] text-indigo-400">불러오는 중…</span>}
      </h3>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(open => !open)}
            className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-black text-indigo-600 transition-all hover:bg-indigo-50"
          >
            <Plus size={13} strokeWidth={3}/>거래명세서<ChevronDown size={12} strokeWidth={3} className="-ml-0.5 opacity-80"/>
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 w-28 rounded-xl border border-slate-100 bg-white p-1 shadow-xl">
              <button onClick={() => { setMenuOpen(false); onCreateSale(); }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-black text-blue-600 hover:bg-blue-50">매출전표</button>
              <button onClick={() => { setMenuOpen(false); onCreatePurchase(); }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-black text-rose-600 hover:bg-rose-50">매입전표</button>
            </div>
          )}
        </div>
        <button
          onClick={onCreateCash}
          className="flex items-center gap-1.5 rounded-xl border border-teal-200 bg-white px-3 py-2 text-xs font-black text-teal-600 transition-all hover:bg-teal-50"
          title="일반전표 — 돈이 실제로 오간 것. 전기·임대 같은 비용, 수금·지불(미수/미지급 상계), 대출상환·급여"
        >
          <Plus size={13} strokeWidth={3}/>일반전표
        </button>
        {onOpenRecurring && (
          <button
            onClick={onOpenRecurring}
            className="flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-black text-violet-600 transition-all hover:bg-violet-50"
            title="전표 템플릿 — 목록 관리 · 매달 자동 발행 설정"
          >
            <RotateCw size={13} strokeWidth={3}/>템플릿
          </button>
        )}
        <div className="mx-1 h-6 w-px self-center bg-slate-200"/>
        <button
          onClick={onOpenCompany}
          className="flex items-center gap-1.5 rounded-xl bg-slate-50 px-3 py-2 text-xs font-black text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-700"
          title="회사 정보 설정"
        >
          <Save size={13}/>회사정보
        </button>
      </div>
    </div>
  );
}
