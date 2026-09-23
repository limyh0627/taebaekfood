import React from 'react';
import { X, type LucideIcon } from 'lucide-react';

/**
 * **알림창 한 벌 — 주문·배송 화면의 모든 알림이 이 모양이다.**
 *
 * 2026-09-15 사장님: "주문배송관리에서 알람양식은 저걸로 통일 색만 바꿔쓰고
 * 재고가없어 전량생산합니다부터 저기 설명은 알람 내용쪽으로 들어가고
 * 헤더에는 재고부족 작업완료 출고완료 이런식으로 제목을 넣어".
 *
 * 기준은 재고 사용 확인창(`StockUseModal`)이다 — 왼쪽에 색 아이콘, 가운데 제목,
 * 오른쪽에 닫기, 아래에 내용과 단추.
 *
 * **머리에는 짧은 이름만 선다**(`재고부족` · `작업완료` · `출고완료`). 전에는 머리에
 * "재고가 없어 전량 생산합니다" 같은 **문장**이 들어가 창마다 길이가 들쭉날쭉했고,
 * 무슨 창인지 한눈에 안 잡혔다. 설명은 아래 내용으로 내린다.
 *
 * **바뀌는 것은 색뿐이다** — 색은 일의 갈래를 알린다. Tailwind 는 클래스 이름을
 * 조립하면 못 알아보므로(`bg-${tone}-50` 은 안 만들어진다) 통째로 적어 둔다.
 */
export type AlertTone = 'rose' | 'emerald' | 'sky' | 'amber' | 'pink' | 'slate' | 'indigo';

const TONE: Record<AlertTone, { 바탕: string; 글자: string; 단추: string }> = {
  //  단추 색은 아이콘보다 한 단 진하다 — 눌러야 할 것이 먼저 읽혀야 한다.
  rose:    { 바탕: 'bg-rose-50',    글자: 'text-rose-500',    단추: 'bg-rose-500 hover:bg-rose-600' },
  emerald: { 바탕: 'bg-emerald-50', 글자: 'text-emerald-600', 단추: 'bg-emerald-600 hover:bg-emerald-700' },
  sky:     { 바탕: 'bg-sky-50',     글자: 'text-sky-600',     단추: 'bg-sky-600 hover:bg-sky-700' },
  amber:   { 바탕: 'bg-amber-50',   글자: 'text-amber-600',   단추: 'bg-amber-500 hover:bg-amber-600' },
  pink:    { 바탕: 'bg-pink-50',    글자: 'text-pink-600',    단추: 'bg-pink-500 hover:bg-pink-600' },
  slate:   { 바탕: 'bg-slate-100',  글자: 'text-slate-600',   단추: 'bg-slate-700 hover:bg-slate-800' },
  indigo:  { 바탕: 'bg-indigo-50',  글자: 'text-indigo-600',  단추: 'bg-indigo-600 hover:bg-indigo-700' },
};

export const alertToneClass = (tone: AlertTone) => TONE[tone] ?? TONE.slate;

interface Props {
  /** 머리에 설 **짧은 이름** — `재고부족` · `작업완료` · `출고완료`. 문장을 넣지 않는다. */
  title: string;
  tone: AlertTone;
  icon: LucideIcon;
  onClose: () => void;
  /** 넓은 창이 필요한가 — 표를 담을 때만(재고 사용 확인창). */
  wide?: boolean;
  children: React.ReactNode;
  /** 단추 줄. **세로로 쌓는다** — 단추 아래에 덧붙일 말이 있을 수 있다(못 누르는 까닭 등). */
  footer: React.ReactNode;
}

const AlertModalShell: React.FC<Props> = ({ title, tone, icon: Icon, onClose, wide = false, children, footer }) => {
  const 색 = alertToneClass(tone);
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex max-h-[85vh] w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-in zoom-in-95 duration-200`}
      >
        <div className="flex items-center gap-4 border-b border-slate-100 p-6 pb-4">
          <div className={`shrink-0 rounded-2xl p-2.5 ${색.바탕}`}>
            <Icon size={22} className={색.글자} aria-hidden="true" />
          </div>
          <p className="min-w-0 flex-1 truncate text-base font-black text-slate-900">{title}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="shrink-0 rounded-xl p-1.5 text-slate-400 transition-all hover:bg-slate-100"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>

        <div className="flex flex-col gap-2 border-t border-slate-100 px-6 py-4">{footer}</div>
      </div>
    </div>
  );
};

export default AlertModalShell;
