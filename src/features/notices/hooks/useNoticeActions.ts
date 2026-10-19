import { useEffect, useReducer, useRef } from 'react';
import type { Post, CompanyId } from '../../../shared/types';
import { auth } from '../../../shared/firebase';
import { appConfirm } from '../../../shared/components/appDialog';
import { saveOutcomeMessage } from '../../../shared/saveOutcome';
import type { NoticeBindings, NoticeContext, NoticeReference } from '../infrastructure/noticeWrites';
export interface NoticeCleanupJob {
    jobId: string;
    companyId: CompanyId;
    actorUid: string;
    employeeId: string;
    postId: string;
    displayTitle: string;
    reference: NoticeReference;
    status: 'pending' | 'running';
    message: string;
    blocks: Post['blocks'];
}
export interface NoticeActionsOptions {
    companyId?: CompanyId;
    actorUid?: string;
    employeeId?: string;
    canWrite?: boolean;
    ports?: NoticeBindings;
    onChanged?: () => void | Promise<void>;
    confirm?: (message: string) => Promise<boolean>;
}
export function useNoticeActions(options: NoticeActionsOptions) {
    const [, render] = useReducer((n: number) => n + 1, 0), alive = useRef(true), latest = useRef(options);
    latest.current = options;
    const owner = useRef({ companyId: options.companyId, actorUid: options.actorUid, employeeId: options.employeeId });
    const selected = useRef<Post | null>(null), selection = useRef(0), operation = useRef<object | null>(null), message = useRef(''), jobs = useRef(new Map<string, NoticeCleanupJob>());
    if (owner.current.companyId !== options.companyId || owner.current.actorUid !== options.actorUid || owner.current.employeeId !== options.employeeId) {
        owner.current = { companyId: options.companyId, actorUid: options.actorUid, employeeId: options.employeeId };
        selected.current = null;
        selection.current++;
        operation.current = null;
        message.current = '';
    }
    const renderOwner = owner.current;
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);
    const refresh = () => {
        if (alive.current)
            render();
    };
    const current = (scope: typeof owner.current) => alive.current && owner.current === scope && !!scope.companyId && !!scope.actorUid && !!scope.employeeId && auth.currentUser?.uid === scope.actorUid;
    const selectPost = (post: Post) => {
        if (owner.current !== renderOwner)
            return;
        selected.current = { ...post, blocks: post.blocks?.map(block => ({ ...block })) };
        selection.current++;
        message.current = '';
        refresh();
    };
    const closeSelected = () => {
        if (owner.current !== renderOwner)
            return;
        selected.current = null;
        selection.current++;
        refresh();
    };
    const begin = () => {
        const scope = owner.current;
        if (scope !== renderOwner || operation.current || !selected.current || !current(scope) || !latest.current.ports || latest.current.canWrite === false)
            return null;
        const task = {};
        operation.current = task;
        message.current = '';
        refresh();
        return {
            scope, task, post: selected.current, generation: selection.current, planId: crypto.randomUUID()
        };
    };
    const valid = (run: NonNullable<ReturnType<typeof begin>>) => current(run.scope) && operation.current === run.task && selection.current === run.generation && selected.current?.id === run.post.id;
    const finish = (task: object) => {
        if (operation.current === task) {
            operation.current = null;
            refresh();
        }
    };
    const retryCleanup = async (jobId: string) => {
        const job = jobs.current.get(jobId), scope = owner.current;
        if (scope !== renderOwner || !job || job.status === 'running' || job.companyId !== scope.companyId || job.actorUid !== scope.actorUid || job.employeeId !== scope.employeeId || !current(scope) || !latest.current.ports)
            return;
        const token = {};
        jobs.current.set(jobId, { ...job, status: 'running', message: '남은 사진 정리를 확인하고 있습니다.' });
        refresh();
        const ctx: NoticeContext = {
            companyId: job.companyId, actorUid: job.actorUid, employeeId: job.employeeId, isCurrent: () => current(scope)
        };
        try {
            const outcome = await latest.current.ports.cleanup(job.reference, ctx);
            if (!current(scope))
                return;
            if (outcome.serverResult && outcome.serverResult.cleanupStatus !== 'pending' && outcome.serverResult.cleanupStatus !== 'manual-blocked' && outcome.status !== 'unknown')
                jobs.current.delete(jobId);
            else
                jobs.current.set(jobId, { ...job, status: 'pending', message: outcome.serverResult?.message || saveOutcomeMessage(outcome) });
        }
        catch (error) {
            jobs.current.set(jobId, { ...job, status: 'pending', message: '공지는 삭제됐지만 사진 정리는 완료되지 않았습니다. ' + (error instanceof Error ? error.message : String(error)) });
        }
        finally {
            void token;
            refresh();
            if (current(scope))
                void latest.current.onChanged?.();
        }
    };
    const perform = async (action: 'pin' | 'delete') => {
        const run = begin();
        if (!run)
            return;
        const ctx: NoticeContext = {
            companyId: run.scope.companyId!, actorUid: run.scope.actorUid!, employeeId: run.scope.employeeId!, isCurrent: () => current(run.scope) && operation.current === run.task
        };
        const reference = { companyId: ctx.companyId, postId: run.post.id, planId: run.planId };
        let sent = false;
        try {
            if (action === 'delete') {
                const accepted = await (latest.current.confirm ?? appConfirm)('이 공지를 삭제할까요?');
                if (!accepted || !valid(run))
                    return;
            }
            const opening = await latest.current.ports!.open(run.post, { ...ctx, postId: run.post.id, planId: run.planId });
            if (!valid(run))
                return;
            sent = true;
            const outcome = await latest.current.ports!.save({ action, ...(action === 'pin' ? { patch: { pinned: !run.post.pinned } } : {}) }, {
                ...ctx, postId: run.post.id, planId: run.planId, opening
            });
            if (outcome.serverResult?.status === 'applied' && (outcome.serverResult.cleanupStatus === 'pending' || outcome.serverResult.cleanupStatus === 'manual-blocked'))
                jobs.current.set(run.planId, {
                    jobId: run.planId, companyId: ctx.companyId, actorUid: ctx.actorUid, employeeId: ctx.employeeId, postId: run.post.id, displayTitle: run.post.title?.trim() || `공지 ${run.post.id}`, reference, status: 'pending', message: outcome.serverResult.message, blocks: run.post.blocks?.map(b => ({ ...b }))
                });
            if (valid(run)) {
                message.current = outcome.status === 'saved' ? outcome.serverResult?.message || '공지 처리가 확인됐습니다.' : saveOutcomeMessage(outcome);
                if (outcome.status === 'saved' && outcome.requestFinalized) {
                    if (action === 'delete') {
                        selected.current = null;
                        selection.current++;
                    }
                    else
                        selected.current = { ...run.post, pinned: !run.post.pinned };
                }
            }
            finish(run.task);
            if (current(run.scope) && jobs.current.has(run.planId))
                await retryCleanup(run.planId);
        }
        catch (error) {
            if (valid(run))
                message.current = (sent ? (action === 'delete' ? '공지 삭제 결과를 확인하지 못했습니다. 사진은 삭제하지 않았습니다. ' : '공지 고정 결과를 확인하지 못했습니다. ') : '공지 원문을 확인하지 못해 새 요청을 보내지 않았습니다. ') + (error instanceof Error ? error.message : String(error)) + ' 보관된 요청이 있으면 결과를 확인해 주세요.';
        }
        finally {
            finish(run.task);
            if (current(run.scope))
                void latest.current.onChanged?.();
        }
    };
    return {
        selectedPost: selected.current, selectPost, closeSelected, actionBusy: !!operation.current, actionMessage: message.current, togglePinned: () => perform('pin'), deleteSelected: () => perform('delete'), retryCleanup, cleanupJobs: [...jobs.current.values()].filter(job => job.companyId === options.companyId && job.actorUid === options.actorUid && job.employeeId === options.employeeId)
    };
}
