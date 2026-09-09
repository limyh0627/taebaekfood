import { describe, expect, it } from 'vitest';
import type { AppNotification } from './types';
import { selectBellNotifications } from './bellNotifications';

const notification = (
  id: string,
  type: AppNotification['type'],
  overrides: Partial<AppNotification> = {},
): AppNotification => ({
  id,
  type,
  title: id,
  body: id,
  readBy: [],
  createdAt: '2026-09-09T00:00:00.000Z',
  ...overrides,
});

describe('종 알림', () => {
  it('내 신규 주문과 오피스톡만 보여주고 그 안에서 안 읽은 것만 센다', () => {
    const { visible, unread } = selectBellNotifications([
      notification('주문', 'new_order'),
      notification('안읽은톡', 'mention', { targetId: 'me' }),
      notification('읽은톡', 'mention', { targetId: 'me', readBy: ['me'] }),
      notification('내가삭제한주문', 'new_order', { dismissedBy: ['me'] }),
      notification('남이삭제한주문', 'new_order', { dismissedBy: ['other'] }),
      notification('남의톡', 'mention', { targetId: 'other' }),
      notification('확인사항', 'confirmation'),
      notification('연차', 'leave_request', { targetId: 'me' }),
      notification('재고', 'inventory_shortage'),
    ], 'me');

    expect(visible.map(n => n.id)).toEqual(['주문', '안읽은톡', '읽은톡', '남이삭제한주문']);
    expect(unread.map(n => n.id)).toEqual(['주문', '안읽은톡', '남이삭제한주문']);
  });
});
