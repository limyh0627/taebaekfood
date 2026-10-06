import { useRef } from 'react';
import { appConfirm } from './appDialog';

/** 같은 대상의 확인·삭제가 끝날 때까지 재클릭만 막는다. */
export function useDeleteConfirmation() {
  const pending = useRef(new Set<string>());
  return async (key: string, message: string, remove: () => unknown | Promise<unknown>) => {
    if (pending.current.has(key)) return;
    pending.current.add(key);
    try {
      if (await appConfirm(message)) await remove();
    } finally {
      pending.current.delete(key);
    }
  };
}
