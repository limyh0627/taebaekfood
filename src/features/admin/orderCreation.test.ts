import { describe, expect, it, vi } from 'vitest';
import { newOrderCreationSession, submitOrderCreation } from './orderCreation';

describe('주문 생성 저장 세션', () => {
  it('본문 저장 실패 뒤 재시도해도 처음 만든 주문 ID를 그대로 쓴다', async () => {
    const session = newOrderCreationSession();
    const createIdentity = vi.fn(() => ({ id: 'ORD-1', cardNo: 'ORD-260914-001' }));
    const saveOrder = vi.fn()
      .mockRejectedValueOnce(new Error('응답 끊김'))
      .mockResolvedValueOnce(undefined);

    await expect(submitOrderCreation(session, { name: '첫 주문' }, { createIdentity, saveOrder }))
      .rejects.toThrow('응답 끊김');
    const retry = await submitOrderCreation(session, { name: '첫 주문' }, { createIdentity, saveOrder });

    expect(createIdentity).toHaveBeenCalledTimes(1);
    expect(saveOrder.mock.calls.map(call => call[0].id)).toEqual(['ORD-1', 'ORD-1']);
    expect(retry).toMatchObject({ status: 'saved', identity: { id: 'ORD-1' } });
  });

  it('부가 알림이 실패해도 주문은 저장 성공이고 실패 항목만 돌려준다', async () => {
    const session = newOrderCreationSession();
    const saveOrder = vi.fn().mockResolvedValue(undefined);
    const result = await submitOrderCreation(session, {}, {
      createIdentity: () => ({ id: 'ORD-2', cardNo: 'ORD-260914-002' }),
      saveOrder,
      followUps: [
        { label: '재고 부족 확인', run: vi.fn().mockResolvedValue(undefined) },
        { label: '신규 주문 알림', run: vi.fn().mockRejectedValue(new Error('알림 실패')) },
      ],
    });

    expect(saveOrder).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: 'saved',
      identity: { id: 'ORD-2', cardNo: 'ORD-260914-002' },
      failedFollowUps: ['신규 주문 알림'],
    });
    expect(session.identity).toBeNull();
  });

  it('저장 중 다시 누른 호출은 두 번째 쓰기를 시작하지 않는다', async () => {
    const session = newOrderCreationSession();
    let finish!: () => void;
    const saveOrder = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const deps = {
      createIdentity: () => ({ id: 'ORD-3', cardNo: 'ORD-260914-003' }),
      saveOrder,
    };

    const first = submitOrderCreation(session, {}, deps);
    await expect(submitOrderCreation(session, {}, deps)).resolves.toEqual({ status: 'busy' });
    finish();
    await first;

    expect(saveOrder).toHaveBeenCalledTimes(1);
  });
});
