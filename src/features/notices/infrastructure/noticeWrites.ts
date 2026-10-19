import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions } from '../../../shared/firebase';
import { noticeOpening, normalizeNoticeObservationResult, type NoticeObservationResult, normalizeNoticeReference, normalizeNoticePhotoReference, normalizeNoticeRequest, normalizeNoticePhotoRequest, normalizeNoticeOpenResult, normalizeNoticeResult, normalizeNoticePhotoResult, normalizeNoticeHistoryResult, serializeNoticeRequest, serializeNoticePhotoRequest, type NoticeScope, type NoticeReference, type NoticePhotoReference, type NoticeRequest, type NoticePhotoRequest, type NoticeOpenResult, type NoticeResult, type NoticePhotoResult, type NoticeHistoryResult, type NoticeCommand } from '../../../shared/noticeCommand';
import type { Post } from '../../../shared/types';
import type { SaveOutcome } from '../../../shared/saveOutcome';
export type { NoticeScope, NoticeReference, NoticePhotoReference, NoticeOpenResult, NoticeResult, NoticePhotoResult };
export type NoticeRecoveryReference = NoticeReference | NoticePhotoReference;
export interface NoticeContext extends NoticeScope {
    isCurrent: () => boolean;
}
export interface NoticeOperationContext extends NoticeContext {
    postId: string;
    planId: string;
}
export interface NoticeSaveContext extends NoticeOperationContext {
    opening: NoticeOpenResult | null;
}
export type NoticeOutcome = SaveOutcome & {
    requestFinalized?: boolean;
    requiresReopen?: boolean;
    copyMismatch?: boolean;
    serverResult?: NoticeResult | NoticePhotoResult;
};
export interface NoticeEntry {
    key: string;
    kind: 'post' | 'photo';
    reference: NoticeRecoveryReference | null;
    status: 'valid' | 'corrupt' | 'missing';
    description: string;
    observedLocalText: string | null;
    observedReferenceText: string | null;
    request?: NoticeRequest | NoticePhotoRequest;
    serverResult?: NoticeResult | NoticePhotoResult;
}
export interface NoticeBindings {
    observeLegacy: (reference: NoticeReference, ctx: NoticeContext) => Promise<NoticeObservationResult>;
    open: (post: Post, ctx: NoticeOperationContext) => Promise<NoticeOpenResult>;
    save: (input: {
        action: NoticeRequest['action'];
        patch?: NoticeRequest['patch'];
    }, ctx: NoticeSaveContext) => Promise<NoticeOutcome>;
    read: (ctx: NoticeContext) => Promise<NoticeEntry[]>;
    inspect: (ref: NoticeRecoveryReference, ctx: NoticeContext) => Promise<NoticeOutcome>;
    retry: (ref: NoticeRecoveryReference, ctx: NoticeContext) => Promise<NoticeOutcome>;
    cancel: (ref: NoticeRecoveryReference, ctx: NoticeContext) => Promise<NoticeOutcome>;
    cleanup: (ref: NoticeRecoveryReference, ctx: NoticeContext) => Promise<NoticeOutcome>;
    discard: (ref: NoticeRecoveryReference, raw: string | null, referenceRaw: string | null, ctx: NoticeContext) => Promise<NoticeOutcome>;
    history: (ctx: NoticeContext, cursor?: string) => Promise<NoticeHistoryResult>;
    reservePhoto: (request: NoticePhotoRequest, ctx: NoticeContext) => Promise<NoticePhotoResult>;
}
export interface NoticeWritePort {
    storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
    command: (input: NoticeCommand) => Promise<unknown>;
    digest: (text: string) => Promise<string>;
    assertContext: (ctx: NoticeContext) => Promise<void>;
}
export const isNoticePhotoReference = (ref: NoticeRecoveryReference): ref is NoticePhotoReference => 'uploadId' in ref;
const refId = (ref: NoticeRecoveryReference) => isNoticePhotoReference(ref) ? ref.uploadId : ref.planId;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const unknown = (message = '공지 처리 결과를 확인하지 못했습니다.'): NoticeOutcome => ({ status: 'unknown', message, nextAction: '같은 요청의 결과 확인 또는 미처리 요청 중단을 선택해 주세요. 새 원문으로 다시 보내지 마세요.' });
const prefix = (ctx: NoticeScope) => `notice-operation-v1:${ctx.companyId}:${encodeURIComponent(ctx.actorUid)}:${encodeURIComponent(ctx.employeeId)}:`;
const keys = (ctx: NoticeScope, ref: NoticeRecoveryReference) => {
    const key = prefix(ctx) + (isNoticePhotoReference(ref) ? 'photo' : 'post') + ':' + encodeURIComponent(ref.postId) + ':' + encodeURIComponent(refId(ref));
    return { body: key, sidecar: key + ':reference' };
};
const exclusive = async <T>(key: string, action: () => Promise<T>) => typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request(key, action) : action();
export function createNoticeWriter(port: NoticeWritePort): NoticeBindings {
    const active = async (ctx: NoticeContext) => {
        if (!ctx.isCurrent())
            throw Error('공지 작업 화면이 바뀌었습니다.');
        await port.assertContext(ctx);
        if (!ctx.isCurrent())
            throw Error('공지 작업 화면이 바뀌었습니다.');
    };
    const normalizeRef = (input: NoticeRecoveryReference) => isNoticePhotoReference(input) ? normalizeNoticePhotoReference(input) : normalizeNoticeReference(input);
    const parse = async (ctx: NoticeContext, ref: NoticeRecoveryReference, raw: string | null, referenceRaw: string | null) => {
        if (!raw)
            return null;
        try {
            const saved = JSON.parse(raw), sidecar = JSON.parse(referenceRaw!);
            const request = isNoticePhotoReference(ref) ? normalizeNoticePhotoRequest(saved.request) : normalizeNoticeRequest(saved.request), text = isNoticePhotoReference(ref) ? serializeNoticePhotoRequest(request as NoticePhotoRequest) : serializeNoticeRequest(request as NoticeRequest);
            if (saved.version !== 1 || saved.actorUid !== ctx.actorUid || saved.employeeId !== ctx.employeeId || !same(request.reference, ref) || sidecar.actorUid !== ctx.actorUid || sidecar.employeeId !== ctx.employeeId || !same(sidecar.reference, ref) || sidecar.requestHash !== saved.requestHash || await port.digest(text) !== saved.requestHash)
                throw Error();
            const serverResult = saved.observation ? (isNoticePhotoReference(ref) ? normalizeNoticePhotoResult(saved.observation, ref, ctx.actorUid, ctx.employeeId, saved.requestHash) : normalizeNoticeResult(saved.observation, ref, ctx.actorUid, ctx.employeeId, saved.requestHash)) : undefined;
            return { request, requestHash: saved.requestHash as string, serverResult };
        }
        catch {
            return null;
        }
    };
    const snapshot = async (input: NoticeRecoveryReference, ctx: NoticeContext) => {
        const ref = normalizeRef(input);
        if (ref.companyId !== ctx.companyId)
            throw Error('다른 회사 요청입니다.');
        const key = keys(ctx, ref), raw = port.storage.getItem(key.body), referenceRaw = port.storage.getItem(key.sidecar), plan = await parse(ctx, ref, raw, referenceRaw);
        return {
            ref, key, raw, referenceRaw, plan
        };
    };
    const exact = (s: Awaited<ReturnType<typeof snapshot>>) => port.storage.getItem(s.key.body) === s.raw && port.storage.getItem(s.key.sidecar) === s.referenceRaw;
    const clear = (s: Awaited<ReturnType<typeof snapshot>>) => {
        if (!exact(s))
            throw Error('보관 사본이 바뀌었습니다.');
        if (s.raw !== null)
            port.storage.removeItem(s.key.body);
        if (s.referenceRaw !== null)
            port.storage.removeItem(s.key.sidecar);
        if (port.storage.getItem(s.key.body) !== null || port.storage.getItem(s.key.sidecar) !== null)
            throw Error('보관 정리를 확인하지 못했습니다.');
    };
    const persist = async (request: NoticeRequest | NoticePhotoRequest, ctx: NoticeContext) => {
        const ref = request.reference, text = isNoticePhotoReference(ref) ? serializeNoticePhotoRequest(request as NoticePhotoRequest) : serializeNoticeRequest(request as NoticeRequest), requestHash = await port.digest(text), key = keys(ctx, ref);
        await exclusive(key.body, async () => {
            await active(ctx);
            const previous = await snapshot(ref, ctx);
            if (previous.raw !== null || previous.referenceRaw !== null) {
                if (previous.plan?.requestHash === requestHash && same(previous.plan.request, request))
                    return;
                throw Error('같은 요청 번호에 다른 보관 원문이 있습니다. 먼저 결과를 확인해 주세요.');
            }
            const raw = JSON.stringify({
                version: 1, actorUid: ctx.actorUid, employeeId: ctx.employeeId, request, requestHash
            }), referenceRaw = JSON.stringify({
                version: 1, actorUid: ctx.actorUid, employeeId: ctx.employeeId, reference: ref, requestHash
            });
            port.storage.setItem(key.sidecar, referenceRaw);
            if (port.storage.getItem(key.sidecar) !== referenceRaw)
                throw Error('요청 참조 보관을 확인하지 못했습니다.');
            port.storage.setItem(key.body, raw);
            if (port.storage.getItem(key.body) !== raw || port.storage.getItem(key.sidecar) !== referenceRaw)
                throw Error('요청 원문 보관을 확인하지 못했습니다.');
        });
    };
    const observe = async (s: Awaited<ReturnType<typeof snapshot>>, result: NoticeResult | NoticePhotoResult, ctx: NoticeContext) => {
        if (!s.plan)
            return;
        await exclusive(s.key.body, async () => {
            await active(ctx);
            if (!exact(s))
                throw Error('관측 중 기기 사본이 바뀌었습니다.');
            const raw = JSON.stringify({ ...JSON.parse(s.raw!), observation: result });
            port.storage.setItem(s.key.body, raw);
            if (port.storage.getItem(s.key.body) !== raw || port.storage.getItem(s.key.sidecar) !== s.referenceRaw)
                throw Error('단계 관측 보관을 확인하지 못했습니다.');
        });
    };
    const run = async (input: NoticeRecoveryReference, ctx: NoticeContext, mode: 'inspect' | 'retry' | 'cancel' | 'cleanup'): Promise<NoticeOutcome> => {
        try {
            const s = await snapshot(input, ctx), photo = isNoticePhotoReference(s.ref);
            if (mode === 'retry' && !s.plan)
                return unknown('보관 원문을 읽지 못해 다시 보내지 않았습니다.');
            await active(ctx);
            if (!exact(s))
                return unknown('보관 사본이 바뀌어 요청을 보내지 않았습니다.');
            const command: NoticeCommand = photo
                ? mode === 'retry' ? { mode: 'reservePhoto', request: s.plan!.request as NoticePhotoRequest }
                    : mode === 'cancel' ? { mode: 'cancelPhoto', photoReference: s.ref as NoticePhotoReference }
                        : mode === 'cleanup' ? { mode: 'cleanup', photoReference: s.ref as NoticePhotoReference }
                            : { mode: 'inspect', photoReference: s.ref as NoticePhotoReference }
                : mode === 'retry' ? { mode: 'apply', request: s.plan!.request as NoticeRequest }
                    : mode === 'cancel' ? { mode: 'cancel', reference: s.ref as NoticeReference }
                        : mode === 'cleanup' ? { mode: 'cleanup', reference: s.ref as NoticeReference }
                            : { mode: 'inspect', reference: s.ref as NoticeReference };
            const attachedPhotos: Awaited<ReturnType<typeof snapshot>>[] = [];
            if (!photo && s.plan && 'action' in s.plan.request) {
                for (const block of s.plan.request.patch?.blocks ?? []) {
                    if (block.type !== 'image' || typeof block.path !== 'string')
                        continue;
                    const base = `companies/${ctx.companyId}/notices/${s.ref.postId}/`;
                    if (!block.path.startsWith(base))
                        continue;
                    const uploadId = block.path.slice(base.length);
                    if (!uploadId || uploadId.includes('/'))
                        continue;
                    const savedPhoto = await snapshot({ companyId: ctx.companyId, postId: s.ref.postId, uploadId }, ctx);
                    if (savedPhoto.plan)
                        attachedPhotos.push(savedPhoto);
                }
            }
            const value = await port.command(command);
            await active(ctx);
            const result = photo ? normalizeNoticePhotoResult(value, s.ref as NoticePhotoReference, ctx.actorUid, ctx.employeeId) : normalizeNoticeResult(value, s.ref as NoticeReference, ctx.actorUid, ctx.employeeId);
            const mismatch = s.raw !== null && (!s.plan || result.requestHash !== null && result.requestHash !== s.plan.requestHash) || s.raw === null && result.status === 'applied';
            if (mismatch)
                return {
                    status: 'rejected', copyMismatch: true, serverResult: result, message: `이 기기 사본의 완료로 처리하지 않았습니다. ${result.message}`, nextAction: '실제 공지 상태를 확인한 뒤 관측한 기기 사본만 명시적으로 정리할 수 있습니다.'
                };
            if (result.status === 'unknown')
                return { ...unknown(result.message), serverResult: result };
            if (result.status === 'reserved')
                return { ...unknown(result.message), serverResult: result };
            if (result.status === 'applied' && attachedPhotos.length) {
                try {
                    for (const savedPhoto of attachedPhotos) {
                        await active(ctx);
                        const photoResult = normalizeNoticePhotoResult(await port.command({ mode: 'inspect', photoReference: savedPhoto.ref as NoticePhotoReference }), savedPhoto.ref as NoticePhotoReference, ctx.actorUid, ctx.employeeId);
                        await active(ctx);
                        if (photoResult.requestHash !== savedPhoto.plan!.requestHash || photoResult.status !== 'reserved' || photoResult.uploadStatus !== 'verified' || photoResult.cleanupStatus !== 'not-required')
                            continue;
                        await exclusive(savedPhoto.key.body, async () => {
                            await active(ctx);
                            clear(savedPhoto);
                        });
                    }
                }
                catch {
                    return {
                        status: 'partial', reason: 'followup-unconfirmed', committedIds: [s.ref.postId], unconfirmedIds: [], serverResult: result, message: '공지는 저장됐지만 완료된 사진 기기 사본 정리를 확인하지 못했습니다.', nextAction: '본문을 다시 보내지 말고 같은 요청의 결과 확인으로 정리를 마쳐 주세요.'
                    };
                }
            }
            if (result.cleanupStatus === 'pending' || result.cleanupStatus === 'manual-blocked') {
                try {
                    await observe(s, result, ctx);
                }
                catch {
                    return {
                        status: 'partial', reason: 'followup-unconfirmed', committedIds: result.status === 'applied' ? [s.ref.postId] : [], unconfirmedIds: [], serverResult: result, message: '서버 처리 상태는 확인했지만 기기의 단계 기록을 보관하지 못했습니다.', nextAction: '본문을 다시 보내지 말고 같은 요청의 결과를 확인해 주세요.'
                    };
                }
                return result.status === 'applied' ? { status: 'saved', requestFinalized: true, serverResult: result } : {
                    status: result.status === 'cancelled' ? 'cancelled' : 'rejected', requestFinalized: true, serverResult: result, message: result.message, nextAction: '남은 사진 정리 상태를 확인해 주세요. 본문을 다시 보내지 마세요.'
                };
            }
            try {
                await exclusive(s.key.body, async () => {
                    await active(ctx);
                    clear(s);
                });
            }
            catch {
                return result.status === 'applied' ? {
                    status: 'partial', reason: 'followup-unconfirmed', committedIds: [s.ref.postId], unconfirmedIds: [], serverResult: result, message: '공지는 저장됐지만 기기 사본 정리를 확인하지 못했습니다.', nextAction: '같은 요청의 결과 확인으로 사본 정리를 마쳐 주세요.'
                } : { ...unknown('요청은 종결됐지만 기기 사본 정리를 확인하지 못했습니다.'), serverResult: result };
            }
            return result.status === 'applied' ? { status: 'saved', requestFinalized: true, serverResult: result } : {
                status: result.status === 'cancelled' ? 'cancelled' : 'rejected', requestFinalized: true, requiresReopen: true, serverResult: result, message: result.message, nextAction: '현재 자료를 다시 열거나 명시적으로 새 공지를 작성해 주세요.'
            };
        }
        catch {
            return unknown();
        }
    };
    const open = async (post: Post, ctx: NoticeOperationContext) => {
        const reference = normalizeNoticeReference({ companyId: ctx.companyId, planId: ctx.planId, postId: ctx.postId }), opening = noticeOpening(post);
        await active(ctx);
        const result = normalizeNoticeOpenResult(await port.command({ mode: 'open', reference, opening }), reference, ctx.actorUid, ctx.employeeId);
        await active(ctx);
        if (!same(result.opening, opening))
            throw Error('선택한 공지가 바뀌었습니다. 현재 자료를 다시 열어 주세요.');
        return result;
    };
    const save: NoticeBindings['save'] = async (input, ctx) => {
        try {
            await active(ctx);
            const reference = normalizeNoticeReference({ companyId: ctx.companyId, planId: ctx.planId, postId: ctx.postId });
            if (input.action !== 'create') {
                if (!ctx.opening)
                    throw Error('수정할 원문을 먼저 확인해 주세요.');
                normalizeNoticeOpenResult(ctx.opening, reference, ctx.actorUid, ctx.employeeId);
            }
            const request = normalizeNoticeRequest({
                version: 1, reference, action: input.action, expectedVersion: ctx.opening?.expectedVersion ?? null, ...(input.patch ? { patch: input.patch } : {})
            });
            await persist(request, ctx);
        }
        catch (error) {
            return { status: 'rejected', message: error instanceof Error ? error.message : String(error), nextAction: '보관 요청을 다시 읽어 상태를 확인해 주세요. 새 업무 요청은 보내지 않았습니다.' };
        }
        return run({ companyId: ctx.companyId, planId: ctx.planId, postId: ctx.postId }, ctx, 'retry');
    };
    const read = async (ctx: NoticeContext): Promise<NoticeEntry[]> => {
        await active(ctx);
        const entries: NoticeEntry[] = [], ids = new Set<string>();
        for (let n = 0; n < port.storage.length; n++) {
            const key = port.storage.key(n);
            if (key?.startsWith(prefix(ctx)))
                ids.add(key.endsWith(':reference') ? key.slice(0, -10) : key);
        }
        for (const key of ids) {
            const parts = key.slice(prefix(ctx).length).split(':');
            let ref: NoticeRecoveryReference | null = null;
            const kind = parts[0] === 'photo' ? 'photo' : 'post';
            try {
                if (parts.length !== 3 || !['post', 'photo'].includes(parts[0]))
                    throw Error('요청 키 형식');
                ref = normalizeRef({ companyId: ctx.companyId, postId: decodeURIComponent(parts[1]), ...(kind === 'photo' ? { uploadId: decodeURIComponent(parts[2]) } : { planId: decodeURIComponent(parts[2]) }) } as NoticeRecoveryReference);
            }
            catch {
            }
            if (!ref) {
                entries.push({
                    key, kind, reference: null, status: 'corrupt', description: '공지 요청 번호 확인 필요', observedLocalText: port.storage.getItem(key), observedReferenceText: port.storage.getItem(key + ':reference')
                });
                continue;
            }
            const s = await snapshot(ref, ctx), title = s.plan && !isNoticePhotoReference(ref) ? (s.plan.request as NoticeRequest).patch?.title : undefined;
            entries.push({
                key, kind, reference: ref, status: s.plan && exact(s) ? 'valid' : s.raw === null ? 'missing' : 'corrupt', description: title || `공지 ${ref.postId} · ${kind === 'photo' ? '사진' : '저장'} 요청`, observedLocalText: s.raw, observedReferenceText: s.referenceRaw, request: s.plan?.request, serverResult: s.plan?.serverResult
            });
        }
        await active(ctx);
        return entries;
    };
    const discard: NoticeBindings['discard'] = async (ref, raw, referenceRaw, ctx) => {
        try {
            const s = await snapshot(ref, ctx);
            if (s.raw !== raw || s.referenceRaw !== referenceRaw)
                return { status: 'rejected', message: '관측한 기기 사본이 바뀌어 정리하지 않았습니다.' };
            await active(ctx);
            const photo = isNoticePhotoReference(s.ref), value = await port.command(photo ? { mode: 'inspect', photoReference: s.ref as NoticePhotoReference } : { mode: 'inspect', reference: s.ref as NoticeReference });
            await active(ctx);
            const result = photo ? normalizeNoticePhotoResult(value, s.ref as NoticePhotoReference, ctx.actorUid, ctx.employeeId) : normalizeNoticeResult(value, s.ref as NoticeReference, ctx.actorUid, ctx.employeeId);
            if (result.status === 'unknown' || result.status === 'reserved')
                return {
                    status: 'rejected', serverResult: result, message: result.message, nextAction: '먼저 미처리 요청 중단으로 종결해 주세요.'
                };
            await exclusive(s.key.body, async () => {
                await active(ctx);
                clear(s);
            });
            return { status: 'saved', serverResult: result };
        }
        catch {
            return unknown('이 기기 사본 정리를 확인하지 못했습니다.');
        }
    };
    const reservePhoto: NoticeBindings['reservePhoto'] = async (request, ctx) => {
        request = normalizeNoticePhotoRequest(request);
        await persist(request, ctx);
        const s = await snapshot(request.reference, ctx);
        await active(ctx);
        if (!exact(s))
            throw Error('사진 예약 사본이 바뀌었습니다.');
        const result = normalizeNoticePhotoResult(await port.command({ mode: 'reservePhoto', request }), request.reference, ctx.actorUid, ctx.employeeId, s.plan!.requestHash);
        await active(ctx);
        await observe(s, result, ctx);
        return result;
    };
    const history: NoticeBindings['history'] = async (ctx, cursor) => {
        await active(ctx);
        const result = normalizeNoticeHistoryResult(await port.command({ mode: 'listHistory', companyId: ctx.companyId, ...(cursor ? { cursor } : {}) }), ctx.companyId, ctx.actorUid, ctx.employeeId);
        await active(ctx);
        return result;
    };
    return {
        observeLegacy: async (reference, ctx) => {
            reference = normalizeNoticeReference(reference);
            await active(ctx);
            const result = normalizeNoticeObservationResult(await port.command({ mode: 'open', reference, observeOnly: true }), reference, ctx.actorUid, ctx.employeeId);
            await active(ctx);
            return result;
        }, open, save, read, inspect: (ref, ctx) => run(ref, ctx, 'inspect'), retry: (ref, ctx) => run(ref, ctx, 'retry'), cancel: (ref, ctx) => run(ref, ctx, 'cancel'), cleanup: (ref, ctx) => run(ref, ctx, 'cleanup'), discard, history, reservePhoto
    };
}
export const noticeDigest = async (text: string | ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof text === 'string' ? new TextEncoder().encode(text) : text))).map(v => v.toString(16).padStart(2, '0')).join('');
export const noticeBindings: NoticeBindings = { ...createNoticeWriter({
        storage: {
            get length() {
                return localStorage.length;
            }, key: n => localStorage.key(n), getItem: key => localStorage.getItem(key), setItem: (key, text) => localStorage.setItem(key, text), removeItem: key => localStorage.removeItem(key)
        }, digest: text => noticeDigest(text), command: async (input) => (await httpsCallable(functions, 'noticeCommand')(input)).data, assertContext: async (ctx) => {
            const check = () => {
                if (!ctx.isCurrent() || auth.currentUser?.uid !== ctx.actorUid)
                    throw Error('회사 또는 로그인 계정이 바뀌었습니다.');
            };
            check();
            await authReady;
            check();
            const token = await auth.currentUser!.getIdTokenResult();
            check();
            if (token.claims.companyId !== ctx.companyId || token.claims.employeeId !== ctx.employeeId || token.claims.isAdmin !== true)
                throw Error('현재 회사의 공지 관리자 권한을 확인해 주세요.');
        }
    }) };
