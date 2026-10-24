import { useLayoutEffect, useReducer, useRef } from 'react';
import { auth } from '../../../shared/firebase';
import type { CompanyId } from '../../../shared/types';

export type HaccpRecordActorToken = object;
export type HaccpRecordActorAction = 'save' | 'confirm' | 'delete';
interface Options {
  companyId: CompanyId;
  currentUserId?: string;
  isAdmin?: boolean;
  canConfirm?: boolean;
}

// 초안과 조회 정책은 각 폼에 두고, 비동기 작업이 시작된 계정의 수명만 공유한다.
export function useHaccpRecordActor(options: Options) {
  const [, paint] = useReducer(value => value + 1, 0);
  const latest = useRef(options);
  latest.current = options;
  const owner = useRef<{ companyId: CompanyId; employee: string; uid: string; alive: boolean } | null>(null);
  const uid = auth.currentUser?.uid ?? '';
  if (!owner.current || !owner.current.alive || owner.current.companyId !== options.companyId ||
      owner.current.employee !== (options.currentUserId ?? '') || owner.current.uid !== uid) {
    if (owner.current) owner.current.alive = false;
    owner.current = { companyId: options.companyId, employee: options.currentUserId ?? '', uid, alive: true };
  }
  const state = owner.current;
  const isCurrent = (token: HaccpRecordActorToken) => token === state && owner.current === state && state.alive &&
    (auth.currentUser?.uid ?? '') === state.uid;
  useLayoutEffect(() => {
    state.alive = true;
    let active = true;
    const stop = auth.onAuthStateChanged(user => {
      if (!active || owner.current !== state || (user?.uid ?? '') === state.uid) return;
      state.alive = false;
      paint();
    });
    return () => { active = false; state.alive = false; stop(); };
  }, [state]);
  const canAct = (kind: HaccpRecordActorAction, token: HaccpRecordActorToken = state) =>
    isCurrent(token) && !!state.uid && (kind !== 'confirm' || !!latest.current.canConfirm) &&
    (kind !== 'delete' || !!latest.current.isAdmin);
  return { ownerToken: state as HaccpRecordActorToken, isCurrent, canAct };
}
