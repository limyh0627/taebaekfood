import React from 'react';
import { GripVertical, X, Link2, Unlink } from 'lucide-react';
import type { Order, Partner } from '../types';
import type { DayRow } from '../src/shared/deliveryPlan';
import { cardNoLabel } from '../src/shared/cardNo';
import { statusColor, statusLabel } from '../src/shared/orderStatusStyle';

/**
 * **하루치 배송 줄 — 화면 한 벌.**
 *
 * 2026-09-09 사장님. 전에는 **오늘 칸만** 번호·오전오후가 붙고 나머지 날은 밋밋한 목록이었다.
 * 게다가 같은 카드가 세 군데(주간 캘린더 오늘칸 · 금일 배송순서 판 · 하루 상세 창)에
 * 따로 쓰여 있어서 셋이 조금씩 달랐다. **한 벌로 모은다** — 어디서 보든 같은 카드다.
 *
 * ---
 * **주문카드는 카드번호를 눌러야 열린다.** 전에는 줄 아무 데나 누르면 열려서,
 * 순서를 끌어 옮기려다 창이 튀어나왔다(2026-09-09 사장님: "클릭으로 열리는게 아니라").
 * 끄는 자리와 여는 자리를 갈라 놓는다.
 */

export interface DayListHandlers {
  /** 카드번호를 눌렀다 — 주문카드를 연다 */
  open: (_o: Order) => void;
  /** 다 한 것 체크 */
  toggleDone: (_id: string) => void;
  /** 오전 ↔ 오후 */
  toggleSlot?: (_id: string) => void;
  /** 목록에서 뺀다 */
  remove?: (_id: string) => void;
  /** 끌어 놓아 차례가 바뀌었다 — 바뀐 차례 전체를 준다 */
  reorder?: (_next: string[]) => void;
  /** 묶기용 고르기 */
  select?: (_id: string) => void;
}

interface Props {
  rows: DayRow[];
  orders: readonly Order[];
  partners: readonly Partner[];
  on: DayListHandlers;
  /** 캘린더 칸처럼 좁은 자리 — 글자와 여백을 줄인다 */
  compact?: boolean;
  /** 묶으려고 고른 것들. 넘기면 줄마다 고르기 칸이 뜬다. */
  selected?: Set<string>;
}

/** 묶음 띠 색 — 묶음 id 로 고르되 **클래스 이름은 통째로 적는다**(Tailwind 가 글자를 찾는다) */
const 묶음색 = ['border-l-sky-400', 'border-l-emerald-400', 'border-l-violet-400', 'border-l-orange-400', 'border-l-rose-400'];
const 띠색 = (id: string) => {
  let n = 0;
  for (const c of id) n = (n + c.charCodeAt(0)) % 997;
  return 묶음색[n % 묶음색.length];
};

