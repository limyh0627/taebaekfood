import React from 'react';
import {MapPin,GripVertical} from 'lucide-react';
import {OrderStatus,type Order,type Partner} from '../../../shared/types';
import {partnerLabel,shipToOf} from '../../../shared/shipTo';
import {channelStyle,shipMethodOf} from '../../../shared/channelStyle';
import {STATUS_CARD_BORDER,STATUS_HEAD_LINE} from '../../../shared/orderStatusStyle';
import {cardNoLabel} from '../../../shared/cardNo';
import {OrderRecoveryEntry} from './OrderRecoveryEntry';

export type DeliveryCalendarCardOptions = {
      번호?: number; 띠?: string; 번호색?: string;
      /** 그 묶음에 몇 장인가 — 번호 고르개에 세울 숫자들. */
      번호총수?: number;
      /** 같은 차 묶음 — 캘린더에서도 붙어 있다는 표시를 남긴다. */
      한차?: boolean;
      /** 번호를 눌러 자리를 옮긴다(0부터). 안 주면 번호는 글자로만 뜬다. */
      onGotoNumber?: (목표: number) => void;
      drag?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
    };

/**
   * **배송 카드 한 벌 — 어느 날 칸이든 같은 모양이다.**
   *
   * 2026-09-12 사장님: "카드 양식이 당일에 해당하는 바탕색 없는 카드로 통일했으면 좋겠고".
   * **당일 칸이 쓰던 흰 카드**가 기준이다 — 다른 날 칸은 상태색을 바탕에 통째로 깔아
   * 같은 캘린더 안에서 두 가지 카드가 보였다.
   *
   * 담기는 것 — 번호(있으면) · 거래처 · **주문번호** · 주소 · 상태, 그리고 손잡이.
   * 출고완료면 **줄이 그어지고 흐려진다**(사장님: "출고완료되면 월간 카드 처럼 줄그어지고
   * 흐릿해지는 기능"). 카드를 누르면 주문 상세, **주문번호를 누르면 출고일정**이다.
   */
