import { useEffect, useReducer, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../../shared/firebase';
import type { CashEntry, CompanyId, IssuedStatement } from '../../../shared/types';
import {
  clearVoucherPending, readVoucherPending, storeVoucherPending,
  voucherNoWriteProof, voucherPendingKey, type VoucherIssuePending,
} from '../infrastructure/voucherIssuePending';

export interface VoucherIssueOptions {
  companyId: CompanyId;
  onIssueCashEntry?: (entry: CashEntry) => unknown | Promise<unknown>;
  onAddCashEntry?: (entry: CashEntry) => unknown | Promise<unknown>;
  onAddIssuedStatement?: (statement: IssuedStatement) => unknown | Promise<unknown>;
  onApplied: () => void;
}

interface IssueScope {
  companyId: CompanyId;
  actorUid: string;
  pending: VoucherIssuePending | null;
  error: string;
  corrupt: boolean;
  lock: object | null;
}

function createScope(companyId: CompanyId, actorUid: string): IssueScope {
  const scope: IssueScope = { companyId, actorUid, pending: null, error: '', corrupt: false, lock: null };
  try { scope.pending = readVoucherPending(voucherPendingKey(companyId, actorUid), companyId, actorUid); }
  catch (error) { scope.corrupt = true; scope.error = error instanceof Error ? error.message : String(error); }
  return scope;
}

/** 인증 왕복은 같은 UID여도 새 세대다. 이전 응답이 새 창과 보관 요청을 종결하지 못하게 한다. */
export function useVoucherIssue(options: VoucherIssueOptions) {
  const [, repaint] = useReducer(value => value + 1, 0);
  const mounted = useRef(true);
  const latest = useRef(options);
  latest.current = options;
  const owner = useRef<IssueScope | null>(null);
  const uid = auth.currentUser?.uid ?? '';
  if (!owner.current || owner.current.companyId !== options.companyId || owner.current.actorUid !== uid) {
    owner.current = createScope(options.companyId, uid);
  }
  const scope = owner.current;
  const current = (captured: IssueScope) => mounted.current && owner.current === captured
    && latest.current.companyId === captured.companyId && (auth.currentUser?.uid ?? '') === captured.actorUid;

  useEffect(() => {
    mounted.current = true;
    if (!owner.current) { owner.current = createScope(latest.current.companyId, auth.currentUser?.uid ?? ''); repaint(); }
    const unsubscribe = onAuthStateChanged(auth, user => {
      const actorUid = user?.uid ?? '';
      if (owner.current?.actorUid !== actorUid) {
        owner.current = createScope(latest.current.companyId, actorUid);
        repaint();
      }
    });
    return () => {
      mounted.current = false;
      // StrictMode 재설치도 이전 실행의 소유권을 되살리지 않는다.
      owner.current = null;
      unsubscribe();
    };
  }, []);

  const isBusy = () => {
    const active = owner.current;
    return !!active && current(active) && !!active.lock;
  };
  const submit = async (pending: VoucherIssuePending, retry = false) => {
    const captured = owner.current;
    if (!captured || !current(captured) || captured.lock) return;
    const lock = {};
    captured.lock = lock;
    repaint();
    const owns = () => current(captured) && captured.lock === lock;
    const key = voucherPendingKey(captured.companyId, captured.actorUid);
    let encoded = '', sent = false;
    try {
      if (!captured.actorUid || pending.userId !== captured.actorUid || pending.companyId !== captured.companyId || !owns()) {
        throw new Error('로그인과 회사를 다시 확인해 주세요.');
      }
      const ports = latest.current;
      const save = pending.kind === 'cashEntries' ? ports.onIssueCashEntry ?? ports.onAddCashEntry : ports.onAddIssuedStatement;
      if (!save) throw new Error('전표 저장 기능이 연결되지 않았습니다.');
      encoded = storeVoucherPending(key, pending);
      captured.pending = pending;
      captured.error = '';
      if (!owns()) return;
      sent = true;
      if (pending.kind === 'cashEntries') await (ports.onIssueCashEntry ?? ports.onAddCashEntry)!(pending.document);
      else await ports.onAddIssuedStatement!(pending.document);
      if (!owns()) return;
      clearVoucherPending(key, encoded);
      captured.pending = null;
      ports.onApplied();
    } catch (error) {
      if (!owns()) return;
      const noWrites = sent && voucherNoWriteProof(error, pending);
      if (noWrites && !retry) { clearVoucherPending(key, encoded); captured.pending = null; }
      const detail = error instanceof Error ? error.message : String(error);
      captured.error = detail;
      alert(sent
        ? noWrites
          ? `전표가 저장되지 않았습니다. ${retry ? '이전 요청은 보존했습니다. 이전 전표 재시도로 같은 요청 결과를 확인해 주세요.' : '입력을 수정한 뒤 다시 저장해 주세요.'} ${detail}`
          : `전표 저장 결과를 확인하지 못했습니다. 새로 발행하지 말고 이전 전표 재시도로 같은 요청 결과를 확인해 주세요. ${detail}`
        : `전표를 전송하기 전에 입력 또는 최초 요청 보관을 확인하지 못했습니다. 전송하지 않았으며 입력은 유지됩니다. ${detail}`);
    } finally {
      if (owns()) { captured.lock = null; repaint(); }
    }
  };
  return {
    actorUid: scope.actorUid, pending: scope.pending, error: scope.error,
    corrupt: scope.corrupt, saving: !!scope.lock, isBusy, submit,
    retry: () => { const active = owner.current; return active?.pending ? submit(active.pending, true) : Promise.resolve(); },
  };
}
