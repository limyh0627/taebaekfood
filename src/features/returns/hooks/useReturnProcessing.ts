import { useEffect, useRef, useState } from 'react';
import type { CompanyId, ReturnRequest } from '../../../shared/types';
import { returnBusinessText } from '../../../shared/returnBusinessEvidence';
import { returnSubmissionActorUid } from '../../../shared/services/returnRequestSubmission';
import { appConfirm } from '../../../shared/components/appDialog';

interface Options {
  companyId: CompanyId;
  isAdmin: boolean;
  requests: ReturnRequest[];
  onProcessReturn: (request: ReturnRequest) => Promise<void>;
}

export function useReturnProcessing(options: Options) {
  const uid = returnSubmissionActorUid();
  const owner = useRef({ companyId: options.companyId, uid });
  if (owner.current.companyId !== options.companyId || owner.current.uid !== uid) {
    owner.current = { companyId: options.companyId, uid };
  }
  const latest = useRef(options);
  latest.current = options;
  const mounted = useRef(false);
  const running = useRef<{ owner: typeof owner.current; id: string } | null>(null);
  const [display, setDisplay] = useState<typeof running.current>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; running.current = null; };
  }, []);

  const renderOwner = owner.current;
  const process = async (request: ReturnRequest) => {
    const capturedOwner = renderOwner;
    if (!mounted.current || owner.current !== capturedOwner || !capturedOwner.uid || returnSubmissionActorUid() !== capturedOwner.uid) return;
    if (running.current?.owner === capturedOwner) return;
    if (!latest.current.isAdmin) { alert('관리자만 반품 처리를 할 수 있습니다.'); return; }
    const original = structuredClone(request);
    const evidence = returnBusinessText(original);
    const run = { owner: capturedOwner, id: original.id };
    const ownsRun = () => mounted.current && owner.current === capturedOwner && running.current === run
      && returnSubmissionActorUid() === capturedOwner.uid;
    const canProcess = () => {
      const row = latest.current.requests.find(value => value.id === original.id);
      return ownsRun() && latest.current.isAdmin && row?.companyId === capturedOwner.companyId
        && row.status === 'pending' && !row.cancelledAt && returnBusinessText(row) === evidence;
    };
    running.current = run;
    setDisplay(run);
    try {
      if (!canProcess()) return;
      if (!await appConfirm(`${original.partnerName}의 반품을 처리하시겠습니까?\n재판매 가능 품목의 재고가 복귀됩니다.`)) return;
      if (!canProcess()) return;
      await latest.current.onProcessReturn(original);
    } catch (error) {
      if (canProcess()) alert(error instanceof Error ? error.message : '반품 처리를 완료하지 못했습니다.');
    } finally {
      if (running.current === run) {
        running.current = null;
        if (mounted.current && owner.current === capturedOwner) setDisplay(null);
      }
    }
  };

  const processingId = display?.owner === owner.current ? display.id : null;
  return { processingId, busy: processingId !== null, process };
}
