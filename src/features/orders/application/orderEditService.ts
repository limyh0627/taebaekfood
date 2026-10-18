import { isCalendarDay } from '../../../shared/day';
import { classifyOrderEdit, editBlockMessage } from '../../../shared/orderEditGuard';
import { boxCountOf } from '../../../shared/orderUnits';
import { companyOf, OrderStatus, type CompanyId, type Order, type OrderItem } from '../../../shared/types';
import type { SaveOutcome } from '../../../shared/saveOutcome';
export interface OrderEditDraft {
  deliveryDate: string;
  items: OrderItem[];
  note: string;
  noteImportant: boolean;
}
export type OrderEdit = {
  kind: 'draft';
  draft: OrderEditDraft;
} | {
  kind: 'items';
  items: OrderItem[];
};
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
export interface OrderEditPorts {
  isCurrent: () => boolean;
  confirm: (message: string) => Promise<boolean>;
  submit: (opening: Order, edit: OrderEdit, confirmedAddedToDispatched: boolean) => Promise<SaveOutcome>;
}
const cancelled = (): SaveOutcome => ({
  status: 'cancelled',
  message: '저장을 취소했습니다.'
});
/** 화면 상태를 소유하지 않고 기존 품목 판정과 원자 writer 사이의 저장 순서를 책임진다. */
export async function saveOrderEdit(input: OrderEditInput, ports: OrderEditPorts): Promise<SaveOutcome> {
  const {
    order,
    edit,
    companyId,
    actorUid
  } = input;
  if (!order || companyOf(order) !== companyId) return {
    status: 'rejected',
    message: '현재 회사의 주문을 찾을 수 없습니다.',
    nextAction: '회사와 주문을 확인한 뒤 다시 열어 주세요.'
  };
  if (!actorUid) return {
    status: 'rejected',
    message: '로그인 정보를 확인하지 못했습니다.',
    nextAction: '다시 로그인한 뒤 주문을 확인해 주세요.'
  };
  const items = edit.kind === 'draft' ? edit.draft.items : edit.items;
  const itemsIssue = orderEditItemsIssue(items, edit.kind);
  if (itemsIssue) return {
    status: 'rejected',
    message: itemsIssue,
    nextAction: '품목과 수량을 확인한 뒤 다시 저장해 주세요.'
  };
  if (edit.kind === 'draft') {
    const {
      draft
    } = edit;
    if (!isCalendarDay(draft.deliveryDate.split('T')[0])) return {
      status: 'rejected',
      message: '출고예정일을 확인해 주세요.',
      nextAction: '실제 달력에 있는 날짜를 선택해 주세요.'
    };
  }
  const decision = classifyOrderEdit(order, items);
  if (decision.kind === 'blocked') return {
    status: 'rejected',
    message: editBlockMessage(order, decision.line),
    nextAction: '완료된 품목의 작업을 되돌린 뒤 수량·구성을 수정해 주세요.'
  };
  if (!ports.isCurrent()) return cancelled();
  let confirmedAddedToDispatched = false;
  if (decision.kind === 'added' && order.status === OrderStatus.DISPATCHED) {
    const completed = order.items.filter(line => line.checked).length;
    let confirmed: boolean;
    try {
      confirmed = await ports.confirm(`작업완료된 주문에 품목을 더합니다 — ${decision.added.join(', ')}\n\n` + `이미 끝낸 ${completed}개 품목의 작업완료와 재고는 그대로 둡니다.\n` + `새로 더한 품목이 남아 있으므로 주문은 '작업중' 으로 돌아갑니다.\n\n계속할까요?`);
    } catch {
      return {
        status: 'rejected',
        message: '품목 추가 확인을 완료하지 못해 저장하지 않았습니다.',
        nextAction: '추가할 품목을 확인한 뒤 다시 저장해 주세요.'
      };
    }
    if (!confirmed) return cancelled();
    confirmedAddedToDispatched = true;
  }
  if (!ports.isCurrent()) return cancelled();
  // 파생 patch와 감사는 서버의 같은 트랜잭션에서 확정한다. 최초 화면 원문을 그대로 보낸다.
  try {
    return await ports.submit(order, edit, confirmedAddedToDispatched);
  } catch {
    return {
      status: 'unknown',
      message: '주문 저장 결과를 확인하지 못했습니다.',
      nextAction: '보관 요청의 결과 확인 또는 요청 중단을 선택해 주세요. 작성 내용은 유지했습니다.'
    };
  }
}
