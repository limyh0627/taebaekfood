import { X } from 'lucide-react';

export default function StatementComposerHeader(props: {
  mode: '매출' | '매입' | '비용';
  twoSided: boolean;
  editingDocNo?: string;
  editMode: boolean;
  partnerName?: string;
  partnerPhone?: string;
  /**
   * **이 거래처에 지금 얼마가 걸려 있나**(2026-09-16 사장님: "거래처명 밑에 현재 거래처에
   * 미수금이나 미지급금 나오게 할 수 있나").
   *
   * 전표를 끊는 자리에서 제일 먼저 궁금한 것이 "이 집 아직 얼마 남았나" 인데, 보려면
   * 창을 닫고 거래처 원장으로 갔다 와야 했다. 셈은 `allPartnerBalances`(분개 기준) —
   * 앱에서 잔액을 세는 유일한 길이다. 여기서 따로 세면 원장과 갈린다.
   */
  balance?: { receivable: number; payable: number };
  tradeDate: string;
  onTradeDate: (date: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const { mode, twoSided, editingDocNo, editMode, partnerName, partnerPhone, balance, tradeDate, onTradeDate, onNew, onClose } = props;
  //  **0 원은 안 적는다** — 걸린 것이 없다는 말을 굳이 자리 내어 쓰면 있는 쪽이 안 띈다.
  //  1원 미만은 반올림 찌꺼기라 없는 것으로 본다.
  const 미수 = Math.round(balance?.receivable ?? 0);
  const 미지급 = Math.round(balance?.payable ?? 0);
  const 돈 = (n: number) => n.toLocaleString('ko-KR');
  return (
    <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-3 sm:gap-3 sm:px-5">
      <span className={`rounded-full px-2.5 py-1 text-xs font-black ${
        twoSided ? 'bg-amber-100 text-amber-700' : mode === '매출' ? 'bg-blue-100 text-blue-700' : 'bg-rose-100 text-rose-700'}`}>
        {twoSided ? '일반' : mode === '매출' ? '매출' : '매입'}전표
      </span>
      {editingDocNo && <span className="rounded-lg bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-400">[수정중] {editingDocNo}</span>}
      {partnerName
        ? (
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-black text-slate-900">{partnerName}</span>
            {/*  **이름 바로 밑에 잔액** — 전표를 끊기 전에 "이 집 아직 얼마 남았나" 를 보는 자리다.
                 받을 것과 줄 것은 **뜻이 반대**라 색으로 가른다(미수 파랑 · 미지급 빨강).
                 둘 다 없으면 '거래 없음' 이라고 적는다 — 빈칸이면 못 읽어 온 것인지,
                 진짜 없는 것인지 알 수가 없다. */}
            <span className="flex items-center gap-2 text-[11px] font-bold">
              {미수 !== 0 && <span className="text-blue-600">미수 {돈(미수)}</span>}
              {미지급 !== 0 && <span className="text-rose-600">미지급 {돈(미지급)}</span>}
              {미수 === 0 && 미지급 === 0 && <span className="text-slate-300">거래 없음</span>}
            </span>
          </span>
        )
        : <span className="text-sm font-bold text-slate-400">거래처를 선택하세요</span>}
      {partnerPhone && <span className="text-xs text-slate-400">{partnerPhone}</span>}
      <span className="text-slate-200">·</span>
      {editingDocNo && !editMode
        ? <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-black text-slate-700">{tradeDate}</span>
        : <input aria-label="전표일자" type="date" value={tradeDate} onChange={event => onTradeDate(event.target.value)}
            className="cursor-pointer rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>}
      <div className="ml-auto flex items-center gap-2">
        <button onClick={onNew} className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600 transition-all hover:bg-slate-200">새 전표</button>
        <button aria-label="전표 작성 닫기" onClick={onClose} className="rounded-xl p-2 text-slate-400 transition-all hover:bg-slate-100"><X size={18}/></button>
      </div>
    </div>
  );
}
