import { useEffect, useRef } from 'react';
import { auth } from '../firebase';

/** 회사·인증 사용자·화면이 바뀐 출력은 뒤늦게 완료돼도 저장하지 않는다. */
export function useOutputScope(companyId: string, viewKey: unknown): () => AbortSignal {
  const uid = auth.currentUser?.uid;
  const current = useRef<{companyId: string; viewKey: unknown; uid: string | undefined; controller: AbortController} | null>(null);
  if (!current.current || current.current.companyId !== companyId || current.current.viewKey !== viewKey || current.current.uid !== uid) {
    current.current?.controller.abort();
    const controller = new AbortController(); if (!uid) controller.abort();
    current.current = {companyId, viewKey, uid, controller};
  }
  const scope = current.current;
  useEffect(() => {
    // StrictMode의 검사용 setup→cleanup→setup은 새 출력 수명으로 시작한다.
    if (scope.controller.signal.aborted && scope.uid && auth.currentUser?.uid === scope.uid) scope.controller = new AbortController();
    const controller = scope.controller;
    const stop = auth.onAuthStateChanged?.(user => { if (user?.uid !== scope.uid) controller.abort(); });
    return () => { controller.abort(); stop?.(); };
  }, [scope]);
  return () => { if (current.current !== scope || !scope.uid || auth.currentUser?.uid !== scope.uid) scope.controller.abort(); return scope.controller.signal; };
}
