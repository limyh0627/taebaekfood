import { OrderStatus } from './types';

/**
 * **주문 상태의 이름과 색 — 여기 하나가 정한다.**
 *
 * 네 곳에 따로 적혀 있었고 **셋이 서로 달랐다**(2026-09-06) —
 * 작업완료가 전표에선 하늘색, 달력에선 보라, 배송관리에선 초록이었다.
 * 배송관리에는 하늘 배경에 엉뚱한 글자색이 섞여 있었는데 복사 실수로 보인다.
 *
 * **주문 화면(OrdersList)이 기준이다**(2026-09-06 사장님) —
 * 제일 자주 보는 화면이고, 거기 색이 일을 그대로 따라간다.
 *
 *   대기중    **분홍**
 *   작업중    노랑
 *   작업완료  **초록** — 만들어 놓은 것
 *   출고완료  하늘
 *   예전 주문 **회색** — 끝나서 물러난 것
 *
 * 색을 옮긴 내력 — 2026-09-14 "대기중 분홍색으로 한번 바꿔봐" 로 대기중에 분홍을 입혔고,
 * "작업중 카드 색깔을 이걸로 바꾸고 출고완료 카드 색에 작업중 색을 써" 로 한 칸씩 밀어
 * (분홍→작업중 · 하늘→출고완료 · 대기중은 노랑으로) 두었다가, 09-15 화면을 보시고
 * "대기중 작업중 색 서로 바꾸라고" 하여 **대기중 분홍 · 작업중 노랑**으로 맞바꿨다.
 * 남색은 이제 상태 색으로 안 쓴다.
 *
 * `DELIVERED` 는 화면에서 '배송완료'가 아니라 **'예전 주문'**이다.
 * 따로 배송완료를 두지 않고, 끝난 주문이 이력으로 물러나는 자리다.
 */
export const STATUS_LABEL: Record<string, string> = {
  [OrderStatus.PENDING]: '대기중',
  [OrderStatus.PROCESSING]: '작업중',
  [OrderStatus.DISPATCHED]: '작업완료',
  [OrderStatus.SHIPPED]: '출고완료',
  [OrderStatus.DELIVERED]: '예전 주문',
  [OrderStatus.ON_HOLD]: '보류',
};

/** 딱지 — 옅은 바탕에 진한 글씨 */
export const STATUS_COLOR: Record<string, string> = {
  [OrderStatus.PENDING]: 'bg-pink-100 text-pink-700',
  [OrderStatus.PROCESSING]: 'bg-amber-100 text-amber-700',
  [OrderStatus.DISPATCHED]: 'bg-emerald-100 text-emerald-700',
  [OrderStatus.SHIPPED]: 'bg-sky-100 text-sky-700',
  [OrderStatus.DELIVERED]: 'bg-slate-100 text-slate-500',
  [OrderStatus.ON_HOLD]: 'bg-orange-100 text-orange-700',
};

/**
 * 카드 머리 띠 — 거래처명 줄에 상태색 바탕을 깐다. 카드를 멀리서 봐도 상태가 읽힌다.
 * 글자만 한 단 진하다 — 이름이 묻히지 않게.
 */
export const STATUS_HEAD: Record<string, string> = {
  [OrderStatus.PENDING]: 'bg-pink-100 text-pink-800',
  [OrderStatus.PROCESSING]: 'bg-amber-100 text-amber-800',
  [OrderStatus.DISPATCHED]: 'bg-emerald-100 text-emerald-800',
  [OrderStatus.SHIPPED]: 'bg-sky-100 text-sky-800',
  [OrderStatus.DELIVERED]: 'bg-slate-100 text-slate-600',
  [OrderStatus.ON_HOLD]: 'bg-orange-100 text-orange-800',
};

/**
 * **보드 카드 테두리** — 상태를 카드 가장자리로 알린다(2026-09-12 사장님: "카드 테두리에 색 넣어봐").
 *
 * 머리 띠의 바탕과 아래 선을 차례로 걷어내고 나니 상태가 글자 하나로만 남아 멀리서 안 보였다.
 * 바탕을 칠하지 않으면서 카드를 훑어볼 수 있는 자리가 테두리다.
 */
