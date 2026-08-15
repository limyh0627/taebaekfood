import React from 'react';
import { subChipClass } from './submaterialStyle';

/**
 * 품목 카드 공용 표기 — 주문 생성·거래처별 품목이 같은 모양을 쓴다.
 *
 * 한 곳에 모아둔 이유: 두 화면이 같은 품목을 보여주는데 마크업이 갈려서
 * 한쪽만 규격이 안 보이거나 색이 달라지는 일이 반복됐다.
 * (기능은 화면마다 다르다 — 주문은 수량 입력, 거래처별 품목은 연결 버튼)
 */

/** 품목명 토큰 색상 — 등급(분·특A·A·골드·원액)과 용기(병)를 색으로 갈라 비슷한 이름 헷갈림 방지 */
const NAME_TOKEN_COLORS: Record<string, string> = {
  '병': 'text-teal-600',
  '분': 'text-blue-600',
  '특A': 'text-amber-800',
  'A': 'text-orange-500',
  '골드': 'text-yellow-500',
  '원액': 'text-purple-600',
};

/** 용량별 고정색 — 같은 용량은 어느 화면에서든 같은 색이라 눈으로 바로 갈린다 */
const VOLUME_CHIP_COLORS: Record<string, string> = {
  '180ml': 'bg-pink-100 text-pink-700',
  '300ml': 'bg-green-100 text-green-700',
  '350ml': 'bg-sky-100 text-sky-700',
  '1500ml': 'bg-indigo-100 text-indigo-700',
  '1750ml': 'bg-violet-100 text-violet-700',
  '1800ml': 'bg-red-100 text-red-700',
  '1kg': 'bg-amber-100 text-amber-800',
  '4kg': 'bg-orange-100 text-orange-700',
  '16.5kg': 'bg-cyan-100 text-cyan-700',
  '20kg': 'bg-emerald-100 text-emerald-800',
};

const VOLUME_RE = /^\d+(\.\d+)?\s*(ml|l|g|kg)$/i;
const normVolume = (s: string) => s.trim().toLowerCase().replace(/\s/g, '');

/** "참기름/병/분/300ml" → { base: "참기름/병/분", vol: "300ml" }. 이름에 없으면 규격에서 찾는다. */
export function splitNameVolume(product: { name: string; spec?: string }): { base: string; vol: string | null } {
  const parts = product.name.split('/');
  const last = parts[parts.length - 1]?.trim() ?? '';
  if (parts.length > 1 && VOLUME_RE.test(last)) {
    return { base: parts.slice(0, -1).join('/'), vol: normVolume(last) };
  }
  const spec = (product.spec ?? '').trim();
  if (spec && VOLUME_RE.test(spec)) return { base: product.name, vol: normVolume(spec) };
  return { base: product.name, vol: null };
}

/** 슬래시 이름을 토큰별로 색을 입혀 그린다 */
export function renderColoredName(name: string): React.ReactNode {
  const parts = name.split('/');
  if (parts.length === 1) return name;
  return parts.map((part, i) => {
    const color = NAME_TOKEN_COLORS[part.trim()];
    return (
      <React.Fragment key={i}>
        {i > 0 && <span className="text-slate-300">/</span>}
        {color ? <span className={color}>{part}</span> : part}
      </React.Fragment>
    );
  });
}

/**
 * 규격 칩 — 품목의 규격을 **그대로** 띄운다('300ml * 20'). 색만 용량으로 고른다.
 * 이름에서 '(20개입)'을 뺐으므로(2026-08-14) 규격이 낱개·10개입·20개입을 가르는 유일한 표시다.
 */
export function specText(spec?: string): string {
  const s = String(spec ?? '').trim();
  if (!s) return '';
  // 낱개(* 1)는 개입수를 안 적는다 — 1은 정보가 없고 자리만 먹는다
  return s.replace(/\s*[*x×]\s*1\s*$/i, '');
}

export function ProductSpecChip({ product }: { product: { name: string; spec?: string } }) {
  const { vol } = splitNameVolume(product);
  const text = specText(product.spec) || vol;
  if (!text) return null;
  return (
    <span className={`shrink-0 text-[11px] font-black px-2 py-1 rounded-lg whitespace-nowrap ${VOLUME_CHIP_COLORS[vol ?? ''] ?? 'bg-slate-100 text-slate-600'}`}>
      {text}
    </span>
  );
}

/** 이름 + 규격칩 한 줄 — 두 화면의 카드 머리가 같은 모양이 된다 */
export function ProductNameRow({ product }: { product: { name: string; spec?: string } }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <p className="text-xs font-bold text-slate-800 truncate flex-1 min-w-0">
        {renderColoredName(splitNameVolume(product).base)}
      </p>
      <ProductSpecChip product={product} />
    </div>
  );
}

