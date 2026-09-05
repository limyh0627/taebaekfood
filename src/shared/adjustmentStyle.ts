/**
 * **확인사항 갈래의 이름과 색.**
 *
 * [AdminChecklist](../../components/AdminChecklist.tsx) 와
 * [ConfirmationItems](../../components/ConfirmationItems.tsx) 가 **글자까지 똑같이**
 * 따로 적고 있었다(2026-09-05). 갈래를 하나 더할 때 한쪽만 고치면, 같은 것이
 * 한 화면에서는 '가공비 전표'로 다른 화면에서는 '채팅 언급'으로 보인다.
 */
export type AdjustmentType =
  | 'quantity_change' | 'cancel_receipt' | 'reorder_alert' | 'oem_fee' | 'mention';

interface 딱지 { label: string; cls: string }

/** 모르는 갈래는 '채팅 언급'으로 본다 — 옛 기록에 갈래가 안 적힌 것이 있다. */
const 기본: 딱지 = { label: '채팅 언급', cls: 'bg-indigo-50 text-indigo-600' };

const 표: Record<string, 딱지> = {
  quantity_change: { label: '수량 변동',   cls: 'bg-blue-50 text-blue-600' },
  cancel_receipt:  { label: '입고 취소',   cls: 'bg-rose-50 text-rose-600' },
  reorder_alert:   { label: '발주 필요',   cls: 'bg-rose-50 text-rose-600' },
  oem_fee:         { label: '가공비 전표', cls: 'bg-violet-50 text-violet-600' },
};

export const adjTypeLabel = (type: string): string => (표[type] ?? 기본).label;
export const adjTypeClass = (type: string): string => (표[type] ?? 기본).cls;
