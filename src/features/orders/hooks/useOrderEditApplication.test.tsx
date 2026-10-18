/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OrderStatus, type Order } from '../../../shared/types';
import type {OrderEdit} from '../application/orderEditService';
import type { SaveOutcome } from '../../../shared/saveOutcome';
import { useOrderEditApplication, type PendingOrderEdit } from './useOrderEditApplication';
const opening: Order = {
  id: 'A',
  companyId: 'taebaek',
  partnerName: '거래처',
  items: [],
  totalAmount: 0,
  status: OrderStatus.PENDING,
  createdAt: '2026-10-18',
  deliveryDate: '2026-10-18',
  email: '',
  source: '일반'
};
const edit = {
  kind: 'items' as const,
  items: []
};
const unknown: SaveOutcome = {
  status: 'unknown',
  message: '미확인',
  nextAction: '결과 확인'
};
it('같은 주문 중복 송신을 막고 최초 opening과 edit만 전달한다', async () => {
  let finish!: (o: SaveOutcome) => void;
  const submit = vi.fn((_o: Order, _e: OrderEdit) => new Promise<SaveOutcome>(r => finish = r));
  const hook = renderHook(() => useOrderEditApplication({
    scopeKey: 'A',
    onSaveOrderEdit: submit
  }));
  let pending!: Promise<unknown>;
  act(() => {
    pending = hook.result.current.run(opening, edit);
    void hook.result.current.run(opening, edit);
  });
  expect(submit).toHaveBeenCalledOnce();
  expect(submit).toHaveBeenCalledWith(opening, edit);
  expect(hook.result.current.close()).toBe(false);
  await act(async () => {
    finish({
      status: 'saved'
    });
    await pending;
  });
  expect(hook.result.current.busy).toBe(false);
});
it('미확인 A가 있어도 B 초안을 전송할 수 있고 A 복구는 정확 plan만 조회한다', async () => {
  let stored: PendingOrderEdit[] = [];
  const submit = vi.fn(async (row: Order) => {
    if (row.id === 'A') {
      stored = [{
        id: 'A',
        planId: 'plan-A',
        description: 'A'
      }];
      return unknown;
    }
    return {
      status: 'saved' as const
    };
  });
  const inspect = vi.fn(async () => ({
    status: 'saved' as const
  }));
  const hook = renderHook(() => useOrderEditApplication({
    scopeKey: 'A',
    onSaveOrderEdit: submit,
    onReadPendingOrderEdits: () => stored,
    onInspectOrderEdit: inspect
  }));
  await act(async () => {
    await hook.result.current.run(opening, edit);
  });
  await act(async () => {
    await hook.result.current.run(opening, edit);
  });
  expect(submit).toHaveBeenCalledOnce();
  await act(async () => {
    await hook.result.current.run({
      ...opening,
      id: 'B'
    }, edit);
  });
  expect(submit).toHaveBeenCalledTimes(2);
  await act(async () => {
    await hook.result.current.inspect(stored[0]);
  });
  expect(inspect).toHaveBeenCalledWith('plan-A', 'A');
});
it('저장소 읽기 실패와 미연결은 전송0으로 원인을 안내한다', async () => {
  const submit = vi.fn(async () => ({
    status: 'saved' as const
  }));
  const hook = renderHook(() => useOrderEditApplication({
    scopeKey: 'A',
    onSaveOrderEdit: submit,
    onReadPendingOrderEdits: () => {
      throw Error('storage');
    }
  }));
  await act(async () => {
    await hook.result.current.run(opening, edit);
  });
  expect(submit).not.toHaveBeenCalled();
  expect(hook.result.current.message).toContain('전송하지 않았습니다');
});
it('회사와 UID 전환 뒤 이전 ACK가 새로운 화면을 완료시키지 않는다', async () => {
  let finish!: (o: SaveOutcome) => void;
  const hook = renderHook(({
    scopeKey
  }) => useOrderEditApplication({
    scopeKey,
    onSaveOrderEdit: () => new Promise<SaveOutcome>(r => finish = r)
  }), {
    initialProps: {
      scopeKey: 'taebaek:UID-A'
    }
  });
  let pending!: ReturnType<typeof hook.result.current.run>;
  act(() => {
    pending = hook.result.current.run(opening, edit);
  });
  hook.rerender({
    scopeKey: 'taebaek:UID-B'
  });
  await act(async () => {
    finish({
      status: 'saved'
    });
    expect((await pending).committed).toBe(false);
  });
  expect(hook.result.current.message).toBe('');
  expect(hook.result.current.pendingEdits).toEqual([]);
});
it('이미 적용된 요청 중단은 기존 주문을 보존했다는 안내를 남긴다', async () => {
  const cancel = vi.fn(async () => ({
    status: 'saved' as const
  }));
  const hook = renderHook(() => useOrderEditApplication({
    scopeKey: 'A',
    onCancelOrderEdit: cancel
  }));
  await act(async () => {
    await hook.result.current.cancel({
      id: 'A',
      planId: 'old-plan',
      description: 'A'
    });
  });
  expect(cancel).toHaveBeenCalledWith('old-plan', 'A');
  expect(hook.result.current.message).toContain('기존 주문은 유지');
});
it('오류 안내 대상은 busy 종료 뒤에도 A에만 남고 B 처리시 B로 전환한다', async () => {
  const hook = renderHook(() => useOrderEditApplication({
    scopeKey: 'A',
    onSaveOrderEdit: async () => unknown
  }));
  await act(async () => {
    await hook.result.current.run(opening, edit);
  });
  expect(hook.result.current.busyId).toBeNull();
  expect(hook.result.current.messageTargetId).toBe('A');
  await act(async () => {
    await hook.result.current.run({
      ...opening,
      id: 'B'
    }, edit);
  });
  expect(hook.result.current.messageTargetId).toBe('B');
});
it('과거 요청 inspect ACK는 새 초안 종료 대신 해당 주문 재확인을 안내한다',async()=>{const hook=renderHook(()=>useOrderEditApplication({scopeKey:'A',onInspectOrderEdit:async()=>({status:'saved'})}));await act(async()=>{expect((await hook.result.current.inspect({id:'A',planId:'old',description:'이전 요청'})).committed).toBe(true);});expect(hook.result.current.messageTargetId).toBe('A');expect(hook.result.current.message).toContain('현재 주문을 다시 열어');});