/**
 * 품목 카드 — 주문 생성·거래처별 품목이 **같은 생김새**를 쓴다.
 *
 *   [낱개][20개입]              ← topChips (변형 선택·상태 배지 등 화면마다 다름)
 *   참기름/병/A/가득찬  [300ml*20]
 *   부자재 [5-1호박스][테이프-빨강]
 *   ...children               ← 수량 입력·연결 버튼 등 화면별 기능
 *
 * 기능은 children/topChips로 갈리고 껍데기만 공유한다.
 */
export function ProductCard({
  product, subs = [], selected = false, onClick, categoryLabel, topChips, children,
}: {
  product: { name: string; spec?: string };
  subs?: { id?: string; name: string; subtype?: string; category?: string }[];
  selected?: boolean;
  onClick?: () => void;
  /** 품목명 앞에 붙는 카테고리(참기름·들깨…). 값이 다르면 색도 다르다. */
  categoryLabel?: string;
  topChips?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      className={`p-3 rounded-2xl border transition-all flex flex-col gap-2 ${onClick ? 'cursor-pointer' : ''} ${
        selected ? 'bg-white border-indigo-500 shadow-md ring-1 ring-indigo-500' : 'bg-white border-slate-100 hover:border-indigo-200'
      }`}
    >
      {topChips && <div className="flex flex-wrap items-center gap-1">{topChips}</div>}
      <div className="min-w-0">
        {/* 카테고리 칩은 품목명 줄 왼쪽에 붙인다.
            이름은 truncate 대신 줄바꿈(break-keep)이라 칩과 같은 줄이어도 '...'으로 안 잘린다.
            규격은 색 칩 하나만 둔다(전엔 오른쪽 칩과 회색 줄로 두 번 떴다). */}
        <div className="flex items-start gap-2">
          <p className="text-[13px] font-bold text-slate-800 leading-snug break-keep flex-1 min-w-0">
            {categoryLabel && (
              <span className={`mr-1.5 align-middle text-[10px] font-black px-1.5 py-0.5 rounded-md ${categoryChipClass(categoryLabel)}`}>
                {categoryLabel}
              </span>
            )}
            {renderColoredName(splitNameVolume(product).base)}
          </p>
          <ProductSpecChip product={product} />
        </div>
        {subs.length > 0 && (
          // 한 줄에 하나씩 — '마개: 물엿캡-빨강' 처럼 갈래를 앞에 적는다
          <div className="flex flex-col gap-0.5 mt-1.5">
            {subs.map((s, i) => (
              <div key={s.id ?? `${s.name}-${i}`} className="flex items-center gap-1 min-w-0">
                <span className="text-[10px] font-black text-slate-400 shrink-0">{s.subtype || s.category || '부자재'}</span>
                <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded border leading-tight truncate ${subChipClass(s)}`}>
                  {s.name}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

/** 카테고리별 고정색 — 이름 해시라 다른 카테고리는 반드시 다른 색이 된다 */
const CATEGORY_CHIP_COLORS = [
  'bg-indigo-100 text-indigo-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-800',
  'bg-rose-100 text-rose-700', 'bg-sky-100 text-sky-700', 'bg-violet-100 text-violet-700',
  'bg-teal-100 text-teal-700', 'bg-orange-100 text-orange-700', 'bg-pink-100 text-pink-700',
  'bg-lime-100 text-lime-700', 'bg-cyan-100 text-cyan-700', 'bg-fuchsia-100 text-fuchsia-700',
];
/** 자주 쓰는 갈래는 눈에 익은 색으로 고정하고, 나머지는 이름으로 고르게 둔다 */
const CATEGORY_FIXED: Record<string, string> = {
  '참기름': 'bg-pink-100 text-pink-700',
  '들기름': 'bg-lime-100 text-lime-700',
  '참깨': 'bg-orange-100 text-orange-700',
  '들깨': 'bg-emerald-100 text-emerald-700',
  '검정깨': 'bg-slate-200 text-slate-700',
  '향미유': 'bg-violet-100 text-violet-700',
  '고춧가루': 'bg-rose-100 text-rose-700',
};
export function categoryChipClass(cat: string): string {
  if (CATEGORY_FIXED[cat]) return CATEGORY_FIXED[cat];
  const h = [...cat].reduce((a, c) => a + c.charCodeAt(0), 0);
  return CATEGORY_CHIP_COLORS[h % CATEGORY_CHIP_COLORS.length];
}
