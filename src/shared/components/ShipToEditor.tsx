import React, { useState } from 'react';
import { MapPin, Plus, X, ArrowUp } from 'lucide-react';
import { isShipMethod } from '../partnerShipping';
import type { ShipTo, ShipMethod } from '../types';

/**
 * **배송지 편집** — 한 거래처 안에서 물건이 갈라져 가는 곳을 매긴다.
 *
 * 2026-09-16 사장님: "일반기능으로 넣고" — 해피유통만 쓰는 게 아니라 어느 거래처든
 * 배송지를 달 수 있게 한다. 값은 같고, 나중에 다른 거래처에도 쓴다.
 *
 * ---
 * **지우지 않고 보관한다.** 지난 주문이 배송지 id 를 가리키고 있어서, 지우면 그 주문들의
 * 이름이 `해피유통(쿠팡)` 에서 `해피유통` 으로 조용히 바뀐다. 어느 주문이 어디로 갔는지
 * 기록이 사라지는 것이다. 보관하면 고르는 목록에서만 빠지고 지난 주문은 그대로 읽힌다.
 *
 * **맨 앞이 기본 배송지다**(`shipTo.defaultShipToId`) — 주문 화면이 그걸 먼저 고른다.
 * 순서를 사람이 정하게 둔다. 코드가 "주문이 제일 많은 곳" 같은 걸로 고르면 어느 날 갑자기
 * 기본값이 바뀌어 있고 왜 바뀌었는지 아무도 모른다.
 */
export default function ShipToEditor(props: {
  value: ShipTo[];
  shippingEnabled?: boolean;
  onChange: (next: ShipTo[]) => void;
}) {
  const { value, onChange, shippingEnabled = true } = props;
  const [draft, setDraft] = useState('');
  const [method, setMethod] = useState<ShipMethod | ''>('');

  const add = () => {
    const name = draft.trim();
    if (!name || (shippingEnabled && !isShipMethod(method))) return;
    if (value.some(s => s.name === name && !s.archived)) { setDraft(''); return; }
    //  id 는 만든 순간으로 짓는다 — 이름을 고쳐도 지난 주문이 안 끊긴다.
    onChange([...value, { id: `st-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name, ...(shippingEnabled && isShipMethod(method) ? {defaultShipMethod:method} : {}) }]);
    setDraft('');
    setMethod('');
  };

  const rename = (id: string, name: string) =>
    onChange(value.map(s => (s.id === id ? { ...s, name } : s)));

  const toggleArchive = (id: string) =>
    onChange(value.map(s => (s.id === id ? { ...s, archived: !s.archived } : s)));

  /** 맨 앞으로 — 그게 곧 기본 배송지다. */
  const toTop = (id: string) => {
    const 것 = value.find(s => s.id === id);
    if (!것) return;
    onChange([것, ...value.filter(s => s.id !== id)]);
  };

  const 쓰는것 = value.filter(s => !s.archived);

  return (
    <div>
      <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">
        <MapPin size={12} className="mr-1 inline" aria-hidden="true" />
        배송지
      </label>

      {value.length === 0 ? (
        <p className="mb-2 text-[11px] font-medium leading-snug text-slate-400">
          한 거래처가 여러 곳으로 나갈 때만 답니다. 안 달면 지금처럼 그대로 돕니다.
        </p>
      ) : (
        <p className="mb-2 text-[11px] font-bold leading-snug text-slate-400">
          맨 위가 <b className="text-slate-600">기본 배송지</b>입니다 · 배송지마다 나가는 품목을 따로 정할 수 있습니다
        </p>
      )}

      <div className="space-y-1.5">
        {value.map((s, i) => (
          <div key={s.id} className={`flex flex-wrap items-center gap-1.5 rounded-xl border px-2 py-1.5 ${
            s.archived ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white'}`}>
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {i === 0 && !s.archived
              ? <span className="shrink-0 rounded-md bg-slate-700 px-1.5 py-0.5 text-[9px] font-black text-white">기본</span>
              : (
                <button type="button" onClick={() => toTop(s.id)} disabled={s.archived}
                  title="기본 배송지로" aria-label={`${s.name} 기본 배송지로`}
                  className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30">
                  <ArrowUp size={12} aria-hidden="true" />
                </button>
              )}
            <input
              value={s.name}
              onChange={e => rename(s.id, e.target.value)}
              disabled={s.archived}
              aria-label="배송지 이름"
              className={`min-w-0 flex-1 bg-transparent text-sm font-bold outline-none ${s.archived ? 'text-slate-400 line-through' : 'text-slate-800'}`}
            />
            </div>
            {shippingEnabled && <select aria-label={s.name+' 기본 배송방식'} disabled={s.archived} value={isShipMethod(s.defaultShipMethod)?s.defaultShipMethod:''} onChange={e => onChange(value.map(row => row.id===s.id?{...row,defaultShipMethod:e.target.value as ShipMethod}:row))} className="order-3 w-full min-w-0 rounded-lg border border-slate-200 bg-white p-1.5 text-xs sm:order-none sm:w-auto sm:max-w-[45%]">
              <option value="" disabled>미설정 (거래처 기본 사용)</option>{(['배송','화물','수령','택배'] as const).map(m=><option key={m} value={m}>{m}</option>)}
            </select>}
            {/*  **지우기가 아니라 보관이다** — 지난 주문이 이 id 를 가리키고 있다. */}
            <button type="button" onClick={() => toggleArchive(s.id)}
              className="order-2 shrink-0 rounded-lg px-2 py-1 text-[10px] font-black text-slate-400 transition-colors hover:bg-white hover:text-slate-700 sm:order-none">
              {s.archived ? '되살리기' : '보관'}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-1.5 sm:flex">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="배송지 이름 (포천 · 쿠팡 물류센터 …)"
          aria-label="새 배송지 이름"
          className="col-span-2 w-full min-w-0 rounded-xl border border-slate-200 bg-white sm:w-auto sm:flex-1 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-400"
        />
        {shippingEnabled && <select aria-label="새 배송지 기본 배송방식" value={method} onChange={e=>setMethod(e.target.value as ShipMethod | '')} className="min-h-9 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-2 text-xs sm:w-auto sm:max-w-[40%]"><option value="">배송방식 선택</option>{(['배송','화물','수령','택배'] as const).map(m=><option key={m} value={m}>{m}</option>)}</select>}
        <button type="button" onClick={add} disabled={!draft.trim() || (shippingEnabled && !isShipMethod(method))}
          className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-slate-700 px-3 py-2 text-xs font-black text-white transition-colors hover:bg-slate-800 disabled:opacity-40">
          <Plus size={13} aria-hidden="true" /> 추가
        </button>
      </div>

      {shippingEnabled && <p className="mt-1.5 text-xs text-slate-500">새 배송지는 기본 배송방식을 선택한 뒤 추가합니다. 미설정 배송지는 거래처 기본값을 사용합니다.</p>}

      {쓰는것.length === 1 && (
        <p className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-slate-400">
          <X size={11} aria-hidden="true" />
          배송지가 하나뿐이면 갈래가 없는 것과 같습니다 — 주문 화면에 토글이 뜹니다
        </p>
      )}
    </div>
  );
}
