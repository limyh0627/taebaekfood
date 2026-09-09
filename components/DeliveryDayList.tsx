import React from 'react';
import { GripVertical, X, Link2, Unlink } from 'lucide-react';
import type { Order, Partner } from '../types';
import type { DayRow } from '../src/shared/deliveryPlan';
import { cardNoLabel } from '../src/shared/cardNo';
import { statusColor, statusLabel } from '../src/shared/orderStatusStyle';
import { dateOfLocal } from '../src/shared/day';

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
  /** 드래그로 날짜를 옮길 때 원래 날짜를 함께 넘긴다. */
  dateStr: string;
  /** 오전 다음 오후처럼 번호를 하루 전체에서 이어 붙인다. */
  positionOffset?: number;
}

/** 묶음 띠 색 — 묶음 id 로 고르되 **클래스 이름은 통째로 적는다**(Tailwind 가 글자를 찾는다) */
const 묶음색 = ['border-l-sky-400', 'border-l-emerald-400', 'border-l-violet-400', 'border-l-orange-400', 'border-l-rose-400'];
const 띠색 = (id: string) => {
  let n = 0;
  for (const c of id) n = (n + c.charCodeAt(0)) % 997;
  return 묶음색[n % 묶음색.length];
};

const DeliveryDayList: React.FC<Props> = ({ rows, orders, partners, on, compact = false, selected, dateStr, positionOffset = 0 }) => {
  const [dragId, setDragId] = React.useState<string | null>(null);

  if (rows.length === 0) {
    return <p className={`text-center font-bold text-slate-300 ${compact ? 'text-[10px] py-3' : 'text-[11px] py-6'}`}>배송 없음</p>;
  }

  const 차례 = rows.map(r => r.orderId);
  const 놓기 = (movingId: string, onId: string, after: boolean) => {
    if (!movingId || movingId === onId || !on.reorder || !차례.includes(movingId)) { setDragId(null); return; }
    const next = [...차례];
    next.splice(next.indexOf(movingId), 1);
    const target = next.indexOf(onId);
    next.splice(after ? target + 1 : target, 0, movingId);
    on.reorder(next);
    setDragId(null);
  };

  const 순번바꾸기 = (orderId: string, toIndex: number) => {
    if (!on.reorder) return;
    const next = 차례.filter(id => id !== orderId);
    next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, orderId);
    on.reorder(next);
  };

  return (
    <div className={`flex flex-col ${compact ? 'gap-0.5' : 'gap-1'}`}>
      {rows.map((r, i) => {
        const o = orders.find(x => x.id === r.orderId);
        if (!o) return null;
        const 이름 = partners.find(c => c.id === o.partnerId)?.name || o.partnerName || '';
        const 고름 = selected?.has(r.orderId) ?? false;
        const 접수일 = dateOfLocal(o.createdAt);
        return (
          <div
            key={r.orderId}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              const movingId = e.dataTransfer.getData('orderId') || dragId || '';
              const sourceDate = e.dataTransfer.getData('deliverySourceDate');
              // 다른 날짜에서 온 카드는 바깥 날짜 칸이 받는다. 여기서 막으면 날짜 이동이 안 된다.
              if (sourceDate && sourceDate !== dateStr) return;
              if (!차례.includes(movingId)) return;
              e.preventDefault();
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              놓기(movingId, r.orderId, e.pageY > rect.top + window.scrollY + rect.height / 2);
            }}
            className={`flex items-center rounded-xl border bg-white transition-all ${
              compact ? 'gap-1.5 px-2 py-2' : 'gap-2 px-3 py-2.5'
            } ${r.done ? 'opacity-50' : ''} ${
              //  묶음은 왼쪽 굵은 띠로 잇는다 — 첫 줄만 위, 끝 줄만 아래가 둥글다
              r.groupId ? `border-l-4 ${띠색(r.groupId)} ` : ''
            }${고름 ? 'ring-2 ring-indigo-400 border-indigo-200' : 'border-slate-100'} ${
              dragId === r.orderId ? 'opacity-60 ring-2 ring-indigo-300' : ''}`}
          >
            {/* 카드 전체 대신 큼직한 손잡이만 끈다 — 번호·체크·주문번호 클릭과 충돌하지 않는다. */}
            {on.reorder && (
              <div
                draggable
                onDragStart={e => {
                  setDragId(r.orderId);
                  e.dataTransfer.setData('orderId', r.orderId);
                  e.dataTransfer.setData('deliverySourceDate', dateStr);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => setDragId(null)}
                title="잡아서 순서나 날짜 변경"
                className="shrink-0 self-stretch min-h-7 w-5 flex items-center justify-center text-slate-300 hover:text-indigo-500 cursor-grab active:cursor-grabbing"
              >
                <GripVertical size={compact ? 15 : 17} />
              </div>
            )}

            {/* 다 한 것 체크 */}
            <button
              type="button"
              onClick={e => { e.stopPropagation(); on.toggleDone(r.orderId); }}
              aria-label={r.done ? '완료 취소' : '완료'}
              className={`shrink-0 rounded-md border-2 flex items-center justify-center transition-colors ${
                compact ? 'w-[18px] h-[18px]' : 'w-5 h-5'
              } ${r.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200 hover:border-emerald-400'}`}
            >
              {r.done && <span className={compact ? 'text-[8px]' : 'text-[10px]'}>✓</span>}
            </button>

            {/* 숫자를 직접 눌러 목표 순서를 고른다 — 좁은 카드끼리 드래그하는 것보다 확실하다. */}
            {on.reorder ? (
              <select
                aria-label={`${이름} 배송 순서`}
                value={i}
                onPointerDown={e => e.stopPropagation()}
                onChange={e => 순번바꾸기(r.orderId, Number(e.target.value))}
                className={`shrink-0 appearance-none text-center font-black tabular-nums text-slate-500 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer outline-none focus:ring-2 focus:ring-indigo-300 ${compact ? 'w-7 h-7 text-xs' : 'w-8 h-8 text-sm'}`}
              >
                {rows.map((_, n) => <option key={n} value={n}>{positionOffset + n + 1}</option>)}
              </select>
            ) : (
              <span className={`shrink-0 font-black tabular-nums text-slate-400 ${compact ? 'text-xs w-4' : 'text-sm w-5'}`}>
                {positionOffset + i + 1}
              </span>
            )}

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 min-w-0">
                <span className={`font-bold text-slate-700 truncate ${r.done ? 'line-through' : ''} ${compact ? 'text-[15px]' : 'text-base'}`}>
                  {이름}
                </span>
                {/*  **아직 안 만든 주문인지 보여야 한다**(2026-09-09 사장님: "금일 배송순서에
                     대기중 작업중 이 상태가 없네"). 전에는 작업완료 주문만 올라와서 상태가
                     늘 같았는데, 이제 대기중·작업중도 같이 뜬다 — 색으로 갈라 보인다.
                     색은 [orderStatusStyle](../src/shared/orderStatusStyle.ts) 한 곳이 정한다. */}
                <span className={`shrink-0 font-black rounded px-1.5 py-0.5 ${statusColor(o.status)} ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
                  {statusLabel(o.status)}
                </span>
                {/*  캘린더에서 저절로 들어온 줄. 사람이 손대면 떨어진다. */}
                {r.auto && (
                  <span className={`shrink-0 font-black text-slate-300 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>자동</span>
                )}
              </div>
              {/*  **카드번호를 눌러야 주문카드가 열린다** — 줄 전체를 누르면 끌어 옮길 수가 없다 */}
              <div className="flex items-center gap-2 min-w-0 whitespace-nowrap overflow-hidden">
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); on.open(o); }}
                  onPointerDown={e => e.stopPropagation()}
                  className={`shrink-0 text-left font-black text-indigo-500 hover:text-indigo-700 hover:underline tabular-nums whitespace-nowrap ${compact ? 'text-xs' : 'text-[13px]'}`}
                >
                  {cardNoLabel(o)}
                </button>
                {접수일 && (
                  <span className={`shrink-0 text-slate-400 font-bold ${compact ? 'text-[11px]' : 'text-xs'}`}>
                    접수 {Number(접수일.slice(5, 7))}/{Number(접수일.slice(8, 10))}
                  </span>
                )}
                {!compact && <span className="shrink-0 text-[11px] text-slate-300 font-bold">{o.items.length}품목</span>}
              </div>
              {(on.select || on.toggleSlot || (r.groupName && r.groupFirst)) && (
                <div className="flex items-center gap-2 mt-0.5 min-h-4">
                  {/* 좁은 주간 칸에서 거래처명이 잘리지 않도록 보조 동작은 이름 아랫줄에 둔다. */}
                  {on.select && (
                    <button type="button" onClick={e => { e.stopPropagation(); on.select!(r.orderId); }}
                      aria-label={r.groupId ? '묶음에서 빼기' : '묶을 것 고르기'}
                      className={`shrink-0 inline-flex items-center gap-1 font-black transition-colors ${compact ? 'text-[10px]' : 'text-[11px]'} ${고름 ? 'text-indigo-500' : 'text-slate-400 hover:text-indigo-500'}`}>
                      {r.groupId ? <Unlink size={compact ? 13 : 15} /> : <Link2 size={compact ? 13 : 15} />}
                      묶기
                    </button>
                  )}
                  {on.toggleSlot && (
                    <button type="button" onClick={e => { e.stopPropagation(); on.toggleSlot!(r.orderId); }}
                      className={`shrink-0 font-black transition-colors ${compact ? 'text-[11px]' : 'text-xs'} ${
                        r.slot === '오후' ? 'text-indigo-500 hover:text-indigo-700' : 'text-amber-500 hover:text-amber-700'}`}>
                      {r.slot}
                    </button>
                  )}
                  {r.groupName && r.groupFirst && (
                    <span className={`font-black text-slate-400 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>· {r.groupName}</span>
                  )}
                </div>
              )}
            </div>

            {on.remove && (
              <button type="button" onClick={e => { e.stopPropagation(); on.remove!(r.orderId); }}
                aria-label="목록에서 빼기" className="shrink-0 text-slate-200 hover:text-rose-400">
                <X size={compact ? 9 : 11} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default DeliveryDayList;
