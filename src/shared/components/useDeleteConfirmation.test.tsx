/** @vitest-environment jsdom */
import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { appConfirm } from './appDialog';
import { useDeleteConfirmation } from './useDeleteConfirmation';
vi.mock('./appDialog', () => ({ appConfirm: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it('같은 대상 재클릭만 거절하고 다른 대상의 동일 문구 확인은 유지한다', async () => {
  const waiting: ((answer: boolean) => void)[] = [];
  vi.mocked(appConfirm).mockImplementation(() => new Promise(resolve => waiting.push(resolve)));
  const { result, rerender } = renderHook(useDeleteConfirmation);
  const removeA = vi.fn(), removeB = vi.fn();
  const a = result.current('a', '삭제?', removeA);
  rerender();
  const duplicate = result.current('a', '삭제?', removeA);
  const b = result.current('b', '삭제?', removeB);
  expect(appConfirm).toHaveBeenCalledTimes(2);
  waiting[0](true); waiting[1](false);
  await Promise.all([a, duplicate, b]);
  expect(removeA).toHaveBeenCalledOnce();
  expect(removeB).not.toHaveBeenCalled();
  vi.mocked(appConfirm).mockResolvedValue(true);
  await result.current('b', '삭제?', removeB);
  expect(removeB).toHaveBeenCalledOnce();
});

it('확인 뒤 비동기 삭제가 끝날 때까지 잠그며 실패 후 재시도를 허용한다', async () => {
  vi.mocked(appConfirm).mockResolvedValue(true);
  let fail!: (error: Error) => void;
  const remove = vi.fn(() => new Promise((_, reject) => { fail = reject; }));
  const { result } = renderHook(useDeleteConfirmation);
  const operation = result.current('a', '삭제?', remove);
  const rejected = expect(operation).rejects.toThrow('저장 실패');
  await Promise.resolve();
  await result.current('a', '삭제?', remove);
  expect(appConfirm).toHaveBeenCalledOnce();
  fail(new Error('저장 실패'));
  await rejected;
  const retry = vi.fn();
  await result.current('a', '삭제?', retry);
  expect(retry).toHaveBeenCalledOnce();
});