export default function DeliveryCalendarCard({o,opt,partners,handleOrderClick,setPreviewDeliveryOrderId,calendarLocationOf,renderOrderRecovery,statusText}:{o:Order;opt:DeliveryCalendarCardOptions;partners:Partner[];handleOrderClick:(order:Order)=>void;setPreviewDeliveryOrderId:(id:string)=>void;calendarLocationOf:(order:Order)=>string;renderOrderRecovery?:(order:Order)=>React.ReactNode;statusText:string}) {
    //  **배송지까지 붙인다**(2026-09-16 사장님: "배송캘린더에서도 배송지명으로 들어가있게").
    const 그거래처 = partners.find(c => c.id === o.partnerId);
    const 이름 = partnerLabel(그거래처?.name || o.partnerName || '', shipToOf(그거래처, o.shipToId)?.name);
    const 끝났나 = o.status === OrderStatus.SHIPPED;
    return (
      <div
        key={o.id}
        {...opt.drag}
        /*  **카드를 누르면 출고 일정 수정**(2026-09-15 사장님: "카드 자체를 누르면 출고일정수정이
             뜨게 바꾸고 주문 번호를 눌렀을때 주문카드 보이게"). 둘을 맞바꿨다 —
             배송 화면에서 카드를 누르는 까닭은 열에 아홉 **날짜를 옮기려는 것**인데,
             넓은 카드가 주문 상세를 열고 좁은 주문번호가 일정 수정을 열고 있었다.
             자주 하는 일을 넓은 자리에 둔다. */
        onClick={() => handleOrderClick(o)}
        /*  **주문 카드와 같은 옷을 입힌다**(2026-09-14 사장님: "저기 있는 카드들도 주문카드랑
             색 맞춰 글씨랑 테두리"). 전에는 `statusChip` 을 통째로 얹어 **바탕까지 상태색으로
             칠했다** — 캘린더 칸은 카드가 작고 여럿이라 바탕이 깔리면 온통 색판이 됐다
             ("대기중 왤케 노래"). 주문 카드는 바탕이 흰색이고 **테두리와 글자**로만 상태를
             알린다(`STATUS_CARD_BORDER`·`STATUS_HEAD_LINE`) — 같은 규칙을 쓴다.
             오전·오후는 번호 색으로 남는다(`opt.번호색`). */
        title={`${이름} · ${statusText} — 눌러서 출고 일정 수정`}
        className={`flex items-center gap-1.5 rounded-xl border bg-white px-2 py-1.5 shadow-sm transition-all hover:brightness-95 cursor-pointer ${STATUS_CARD_BORDER[o.status] ?? 'border-slate-200'} ${opt.한차 ? 'border-l-4 border-l-indigo-400' : ''} ${끝났나 ? 'opacity-50' : ''}`}
      >
        {/*  **번호를 눌러 자리를 고른다**(2026-09-15 사장님: "배송캘린더에 배송순서 숫자 눌러서
             번호 타겟할 수 있게 바꿔주고"). 좁은 칸에서 카드를 끌어 옮기는 것보다 확실하다 —
             금일 배송순서 판이 진작 쓰던 방식이라 모양을 맞춘다. */}
        {opt.번호 !== undefined && (
          opt.onGotoNumber && (opt.번호총수 ?? 0) > 1 ? (
            <select
              aria-label={`${이름} 배송 순서`}
              value={opt.번호}
              onClick={e => e.stopPropagation()}
              onPointerDown={e => e.stopPropagation()}
              onChange={e => { e.stopPropagation(); opt.onGotoNumber?.(Number(e.target.value) - 1); }}
              className={`w-6 shrink-0 cursor-pointer appearance-none rounded bg-transparent text-center text-[9px] font-black outline-none hover:bg-slate-100 ${opt.번호색 ?? 'text-slate-400'}`}
            >
              {Array.from({ length: opt.번호총수 ?? 0 }, (_, i) => i + 1)
                .map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          ) : (
            <span className={`w-3 shrink-0 text-[9px] font-black ${opt.번호색 ?? 'text-slate-400'}`}>{opt.번호}</span>
          )
        )}
        <span className="min-w-0 flex-1">
          {/*  **주문번호는 맨 위, 작게**(2026-09-16 사장님: "주문번호는 크기 좀 줄여서 맨 위에 둬").
               어느 주문인지 짚을 때만 보는 것이라 거래처명 밑에서 자리를 다투고 있었다.
               위로 올려 **한 줄로 얇게** 깔면 아래 이름이 온전히 넓어진다.
               누르면 주문 상세 — 2026-09-12 에 여기 붙였던 출고 일정 수정은 카드 전체로 옮겼다.
               카드 눌림과 겹치지 않게 여기서 끊는다. */}
          <button
            type="button"
            title="눌러서 주문 상세 보기"
            aria-label={`${이름} 주문 상세`}
            onClick={e => { e.stopPropagation(); setPreviewDeliveryOrderId(o.id); }}
            className="block max-w-full truncate text-left text-[8px] font-black text-indigo-400 tabular-nums hover:underline"
          >{cardNoLabel(o)}</button>
          <span className="flex min-w-0 items-center gap-1">
            {/*  **출고 방식은 거래처명 앞이다**(사장님: "배송 택배 이런게 거래처명 좌측으로 오자").
                 뒤에 두면 긴 거래처명에 밀려 잘려 나갔고, 딱지가 줄마다 다른 자리에 서서
                 세로로 훑을 수가 없었다. 앞에 세우면 딱지들이 한 줄로 선다.
                 주문 카드도 판매 채널을 이름 앞에 둔다 — 같은 규칙이다.
                 배송·직접수령·택배. 안 적힌 옛 주문은 판매 채널로 읽는다(`shipMethodOf`). */}
            <span className={`shrink-0 rounded px-1 py-0.5 text-[8px] font-black ${channelStyle(shipMethodOf(o) === '배송' ? '일반' : shipMethodOf(o)).chip}`}>
              {shipMethodOf(o)}
            </span>
            {/*  **거래처명이 이 카드의 주인공이다**(사장님: "거래처명 글씨 크기 좀만 키우고") —
                 10 → 12px. 멀리서 훑을 때 읽히는 것이 이름이다. */}
            <span className={`min-w-0 truncate text-[12px] font-bold ${STATUS_HEAD_LINE[o.status] ?? 'text-slate-700'} ${끝났나 ? 'line-through' : ''}`}>{이름}</span>
          </span>
          {calendarLocationOf(o) && (
            <span className="mt-0.5 flex items-center gap-0.5 truncate text-[9px] font-medium text-slate-500">
              <MapPin size={9} className="shrink-0" />{calendarLocationOf(o)}
            </span>
          )}
        </span>
        {/*  **상태 글자는 뺐다 — 색으로만 알린다**(2026-09-15 사장님: "작업완료 대기중 이런건
             빼고 색깔로만 구분할게 배송캘린더 쪽에선"). 칸이 좁아 `작업완료` 네 글자가
             거래처명을 밀어냈다. 테두리와 거래처명 색이 이미 같은 말을 하고 있다
             (`STATUS_CARD_BORDER`·`STATUS_HEAD_LINE`). 마우스를 올리면 글자로도 나온다. */}
        {opt.drag?.draggable && <GripVertical size={10} className="shrink-0 text-slate-300" />}
        <div onClick={event=>event.stopPropagation()}><OrderRecoveryEntry order={o} renderOrderRecovery={renderOrderRecovery} /></div>
      </div>
    );
  }
