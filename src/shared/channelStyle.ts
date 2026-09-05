import { User, Truck, Store, LayoutGrid } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * **거래처 채널(일반·택배·스마트스토어)의 아이콘과 색.**
 *
 * 다섯 곳에 따로 적혀 있었다(2026-09-05) — AddOrderModal · PasteOrderModal ·
 * ItemManager · OrdersList · AddPartnerModal. **그중 OrdersList 만 색 모양이 달랐고**
 * (`text-`/`bg-` 를 나눠 씀), AddPartnerModal 은 이름표까지 달고 있었다.
 *
 * 채널을 하나 더할 때 다섯 곳을 다 고쳐야 하고, 한 곳을 놓치면 그 화면에서만
 * 회색 네모로 보인다.
 */
export type ChannelKey = '일반' | '택배' | '스마트스토어';

export interface ChannelStyle {
  icon: LucideIcon;
  /** 이름표 — 거래처를 만들 때 고르는 자리가 쓴다 */
  label: string;
  /** 배경 + 글자를 한 덩어리로 (`bg-indigo-100 text-indigo-600`) */
  chip: string;
  /** 글자색만 */
  fg: string;
  /** 배경색만 */
  bg: string;
}

const 표: Record<ChannelKey, ChannelStyle> = {
  '일반':         { icon: User,  label: '일반 거래처',   chip: 'bg-indigo-100 text-indigo-600', fg: 'text-indigo-600', bg: 'bg-indigo-50' },
  '택배':         { icon: Truck, label: '택배사/대행',   chip: 'bg-pink-100 text-pink-600',     fg: 'text-pink-600',   bg: 'bg-pink-50' },
  '스마트스토어': { icon: Store, label: '스마트스토어',  chip: 'bg-lime-100 text-lime-600',     fg: 'text-lime-600',   bg: 'bg-lime-50' },
};

/** 모르는 채널 — 옛 거래처에 채널이 안 적힌 것이 있다 */
const 기본: ChannelStyle = {
  icon: LayoutGrid, label: '기타',
  chip: 'bg-slate-100 text-slate-600', fg: 'text-slate-600', bg: 'bg-slate-50',
};

export const channelStyle = (t?: string): ChannelStyle => 표[t as ChannelKey] ?? 기본;

/** 거래처를 만들 때 고르는 차례 */
export const CHANNELS: ChannelKey[] = ['일반', '택배', '스마트스토어'];

/** 물건을 실어 보내는 채널인가 — 택배·스마트스토어는 배송이 붙는다 */
export const isDeliveryChannel = (t?: string): boolean =>
  t === '택배' || t === '스마트스토어';
