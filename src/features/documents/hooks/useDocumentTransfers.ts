import { useEffect, useReducer, useRef } from 'react';
import type { CabinetDoc, CompanyId } from '../../../shared/types';
import { auth } from '../../../shared/firebase';
import { appConfirm } from '../../../shared/components/appDialog';
import { createDocumentTransferPlan, createDocumentTransferPort, isDocumentTransferNotStarted } from '../infrastructure/documentTransfers';

type Plan = ReturnType<typeof createDocumentTransferPlan>;
type Ports = ReturnType<typeof createDocumentTransferPort>;
type Scope = { companyId: CompanyId; actorUid: string; employeeId: string };
export interface DocumentTransferJob {
  jobId: string;
  companyId: CompanyId;
  actorUid: string;
  documentId: string;
  fileName: string;
  category: string;
  subCategory: string;
  kind: 'upload' | 'delete';
  stage: 'upload' | 'url' | 'metadata' | 'cleanup' | 'unknown';
  busy: boolean;
  message: string;
  canRetry: boolean;
}
type StoredJob = DocumentTransferJob & { employeeId: string; plan?: Plan; document?: CabinetDoc; url?: string; path: string };
export interface DocumentTransfersOptions {
  companyId: CompanyId;
  actorUid?: string;
  employeeId: string;
  uploadedBy: string;
  ports?: Ports;
  confirm?: (message: string) => Promise<boolean>;
}
export function useDocumentTransfers(options: DocumentTransfersOptions) {
  const [, render] = useReducer((n: number) => n + 1, 0);
  const mounted = useRef(true);
  const owner = useRef({ companyId: options.companyId, actorUid: options.actorUid, employeeId: options.employeeId });
  const jobs = useRef(new Map<string, StoredJob>());
  const ports = options.ports ?? createDocumentTransferPort();
  if (owner.current.companyId !== options.companyId || owner.current.actorUid !== options.actorUid || owner.current.employeeId !== options.employeeId) {
    owner.current = { companyId: options.companyId, actorUid: options.actorUid, employeeId: options.employeeId };
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = () => { if (mounted.current) render(); };
  const context = (job: StoredJob) => {
    const token = owner.current;
    const scope: Scope = { companyId: job.companyId, actorUid: job.actorUid, employeeId: job.employeeId };
    return { scope, isCurrent: () => mounted.current && owner.current === token
      && token.companyId === scope.companyId && token.actorUid === scope.actorUid && token.employeeId === scope.employeeId
      && auth.currentUser?.uid === scope.actorUid };
  };
  const run = async (jobId: string) => {
    const job = jobs.current.get(jobId);
    if (!job || job.busy || job.stage === 'unknown') return;
    const ctx = context(job);
    if (!ctx.isCurrent()) return;
    job.busy = true;
    job.canRetry = false;
    job.message = '처리 중입니다.';
    refresh();
    let startedMetadata = false;
    try {
      await ports.assertCurrent(ctx);
      if (!ctx.isCurrent()) return;
      if (job.kind === 'upload') {
        if (job.stage === 'upload') {
          await ports.uploadFile(job.plan!, ctx);
          job.stage = 'url';
        }
        if (!ctx.isCurrent()) return;
        if (job.stage === 'url') {
          job.url = await ports.getFileUrl(job.plan!, ctx);
          job.stage = 'metadata';
        }
        if (!ctx.isCurrent()) return;
        startedMetadata = true;
        await ports.createMetadata(job.plan!, job.url!, ctx);
      } else {
        if (job.stage === 'metadata') {
          startedMetadata = true;
          await ports.deleteMetadata(job.document!, ctx);
          startedMetadata = false;
          job.stage = 'cleanup';
        }
        if (!ctx.isCurrent()) return;
        await ports.cleanupStorage(job.path, ctx);
      }
      jobs.current.delete(jobId);
    } catch (error) {
      if (isDocumentTransferNotStarted(error)) {
        job.message = `${error.message} 확인 후 같은 작업을 이어갈 수 있습니다.`;
      } else if (startedMetadata) {
        job.stage = 'unknown';
        job.message = job.kind === 'upload'
          ? '파일은 업로드됐지만 목록 등록 결과를 확인하지 못했습니다. 현재 목록을 확인해 주세요. 목록에 없다는 이유로 미등록을 확정할 수 없습니다.'
          : '목록 삭제 결과를 확인하지 못해 파일을 삭제하지 않았습니다. 현재 목록을 확인해 주세요. 삭제를 다시 보내지 않습니다.';
      } else {
        job.message = job.stage === 'cleanup'
          ? '목록은 삭제됐지만 파일 정리가 완료되지 않았습니다. 같은 파일 정리만 다시 시도해 주세요.'
          : job.stage === 'url' ? '파일 업로드는 완료됐지만 주소를 받지 못했습니다. 주소 받기만 다시 시도해 주세요.'
          : '파일 업로드를 완료하지 못했습니다. 같은 파일과 경로로 다시 시도해 주세요.';
      }
    } finally {
      if (!ctx.isCurrent() && job.stage !== 'unknown') job.message = '회사 또는 로그인 화면이 바뀌어 다음 단계를 시작하지 않았습니다. 원래 계정에서 같은 작업을 이어갈 수 있습니다.';
      job.busy = false;
      job.canRetry = job.stage !== 'unknown';
      refresh();
    }
  };
  const startUploads = async (files: File[], category: string, subCategory: string) => {
    const token = owner.current;
    if (!token.actorUid || auth.currentUser?.uid !== token.actorUid) return;
    const ids: string[] = [];
    for (const file of files) {
      const plan = createDocumentTransferPlan({ companyId: token.companyId, actorUid: token.actorUid, employeeId: token.employeeId }, file, category, subCategory, options.uploadedBy);
      const jobId = crypto.randomUUID();
      jobs.current.set(jobId, {
        jobId, companyId: token.companyId, actorUid: token.actorUid, employeeId: token.employeeId,
        documentId: plan.documentId, path: plan.path, fileName: file.name, category, subCategory,
        kind: 'upload', stage: 'upload', busy: false, canRetry: true, message: '', plan
      });
      ids.push(jobId);
    }
    refresh();
    await Promise.all(ids.map(run));
  };
  const deleteDocument = async (document: CabinetDoc) => {
    const token = owner.current;
    if (!token.actorUid || auth.currentUser?.uid !== token.actorUid) return;
    const frozen = { ...document };
    if (!await (options.confirm ?? appConfirm)(`"${frozen.fileName}" 파일을 삭제할까요?`)) return;
    if (!mounted.current || owner.current !== token || auth.currentUser?.uid !== token.actorUid) return;
    if (Array.from(jobs.current.values()).some(job => job.kind === 'delete' && job.documentId === frozen.id
      && job.companyId === token.companyId && job.actorUid === token.actorUid)) return;
    const jobId = crypto.randomUUID();
    jobs.current.set(jobId, {
      jobId, companyId: token.companyId, actorUid: token.actorUid, employeeId: token.employeeId, documentId: frozen.id,
      path: frozen.storagePath, fileName: frozen.fileName, category: frozen.category, subCategory: frozen.subCategory ?? '',
      kind: 'delete', stage: 'metadata', busy: false, canRetry: true, message: '', document: frozen
    });
    await run(jobId);
  };
  return {
    jobs: Array.from(jobs.current.values()).filter(job => job.companyId === options.companyId && job.actorUid === options.actorUid && job.employeeId === options.employeeId),
    startUploads, deleteDocument, retryUpload: run, retryCleanup: run, retry: run
  };
}
