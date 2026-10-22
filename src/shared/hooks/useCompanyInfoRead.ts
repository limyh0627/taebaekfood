import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, authReady, db } from '../firebase';
import { companySettingDocId } from '../companySettings';
import type { CompanyId, CompanyInfo } from '../types';

export type CompanyInfoReadStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error';
export type CompanyInfoObservationToken = Readonly<object>;
export interface CompanyInfoRead {
  readonly companyId: CompanyId;
  value: CompanyInfo | null;
  status: CompanyInfoReadStatus;
  error: string;
  retry(): void;
  observationToken: CompanyInfoObservationToken;
  isCurrent(token: CompanyInfoObservationToken): boolean;
}
type Owner = { companyId: CompanyId; uid: string; enabled: boolean };
type ReadState = { owner: Owner; value: CompanyInfo | null; status: CompanyInfoReadStatus; error: string; token: CompanyInfoObservationToken };
const emptyState = (owner: Owner): ReadState => ({ owner, value: null, status: owner.enabled && owner.uid ? 'loading' : 'idle', error: '', token: {} });

/** 회사 문서의 조회와 관측 수명을 함께 소유해 이전 회사/계정의 설정을 재사용하지 않는다. */
export function useCompanyInfoRead({ companyId, enabled }: { companyId: CompanyId; enabled: boolean }): CompanyInfoRead {
  const [, repaint] = useState(0);
  const [revision, setRevision] = useState(0);
  const latest = useRef({ companyId, enabled });
  latest.current = { companyId, enabled };
  const owner = useRef<Owner>({ companyId, enabled, uid: auth.currentUser?.uid ?? '' });
  if (owner.current.companyId !== companyId || owner.current.enabled !== enabled || owner.current.uid !== (auth.currentUser?.uid ?? ''))
    owner.current = { companyId, enabled, uid: auth.currentUser?.uid ?? '' };
  const captured = owner.current;
  const mounted = useRef(false);
  const readRun = useRef<object | null>(null);
  const [state, setState] = useState(() => emptyState(captured));
  const observed = useRef(state);
  const currentOwner = () => mounted.current && owner.current === captured && auth.currentUser?.uid === captured.uid;
  const publish = (next: ReadState) => { observed.current = next; setState(next); };
  useEffect(() => {
    mounted.current = true;
    const stop = auth.onAuthStateChanged(user => {
      const uid = user?.uid ?? '';
      if (uid !== owner.current.uid) {
        owner.current = { ...latest.current, uid };
        readRun.current = null;
        repaint(value => value + 1);
      }
    });
    return () => { mounted.current = false; readRun.current = null; stop(); };
  }, []);
  useEffect(() => {
    const run = {};
    readRun.current = run;
    let stop: (() => void) | undefined;
    let live = true;
    const current = () => live && currentOwner() && readRun.current === run;
    publish(emptyState(captured));
    if (!captured.enabled || !captured.uid) return () => { live = false; };
    const failed = () => {
      if (current()) publish({ owner: captured, value: null, status: 'error', error: '현재 회사 설정을 읽지 못했습니다. 다시 확인해 주세요.', token: {} });
    };
    void authReady.then(() => {
      if (!current()) return;
      stop = onSnapshot(doc(db, 'settings', companySettingDocId(captured.companyId, 'company')), snapshot => {
        if (!current()) return;
        const exists = snapshot.exists();
        publish({ owner: captured, value: exists ? snapshot.data() as CompanyInfo : null, status: exists ? 'ready' : 'missing', error: '', token: {} });
      }, failed);
    }).catch(failed);
    return () => { live = false; if (readRun.current === run) readRun.current = null; stop?.(); };
  }, [captured, revision]);
  const retry = useCallback(() => {
    if (!currentOwner() || !captured.enabled || !captured.uid) return;
    readRun.current = null;
    publish(emptyState(captured));
    setRevision(value => value + 1);
  }, [captured]);
  const isCurrent = useCallback((token: CompanyInfoObservationToken) => currentOwner() && captured.enabled
    && observed.current.owner === captured && observed.current.status === 'ready' && observed.current.token === token, [captured]);
  const visible = state.owner === captured && currentOwner() ? state : emptyState(captured);
  return { companyId: captured.companyId, value: visible.value, status: visible.status, error: visible.error, retry, observationToken: visible.token, isCurrent };
}
