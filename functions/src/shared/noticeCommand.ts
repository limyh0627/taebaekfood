import { encodeCatalogValue, decodeCatalogValue, type CatalogValue } from './catalogOrderReferenceProof';
import { cleanupValidId } from './partnerItemCleanup';
import { documentId } from './documentId';
export type { CatalogValue } from './catalogOrderReferenceProof';
export const NOTICE_OPERATIONS = 'noticeOperations', NOTICE_UPLOADS = 'noticePhotoUploads', NOTICE_PATHS = 'noticeStoragePaths';
export const NOTICE_FIELDS = ['title', 'author', 'content', 'date', 'tag', 'pinned', 'blocks'] as const;
export interface NoticeReference {
    companyId: 'taebaek' | 'punghoe';
    planId: string;
    postId: string;
}
export interface NoticePhotoReference {
    companyId: NoticeReference['companyId'];
    postId: string;
    uploadId: string;
}
export interface NoticeScope {
    companyId: NoticeReference['companyId'];
    actorUid: string;
    employeeId: string;
}
export type NoticeBlock = {
    type: 'text';
    text: string;
    format?: 'paragraph' | 'heading' | 'subheading' | 'list';
    bold?: boolean;
    link?: string;
} | {
    type: 'image';
    path: string;
    url: string;
    caption: string;
};
export interface NoticePatch {
    title?: string;
    author?: string;
    content?: string;
    date?: string;
    tag?: '공지' | '긴급' | '매뉴얼' | '업무';
    pinned?: boolean;
    blocks?: NoticeBlock[];
}
export interface NoticeRequest {
    version: 1;
    reference: NoticeReference;
    action: 'create' | 'edit' | 'pin' | 'delete';
    expectedVersion: string | null;
    patch?: NoticePatch;
}
export interface NoticePhotoRequest {
    version: 1;
    reference: NoticePhotoReference;
    sha256: string;
    size: number;
    contentType: 'image/jpeg' | 'image/png' | 'image/webp';
}
export type NoticeCleanupStatus = 'not-required' | 'pending' | 'deleted' | 'absent' | 'retained-shared' | 'retained-replaced' | 'manual-blocked';
export interface NoticeResult {
    version: 1;
    reference: NoticeReference;
    actorUid: string;
    employeeId: string;
    status: 'applied' | 'rejected' | 'cancelled' | 'unknown';
    requestHash: string | null;
    cleanupStatus: NoticeCleanupStatus;
    message: string;
}
export interface NoticePhotoResult {
    version: 1;
    reference: NoticePhotoReference;
    actorUid: string;
    employeeId: string;
    status: 'reserved' | 'cancelled' | 'unknown';
    uploadStatus: 'reserved' | 'absent' | 'verified' | 'unverified';
    downloadUrl?: string;
    generation?: string;
    requestHash: string | null;
    cleanupStatus: NoticeCleanupStatus;
    path: string;
    message: string;
}
export interface NoticeOpenResult {
    reference: NoticeReference;
    actorUid: string;
    employeeId: string;
    opening: CatalogValue;
    expectedVersion: string | null;
}
export interface NoticeObservationResult {
    reference: NoticeReference;
    actorUid: string;
    employeeId: string;
    observeOnly: true;
    exists: boolean;
    snapshot: CatalogValue | null;
    expectedVersion: string | null;
}
export interface NoticeHistoryResult {
    version: 1;
    companyId: NoticeReference['companyId'];
    actorUid: string;
    employeeId: string;
    entries: ({
        kind: 'post';
        result: NoticeResult;
        createdAt: string;
        label: string;
    } | {
        kind: 'photo';
        result: NoticePhotoResult;
        createdAt: string;
        label: string;
    })[];
    nextCursor: string | null;
}
export type NoticeCommand = {
    mode: 'open';
    reference: NoticeReference;
    observeOnly: true;
} | {
    mode: 'open';
    reference: NoticeReference;
    opening: CatalogValue;
} | {
    mode: 'apply';
    request: NoticeRequest;
} | {
    mode: 'inspect' | 'cancel';
    reference: NoticeReference;
} | {
    mode: 'reservePhoto';
    request: NoticePhotoRequest;
} | {
    mode: 'inspect';
    photoReference: NoticePhotoReference;
} | {
    mode: 'cancelPhoto';
    photoReference: NoticePhotoReference;
} | {
    mode: 'cleanup';
    reference: NoticeReference;
} | {
    mode: 'cleanup';
    photoReference: NoticePhotoReference;
} | {
    mode: 'listHistory';
    companyId: NoticeReference['companyId'];
    cursor?: string;
};
const company = (v: unknown) => {
    if (v !== 'taebaek' && v !== 'punghoe')
        throw Error('공지 소속 회사를 확인해 주세요.');
    return v;
};
function exact(v: unknown, keys: readonly string[]): asserts v is Record<string, unknown> {
    if (!v || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v)) || Object.keys(v).some(k => !keys.includes(k)))
        throw Error('공지 요청 형식을 확인해 주세요.');
}
export function normalizeNoticeReference(v: unknown): NoticeReference {
    exact(v, ['companyId', 'planId', 'postId']);
    if (!cleanupValidId(v.planId) || !documentId(v.postId))
        throw Error('공지 요청 번호를 확인해 주세요.');
    return { companyId: company(v.companyId), planId: v.planId, postId: v.postId };
}
export function normalizeNoticePhotoReference(v: unknown): NoticePhotoReference {
    exact(v, ['companyId', 'postId', 'uploadId']);
    if (!documentId(v.postId) || !cleanupValidId(v.uploadId))
        throw Error('사진 요청 번호를 확인해 주세요.');
    return { companyId: company(v.companyId), postId: v.postId, uploadId: v.uploadId };
}
export const noticePhotoPath = (ref: NoticePhotoReference) => { const r = normalizeNoticePhotoReference(ref); return `companies/${r.companyId}/notices/${r.postId}/${r.uploadId}`; };
const version = (v: unknown) => {
    if (v !== null && (typeof v !== 'string' || !/^\d+:\d{9}$/.test(v)))
        throw Error('확인한 공지 버전을 보존해 주세요.');
    return v as string | null;
};
export function noticeOpening(row: object | null | undefined): CatalogValue { return encodeCatalogValue(Object.fromEntries(NOTICE_FIELDS.filter(k => row && Object.prototype.hasOwnProperty.call(row, k)).map(k => [k, (row as Record<string, unknown>)[k]]))); }
function opening(value: unknown): CatalogValue {
    const no = () => { throw Error('공지 원문 형식을 확인해 주세요.'); };
    const raw = decodeCatalogValue(value, { special: () => undefined, timestamp: no, reference: no, geo: no, bytes: no });
    exact(raw, NOTICE_FIELDS);
    if (JSON.stringify(noticeOpening(raw)) !== JSON.stringify(value))
        no();
    return value as CatalogValue;
}
export function normalizeNoticeOpenRequest(v: unknown) {
    exact(v, ['mode', 'reference', 'opening']);
    if (v.mode !== 'open')
        throw Error('공지 열기 요청이 아닙니다.');
    return { mode: 'open' as const, reference: normalizeNoticeReference(v.reference), opening: opening(v.opening) };
}
function blocks(v: unknown): NoticeBlock[] {
    if (!Array.isArray(v))
        throw Error('공지 단락을 확인해 주세요.');
    for (const b of v) {
        if (!b || typeof b !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(b)))
            throw Error('공지 단락 형식을 확인해 주세요.');
        encodeCatalogValue(b);
    }
    return v as NoticeBlock[];
}
export function normalizeNoticeRequest(v: unknown): NoticeRequest {
    exact(v, ['version', 'reference', 'action', 'expectedVersion', 'patch']);
    if (v.version !== 1 || !['create', 'edit', 'pin', 'delete'].includes(String(v.action)))
        throw Error('공지 저장 요청을 확인해 주세요.');
    const r: NoticeRequest = { version: 1, reference: normalizeNoticeReference(v.reference), action: v.action as NoticeRequest['action'], expectedVersion: version(v.expectedVersion) };
    if (r.action === 'delete') {
        if (v.patch !== undefined)
            throw Error('삭제 원문에 수정값을 섞을 수 없습니다.');
        return r;
    }
    exact(v.patch, r.action === 'pin' ? ['pinned'] : NOTICE_FIELDS);
    const patch: NoticePatch = {};
    for (const k of NOTICE_FIELDS) {
        const val = v.patch[k];
        if (val === undefined)
            continue;
        if (k === 'blocks')
            patch.blocks = blocks(val);
        else if (k === 'pinned') {
            if (typeof val !== 'boolean')
                throw Error('고정 상태를 확인해 주세요.');
            patch.pinned = val;
        }
        else {
            if (typeof val !== 'string' || k === 'tag' && !['공지', '긴급', '매뉴얼', '업무'].includes(val))
                throw Error('공지 입력값을 확인해 주세요.');
            (patch as Record<string, unknown>)[k] = val;
        }
    }
    if (patch.title !== undefined && !patch.title.trim())
        throw Error('공지 제목을 입력해 주세요.');
    if (!Object.keys(patch).length)
        throw Error('수정한 공지가 없습니다.');
    if (r.action === 'create' && (['title', 'author', 'content', 'date', 'tag'].some(k => typeof (patch as Record<string, unknown>)[k] !== 'string') || !patch.title?.trim()))
        throw Error('공지 제목과 본문 정보를 입력해 주세요.');
    r.patch = patch;
    return r;
}
export const serializeNoticeRequest = (v: NoticeRequest) => JSON.stringify(normalizeNoticeRequest(v));
export function normalizeNoticePhotoRequest(v: unknown): NoticePhotoRequest {
    exact(v, ['version', 'reference', 'sha256', 'size', 'contentType']);
    if (v.version !== 1 || typeof v.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(v.sha256) || !Number.isSafeInteger(v.size) || Number(v.size) <= 0 || Number(v.size) > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(String(v.contentType)))
        throw Error('사진은 JPG·PNG·WebP 형식으로 5MB까지 첨부할 수 있습니다.');
    return { version: 1, reference: normalizeNoticePhotoReference(v.reference), sha256: v.sha256, size: v.size as number, contentType: v.contentType as NoticePhotoRequest['contentType'] };
}
export const serializeNoticePhotoRequest = (v: NoticePhotoRequest) => JSON.stringify(normalizeNoticePhotoRequest(v));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function bound(v: Record<string, unknown>, uid: string, employeeId: string) {
    if (v.actorUid !== uid || v.employeeId !== employeeId)
        throw Error('다른 계정의 공지 결과입니다.');
}
const cleanup = (v: unknown): NoticeCleanupStatus => {
    if (!['not-required', 'pending', 'deleted', 'absent', 'retained-shared', 'retained-replaced', 'manual-blocked'].includes(String(v)))
        throw Error('사진 정리 상태를 확인하지 못했습니다.');
    return v as NoticeCleanupStatus;
};
export function normalizeNoticeOpenResult(v: unknown, ref: NoticeReference, uid: string, employeeId: string): NoticeOpenResult {
    exact(v, ['reference', 'actorUid', 'employeeId', 'opening', 'expectedVersion']);
    bound(v, uid, employeeId);
    if (!same(normalizeNoticeReference(v.reference), normalizeNoticeReference(ref)))
        throw Error('다른 공지의 열기 결과입니다.');
    return { reference: normalizeNoticeReference(v.reference), actorUid: uid, employeeId, opening: opening(v.opening), expectedVersion: version(v.expectedVersion) };
}
export function normalizeNoticeResult(v: unknown, ref: NoticeReference, uid: string, employeeId: string, hash?: string): NoticeResult {
    exact(v, ['version', 'reference', 'actorUid', 'employeeId', 'status', 'requestHash', 'cleanupStatus', 'message']);
    bound(v, uid, employeeId);
    if (v.version !== 1 || !same(normalizeNoticeReference(v.reference), normalizeNoticeReference(ref)) || !['applied', 'rejected', 'cancelled', 'unknown'].includes(String(v.status)) || typeof v.message !== 'string' || !v.message || (v.requestHash === null ? !['cancelled', 'unknown'].includes(String(v.status)) : typeof v.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.requestHash)) || hash !== undefined && v.requestHash !== null && hash !== v.requestHash)
        throw Error('공지 처리 근거를 확인하지 못했습니다.');
    return { version: 1, reference: normalizeNoticeReference(v.reference), actorUid: uid, employeeId, status: v.status as NoticeResult['status'], requestHash: v.requestHash as string | null, cleanupStatus: cleanup(v.cleanupStatus), message: v.message };
}
export function normalizeNoticePhotoResult(v: unknown, ref: NoticePhotoReference, uid: string, employeeId: string, hash?: string): NoticePhotoResult {
    exact(v, ['version', 'reference', 'actorUid', 'employeeId', 'status', 'requestHash', 'cleanupStatus', 'uploadStatus', 'downloadUrl', 'generation', 'path', 'message']);
    bound(v, uid, employeeId);
    if (v.version !== 1 || !same(normalizeNoticePhotoReference(v.reference), normalizeNoticePhotoReference(ref)) || !['reserved', 'cancelled', 'unknown'].includes(String(v.status)) || !['reserved', 'absent', 'verified', 'unverified'].includes(String(v.uploadStatus)) || (v.uploadStatus === 'verified' ? (typeof v.downloadUrl !== 'string' || !/^https?:\/\//i.test(v.downloadUrl) || typeof v.generation !== 'string' || !/^\d+$/.test(v.generation)) : (v.downloadUrl !== undefined || v.generation !== undefined)) || v.path !== noticePhotoPath(ref) || typeof v.message !== 'string' || !v.message || (v.requestHash === null ? !['cancelled', 'unknown'].includes(String(v.status)) : typeof v.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.requestHash)) || hash !== undefined && v.requestHash !== null && hash !== v.requestHash)
        throw Error('사진 예약 근거를 확인하지 못했습니다.');
    return { version: 1, reference: normalizeNoticePhotoReference(v.reference), actorUid: uid, employeeId, status: v.status as NoticePhotoResult['status'], requestHash: v.requestHash as string | null, cleanupStatus: cleanup(v.cleanupStatus), uploadStatus: v.uploadStatus as NoticePhotoResult['uploadStatus'], ...(v.uploadStatus === 'verified' ? { downloadUrl: v.downloadUrl as string, generation: v.generation as string } : {}), path: noticePhotoPath(ref), message: v.message };
}
export function normalizeNoticeHistoryResult(v: unknown, companyId: NoticeReference['companyId'], uid: string, employeeId: string): NoticeHistoryResult {
    exact(v, ['version', 'companyId', 'actorUid', 'employeeId', 'entries', 'nextCursor']);
    bound(v, uid, employeeId);
    if (v.version !== 1 || v.companyId !== companyId || !Array.isArray(v.entries) || v.entries.length > 50 || (v.nextCursor !== null && (typeof v.nextCursor !== 'string' || !/^[a-f0-9]{64}$/.test(v.nextCursor))))
        throw Error('공지 처리이력 범위가 다릅니다.');
    return { version: 1, companyId, actorUid: uid, employeeId, nextCursor: v.nextCursor as string | null, entries: v.entries.map(e => {
            exact(e, ['kind', 'result', 'createdAt', 'label']);
            if (typeof e.createdAt !== 'string' || typeof e.label !== 'string')
                throw Error('공지 이력 정보를 확인해 주세요.');
            if (e.kind === 'post') {
                const ref = normalizeNoticeReference((e.result as NoticeResult)?.reference);
                if (ref.companyId !== companyId)
                    throw Error('다른 회사 이력입니다.');
                return { kind: 'post' as const, result: normalizeNoticeResult(e.result, ref, uid, employeeId), createdAt: e.createdAt, label: e.label };
            }
            if (e.kind === 'photo') {
                const ref = normalizeNoticePhotoReference((e.result as NoticePhotoResult)?.reference);
                if (ref.companyId !== companyId)
                    throw Error('다른 회사 이력입니다.');
                return { kind: 'photo' as const, result: normalizeNoticePhotoResult(e.result, ref, uid, employeeId), createdAt: e.createdAt, label: e.label };
            }
            throw Error('공지 이력 종류가 다릅니다.');
        }) };
}
export function normalizeNoticeObservationResult(value: unknown, ref: NoticeReference, uid: string, employeeId: string): NoticeObservationResult {
    exact(value, ['reference', 'actorUid', 'employeeId', 'observeOnly', 'exists', 'snapshot', 'expectedVersion']);
    bound(value, uid, employeeId);
    if (!same(normalizeNoticeReference(value.reference), normalizeNoticeReference(ref)) || value.observeOnly !== true || typeof value.exists !== 'boolean' || (!value.exists && (value.snapshot !== null || value.expectedVersion !== null)) || (value.exists && (value.snapshot === null || value.expectedVersion === null)))
        throw Error('현재 공지 관찰 결과를 확인하지 못했습니다.');
    return { reference: normalizeNoticeReference(value.reference), actorUid: uid, employeeId, observeOnly: true, exists: value.exists, snapshot: value.exists ? opening(value.snapshot) : null, expectedVersion: version(value.expectedVersion) };
}
export function decodeNoticeObservationSnapshot(value: CatalogValue): Record<string, unknown> { const no = () => { throw Error('현재 공지 관찰 원문을 확인하지 못했습니다.'); }; const raw = decodeCatalogValue(opening(value), { special: () => undefined, timestamp: no, reference: no, geo: no, bytes: no }); exact(raw, NOTICE_FIELDS); return raw; }
