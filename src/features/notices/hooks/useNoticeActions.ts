import { useEffect, useReducer, useRef } from 'react';
import type { Post, CompanyId } from '../../../shared/types';
import { auth } from '../../../shared/firebase';
import { appConfirm } from '../../../shared/components/appDialog';
import { deleteNoticeImages } from '../../../shared/noticeImage';

export interface NoticeCleanupJob {
  jobId: string;
  companyId: CompanyId;
  actorUid: string;
  postId: string;
  displayTitle: string;
  blocks: Post['blocks'];
  status: 'pending' | 'running';
  message: string;
}
export interface NoticeActionsOptions {
  companyId?: CompanyId;
  actorUid?: string;
  onUpdatePost?: (id: string, patch: Partial<Post>) => unknown | Promise<unknown>;
  onDeletePost?: (id: string) => unknown | Promise<unknown>;
  confirm?: (message: string) => Promise<boolean>;
}

export function useNoticeActions(options: NoticeActionsOptions) {
  const [, render] = useReducer((n: number) => n + 1, 0);
  const alive = useRef(true);
  const owner = useRef({ companyId: options.companyId, actorUid: options.actorUid });
  const selected = useRef<Post | null>(null);
  const selection = useRef(0);
  const operation = useRef<object | null>(null);
  const message = useRef('');
  const jobs = useRef(new Map<string, NoticeCleanupJob>());
  if (owner.current.companyId !== options.companyId || owner.current.actorUid !== options.actorUid) {
    owner.current = { companyId: options.companyId, actorUid: options.actorUid };
    selected.current = null;
    selection.current++;
    operation.current = null;
    message.current = '';
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refresh = () => { if (alive.current) render(); };
  const current = (scope: typeof owner.current) => alive.current && owner.current === scope
    && !!scope.actorUid && auth.currentUser?.uid === scope.actorUid;
  const selectPost = (post: Post) => {
    selected.current = { ...post, blocks: post.blocks?.map(block => ({ ...block })) };
    selection.current++;
    message.current = '';
    refresh();
  };
  const closeSelected = () => { selected.current = null; selection.current++; refresh(); };
  const retryCleanup = async (jobId: string) => {
    const job = jobs.current.get(jobId);
    const scope = owner.current;
    if (!job || job.status === 'running' || job.companyId !== scope.companyId
      || job.actorUid !== scope.actorUid || !current(scope)) return;
    jobs.current.set(jobId, { ...job, status: 'running', message: '사진을 정리하고 있습니다.' });
    refresh();
    try {
      await deleteNoticeImages(job.blocks, job.companyId, job.postId);
      jobs.current.delete(jobId);
    } catch {
      jobs.current.set(jobId, { ...job, status: 'pending', message: '공지는 삭제됐지만 사진 정리는 완료되지 않았습니다. 사진 정리만 다시 시도해 주세요.' });
    } finally { refresh(); }
  };
  const begin = () => {
    const scope = owner.current;
    if (operation.current || !selected.current || !scope.companyId || !current(scope)) return null;
    const task = {};
    operation.current = task;
    message.current = '';
    refresh();
    return { scope, task, post: selected.current, generation: selection.current };
  };
  const validSelection = (run: NonNullable<ReturnType<typeof begin>>) => current(run.scope)
    && operation.current === run.task && selection.current === run.generation
    && selected.current?.id === run.post.id;
  const finish = (task: object) => {
    // 이전 작업의 finally가 새 계정에서 시작한 작업을 풀지 않게 작업 소유자를 비교한다.
    if (operation.current === task) { operation.current = null; refresh(); }
  };
  const togglePinned = async () => {
    if (!options.onUpdatePost) return;
    const run = begin();
    if (!run) return;
    try {
      await options.onUpdatePost(run.post.id, { pinned: !run.post.pinned });
      if (validSelection(run)) {
        selected.current = { ...run.post, pinned: !run.post.pinned };
        message.current = '공지 고정 설정이 저장됐습니다.';
      }
    } catch {
      if (validSelection(run)) message.current = '공지 고정 결과를 확인하지 못했습니다. 현재 목록에서 내용을 확인해 주세요.';
    } finally { finish(run.task); }
  };
  const deleteSelected = async () => {
    if (!options.onDeletePost) return;
    const run = begin();
    if (!run) return;
    try {
      const accepted = await (options.confirm ?? appConfirm)('이 공지를 삭제할까요?');
      if (!accepted || !validSelection(run)) return;
      await options.onDeletePost(run.post.id);
      // 본문 ACK 뒤에만 사진 정리 근거를 만든다. 계정 전환 뒤에도 원 소유자의 근거는 보존한다.
      const blocks = run.post.blocks?.map(block => ({ ...block }));
      let jobId: string | undefined;
      if (blocks?.some(block => block.type === 'image')) {
        jobId = crypto.randomUUID();
        jobs.current.set(jobId, {
          jobId, companyId: run.scope.companyId!, actorUid: run.scope.actorUid!, postId: run.post.id,
          displayTitle: run.post.title?.trim() || `공지 ${run.post.id}`,
          blocks, status: 'pending', message: '공지는 삭제됐습니다. 남은 사진 정리를 진행해 주세요.'
        });
      }
      if (validSelection(run)) {
        selected.current = null;
        selection.current++;
        message.current = '공지가 삭제됐습니다.';
      }
      finish(run.task);
      if (jobId && current(run.scope)) await retryCleanup(jobId);
    } catch {
      if (validSelection(run)) message.current = '공지 삭제 결과를 확인하지 못했습니다. 사진은 삭제하지 않았습니다. 현재 목록에서 공지를 확인해 주세요.';
    } finally { finish(run.task); }
  };
  return {
    selectedPost: selected.current, selectPost, closeSelected,
    actionBusy: !!operation.current, actionMessage: message.current,
    togglePinned, deleteSelected, retryCleanup,
    cleanupJobs: Array.from(jobs.current.values()).filter(job => job.companyId === options.companyId && job.actorUid === options.actorUid)
  };
}
