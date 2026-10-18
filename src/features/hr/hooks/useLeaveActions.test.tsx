/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { LeaveRequest } from '../../../shared/types';
import { useLeaveActions } from './useLeaveActions';
const row = {
  id: 'leave-A',
  employeeId: 'emp',
  employeeName: '직원',
  companyId: 'taebaek',
  type: '연차',
  startDate: '2026-10-18',
  endDate: '2026-10-18',
  reason: '사유',
  status: 'pending',
  requestedAt: '2026-10-18',
  daysUsed: 1
} as LeaveRequest;
const unknown = {
  status: 'unknown' as const,
  message: '미확인',
  nextAction: '보관 요청 확인'
};
it('실제 행과 작업 원문을 전달하고 다른 작업은 같은 보관 계획으로 복구한다', async () => {
  const saved = {
    id: row.id,
    planId: 'mutation-plan',
    action: {
      action: 'approve' as const
    },
    description: '신청 승인'
  };
  let pending: typeof saved[] = [];
  const onAction = vi.fn(async (_row: LeaveRequest, _action: {
    action: string;
  }) => {
    pending = [saved];
    return unknown;
  });
  const inspect = vi.fn(async () => ({
    status: 'saved' as const
  }));
  const hook = renderHook(() => useLeaveActions({
    scopeKey: 'A',
    onAction,
    readPending: () => pending,
    inspect
  }));
  await act(async () => {
    await hook.result.current.run(row, {
      action: 'approve'
    });
  });
  expect(onAction.mock.calls[0]).toEqual([row, {
    action: 'approve'
  }]);
  expect(onAction.mock.calls[0][0]).toBe(row);
  await act(async () => {
    await hook.result.current.run(row, {
      action: 'reject'
    });
  });
  expect(onAction).toHaveBeenCalledOnce();
  expect(hook.result.current.pendingAction?.planId).toBe('mutation-plan');
  await act(async () => {
    await hook.result.current.inspect();
  });
  expect(inspect).toHaveBeenCalledWith('mutation-plan');
});
it('보관 조회 예외는 새 전송 없이 안내하고 기존 미확인 원문을 유지한다', async () => {
  let fail = false;
  const onAction = vi.fn(async () => unknown);
  const hook = renderHook(() => useLeaveActions({
    scopeKey: 'A',
    onAction,
    readPending: () => {
      if (fail) throw Error('storage');
      return [];
    }
  }));
  await act(async () => {
    await hook.result.current.run(row, {
      action: 'approve'
    });
  });
  fail = true;
  await act(async () => {
    await hook.result.current.run({
      ...row,
      id: 'other'
    }, {
      action: 'reject'
    });
  });
  expect(onAction).toHaveBeenCalledOnce();
  expect(hook.result.current.pendingAction?.id).toBe(row.id);
  expect(hook.result.current.message).toContain('전송하지 않았습니다');
  expect(hook.result.current.message).toContain('저장소');
});
it('저장 기능 미연결은 복구 불가능한 미확인 원문을 새로 만들지 않는다', async () => {
  const hook = renderHook(() => useLeaveActions({
    scopeKey: 'A'
  }));
  await act(async () => {
    await hook.result.current.run(row, {
      action: 'approve'
    });
  });
  expect(hook.result.current.pendingAction).toBeNull();
  expect(hook.result.current.message).toContain('연결되지 않아');
});
it('무관한 휴가는 처리하되 기존 미확인 휴가를 목록에서 지우지 않는다', async () => {
  const onAction = vi.fn().mockResolvedValueOnce(unknown).mockResolvedValueOnce({
    status: 'saved'
  });
  const hook = renderHook(() => useLeaveActions({
    scopeKey: 'A',
    onAction
  }));
  await act(async () => {
    await hook.result.current.run(row, {
      action: 'approve'
    });
  });
  await act(async () => {
    await hook.result.current.run({
      ...row,
      id: 'other'
    }, {
      action: 'approve'
    });
  });
  expect(onAction).toHaveBeenCalledTimes(2);
  expect(hook.result.current.pendingActions.map(x => x.id)).toEqual([row.id]);
});
it('반환값 없는 콜백을 성공으로 추정하지 않고 계정 변경 뒤 늦은 안내를 버린다', async () => {
  let finish!: (value: void) => void;
  const onAction = vi.fn(() => new Promise<void>(resolve => finish = resolve));
  const hook = renderHook(({
    scopeKey
  }) => useLeaveActions({
    scopeKey,
    onAction
  }), {
    initialProps: {
      scopeKey: 'UID-A'
    }
  });
  let result!: Promise<unknown>;
  act(() => {
    result = hook.result.current.run(row, {
      action: 'approve'
    });
  });
  hook.rerender({
    scopeKey: 'UID-B'
  });
  await act(async () => {
    finish();
    await result;
  });
  expect(hook.result.current.pendingActions).toEqual([]);
  expect(hook.result.current.message).toBe('');
});
it('전송 뒤 일시 보관 조회 실패가 회복되면 저장된 정확 계획으로 다시 연다', async () => {
  let reads = 0;
  const entry = {
    id: row.id,
    planId: 'exact-plan',
    action: {
      action: 'approve' as const
    },
    description: '승인'
  };
  const readPending = () => {
    reads++;
    if (reads === 3) throw Error('일시 읽기');
    return reads > 3 ? [entry] : [];
  };
  const inspect = vi.fn(async () => ({
    status: 'saved' as const
  }));
  const hook = renderHook(() => useLeaveActions({
    scopeKey: 'A',
    onAction: async () => unknown,
    readPending,
    inspect
  }));
  await act(async () => {
    await hook.result.current.run(row, {
      action: 'approve'
    });
  });
  expect(hook.result.current.pendingAction?.planId).toBeUndefined();
  await act(async () => {
    await hook.result.current.run(row, {
      action: 'reject'
    });
  });
  expect(hook.result.current.pendingAction?.planId).toBe('exact-plan');
  await act(async () => {
    await hook.result.current.inspect();
  });
  expect(inspect).toHaveBeenCalledWith('exact-plan');
});