const DeliveryDayList: React.FC<Props> = ({ rows, orders, partners, on, compact = false, selected }) => {
  const [dragId, setDragId] = React.useState<string | null>(null);

  if (rows.length === 0) {
    return <p className={`text-center font-bold text-slate-300 ${compact ? 'text-[10px] py-3' : 'text-[11px] py-6'}`}>배송 없음</p>;
  }

  const 차례 = rows.map(r => r.orderId);
  const 놓기 = (onId: string) => {
    if (!dragId || dragId === onId || !on.reorder) { setDragId(null); return; }
    const next = [...차례];
    next.splice(next.indexOf(dragId), 1);
    next.splice(next.indexOf(onId), 0, dragId);
    on.reorder(next);
    setDragId(null);
  };

  return (
    <div className={`flex flex-col ${compact ? 'gap-0.5' : 'gap-1'}`}>
      {rows.map((r, i) => {
        const o = orders.find(x => x.id === r.orderId);
        if (!o) return null;
        const 이름 = partners.find(c => c.id === o.partnerId)?.name || o.partnerName || '';
        const 고름 = selected?.has(r.orderId) ?? false;
        return (
          <div
            key={r.orderId}
            draggable={!!on.reorder}
            onDragStart={() => setDragId(r.orderId)}
            onDragOver={e => e.preventDefault()}
            onDrop={() => 놓기(r.orderId)}
            className={`flex items-center rounded-xl border bg-white transition-all ${
              compact ? 'gap-1 px-1.5 py-1' : 'gap-2 px-2.5 py-2'
            } ${r.done ? 'opacity-50' : ''} ${
              //  묶음은 왼쪽 굵은 띠로 잇는다 — 첫 줄만 위, 끝 줄만 아래가 둥글다
              r.groupId ? `border-l-4 ${띠색(r.groupId)} ` : ''
            }${고름 ? 'ring-2 ring-indigo-400 border-indigo-200' : 'border-slate-100'} ${
              on.reorder ? 'cursor-grab active:cursor-grabbing' : ''}`}
          >
            {/* 다 한 것 체크 */}
            <button
              type="button"
              onClick={e => { e.stopPropagation(); on.toggleDone(r.orderId); }}
              aria-label={r.done ? '완료 취소' : '완료'}
              className={`shrink-0 rounded-md border-2 flex items-center justify-center transition-colors ${
                compact ? 'w-3.5 h-3.5' : 'w-4 h-4'
              } ${r.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200 hover:border-emerald-400'}`}
            >
              {r.done && <span className={compact ? 'text-[8px]' : 'text-[10px]'}>✓</span>}
            </button>

            {/* 차례 */}
            <span className={`shrink-0 font-black tabular-nums text-slate-400 ${compact ? 'text-[9px] w-3' : 'text-[10px] w-4'}`}>
              {i + 1}
            </span>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 min-w-0">
                <span className={`font-bold text-slate-700 truncate ${r.done ? 'line-through' : ''} ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
                  {이름}
                </span>
                {/*  **아직 안 만든 주문인지 보여야 한다**(2026-09-09 사장님: "금일 배송순서에
                     대기중 작업중 이 상태가 없네"). 전에는 작업완료 주문만 올라와서 상태가
                     늘 같았는데, 이제 대기중·작업중도 같이 뜬다 — 색으로 갈라 보인다.
                     색은 [orderStatusStyle](../src/shared/orderStatusStyle.ts) 한 곳이 정한다. */}
                <span className={`shrink-0 font-black rounded px-1 py-0.5 ${statusColor(o.status)} ${compact ? 'text-[8px]' : 'text-[9px]'}`}>
                  {statusLabel(o.status)}
                </span>
                {/*  캘린더에서 저절로 들어온 줄. 사람이 손대면 떨어진다. */}
                {r.auto && (
                  <span className={`shrink-0 font-black text-slate-300 ${compact ? 'text-[8px]' : 'text-[9px]'}`}>자동</span>
                )}
              </div>
              {/*  **카드번호를 눌러야 주문카드가 열린다** — 줄 전체를 누르면 끌어 옮길 수가 없다 */}
              <button
                type="button"
                onClick={e => { e.stopPropagation(); on.open(o); }}
                onPointerDown={e => e.stopPropagation()}
                className={`text-left font-black text-indigo-400 hover:text-indigo-600 hover:underline tabular-nums ${compact ? 'text-[8px]' : 'text-[9px]'}`}
              >
                {cardNoLabel(o)}
              </button>
              {!compact && (
                <span className="text-[9px] text-slate-300 font-bold ml-1.5">{o.items.length}품목</span>
              )}
              {r.groupName && r.groupFirst && (
                <span className={`ml-1.5 font-black text-slate-400 ${compact ? 'text-[8px]' : 'text-[9px]'}`}>· {r.groupName}</span>
              )}
            </div>

            {/* 묶기 고르기 */}
            {on.select && (
              <button type="button" onClick={e => { e.stopPropagation(); on.select!(r.orderId); }}
                aria-label={r.groupId ? '묶음에서 빼기' : '묶을 것 고르기'}
                className={`shrink-0 transition-colors ${고름 ? 'text-indigo-500' : 'text-slate-200 hover:text-indigo-400'}`}>
                {r.groupId ? <Unlink size={compact ? 10 : 12} /> : <Link2 size={compact ? 10 : 12} />}
              </button>
            )}

            {on.toggleSlot && (
              <button type="button" onClick={e => { e.stopPropagation(); on.toggleSlot!(r.orderId); }}
                className={`shrink-0 font-black transition-colors ${compact ? 'text-[8px]' : 'text-[9px]'} ${
                  r.slot === '오후' ? 'text-indigo-400 hover:text-indigo-600' : 'text-amber-400 hover:text-amber-600'}`}>
                {r.slot}
              </button>
            )}

            {on.remove && (
              <button type="button" onClick={e => { e.stopPropagation(); on.remove!(r.orderId); }}
                aria-label="목록에서 빼기" className="shrink-0 text-slate-200 hover:text-rose-400">
                <X size={compact ? 9 : 11} />
              </button>
            )}

            {on.reorder && !compact && <GripVertical size={12} className="shrink-0 text-slate-200" />}
          </div>
        );
      })}
    </div>
  );
};

export default DeliveryDayList;
