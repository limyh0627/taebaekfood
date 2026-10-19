import { useEffect, useReducer, useRef } from 'react';
import { auth } from '../../../shared/firebase';
import type { CompanyId, Post } from '../../../shared/types';
import { today } from '../../../shared/day';
import { saveOutcomeMessage, primaryCommitted } from '../../../shared/saveOutcome';
import { prepareNoticePhoto, resumeNoticePhoto, type NoticePhotoPlan } from '../../../shared/noticeImage';
import { noticeOpening, decodeNoticeObservationSnapshot, type NoticeRequest, type NoticeOpenResult, type NoticeObservationResult, type NoticeHistoryResult } from '../../../shared/noticeCommand';
import { isNoticePhotoReference, type NoticeBindings, type NoticeContext, type NoticeEntry, type NoticeRecoveryReference, type NoticeOutcome } from '../infrastructure/noticeWrites';
type Blocks = NonNullable<Post['blocks']>;
type Form = Pick<Post, 'title' | 'content' | 'author' | 'tag'>;
export interface NoticeEditorOptions {
    companyId?: CompanyId;
    actorUid?: string;
    employeeId?: string;
    canWrite?: boolean;
    ports?: NoticeBindings;
}
export interface LegacyNoticeEntry {
    key: string;
    observedLocalText: string;
    observedReferenceText: string | null;
    post: Post | null;
    editing: boolean;
    status: 'valid' | 'corrupt';
    postId?: string;
    message: string;
    inspected: boolean;
    observation?: NoticeObservationResult;
    observedPost?: Record<string, unknown> | null;
}
interface PhotoJob {
    id: string;
    plan: NoticePhotoPlan;
    file?: File;
    postId: string;
    generation: object;
    busy: boolean;
    message: string;
    block?: Extract<Blocks[number], {
        type: 'image';
    }>;
}
const empty = (): Form => ({
    title: '', content: '', author: '', tag: '공지'
});
const safeLink = (value?: string) => {
    try {
        const url = new URL(value || '');
        return ['http:', 'https:'].includes(url.protocol);
    }
    catch {
        return false;
    }
};
export function useNoticeEditor(options: NoticeEditorOptions) {
    const [, render] = useReducer((n: number) => n + 1, 0), mounted = useRef(true), latest = useRef(options);
    latest.current = options;
    const make = () => ({
        companyId: options.companyId, actorUid: options.actorUid, employeeId: options.employeeId, form: empty(), blocks: [] as Blocks, blocksDirty: false, editing: null as Post | null, showForm: false, preview: false, pinned: false, postId: `notice-${crypto.randomUUID()}`, planId: crypto.randomUUID(), generation: {}, opening: null as NoticeOpenResult | null, task: null as object | null, pending: false, requiresNew: false, message: '', operations: [] as NoticeEntry[], photos: new Map<string, PhotoJob>(), readLoading: true, readError: '', readGeneration: 0, legacy: null as LegacyNoticeEntry | null, history: [] as NoticeHistoryResult['entries'], historyMore: null as string | null, historyLoading: false, historyError: '', historyGeneration: 0, results: new Map<string, NoticeOutcome>()
    });
    const owner = useRef<ReturnType<typeof make> | null>(null);
    if (!owner.current || owner.current.companyId !== options.companyId || owner.current.actorUid !== options.actorUid || owner.current.employeeId !== options.employeeId)
        owner.current = make();
    const current = owner.current;
    const repaint = () => {
        if (mounted.current)
            render();
    };
    const active = () => mounted.current && owner.current === current && !!current.companyId && !!current.actorUid && !!current.employeeId && auth.currentUser?.uid === current.actorUid;
    const ctx = (task?: object): NoticeContext => ({
        companyId: current.companyId!, actorUid: current.actorUid!, employeeId: current.employeeId!, isCurrent: () => active() && (!task || current.task === task)
    });
    const writable = () => active() && latest.current.canWrite !== false && !!latest.current.ports;
    const readLegacy = () => {
        const key = `notice-save-pending:${current.companyId || ''}:${current.actorUid || ''}`;
        try {
            const raw = sessionStorage.getItem(key);
            if (!raw) {
                current.legacy = null;
                return;
            }
            let post: Post | null = null, editing = false, postId: string | undefined;
            try {
                const saved = JSON.parse(raw);
                if (typeof saved?.post?.id === 'string' && saved.post.id && !saved.post.id.includes('/'))
                    postId = saved.post.id;
                if (saved && typeof saved.editing === 'boolean' && typeof saved.post?.id === 'string' && ['title', 'content', 'author', 'date'].every(k => typeof saved.post[k] === 'string') && Array.isArray(saved.post.blocks)) {
                    post = saved.post;
                    editing = saved.editing;
                }
            }
            catch {
            }
            const referenceRaw = sessionStorage.getItem(key + ':reference');
            const old = current.legacy?.observedLocalText === raw && current.legacy.observedReferenceText === referenceRaw ? current.legacy : null;
            current.legacy = {
                key, observedLocalText: raw, observedReferenceText: referenceRaw, post, editing, postId, status: post ? 'valid' : 'corrupt', message: (postId ? '' : '대상을 식별할 수 없어 서버 처리 여부는 확인하지 못했습니다. 현재 공지 목록을 직접 확인해 주세요. ') + '이전 방식으로 보관된 요청입니다. 영수증이 없다는 이유로 미저장이라고 단정하지 않습니다. 현재 공지를 확인한 뒤 이 기기 사본만 명시적으로 정리해 주세요.', inspected: old?.inspected ?? false, observation: old?.observation, observedPost: old?.observedPost
            };
        }
        catch {
            current.readError = '이전 공지 요청을 읽지 못했습니다.';
        }
    };
    const refresh = async () => {
        if (latest.current.canWrite === false) {
            current.readGeneration++;
            current.readLoading = false;
            current.readError = '';
            current.operations = [];
            current.legacy = null;
            repaint();
            return;
        }
        if (!active() || !latest.current.ports)
            return;
        const generation = ++current.readGeneration;
        current.readLoading = true;
        repaint();
        try {
            const rows = await latest.current.ports.read({ ...ctx(), isCurrent: () => active() && current.readGeneration === generation });
            if (active() && current.readGeneration === generation) {
                current.operations = rows;
                for (const row of rows) {
                    if (row.reference && row.serverResult)
                        current.results.set(JSON.stringify(row.reference), {
                            status: 'unknown', serverResult: row.serverResult, message: row.serverResult.message, nextAction: '같은 요청의 결과를 확인해 주세요.'
                        });
                }
                current.readError = '';
                readLegacy();
            }
        }
        catch (error) {
            if (active() && current.readGeneration === generation)
                current.readError = '보관된 공지 요청을 읽지 못했습니다. ' + (error instanceof Error ? error.message : String(error));
        }
        finally {
            if (active() && current.readGeneration === generation) {
                current.readLoading = false;
                repaint();
            }
        }
    };
    useEffect(() => {
        mounted.current = true;
        void refresh();
        return () => {
            current.readGeneration++;
            current.historyGeneration++;
        };
    }, [current]);
    useEffect(() => () => {
        mounted.current = false;
    }, []);
    const reset = () => {
        current.form = empty();
        current.blocks = [];
        current.blocksDirty = false;
        current.editing = null;
        current.showForm = false;
        current.preview = false;
        current.pinned = false;
        current.postId = `notice-${crypto.randomUUID()}`;
        current.planId = crypto.randomUUID();
        current.generation = {};
        current.opening = null;
        current.pending = false;
        current.requiresNew = false;
    };
    const canChange = () => writable() && !current.task && !current.pending && !current.requiresNew;
    const openCreate = () => {
        if (!writable() || current.task)
            return false;
        reset();
        current.showForm = true;
        current.blocks = [{ type: 'text', text: '' }];
        repaint();
        return true;
    };
    const openEdit = async (post: Post) => {
        if (!writable() || current.task)
            return false;
        reset();
        current.editing = { ...post, blocks: post.blocks?.map(b => ({ ...b })) };
        current.postId = post.id;
        current.form = {
            title: post.title, content: '', author: post.author, tag: post.tag
        };
        current.blocks = post.blocks?.length ? post.blocks.map(b => ({ ...b })) : [{ type: 'text', text: post.content }];
        current.pinned = !!post.pinned;
        current.showForm = true;
        const task = {};
        current.task = task;
        current.message = '';
        repaint();
        try {
            const opening = await latest.current.ports!.open(current.editing, { ...ctx(task), postId: post.id, planId: current.planId });
            if (!ctx(task).isCurrent())
                return false;
            current.opening = opening;
            return true;
        }
        catch (error) {
            if (ctx(task).isCurrent()) {
                current.message = '공지 원문을 확인하지 못했습니다. ' + (error instanceof Error ? error.message : String(error)) + ' 아직 저장 요청은 보내지 않았습니다. 필요하면 명시적으로 새 공지를 작성해 주세요.';
                current.requiresNew = true;
            }
            return false;
        }
        finally {
            if (owner.current === current && current.task === task) {
                current.task = null;
                repaint();
            }
        }
    };
    const bodyBlocks = () => [...(current.form.content.trim() ? [{ type: 'text' as const, text: current.form.content }] : []), ...current.blocks];
    const cancelDraftPhotos = async (task: object) => {
        for (const job of current.photos.values()) {
            if (job.postId !== current.postId || job.generation !== current.generation)
                continue;
            const result = await latest.current.ports!.cancel(job.plan.request.reference, ctx(task));
            if (!ctx(task).isCurrent())
                return false;
            if (result.status === 'unknown')
                throw Error(saveOutcomeMessage(result));
            const cleanup = await latest.current.ports!.cleanup(job.plan.request.reference, ctx(task));
            if (cleanup.serverResult?.cleanupStatus === 'pending' || cleanup.serverResult?.cleanupStatus === 'manual-blocked')
                current.message = saveOutcomeMessage(cleanup) || cleanup.serverResult.message;
        }
        return true;
    };
    const closeDraft = async () => {
        if (!active() || current.task)
            return false;
        if (current.pending) {
            current.showForm = false;
            repaint();
            return true;
        }
        const task = {};
        current.task = task;
        repaint();
        try {
            if (latest.current.ports)
                await cancelDraftPhotos(task);
            if (!ctx(task).isCurrent())
                return false;
            reset();
            return true;
        }
        catch (error) {
            if (ctx(task).isCurrent())
                current.message = '사진 요청 중단이나 정리가 완료되지 않았습니다. ' + (error instanceof Error ? error.message : String(error));
            return false;
        }
        finally {
            if (owner.current === current && current.task === task) {
                current.task = null;
                repaint();
            }
            if (active())
                void refresh();
        }
    };
    const changeField = (key: keyof Form, value: string) => {
        if (!canChange())
            return;
        current.form = { ...current.form, [key]: value };
        repaint();
    };
    const changeBlock = (index: number, patch: Partial<Blocks[number]>) => {
        if (!canChange() || !current.blocks[index])
            return;
        current.blocksDirty = true;
        current.blocks = current.blocks.map((block, n) => n === index ? { ...block, ...patch } as Blocks[number] : block);
        repaint();
    };
    const addText = () => {
        if (canChange()) {
            current.blocksDirty = true;
            current.blocks = [...current.blocks, { type: 'text', text: '' }];
            repaint();
        }
    };
    const moveBlock = (index: number, direction: -1 | 1) => {
        if (!canChange() || index + direction < 0 || index + direction >= current.blocks.length)
            return;
        current.blocksDirty = true;
        const blocks = [...current.blocks];
        [blocks[index], blocks[index + direction]] = [blocks[index + direction], blocks[index]];
        current.blocks = blocks;
        repaint();
    };
    const removeBlock = async (index: number) => {
        if (!canChange())
            return;
        const block = current.blocks[index];
        if (!block)
            return;
        const job = block.type === 'image' ? [...current.photos.values()].find(job => job.block?.path === block.path && job.generation === current.generation) : undefined;
        if (job && latest.current.ports) {
            const task = {};
            current.task = task;
            repaint();
            try {
                const result = await latest.current.ports.cancel(job.plan.request.reference, ctx(task));
                if (!ctx(task).isCurrent() || result.status === 'unknown')
                    return;
                await latest.current.ports.cleanup(job.plan.request.reference, ctx(task));
                if (!ctx(task).isCurrent())
                    return;
                current.photos.delete(job.id);
            }
            finally {
                if (current.task === task) {
                    current.task = null;
                    repaint();
                }
            }
        }
        if (active()) {
            current.blocksDirty = true;
            current.blocks = current.blocks.filter((_, n) => n !== index);
            repaint();
        }
    };
    const uploadPhotos = async (files: File[], insertion?: {
        index: number;
        offset: number;
    }) => {
        if (!canChange())
            return;
        const task = {}, generation = current.generation, postId = current.postId;
        current.task = task;
        current.message = '';
        repaint();
        let index: number | undefined;
        try {
            for (const file of files) {
                if (!ctx(task).isCurrent())
                    return;
                const plan = await prepareNoticePhoto(current.companyId!, postId, file);
                if (!ctx(task).isCurrent())
                    return;
                const job: PhotoJob = {
                    id: plan.request.reference.uploadId, plan, file, postId, generation, busy: true, message: ''
                };
                current.photos.set(job.id, job);
                const block = await resumeNoticePhoto(plan, file, ctx(task), latest.current.ports);
                job.busy = false;
                job.block = block;
                current.blocksDirty = true;
                if (!ctx(task).isCurrent())
                    return;
                if (index === undefined && insertion && current.blocks[insertion.index]?.type === 'text') {
                    const before = current.blocks[insertion.index] as Extract<Blocks[number], {
                        type: 'text';
                    }>, at = Math.min(insertion.offset, before.text.length);
                    current.blocks = [...current.blocks.slice(0, insertion.index), { ...before, text: before.text.slice(0, at) }, block, { ...before, text: before.text.slice(at) }, ...current.blocks.slice(insertion.index + 1)];
                    index = insertion.index + 2;
                }
                else {
                    const at = index ?? current.blocks.length;
                    current.blocks = [...current.blocks.slice(0, at), block, ...current.blocks.slice(at)];
                    index = at + 1;
                }
            }
        }
        catch (error) {
            if (ctx(task).isCurrent())
                current.message = error instanceof Error ? error.message : String(error);
        }
        finally {
            for (const job of current.photos.values())
                if (job.generation === generation)
                    job.busy = false;
            if (owner.current === current && current.task === task) {
                current.task = null;
                repaint();
            }
            if (active())
                void refresh();
        }
    };
    const resumePhoto = async (id: string, file?: File) => {
        let job = current.photos.get(id);
        if (!job) {
            const entry = current.operations.find(row => row.kind === 'photo' && row.reference && isNoticePhotoReference(row.reference) && row.reference.uploadId === id);
            if (entry?.status === 'valid' && entry.request && 'sha256' in entry.request) {
                job = {
                    id, plan: { request: entry.request, fileName: entry.description }, postId: entry.request.reference.postId, generation: {}, busy: false, message: ''
                };
                current.photos.set(id, job);
            }
        }
        if (!writable() || current.task || !job)
            return false;
        const task = {};
        current.task = task;
        job.busy = true;
        repaint();
        try {
            const block = await resumeNoticePhoto(job.plan, file ?? job.file, ctx(task), latest.current.ports);
            if (!ctx(task).isCurrent())
                return false;
            job.block = block;
            if (job.generation === current.generation && job.postId === current.postId && !current.blocks.some(b => b.type === 'image' && b.path === block.path)) {
                current.blocks = [...current.blocks, block];
                current.blocksDirty = true;
            }
            return true;
        }
        catch (error) {
            if (ctx(task).isCurrent())
                current.message = error instanceof Error ? error.message : String(error);
            return false;
        }
        finally {
            job.busy = false;
            if (current.task === task) {
                current.task = null;
                repaint();
            }
            if (active())
                void refresh();
        }
    };
    const resultKey = (ref: NoticeRecoveryReference) => JSON.stringify(ref);
    const consume = (outcome: NoticeOutcome, ref: NoticeRecoveryReference) => {
        current.results.set(resultKey(ref), outcome);
        current.message = outcome.status === 'saved' ? outcome.serverResult?.message || '공지 처리 완료를 확인했습니다.' : saveOutcomeMessage(outcome);
        const same = !isNoticePhotoReference(ref) && ref.planId === current.planId && ref.postId === current.postId;
        if (same && outcome.requestFinalized) {
            current.pending = false;
            if (primaryCommitted(outcome, current.postId)) {
                for (const [id, job] of current.photos) {
                    if (job.postId === current.postId && job.generation === current.generation && !current.operations.some(row => row.reference && isNoticePhotoReference(row.reference) && row.reference.uploadId === id))
                        current.photos.delete(id);
                }
                reset();
            }
            else
                current.requiresNew = true;
        }
        else if (same) {
            current.pending = outcome.status === 'unknown' || outcome.status === 'partial' || current.operations.some(row => row.reference && !isNoticePhotoReference(row.reference) && row.reference.planId === ref.planId);
            current.requiresNew = outcome.requiresReopen === true;
        }
        return outcome.status === 'saved' && !!outcome.requestFinalized;
    };
    const save = async () => {
        if (!canChange() || current.readLoading || current.readError || !current.form.title.trim() || !bodyBlocks().some(b => b.type === 'image' || b.text.trim()))
            return false;
        if (bodyBlocks().some(b => b.type === 'text' && b.link?.trim() && !safeLink(b.link))) {
            current.message = '링크는 http 또는 https 주소로 입력해 주세요.';
            repaint();
            return false;
        }
        const body = bodyBlocks().filter(b => b.type === 'image' || b.text.trim()), post: Post = {
            id: current.postId, ...current.form, date: current.editing?.date || today(), author: current.form.author || '관리자', pinned: current.pinned, content: body.map(b => b.type === 'text' ? b.text : b.caption).join('\n'), blocks: body
        };
        if (current.editing && !current.blocksDirty)
            post.content = current.editing.content;
        const patch: NoticeRequest['patch'] = {};
        for (const key of ['title', 'author', 'content', 'date', 'tag', 'pinned', 'blocks'] as const)
            if ((key !== 'blocks' || !current.editing || current.blocksDirty) && (!current.editing || !sameValue(post[key], current.editing[key])))
                (patch as Record<string, unknown>)[key] = post[key];
        const ref = { companyId: current.companyId!, planId: current.planId, postId: current.postId }, task = {};
        current.task = task;
        repaint();
        try {
            const outcome = await latest.current.ports!.save({ action: current.editing ? 'edit' : 'create', patch }, {
                ...ctx(task), postId: current.postId, planId: current.planId, opening: current.opening
            });
            if (!ctx(task).isCurrent())
                return false;
            await refresh();
            if (!ctx(task).isCurrent())
                return false;
            return consume(outcome, ref);
        }
        catch (error) {
            if (ctx(task).isCurrent()) {
                current.pending = true;
                current.message = '공지 저장 결과를 확인하지 못했습니다. ' + (error instanceof Error ? error.message : String(error));
            }
            return false;
        }
        finally {
            if (owner.current === current && current.task === task) {
                current.task = null;
                repaint();
            }
            if (active())
                void refresh();
        }
    };
    const recover = async (ref: NoticeRecoveryReference, mode: 'inspect' | 'retry' | 'cancel' | 'cleanup' | 'discard', raw?: string | null, referenceRaw?: string | null) => {
        if (!writable() || current.task)
            return false;
        const entry = current.operations.find(row => row.reference && sameValue(row.reference, ref));
        if (mode === 'retry' && entry?.status !== 'valid')
            return false;
        const task = {};
        current.task = task;
        repaint();
        try {
            const ports = latest.current.ports!, outcome = mode === 'discard' ? await ports.discard(ref, raw!, referenceRaw!, ctx(task)) : await ports[mode](ref, ctx(task));
            if (!ctx(task).isCurrent())
                return false;
            await refresh();
            if (!ctx(task).isCurrent())
                return false;
            if (mode === 'discard') {
                current.results.set(resultKey(ref), outcome);
                current.message = outcome.status === 'saved' ? '이 기기의 사본만 정리했습니다. 저장된 공지와 현재 초안은 바꾸지 않았습니다.' : saveOutcomeMessage(outcome);
                if (outcome.status === 'saved' && !isNoticePhotoReference(ref) && ref.planId === current.planId) {
                    current.pending = false;
                    current.requiresNew = true;
                }
                return outcome.status === 'saved';
            }
            return consume(outcome, ref);
        }
        catch (error) {
            if (ctx(task).isCurrent())
                current.message = error instanceof Error ? error.message : String(error);
            return false;
        }
        finally {
            if (owner.current === current && current.task === task) {
                current.task = null;
                repaint();
            }
        }
    };
    const history = async (reset: boolean) => {
        if (!writable() || current.historyLoading)
            return;
        const generation = ++current.historyGeneration, cursor = reset ? undefined : current.historyMore ?? undefined;
        if (!reset && !cursor)
            return;
        current.historyLoading = true;
        repaint();
        try {
            const page = await latest.current.ports!.history({ ...ctx(), isCurrent: () => active() && current.historyGeneration === generation }, cursor);
            if (active() && current.historyGeneration === generation) {
                current.history = reset ? page.entries : [...current.history, ...page.entries];
                current.historyMore = page.nextCursor;
                current.historyError = '';
                current.message = `이번 조회에서 ${page.entries.length}건을 확인했습니다. 목록에 없다는 이유만으로 미처리라고 확정하지 않습니다.`;
            }
        }
        catch (error) {
            if (active() && current.historyGeneration === generation)
                current.historyError = error instanceof Error ? error.message : String(error);
        }
        finally {
            if (active() && current.historyGeneration === generation) {
                current.historyLoading = false;
                repaint();
            }
        }
    };
    const legacyInspect = async () => {
        const legacy = current.legacy;
        if (!writable() || current.task || !legacy)
            return false;
        if (!legacy.postId) {
            current.message = '이전 사본의 공지 번호를 확인할 수 없어 서버 자료와 대조하지 않았습니다. 이 사본으로 저장이나 서버 중단을 실행하지 않습니다.';
            repaint();
            return false;
        }
        const task = {};
        current.task = task;
        repaint();
        try {
            const observation = await latest.current.ports!.observeLegacy({ companyId: current.companyId!, postId: legacy.postId, planId: 'legacy-' + crypto.randomUUID() }, ctx(task));
            if (!ctx(task).isCurrent() || current.legacy?.observedLocalText !== legacy.observedLocalText)
                return false;
            legacy.observation = observation;
            legacy.observedPost = observation.snapshot ? decodeNoticeObservationSnapshot(observation.snapshot) : null;
            legacy.inspected = true;
            current.message = observation.exists ? '현재 서버 공지를 확인했습니다. 이 자료가 이전 요청의 저장 영수증이라는 뜻은 아닙니다. 보관 사본과 비교한 뒤 이 기기 사본만 정리할 수 있습니다.' : '현재 서버에서 이 공지를 찾지 못했습니다. 이전 요청의 실패나 미처리 확정은 아닙니다. 보관 사본 정리는 서버 중단과 다릅니다.';
            return true;
        }
        catch (error) {
            if (ctx(task).isCurrent())
                current.message = '현재 공지를 확인하지 못했습니다. ' + (error instanceof Error ? error.message : String(error));
            return false;
        }
        finally {
            if (current.task === task) {
                current.task = null;
                repaint();
            }
        }
    };
    const legacyDiscard = async (raw: string, referenceRaw: string | null = null) => {
        const legacy = current.legacy;
        if (!active() || !legacy || (!!legacy.postId && !legacy.inspected) || legacy.observedLocalText !== raw || legacy.observedReferenceText !== referenceRaw)
            return false;
        if (sessionStorage.getItem(legacy.key) !== raw || sessionStorage.getItem(legacy.key + ':reference') !== referenceRaw) {
            current.message = '이전 기기 사본이 바뀌었습니다. 다시 읽어 주세요.';
            repaint();
            return false;
        }
        sessionStorage.removeItem(legacy.key);
        sessionStorage.removeItem(legacy.key + ':reference');
        if (sessionStorage.getItem(legacy.key) !== null)
            return false;
        current.legacy = null;
        current.message = '이전 방식의 기기 사본만 정리했습니다. 저장 여부나 현재 초안을 바꾸지 않았습니다.';
        repaint();
        return true;
    };
    return {
        form: current.form, blocks: current.blocks, bodyBlocks: bodyBlocks(), editing: current.editing, showForm: current.showForm, preview: current.preview, pinned: current.pinned, draftId: current.postId, busy: !!current.task, locked: current.pending || current.requiresNew, canWrite: writable(), canSave: canChange() && !current.readLoading && !current.readError && !!current.form.title.trim(), message: current.message, resultFor: (ref: NoticeRecoveryReference) => current.results.get(resultKey(ref)), readLoading: current.readLoading, readError: current.readError, operations: current.operations, photos: [...current.photos.values()], legacy: current.legacy, openCreate, openEdit, closeDraft, changeField, changeBlock, addText, moveBlock, removeBlock, uploadPhotos, resumePhoto, setPinned: (value: boolean) => {
            if (canChange()) {
                current.pinned = value;
                repaint();
            }
        }, setPreview: (value: boolean) => {
            if (canChange()) {
                current.preview = value;
                repaint();
            }
        }, save, refresh, inspect: (ref: NoticeRecoveryReference) => recover(ref, 'inspect'), retry: (ref: NoticeRecoveryReference) => recover(ref, 'retry'), cancel: (ref: NoticeRecoveryReference) => recover(ref, 'cancel'), cleanup: (ref: NoticeRecoveryReference) => recover(ref, 'cleanup'), discardCopy: (ref: NoticeRecoveryReference, raw: string | null, referenceRaw: string | null) => recover(ref, 'discard', raw, referenceRaw), canRetry: (entry: NoticeEntry) => {
            if (entry.status !== 'valid' || !entry.reference)
                return false;
            const result = current.results.get(resultKey(entry.reference));
            return !result?.copyMismatch && (!result?.serverResult || result.serverResult.status === 'unknown' || result.serverResult.status === 'reserved');
        }, canCleanup: (entry: NoticeEntry) => !!entry.reference && ['pending', 'manual-blocked'].includes(current.results.get(resultKey(entry.reference))?.serverResult?.cleanupStatus ?? ''), canCancel: (entry: NoticeEntry) => !!entry.reference && (!current.results.get(resultKey(entry.reference))?.serverResult || ['unknown', 'reserved'].includes(current.results.get(resultKey(entry.reference))!.serverResult!.status)), requiresFile: (entry: NoticeEntry) => entry.kind === 'photo' && entry.status === 'valid' && !!entry.reference && isNoticePhotoReference(entry.reference) && !current.photos.get(entry.reference.uploadId)?.file, canDiscard: (entry: NoticeEntry) => !!entry.reference && (entry.observedLocalText !== null || entry.observedReferenceText !== null), canCreateNew: writable() && !current.task && !current.pending, history: current.history, historyMore: current.historyMore, historyLoading: current.historyLoading, historyError: current.historyError, loadHistory: () => history(true), nextHistory: () => history(false), legacyInspect, legacyDiscard, canDiscardLegacy: !!current.legacy && (!current.legacy.postId || current.legacy.inspected)
    };
}
const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