export const STATUS_CARD_BORDER: Record<string, string> = {
  /*  **글씨와 같은 색이다**(2026-09-15 사장님: "대기중 테두리 색을 글씨 색이랑 같은 색을 써").
      400 은 800 짜리 거래처명 옆에서 **바래 보였다** — 같은 카드인데 테두리만 물 빠진 듯했다.
      아래 `STATUS_HEAD_LINE` 과 짝을 맞춘다. 한쪽을 고치면 다른 쪽도 같이 고친다.
      (2026-09-12 "테두리색 좀만 어두운 계열로" 에서 300 → 400 으로 한 번 어둡게 했던 자리다) */
  [OrderStatus.PENDING]: 'border-pink-800',
  [OrderStatus.PROCESSING]: 'border-amber-800',
  [OrderStatus.DISPATCHED]: 'border-emerald-800',
  [OrderStatus.SHIPPED]: 'border-sky-800',
  [OrderStatus.DELIVERED]: 'border-slate-600',
  [OrderStatus.ON_HOLD]: 'border-orange-800',
};

/**
 * 보드 카드 머리 띠 — **글자색으로만** 상태를 알린다.
 *
 * 2026-09-12 사장님이 두 걸음으로 정하셨다: 먼저 "바탕색 빼고 테두리에 색 넣어봐",
 * 이어서 "거래처명 밑에 색깔 선 없애봐". 그래서 바탕도 선도 없다.
 */
export const STATUS_HEAD_LINE: Record<string, string> = {
  [OrderStatus.PENDING]: 'text-pink-800',
  [OrderStatus.PROCESSING]: 'text-amber-800',
  [OrderStatus.DISPATCHED]: 'text-emerald-800',
  [OrderStatus.SHIPPED]: 'text-sky-800',
  [OrderStatus.DELIVERED]: 'text-slate-600',
  [OrderStatus.ON_HOLD]: 'text-orange-800',
};

/** 주문 보드의 좁은 헤더 — 상태 색을 유지하면서 본문과 구분한다. */
export const CARD_HEADER_COLOR: Record<string, string> = {
  [OrderStatus.PENDING]: 'bg-pink-200 border-pink-300',
  [OrderStatus.PROCESSING]: 'bg-amber-200 border-amber-300',
  [OrderStatus.DISPATCHED]: 'bg-emerald-200 border-emerald-300',
  [OrderStatus.SHIPPED]: 'bg-sky-200 border-sky-300',
  [OrderStatus.DELIVERED]: 'bg-slate-200 border-slate-300',
  [OrderStatus.ON_HOLD]: 'bg-orange-200 border-orange-300',
};

/** 테두리까지 있는 딱지 — 달력·배송관리처럼 바탕이 흰 데서 쓴다 */
const BORDER: Record<string, string> = {
  [OrderStatus.PENDING]: 'border-pink-200',
  [OrderStatus.PROCESSING]: 'border-amber-200',
  [OrderStatus.DISPATCHED]: 'border-emerald-200',
  [OrderStatus.SHIPPED]: 'border-sky-200',
  [OrderStatus.DELIVERED]: 'border-slate-200',
  [OrderStatus.ON_HOLD]: 'border-orange-200',
};

export const statusColor = (s?: string): string =>
  STATUS_COLOR[s ?? ''] ?? 'bg-slate-50 text-slate-500';

export const statusLabel = (s?: string): string => STATUS_LABEL[s ?? ''] ?? String(s ?? '');

/** 테두리를 붙인 딱지 */
export const statusChip = (s?: string): string =>
  `${statusColor(s)} ${BORDER[s ?? ''] ?? 'border-slate-200'}`;

/**
 * **글자만·바탕만 쓰는 자리** — 딱지가 아니라 점 하나, 글자 하나로 상태를 보일 때.
 *
 * 배송관리는 글자만(`text-pink-500`), 주문목록 칸 머리는 바탕만(`bg-pink-500`)
 * 쓰고 있었고 **거기서 또 색이 갈렸다** — 작업중이 배송관리에선 남색, 다른 데선 하늘색이었다.
 *
 * **클래스 이름을 통째로 적는다.** Tailwind 는 빌드할 때 소스에서 글자를 찾아
 * 클래스를 만들므로, `text-${hue}-500` 처럼 이어 붙이면 **그 클래스가 안 만들어져
 * 색이 아예 안 나온다**(2026-09-06에 그렇게 짰다가 고쳤다).
 */
