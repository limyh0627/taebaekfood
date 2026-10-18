/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useLeaveApplication } from './useLeaveApplication';
const request = {
  id: 'request-1'
};
it('대기 중 중복을 막고 saved 또는 해당 업무 partial만 완료한다', async () => {
  let finish!: (v: any) => void;
  const submit = vi.fn(() => new Promise<any>(r => finish = r)),
    hook = renderHook(() => useLeaveApplication<{
      id: string;
    }>({
      scopeKey: 'A',
      submit
    }));
  let first!: ReturnType<typeof hook.result.current.submit>;
  act(() => {
    first = hook.result.current.submit(request);
    void hook.result.current.submit(request);
  });
  expect(submit).toHaveBeenCalledOnce();
  expect(hook.result.current.busy).toBe(true);
  await act(async () => {
    finish({
      status: 'partial',
      reason: 'followup-unconfirmed',
      message: '알림미확인',
      nextAction: '다시신청금지',
      committedIds: [request.id],
      unconfirmedIds: []
    });
    expect((await first).committed).toBe(true);
  });
  expect(hook.result.current.pending).toBeNull();
  expect(hook.result.current.message).toContain('다시신청금지');
});
it('unknown은 원문을 유지하고 inspect 부재 후에도 새 제출을 허용하지 않는다', async () => {
  const outcome = {
      status: 'unknown' as const,
      message: '미확인',
      nextAction: '확인'
    },
    submit = vi.fn().mockResolvedValue(outcome),
    inspect = vi.fn().mockResolvedValue(outcome);
  const hook = renderHook(() => useLeaveApplication<{
    id: string;
  }>({
    scopeKey: 'A',
    submit,
    inspect
  }));
  await act(async () => {
    await hook.result.current.submit(request);
  });
  await act(async () => {
    await hook.result.current.inspect();
    await hook.result.current.submit({
      id: 'new'
    });
  });
  expect(submit).toHaveBeenCalledOnce();
  expect(inspect).toHaveBeenCalledWith(request.id);
  expect(hook.result.current.pending).toBe(request);
});
it('명시 중단 ACK는 초안을 새로 제출할 수 있게 하고 닫기나 reload는 원문을 없애지 않는다', async () => {
  const submit = vi.fn().mockResolvedValue({
      status: 'unknown',
      message: '미확인',
      nextAction: '확인'
    }),
    cancel = vi.fn().mockResolvedValue({
      status: 'cancelled',
      message: '중단',
      nextAction: '새작성'
    });
  const hook = renderHook(() => useLeaveApplication<{
    id: string;
  }>({
    scopeKey: 'A',
    submit,
    cancel,
    readPending: () => [request]
  }));
  expect(hook.result.current.pendingRequests).toEqual([request]);
  act(() => hook.result.current.reopen(request));
  act(() => hook.result.current.close());
  expect(hook.result.current.pending).toBe(request);
  await act(async () => {
    expect((await hook.result.current.cancel()).cancelled).toBe(true);
  });
  expect(hook.result.current.pending).toBeNull();
  await act(async () => {
    await hook.result.current.submit({
      id: 'new'
    });
  });
  expect(submit).toHaveBeenCalledOnce();
});
it('회사 변경과 닫은 뒤 늦은 ACK는 새 화면을 완료시키지 않는다', async () => {
  let finish!: (v: any) => void;
  const submit = vi.fn(() => new Promise<any>(r => finish = r)),
    hook = renderHook(({
      scopeKey
    }) => useLeaveApplication<{
      id: string;
    }>({
      scopeKey,
      submit
    }), {
      initialProps: {
        scopeKey: 'A'
      }
    });
  let work!: ReturnType<typeof hook.result.current.submit>;
  act(() => {
    work = hook.result.current.submit(request);
  });
  hook.rerender({
    scopeKey: 'B'
  });
  await act(async () => {
    finish({
      status: 'saved'
    });
    expect((await work).committed).toBe(false);
  });
  expect(hook.result.current.message).toBe('');
  expect(hook.result.current.pending).toBeNull();
});
it('전송 전 명시 거절은 초안 controller를 동결하지 않고 수정 후 제출을 허용한다', async () => {
  const submit = vi.fn().mockResolvedValueOnce({
    status: 'rejected',
    message: '기기 저장소 확인',
    nextAction: '아직 전송하지 않았습니다.'
  }).mockResolvedValueOnce({
    status: 'saved'
  });
  const hook = renderHook(() => useLeaveApplication<{
    id: string;
  }>({
    scopeKey: 'A',
    submit
  }));
  await act(async () => {
    expect((await hook.result.current.submit(request)).committed).toBe(false);
  });
  expect(hook.result.current.pending).toBeNull();
  expect(hook.result.current.message).toContain('기기 저장소');
  await act(async () => {
    expect((await hook.result.current.submit({
      id: 'corrected'
    })).committed).toBe(true);
  });
  expect(submit).toHaveBeenCalledTimes(2);
});
it('새 회사 보관 조회가 실패해도 이전 회사 요청과 손상 참조는 남기지 않는다', () => {
  const readPending = vi.fn().mockReturnValueOnce([request]).mockImplementationOnce(() => {
    throw Error('읽기 실패');
  });
  const hook = renderHook(({
    scopeKey
  }) => useLeaveApplication<{
    id: string;
  }>({
    scopeKey,
    submit: vi.fn(),
    readPending,
    readReferences: () => [{
      planId: 'old-plan',
      readable: false
    }]
  }), {
    initialProps: {
      scopeKey: 'A'
    }
  });
  expect(hook.result.current.pendingRequests).toEqual([request]);
  hook.rerender({
    scopeKey: 'B'
  });
  expect(hook.result.current.pendingRequests).toEqual([]);
  expect(hook.result.current.damagedReferences).toEqual([]);
});
it('전송 중 닫기는 ACK 수신까지 보류하고 완료 후 pending이 남는 함정을 막는다', async () => {
  let finish!: (value: any) => void;
  const submit = vi.fn(() => new Promise<any>(resolve => finish = resolve)),
    hook = renderHook(() => useLeaveApplication<{
      id: string;
    }>({
      scopeKey: 'A',
      submit
    }));
  let work!: ReturnType<typeof hook.result.current.submit>;
  act(() => {
    work = hook.result.current.submit(request);
  });
  act(() => expect(hook.result.current.close()).toBe(false));
  expect(hook.result.current.message).toContain('확인하는 중');
  await act(async () => {
    finish({
      status: 'saved'
    });
    expect((await work).committed).toBe(true);
  });
  expect(hook.result.current.pending).toBeNull();
  expect(hook.result.current.pendingRequests).toEqual([]);
  act(() => expect(hook.result.current.close()).toBe(true));
});
it('같은 회사라도 실제 UID scope가 바뀌면 보관 요청과 늦은 ACK를 새 계정에 적용하지 않는다', async () => {
  let finish!: (value: any) => void;
  const submit = vi.fn(() => new Promise<any>(resolve => finish = resolve));
  const hook = renderHook(({
    uid
  }) => useLeaveApplication<{
    id: string;
  }>({
    scopeKey: 'taebaek:' + uid,
    submit,
    readPending: () => uid === 'A' ? [request] : []
  }), {
    initialProps: {
      uid: 'A'
    }
  });
  let work!: ReturnType<typeof hook.result.current.submit>;
  act(() => {
    work = hook.result.current.submit(request);
  });
  hook.rerender({
    uid: 'B'
  });
  expect(hook.result.current.pendingRequests).toEqual([]);
  await act(async () => {
    finish({
      status: 'saved'
    });
    expect((await work).committed).toBe(false);
  });
  expect(hook.result.current.message).toBe('');
  expect(hook.result.current.pending).toBeNull();
});
