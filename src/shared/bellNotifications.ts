import type { AppNotification } from './types';

const BELL_TYPES: ReadonlySet<AppNotification['type']> = new Set(['new_order', 'mention']);

/**
 * 종은 바로 확인해야 하는 신규 주문과 오피스톡만 보여준다.
 * 확인사항·연차·재고 사고 문서는 각 업무 화면에서 계속 쓰므로 DB에서는 지우지 않는다.
 */
export function selectBellNotifications(notifications: AppNotification[], userId: string): {
  visible: AppNotification[];
  unread: AppNotification[];
} {
  const visible = notifications.filter(n =>
    BELL_TYPES.has(n.type)
    && (!n.targetId || n.targetId === userId)
    && !(n.dismissedBy ?? []).includes(userId));
  const unread = visible.filter(n => !n.readBy.includes(userId));
  return { visible, unread };
}