const TEXT_500: Record<string, string> = {
  [OrderStatus.PENDING]: 'text-pink-500',
  [OrderStatus.PROCESSING]: 'text-amber-500',
  [OrderStatus.DISPATCHED]: 'text-emerald-500',
  [OrderStatus.SHIPPED]: 'text-sky-500',
  [OrderStatus.DELIVERED]: 'text-slate-500',
  [OrderStatus.ON_HOLD]: 'text-orange-500',
};

const BG_500: Record<string, string> = {
  [OrderStatus.PENDING]: 'bg-pink-500',
  [OrderStatus.PROCESSING]: 'bg-amber-500',
  [OrderStatus.DISPATCHED]: 'bg-emerald-600',
  [OrderStatus.SHIPPED]: 'bg-sky-500',
  [OrderStatus.DELIVERED]: 'bg-slate-700',
  [OrderStatus.ON_HOLD]: 'bg-orange-500',
};

/** 옅은 바탕만 — 칸 배경처럼 넓게 깔 때 */
const BG_SOFT: Record<string, string> = {
  [OrderStatus.PENDING]: 'bg-pink-50/50',
  [OrderStatus.PROCESSING]: 'bg-amber-50/50',
  [OrderStatus.DISPATCHED]: 'bg-emerald-50/50',
  [OrderStatus.SHIPPED]: 'bg-sky-50/50',
  [OrderStatus.DELIVERED]: 'bg-slate-50/80',
  [OrderStatus.ON_HOLD]: 'bg-orange-50/50',
};

/** 글자만 — `text-pink-500` */
export const statusText = (s?: string): string => TEXT_500[s ?? ''] ?? 'text-slate-500';

/** 진한 바탕만 — 칸 머리의 점·띠 */
export const statusBg = (s?: string): string => BG_500[s ?? ''] ?? 'bg-slate-500';

/** 옅은 바탕만 — 칸 배경 */
export const statusBgSoft = (s?: string): string => BG_SOFT[s ?? ''] ?? 'bg-slate-50/50';

/** 칸 테두리 — 옅게 */
const BORDER_SOFT: Record<string, string> = {
  [OrderStatus.PENDING]: 'border-pink-100',
  [OrderStatus.PROCESSING]: 'border-amber-100',
  [OrderStatus.DISPATCHED]: 'border-emerald-100',
  [OrderStatus.SHIPPED]: 'border-sky-100',
  [OrderStatus.DELIVERED]: 'border-slate-200',
  [OrderStatus.ON_HOLD]: 'border-orange-100',
};

/** 칸 제목 글자 — 진하게 */
const TEXT_700: Record<string, string> = {
  [OrderStatus.PENDING]: 'text-pink-700',
  [OrderStatus.PROCESSING]: 'text-amber-700',
  [OrderStatus.DISPATCHED]: 'text-emerald-700',
  [OrderStatus.SHIPPED]: 'text-sky-700',
  [OrderStatus.DELIVERED]: 'text-slate-700',
  [OrderStatus.ON_HOLD]: 'text-orange-700',
};

export interface StatusColumnStyle {
  /** 점·띠 — 진한 바탕 */
  color: string;
  /** 칸 배경 — 옅은 바탕 */
  bgColor: string;
  borderColor: string;
  textColor: string;
}

/**
 * 주문 화면의 **칸 한 벌** — 점·배경·테두리·글자색.
 *
 * 칸마다 손으로 적혀 있었다(2026-09-06). 상태에서 다 나오는 값이라 여기서 낸다 —
 * 상태 색을 고치면 칸도 저절로 따라간다.
 */
export const statusColumn = (s?: string): StatusColumnStyle => ({
  color: statusBg(s),
  bgColor: statusBgSoft(s),
  borderColor: BORDER_SOFT[s ?? ''] ?? 'border-slate-200',
  textColor: TEXT_700[s ?? ''] ?? 'text-slate-700',
});
