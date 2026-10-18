import { isCalendarDay } from '../../../shared/day';
import { classifyOrderEdit, editBlockMessage } from '../../../shared/orderEditGuard';
import { stampOrderItemEdits } from '../../../shared/stampOrderItemEdits';
import { diffOrderItems } from '../../../shared/orderItemDiff';
import { workStatusFromItems } from '../../../shared/orderCompletion';
import { boxCountOf } from '../../../shared/orderUnits';
import { companyOf, OrderStatus, type CompanyId, type Order, type OrderItem, type OrderItemEdit } from '../../../shared/types';
import type { SaveOutcome } from '../../../shared/saveOutcome';

export interface OrderEditDraft { deliveryDate: string; items: OrderItem[]; note: string; noteImportant: boolean }
export type OrderEdit = { kind: 'draft'; draft: OrderEditDraft } | { kind: 'items'; items: OrderItem[] };
export const orderEditQuantity = (item: OrderItem): number => item.isBoxUnit ? boxCountOf(item) : item.quantity;

/** 전체 작성창의 양수 규칙과 기존 인라인 삭제·0 수량 입력 경로를 구분한다. */
export function orderEditItemsIssue(items: OrderItem[], kind: OrderEdit['kind']): string | null {
  if (!Array.isArray(items) || kind === 'draft' && !items.length) return '주문 품목을 한 개 이상 선택해 주세요.';
  if (items.some(item => !item || typeof item.itemId !== 'string' || !item.itemId.trim())) return '선택되지 않은 주문 품목이 있습니다.';
  if (items.some(item => !Number.isFinite(item.quantity) || !Number.isFinite(orderEditQuantity(item)))) return '주문 수량에 올바른 숫자를 입력해 주세요.';
  if (kind === 'draft' && items.some(item => orderEditQuantity(item) <= 0)) return '주문 수량은 0보다 크게 입력해 주세요.';
  return null;
}
interface OrderEditInput {
  order: Order | undefined;
  edit: OrderEdit;
  companyId: CompanyId;
  actorUid: string | undefined;
  actorName: string | undefined;
}
interface OrderEditPorts {
  isCurrent: () => boolean;
  confirm: (message: string) => Promise<boolean>;
  saveOrderPatch: (id: string, patch: Partial<Order>) => Promise<unknown>;
  appendItemHistory: (history: Omit<OrderItemEdit, 'id'>) => Promise<unknown>;
  now: () => string;
}
const cancelled = (): SaveOutcome => ({status:'cancelled',message:'저장을 취소했습니다.'});
const auditUnconfirmed = (id: string): SaveOutcome => ({
  status:'partial',reason:'followup-unconfirmed',committedIds:[id],unconfirmedIds:[],
  message:'주문 저장은 완료됐지만 수정 이력의 저장 결과를 확인하지 못했습니다.',
  nextAction:'주문을 다시 저장하지 말고 수정 이력을 확인해 주세요.',
});

/** 화면 상태를 소유하지 않고 기존 품목 판정과 원자 writer 사이의 저장 순서를 책임진다. */
export async function saveOrderEdit(input: OrderEditInput, ports: OrderEditPorts): Promise<SaveOutcome> {
  const {order,edit,companyId,actorUid,actorName} = input;
  if (!order || companyOf(order) !== companyId) return {
    status:'rejected',message:'현재 회사의 주문을 찾을 수 없습니다.',nextAction:'회사와 주문을 확인한 뒤 다시 열어 주세요.',
  };
  if (!actorUid) return {status:'rejected',message:'로그인 정보를 확인하지 못했습니다.',nextAction:'다시 로그인한 뒤 주문을 확인해 주세요.'};
  const items = edit.kind === 'draft' ? edit.draft.items : edit.items;
  const itemsIssue = orderEditItemsIssue(items, edit.kind);
  if (itemsIssue) return {status:'rejected',message:itemsIssue,nextAction:'품목과 수량을 확인한 뒤 다시 저장해 주세요.'};
  const extra: Partial<Order> = {};
  if (edit.kind === 'draft') {
    const {draft} = edit;
    if (!isCalendarDay(draft.deliveryDate.split('T')[0])) return {
      status:'rejected',message:'출고예정일을 확인해 주세요.',nextAction:'실제 달력에 있는 날짜를 선택해 주세요.',
    };
    if (draft.deliveryDate.split('T')[0] !== order.deliveryDate?.split('T')[0]) extra.deliveryDate = draft.deliveryDate;
    extra.note = draft.note;
    extra.noteImportant = !!draft.note && draft.noteImportant;
    if (draft.note !== (order.note || '') || draft.noteImportant !== !!order.noteImportant) {
      extra.noteBy = actorName || '미기록';
      extra.noteAt = ports.now();
    }
  }
  const decision = classifyOrderEdit(order, items);
  if (decision.kind === 'blocked') return {
    status:'rejected',message:editBlockMessage(order, decision.line),nextAction:'완료된 품목의 작업을 되돌린 뒤 수량·구성을 수정해 주세요.',
  };
  if (!ports.isCurrent()) return cancelled();
  if (decision.kind === 'added' && order.status === OrderStatus.DISPATCHED) {
    const completed = order.items.filter(line => line.checked).length;
    let confirmed: boolean;
    try { confirmed = await ports.confirm(
      `작업완료된 주문에 품목을 더합니다 — ${decision.added.join(', ')}\n\n`
      + `이미 끝낸 ${completed}개 품목의 작업완료와 재고는 그대로 둡니다.\n`
      + `새로 더한 품목이 남아 있으므로 주문은 '작업중' 으로 돌아갑니다.\n\n계속할까요?`,
    ); } catch {
      return {status:'rejected',message:'품목 추가 확인을 완료하지 못해 저장하지 않았습니다.',nextAction:'추가할 품목을 확인한 뒤 다시 저장해 주세요.'};
    }
    if (!confirmed) return cancelled();
  }
  if (!ports.isCurrent()) return cancelled();
  const at = ports.now();
  const stamped = stampOrderItemEdits(order.items, items, actorName, at);
  const status = [OrderStatus.PENDING,OrderStatus.PROCESSING,OrderStatus.DISPATCHED].includes(order.status)
    ? workStatusFromItems(stamped) : order.status;
  try {
    await ports.saveOrderPatch(order.id, {...extra,items:stamped,...(status ? {status} : {})});
  } catch {
    return {status:'unknown',message:'주문 저장 결과를 확인하지 못했습니다.',nextAction:'현재 주문을 확인한 뒤 다시 시도해 주세요. 작성 내용은 남아 있습니다.'};
  }
  const changes = diffOrderItems(order.items, stamped);
  if (!changes.length) return {status:'saved'};
  // 회사나 로그인이 바뀌면 이미 받은 업무 ACK는 보존하고 새 신원으로 후속 이력을 쓰지 않는다.
  if (!ports.isCurrent()) return auditUnconfirmed(order.id);
  try {
    await ports.appendItemHistory({orderId:order.id,at,by:actorName?.trim() || '미기록',changes:changes.map(change => change.text)});
  } catch { return auditUnconfirmed(order.id); }
  return {status:'saved'};
}
