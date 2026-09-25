import { describe, expect, it, vi } from 'vitest';
import { extractedOfficeTalkMessageIds } from './officeTalkOrder';
import { newOrderCreationSession, resetOrderCreationSession, submitOrderCreation } from '../features/admin/orderCreation';

describe('오피스톡 주문 완료 표시', () => {
  it('모달 열기·취소·저장 실패에서는 표시하지 않고, 성공한 같은 회사 주문만 표시한다', async () => {
    const saved: Array<{ companyId: 'taebaek' | 'punghoe'; sourceChatMessageId?: string; id: string }> = [];
    const session = newOrderCreationSession();
    const identity = { id: 'order-1', cardNo: 'ORD-001' };
    const draft = { companyId: 'taebaek' as const, sourceChatMessageId: 'message-1' };
    let fail = true;
    const saveOrder = vi.fn(async (retryIdentity: typeof identity, order: typeof draft) => {
      if (fail) throw new Error('저장 실패');
      saved.push({ ...order, id: retryIdentity.id });
    });
    const deps = { createIdentity: () => identity, saveOrder };

    // 메시지를 골라 창만 열거나 취소하면 저장된 주문이 없으므로 체크하지 않는다.
    expect(extractedOfficeTalkMessageIds(saved, 'taebaek')).toEqual([]);
    resetOrderCreationSession(session);
    expect(extractedOfficeTalkMessageIds(saved, 'taebaek')).toEqual([]);

    await expect(submitOrderCreation(session, draft, deps)).rejects.toThrow('저장 실패');
    expect(extractedOfficeTalkMessageIds(saved, 'taebaek')).toEqual([]);

    fail = false;
    await expect(submitOrderCreation(session, draft, deps)).resolves.toMatchObject({ status: 'saved', identity });
    expect(saved).toHaveLength(1);
    expect(extractedOfficeTalkMessageIds(saved, 'taebaek')).toEqual(['message-1']);
    expect(extractedOfficeTalkMessageIds(saved, 'punghoe')).toEqual([]);
  });

  it('동일 메시지의 중복 저장 재시도에도 체크는 한 번만 표시한다', () => {
    const orders = [
      { companyId: 'taebaek' as const, sourceChatMessageId: 'message-1' },
      { companyId: 'taebaek' as const, sourceChatMessageId: 'message-1' },
      { companyId: 'taebaek' as const, sourceChatMessageId: '' },
    ];
    expect(extractedOfficeTalkMessageIds(orders, 'taebaek')).toEqual(['message-1']);
  });
});
