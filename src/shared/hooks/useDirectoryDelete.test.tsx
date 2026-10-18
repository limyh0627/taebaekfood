// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useDirectoryDelete } from './useDirectoryDelete';
import type { DirectoryDeletePrepared, DirectoryDeleteOutcome } from '../services/directoryDeleteWrites';
const input = {
  kind: 'partner' as const,
  targetId: 'partner-a',
  opening: {
    name: '원래 이름',
    companyId: 'taebaek'
  }
};
const reference = {
  companyId: 'taebaek' as const,
  kind: 'partner' as const,
  targetId: 'partner-a',
  planId: 'plan-a'
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return {
    promise,
    resolve
  };
};
const ready = (): DirectoryDeletePrepared => ({
  status: 'ready',
  reference
});
describe('삭제 확인창 실제 제어', () => {
  it('선택 원본을 소유하고 preview 준비만으로 업무 ACK나 confirm은 발생하지 않는다', async () => {
    const wait = deferred<DirectoryDeletePrepared>(),
      prepare = vi.fn(() => wait.promise),
      confirm = vi.fn(async (): Promise<DirectoryDeleteOutcome> => ({
        status: 'saved'
      }));
    const view = renderHook(() => useDirectoryDelete({
      scopeKey: 'taebaek:uid',
      prepare,
      confirm
    }));
    const selected = {
      ...input,
      opening: {
        ...input.opening
      }
    };
    act(() => {
      view.result.current.select(selected);
    });
    selected.opening.name = '편집 이름';
    let opening!: Promise<boolean>;
    act(() => {
      opening = view.result.current.openSelected();
    });
    expect(view.result.current.session?.input.opening.name).toBe('원래 이름');
    expect(view.result.current.busy).toBe(true);
    expect(view.result.current.session?.ready).toBe(false);
    expect(await view.result.current.confirm()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    await act(async () => {
      wait.resolve(ready());
      await opening;
    });
    expect(view.result.current.session?.ready).toBe(true);
    expect(view.result.current.lastOutcome).toBe(null);
    expect(confirm).not.toHaveBeenCalled();
    await act(async () => {
      expect(await view.result.current.confirm()).toBe(true);
    });
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it('busy 중 닫기·중복확인을 막고 unknown 뒤에는 재전송 없이 결과조회만 제공한다', async () => {
    const wait = deferred<DirectoryDeleteOutcome>(),
      confirm = vi.fn(() => wait.promise),
      inspect = vi.fn(async (): Promise<DirectoryDeleteOutcome> => ({
        status: 'saved'
      }));
    const view = renderHook(() => useDirectoryDelete({
      scopeKey: 'scope',
      prepare: async () => ready(),
      confirm,
      inspect
    }));
    await act(async () => {
      await view.result.current.open(input);
    });
    let sending!: Promise<boolean>;
    act(() => {
      sending = view.result.current.confirm();
    });
    await act(async () => {
      expect(await view.result.current.close()).toBe(false);
    });
    expect(await view.result.current.confirm()).toBe(false);
    await act(async () => {
      wait.resolve({
        status: 'unknown',
        message: '유실',
        nextAction: '조회'
      });
      await sending;
    });
    expect(view.result.current.session?.ready).toBe(false);
    expect(await view.result.current.confirm()).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    await act(async () => {
      expect(await view.result.current.inspect(reference)).toBe(true);
    });
    expect(view.result.current.session).not.toBe(null);
    expect(view.result.current.message).toContain('확인');
  });
  it('준비 실패·보관 읽기 실패·미연결은 삭제0이고 원인과 원선택을 보존한다', async () => {
    const prepare = vi.fn(async (): Promise<DirectoryDeletePrepared> => ({
      status: 'rejected',
      outcome: {
        status: 'rejected',
        message: '자료 변경',
        nextAction: '다시 열기'
      }
    }));
    const view = renderHook(() => useDirectoryDelete({
      scopeKey: 's',
      prepare
    }));
    await act(async () => {
      expect(await view.result.current.open(input)).toBe(false);
    });
    expect(view.result.current.message).toContain('자료 변경');
    expect(view.result.current.session?.input.targetId).toBe(input.targetId);
    const read = renderHook(() => useDirectoryDelete({
      scopeKey: 's',
      prepare,
      readPending: () => {
        throw Error('저장소 실패');
      }
    }));
    await act(async () => {
      expect(await read.result.current.open(input)).toBe(false);
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    const missing = renderHook(() => useDirectoryDelete({
      scopeKey: 's'
    }));
    await act(async () => {
      await missing.result.current.open(input);
    });
    expect(missing.result.current.lastOutcome?.status).toBe('rejected');
  });
  it('같은 회사 UID 교체는 첫 렌더부터 이전 확인창·목록을 숨기고 늦은 응답을 폐기한다', async () => {
    const wait = deferred<DirectoryDeletePrepared>();
    const view = renderHook(({
      scope
    }) => useDirectoryDelete({
      scopeKey: scope,
      prepare: () => wait.promise
    }), {
      initialProps: {
        scope: 'taebaek:uid-a'
      }
    });
    let opening!: Promise<boolean>;
    act(() => {
      opening = view.result.current.open(input);
    });
    view.rerender({
      scope: 'taebaek:uid-b'
    });
    expect(view.result.current.session).toBe(null);
    expect(view.result.current.pending).toEqual([]);
    await act(async () => {
      wait.resolve(ready());
      expect(await opening).toBe(false);
    });
    expect(view.result.current.session).toBe(null);
    expect(view.result.current.busy).toBe(false);
  });
  it('행이 없어도 보관 ref를 복구하고 준비된 새 ID로 같은 대상 요청을 덮지 않는다', async () => {
    const prepare = vi.fn(async () => ready()),
      inspect = vi.fn(async (): Promise<DirectoryDeleteOutcome> => ({
        status: 'saved'
      }));
    const view = renderHook(() => useDirectoryDelete({
      scopeKey: 's',
      prepare,
      inspect,
      readPending: () => [{
        reference,
        description: '삭제 원문'
      }]
    }));
    await waitFor(() => expect(view.result.current.pending).toHaveLength(1));
    await act(async () => {
      expect(await view.result.current.open(input)).toBe(false);
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(view.result.current.session?.ready).toBe(false);
    await act(async () => {
      expect(await view.result.current.inspect(reference)).toBe(true);
    });
    expect(inspect).toHaveBeenCalledWith(reference);
  });
  it('미송신 준비 취소는 fence ACK 뒤에만 닫고 취소 유실은 창을 보존한다', async () => {
    const wait = deferred<DirectoryDeleteOutcome>(),
      cancel = vi.fn(() => wait.promise);
    const view = renderHook(() => useDirectoryDelete({
      scopeKey: 's',
      prepare: async () => ready(),
      cancel
    }));
    await act(async () => {
      await view.result.current.open(input);
    });
    let closing!: Promise<boolean>;
    act(() => {
      closing = view.result.current.close();
    });
    expect(view.result.current.session).not.toBe(null);
    expect(view.result.current.busy).toBe(true);
    await act(async () => {
      expect(await view.result.current.close()).toBe(false);
    });
    await act(async () => {
      wait.resolve({
        status: 'cancelled',
        message: '중단됨'
      });
      expect(await closing).toBe(true);
    });
    expect(cancel).toHaveBeenCalledWith(reference);
    expect(view.result.current.session).toBe(null);
    const unknownCancel = renderHook(() => useDirectoryDelete({
      scopeKey: 's',
      prepare: async () => ready(),
      cancel: async () => ({
        status: 'unknown',
        message: '유실',
        nextAction: '확인'
      })
    }));
    await act(async () => {
      await unknownCancel.result.current.open(input);
      expect(await unknownCancel.result.current.close()).toBe(false);
    });
    expect(unknownCancel.result.current.session).not.toBe(null);
  });
  it('삭제 송신 뒤 미확정의 닫기는 새 cancel 없이 보관하고 이미 적용된 취소응답은 삭제로 안내한다', async () => {
    const cancel = vi.fn(async (): Promise<DirectoryDeleteOutcome> => ({
      status: 'saved'
    }));
    const view = renderHook(() => useDirectoryDelete({
      scopeKey: 's',
      prepare: async () => ready(),
      confirm: async () => ({
        status: 'unknown',
        message: '유실',
        nextAction: '확인'
      }),
      cancel
    }));
    await act(async () => {
      await view.result.current.open(input);
      await view.result.current.confirm();
      expect(await view.result.current.close()).toBe(true);
    });
    expect(cancel).not.toHaveBeenCalled();
    expect(view.result.current.session).toBe(null);
    await act(async () => {
      await view.result.current.open(input);
      expect(await view.result.current.close()).toBe(true);
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(view.result.current.message).toContain('삭제가 확인');
  });
  it('같은 ID의 다른 종류·다른 plan 결과는 현재 확인창 안내와 삭제준비를 바꾸지 않는다', async () => {
    const view = renderHook(() => useDirectoryDelete({
      scopeKey: 's',
      prepare: async () => ready(),
      inspect: async () => ({
        status: 'saved'
      })
    }));
    await act(async () => {
      await view.result.current.open(input);
    });
    for (const other of [{
      ...reference,
      kind: 'employee' as const
    }, {
      ...reference,
      planId: 'other-plan'
    }]) {
      await act(async () => {
        expect(await view.result.current.inspect(other)).toBe(true);
      });
      expect(view.result.current.messageIdentity).toEqual(other);
      expect(view.result.current.message).toContain('삭제가 확인');
      expect(view.result.current.sessionMessage).toBe('');
      expect(view.result.current.sessionOutcome).toBe(null);
      expect(view.result.current.session?.ready).toBe(true);
    }
    await act(async () => {
      await view.result.current.inspect(reference);
    });
    expect(view.result.current.sessionMessage).toContain('삭제가 확인');
    expect(view.result.current.sessionOutcome?.status).toBe('saved');
  });
});
