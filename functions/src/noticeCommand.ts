import * as admin from 'firebase-admin';
import { createHash, randomUUID } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { NOTICE_OPERATIONS, NOTICE_UPLOADS, NOTICE_PATHS, noticeOpening, noticePhotoPath, normalizeNoticeReference, normalizeNoticePhotoReference, normalizeNoticeRequest, normalizeNoticePhotoRequest, normalizeNoticeOpenRequest, normalizeNoticeResult, normalizeNoticePhotoResult, serializeNoticeRequest, serializeNoticePhotoRequest, type NoticeCommand, type NoticeReference, type NoticePhotoReference, type NoticeRequest, type NoticePhotoRequest, type NoticeResult, type NoticePhotoResult, type NoticeOpenResult, type NoticeHistoryResult, type NoticeCleanupStatus, type NoticeObservationResult } from './shared/noticeCommand';
import { encodeCatalogValue } from './shared/catalogOrderReferenceProof';
import { createNoticeStoragePort, verifyNoticePhoto, deleteNoticeGeneration, type NoticeStoragePort } from './noticeStorageCleanup';
type Actor = {
    uid: string;
    token: Record<string, unknown>;
};
type Result = NoticeResult | NoticePhotoResult;
type Task = {
    path: string;
    url?: string;
    generation?: string;
    status: NoticeCleanupStatus;
    reason?: string;
};
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
export const noticeReceiptId = (ref: NoticeReference, uid: string) => sha(JSON.stringify(['post', ref.companyId, uid, ref.planId]));
export const noticePhotoReceiptId = (ref: NoticePhotoReference, uid: string) => sha(JSON.stringify(['photo', ref.companyId, uid, ref.uploadId]));
export const noticePathId = (path: string) => sha(path);
const discovery = (company: string, uid: string) => sha(JSON.stringify([company, uid]));
const version = (s: admin.firestore.DocumentSnapshot) => s.updateTime ? `${s.updateTime.seconds}:${String(s.updateTime.nanoseconds).padStart(9, '0')}` : null;
function authorize(actor: Actor | undefined, companyId: string): asserts actor is Actor {
    if (!actor?.uid)
        throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    if (typeof actor.token.employeeId !== 'string' || actor.token.isAdmin !== true || actor.token.companyId !== companyId || !['taebaek', 'punghoe'].includes(companyId))
        throw new HttpsError('permission-denied', '현재 회사의 관리자 직원 계정으로 로그인해 주세요.');
}
function stored(raw: admin.firestore.DocumentData | undefined, ref: NoticeReference | NoticePhotoReference, actor: Actor, photo: boolean) {
    if (!raw)
        return null;
    const result = photo ? normalizeNoticePhotoResult(raw.result, ref as NoticePhotoReference, actor.uid, String(actor.token.employeeId)) : normalizeNoticeResult(raw.result, ref as NoticeReference, actor.uid, String(actor.token.employeeId));
    if (result.status === 'unknown')
        throw Error('확정된 공지 처리 근거가 아닙니다.');
    if (raw.requestText === null) {
        if (result.status !== 'cancelled' || result.requestHash !== null)
            throw Error('중단 근거가 다릅니다.');
    }
    else {
        if (typeof raw.requestText !== 'string' || sha(raw.requestText) !== result.requestHash)
            throw Error('공지 최초 원문 해시가 다릅니다.');
        const req = photo ? normalizeNoticePhotoRequest(JSON.parse(raw.requestText)) : normalizeNoticeRequest(JSON.parse(raw.requestText));
        if ((photo ? serializeNoticePhotoRequest(req as NoticePhotoRequest) : serializeNoticeRequest(req as NoticeRequest)) !== raw.requestText || JSON.stringify(req.reference) !== JSON.stringify(ref))
            throw Error('공지 최초 원문이 다릅니다.');
    }
    return { ...raw, result } as {
        result: Result;
        requestText: string | null;
        tasks?: Task[];
        lease?: string;
        label?: string;
        createdAt?: string;
    };
}
const ownPath = (path: string, companyId: string) => new RegExp(`^companies/${companyId}/notices/[^/]+/[^/]+$`).test(path);
const images = (raw: Record<string, unknown> | undefined): Record<string, unknown>[] => Array.isArray(raw?.blocks) ? raw.blocks.filter((b: unknown) => !!b && typeof b === 'object' && (b as {
    type?: unknown;
}).type === 'image') : [];
function tasksOf(blocks: Record<string, unknown>[], companyId: string): Task[] { return blocks.map(b => typeof b.path === 'string' && ownPath(b.path, companyId) ? { path: b.path, ...(typeof b.url === 'string' ? { url: b.url } : {}), status: 'pending' as const } : { path: '', status: 'manual-blocked' as const, reason: '이전 사진의 저장 경로를 확인할 수 없어 자동 삭제하지 않았습니다.' }); }
const aggregate = (tasks: Task[]): NoticeCleanupStatus => tasks.some(t => t.status === 'pending') ? 'pending' : tasks.some(t => t.status === 'manual-blocked') ? 'manual-blocked' : tasks.some(t => t.status === 'retained-shared') ? 'retained-shared' : tasks.some(t => t.status === 'retained-replaced') ? 'retained-replaced' : tasks.some(t => t.status === 'deleted') ? 'deleted' : tasks.length ? 'absent' : 'not-required';
const cleanupMessage = (status: NoticeCleanupStatus) => status === 'pending' ? '공지 처리는 확인됐지만 사진 정리는 완료되지 않았습니다. 사진 정리만 다시 시도해 주세요.' : status === 'manual-blocked' ? '공지 처리는 확인됐습니다. 이전 본문 이미지의 참조가 모호해 사진 자동 삭제를 보류했습니다. 현재 공지 내용을 확인해 주세요.' : status === 'retained-shared' ? '다른 공지가 같은 사진을 사용하여 사진을 보존했습니다.' : status === 'retained-replaced' ? '다른 사진으로 바뀌어 삭제하지 않고 보존했습니다.' : '해당 사진 정리를 마쳤습니다.';
function safeHttp(value: unknown): boolean {
    try {
        const url = new URL(typeof value === 'string' ? value : '');
        return ['http:', 'https:'].includes(url.protocol);
    }
    catch {
        return false;
    }
}
function validateNewBlock(b: Record<string, unknown>) {
    const allowed = b.type === 'text' ? ['type', 'text', 'format', 'bold', 'link'] : ['type', 'path', 'url', 'caption'];
    if (Object.keys(b).some(key => !allowed.includes(key)))
        throw Error('새 공지 단락에 알 수 없는 필드가 있습니다.');
    if (b.type === 'text') {
        if (typeof b.text !== 'string' || b.bold !== undefined && typeof b.bold !== 'boolean' || b.format !== undefined && !['paragraph', 'heading', 'subheading', 'list'].includes(String(b.format)) || b.link !== undefined && (typeof b.link !== 'string' || b.link.trim() && !safeHttp(b.link)))
            throw Error('새 글 단락의 형식과 링크를 확인해 주세요.');
    }
    else if (b.type === 'image') {
        if (typeof b.path !== 'string' || typeof b.url !== 'string' || !safeHttp(b.url) || typeof b.caption !== 'string')
            throw Error('새 사진 단락의 소유 정보가 없습니다.');
    }
    else
        throw Error('새 공지 단락의 종류를 확인해 주세요.');
}
async function photoState(db: admin.firestore.Firestore, actor: Actor, ref: NoticePhotoReference, storage: NoticeStoragePort): Promise<NoticePhotoResult> {
    const doc = await db.collection(NOTICE_OPERATIONS).doc(noticePhotoReceiptId(ref, actor.uid)).get(), saved = stored(doc.data(), ref, actor, true);
    const base: NoticePhotoResult = { version: 1, reference: ref, actorUid: actor.uid, employeeId: String(actor.token.employeeId), status: 'unknown', requestHash: null, cleanupStatus: 'not-required', uploadStatus: 'absent', path: noticePhotoPath(ref), message: '이 사진 요청의 서버 기록이 아직 없습니다. 미처리 요청 중단 또는 같은 예약 확인을 선택해 주세요.' };
    if (!saved)
        return base;
    const result = saved.result as NoticePhotoResult;
    if (result.status !== 'reserved')
        return result;
    try {
        const request = normalizeNoticePhotoRequest(JSON.parse(saved.requestText!)), verified = await verifyNoticePhoto(storage, request, actor.uid, String(actor.token.employeeId));
        return { ...result, uploadStatus: verified ? 'verified' : 'absent', ...(verified || {}), message: verified ? '이미 업로드된 원본 사진을 확인했습니다. 다시 업로드하지 않아도 됩니다.' : '사진 예약은 확인됐지만 원본 파일은 아직 확인되지 않았습니다. 같은 원본 파일로 업로드를 이어가세요.' };
    }
    catch {
        return { ...result, uploadStatus: 'unverified', message: '사진 원본과 예약의 동일성을 확인하지 못했습니다. 원문을 보존하고 사진 결과를 다시 확인하거나 중단해 주세요.' };
    }
}
export async function executeNoticeCommand(db: admin.firestore.Firestore, actor: Actor | undefined, input: NoticeCommand, storage = createNoticeStoragePort()): Promise<NoticeResult | NoticePhotoResult | NoticeOpenResult | NoticeObservationResult | NoticeHistoryResult> {
    if (!input || typeof input !== 'object')
        throw new HttpsError('invalid-argument', '공지 명령 형식을 확인해 주세요.');
    const keys = input.mode === 'apply' || input.mode === 'reservePhoto' ? ['mode', 'request'] : input.mode === 'open' ? ('observeOnly' in input ? ['mode', 'reference', 'observeOnly'] : ['mode', 'reference', 'opening']) : input.mode === 'listHistory' ? ['mode', 'companyId', 'cursor'] : 'photoReference' in input ? ['mode', 'photoReference'] : ['mode', 'reference'];
    if (Object.keys(input).some(key => !keys.includes(key)))
        throw new HttpsError('invalid-argument', '공지 명령의 추가 필드를 확인해 주세요.');
    if (input?.mode === 'listHistory') {
        authorize(actor, input.companyId);
        if (input.cursor !== undefined && !/^[a-f0-9]{64}$/.test(input.cursor))
            throw new HttpsError('invalid-argument', '공지 이력 페이지를 확인해 주세요.');
        let query = db.collection(NOTICE_OPERATIONS).where('scopeKey', '==', discovery(input.companyId, actor.uid)).orderBy(admin.firestore.FieldPath.documentId()).limit(50);
        if (input.cursor)
            query = query.startAfter(input.cursor);
        const docs = await query.get();
        return { version: 1, companyId: input.companyId, actorUid: actor.uid, employeeId: String(actor.token.employeeId), entries: docs.docs.map(d => {
                const raw = d.data(), photo = raw.kind === 'photo', ref = photo ? normalizeNoticePhotoReference(raw.result?.reference) : normalizeNoticeReference(raw.result?.reference);
                if (ref.companyId !== input.companyId)
                    throw Error('다른 회사 이력입니다.');
                const saved = stored(raw, ref, actor, photo)!;
                return { kind: photo ? 'photo' : 'post', result: saved.result, createdAt: raw.createdAt, label: raw.label } as NoticeHistoryResult['entries'][number];
            }), nextCursor: docs.size === 50 ? docs.docs[49].id : null };
    }
    let photo = false, ref: NoticeReference | NoticePhotoReference, request: NoticeRequest | NoticePhotoRequest | undefined, text: string | null = null, hash: string | null = null;
    try {
        if (!input || !['open', 'apply', 'inspect', 'cancel', 'reservePhoto', 'cancelPhoto', 'cleanup'].includes(input.mode))
            throw Error('공지 처리 종류를 확인해 주세요.');
        photo = input.mode === 'reservePhoto' || 'photoReference' in input;
        if (input.mode === 'apply') {
            request = normalizeNoticeRequest(input.request);
            ref = request.reference;
            text = serializeNoticeRequest(request);
            hash = sha(text);
        }
        else if (input.mode === 'reservePhoto') {
            request = normalizeNoticePhotoRequest(input.request);
            ref = request.reference;
            text = serializeNoticePhotoRequest(request);
            hash = sha(text);
        }
        else if (photo)
            ref = normalizeNoticePhotoReference((input as {
                photoReference: NoticePhotoReference;
            }).photoReference);
        else if (input.mode === 'open')
            ref = 'observeOnly' in input && input.observeOnly === true ? normalizeNoticeReference(input.reference) : normalizeNoticeOpenRequest(input).reference;
        else
            ref = normalizeNoticeReference((input as {
                reference: NoticeReference;
            }).reference);
    }
    catch (e) {
        throw new HttpsError('invalid-argument', e instanceof Error ? e.message : '공지 원문을 확인해 주세요.');
    }
    authorize(actor, ref.companyId);
    if (input.mode === 'cleanup')
        return cleanupNoticeOperation(db, actor, ref, photo, storage);
    if (photo && input.mode === 'inspect')
        return photoState(db, actor, ref as NoticePhotoReference, storage);
    const receiptRef = db.collection(NOTICE_OPERATIONS).doc(photo ? noticePhotoReceiptId(ref as NoticePhotoReference, actor.uid) : noticeReceiptId(ref as NoticeReference, actor.uid));
    const photoRef = ref as NoticePhotoReference, postRef = ref as NoticeReference, target = db.collection('notices').doc(ref.postId), path = photo ? noticePhotoPath(photoRef) : '';
    if (photo && input.mode === 'reservePhoto') {
        const prior = stored((await receiptRef.get()).data(), ref, actor, true);
        if (prior) {
            if (prior.result.requestHash !== null && prior.result.requestHash !== hash)
                throw new HttpsError('already-exists', '같은 사진 번호의 최초 내용이 다릅니다.');
            return photoState(db, actor, photoRef, storage);
        }
        if (await storage.stat(path))
            throw new HttpsError('failed-precondition', '이미 파일이 있는 경로를 새 사진 예약으로 승인할 수 없습니다. 새 업로드 번호로 작성해 주세요.');
    }
    const legacyGenerations = new Map<string, string>();
    if (!photo && input.mode === 'apply') {
        const selected = await target.get();
        const raw = selected.data();
        if (raw?.companyId === ref.companyId) {
            for (const b of images(raw)) {
                if (typeof b.path === 'string' && ownPath(b.path, ref.companyId)) {
                    try {
                        const object = await storage.stat(b.path);
                        if (object)
                            legacyGenerations.set(b.path, object.generation);
                    }
                    catch { }
                }
            }
        }
    }
    let verifiedPhotos = new Map<string, {
        generation: string;
        downloadUrl: string;
    }>();
    if (!photo && input.mode === 'apply' && (request as NoticeRequest).patch?.blocks) {
        // 외부 Storage 검증은 쓰기 전 수행하고 TX에서 예약·원문·경로 fence를 다시 검사한다.
        for (const b of (request as NoticeRequest).patch!.blocks!) {
            if (b.type !== 'image' || typeof b.path !== 'string')
                continue;
            const match = new RegExp(`^companies/${ref.companyId}/notices/${ref.postId}/([^/]+)$`).exec(b.path);
            if (!match)
                continue;
            const reservation = await db.collection(NOTICE_UPLOADS).doc(match[1]).get();
            const raw = reservation.data();
            if (raw?.actorUid === actor.uid && raw?.employeeId === actor.token.employeeId && raw?.companyId === ref.companyId && raw?.reference?.postId === ref.postId && raw.closed === false) {
                try {
                    const photoRequest = normalizeNoticePhotoRequest(raw.request), found = await verifyNoticePhoto(storage, photoRequest, actor.uid, String(actor.token.employeeId));
                    if (found)
                        verifiedPhotos.set(b.path, found);
                }
                catch { }
            }
        }
    }
    return db.runTransaction(async (tx) => {
        const prior = await tx.get(receiptRef), saved = stored(prior.data(), ref, actor, photo);
        if (saved && photo && input.mode === 'cancelPhoto' && saved.result.status === 'reserved') {
            const photoResult = { ...saved.result, status: 'cancelled' as const, cleanupStatus: 'pending' as const, message: '사진 예약을 중단했습니다. 남은 사진 정리는 별도로 확인해 주세요.' };
            tx.update(db.collection(NOTICE_UPLOADS).doc(photoRef.uploadId), { closed: true });
            tx.set(db.collection(NOTICE_PATHS).doc(noticePathId(path)), { companyId: ref.companyId, path, closed: true });
            tx.update(receiptRef, { result: photoResult, tasks: [{ path, status: 'pending' }] });
            return photoResult;
        }
        if (saved) {
            if (hash !== null && saved.result.requestHash !== null && saved.result.requestHash !== hash)
                throw new HttpsError('already-exists', '같은 공지 요청 번호의 최초 내용이 다릅니다.');
            return saved.result;
        }
        const common = { version: 1 as const, reference: ref, actorUid: actor.uid, employeeId: String(actor.token.employeeId), requestHash: hash, cleanupStatus: 'not-required' as NoticeCleanupStatus };
        const finish = (result: Result, tasks: Task[] = []) => { tx.create(receiptRef, { kind: photo ? 'photo' : 'post', scopeKey: discovery(ref.companyId, actor.uid), requestText: text, result, tasks, createdAt: new Date().toISOString(), label: photo ? `공지 ${ref.postId} 사진` : (request as NoticeRequest | undefined)?.patch?.title || `공지 ${ref.postId}` }); return result; };
        if (photo) {
            const reservationRef = db.collection(NOTICE_UPLOADS).doc(photoRef.uploadId), reservation = await tx.get(reservationRef), fenceRef = db.collection(NOTICE_PATHS).doc(noticePathId(path)), fence = await tx.get(fenceRef);
            if (reservation.exists)
                throw new HttpsError('already-exists', '이 사진 번호는 다른 예약에서 사용 중입니다.');
            const cancelled = input.mode === 'cancelPhoto';
            if (!cancelled && fence.get('closed') === true)
                throw new HttpsError('failed-precondition', '정리 중이거나 닫힌 사진 경로입니다.');
            const result: NoticePhotoResult = { ...common, reference: photoRef, status: cancelled ? 'cancelled' : 'reserved', requestHash: cancelled ? null : hash, cleanupStatus: cancelled ? 'pending' : 'not-required', uploadStatus: cancelled ? 'absent' : 'reserved', path, message: cancelled ? '이 사진 업로드 예약을 중단했습니다. 남은 파일 정리는 별도로 확인해 주세요.' : '사진 업로드 예약을 보관했습니다.' };
            tx.create(reservationRef, { companyId: ref.companyId, actorUid: actor.uid, employeeId: String(actor.token.employeeId), reference: photoRef, ...(request ? { request } : {}), closed: cancelled, path });
            if (cancelled)
                tx.set(fenceRef, { companyId: ref.companyId, path, closed: true });
            return finish(result, cancelled ? [{ path, status: 'pending' }] : []);
        }
        const result = (status: NoticeResult['status'], message: string, cleanupStatus: NoticeCleanupStatus = 'not-required'): NoticeResult => ({ ...common, reference: postRef, status, message, cleanupStatus });
        if (input.mode === 'inspect')
            return { ...result('unknown', '서버에 이 공지 요청의 처리 기록이 아직 없습니다. 같은 요청으로 다시 확인하거나 미처리 요청을 중단해 주세요.'), requestHash: null };
        if (input.mode === 'cancel')
            return finish({ ...result('cancelled', '이 공지 요청을 중단했습니다. 이미 적용된 공지는 되돌리지 않습니다.'), requestHash: null });
        const snapshot = await tx.get(target), raw = snapshot.data();
        if (snapshot.exists && raw!.companyId !== ref.companyId) {
            if (input.mode === 'open')
                throw new HttpsError('failed-precondition', '선택한 공지의 소속 회사가 일치하지 않습니다.');
            return finish(result('rejected', '공지의 소속 회사가 일치하지 않아 처리하지 않았습니다.'));
        }
        if (input.mode === 'open') {
            if ('observeOnly' in input && input.observeOnly === true)
                return { reference: postRef, actorUid: actor.uid, employeeId: String(actor.token.employeeId), observeOnly: true, exists: snapshot.exists, snapshot: snapshot.exists ? noticeOpening(raw) : null, expectedVersion: version(snapshot) };
            const opening = noticeOpening(raw);
            if (JSON.stringify(opening) !== JSON.stringify('opening' in input ? input.opening : undefined))
                throw new HttpsError('failed-precondition', '선택한 공지가 바뀌었습니다. 현재 목록에서 다시 열어 주세요.');
            return { reference: postRef, actorUid: actor.uid, employeeId: String(actor.token.employeeId), opening, expectedVersion: version(snapshot) };
        }
        const req = request as NoticeRequest;
        if (req.action === 'create' ? snapshot.exists : !snapshot.exists)
            return finish(result('rejected', req.action === 'create' ? '같은 번호의 공지가 이미 있습니다. 현재 목록을 확인해 주세요.' : '공지 대상이 이미 없습니다. 이전 원문을 보존하고 현재 목록에서 새 작업을 선택해 주세요.'));
        if (version(snapshot) !== req.expectedVersion)
            return finish(result('rejected', '공지 원문이 확인 후 변경되거나 다시 만들어져 처리하지 않았습니다. 현재 목록에서 다시 열어 주세요.'));
        const oldBlocks = Array.isArray(raw?.blocks) ? raw!.blocks : [], newBlocks = req.patch?.blocks;
        const consumedImages = new Set<number>();
        const withoutCaption = (block: Record<string, unknown>) => JSON.stringify(encodeCatalogValue(Object.fromEntries(Object.entries(block).filter(([key]) => key !== 'caption'))));
        const newImages: {
            reservation: admin.firestore.DocumentReference;
            path: string;
            generation: string;
        }[] = [];
        if (newBlocks) {
            for (const b of newBlocks) {
                if (b.type === 'image') {
                    const record = b as unknown as Record<string, unknown>;
                    const index = oldBlocks.findIndex((old: Record<string, unknown>, index: number) => !consumedImages.has(index) && old?.type === 'image' && ['path', 'url'].every(key => Object.prototype.hasOwnProperty.call(old, key) === Object.prototype.hasOwnProperty.call(record, key) && old[key] === record[key]) && withoutCaption(old) === withoutCaption(record));
                    if (index >= 0 && (typeof record.caption === 'string' || (Object.prototype.hasOwnProperty.call(oldBlocks[index],'caption') === Object.prototype.hasOwnProperty.call(record,'caption') && oldBlocks[index].caption === record.caption))) {
                        consumedImages.add(index);
                        continue;
                    }
                }
                else if (oldBlocks.some((old: unknown) => JSON.stringify(old) === JSON.stringify(b)))
                    continue;
                try {
                    validateNewBlock(b as unknown as Record<string, unknown>);
                }
                catch (error) {
                    return finish(result('rejected', error instanceof Error ? error.message : '새 단락 형식을 확인해 주세요.'));
                }
                if (b.type === 'image') {
                    const match = new RegExp(`^companies/${ref.companyId}/notices/${ref.postId}/([^/]+)$`).exec(b.path);
                    if (!match)
                        return finish(result('rejected', '새 사진은 이 공지의 검증된 업로드 예약만 사용할 수 있습니다.'));
                    const r = db.collection(NOTICE_UPLOADS).doc(match[1]), rSnap = await tx.get(r), pFence = await tx.get(db.collection(NOTICE_PATHS).doc(noticePathId(b.path))), v = verifiedPhotos.get(b.path);
                    if (!rSnap.exists || rSnap.get('actorUid') !== actor.uid || rSnap.get('employeeId') !== actor.token.employeeId || rSnap.get('companyId') !== ref.companyId || rSnap.get('reference.postId') !== ref.postId || rSnap.get('closed') === true || pFence.get('closed') === true)
                        return finish(result('rejected', '사진 예약이 중단됐거나 소유 정보가 달라 저장하지 않았습니다.'));
                    if (!v)
                        return result('unknown', '사진의 업로드 완료를 아직 확인하지 못해 공지는 보내지 않았습니다. 같은 사진 예약을 확인한 뒤 동일 요청을 이어가세요.');
                    if (b.url !== v.downloadUrl)
                        return finish(result('rejected', '사진 주소가 검증된 업로드 원문과 다릅니다.'));
                    newImages.push({ reservation: r, path: b.path, generation: v.generation });
                }
            }
        }
        const retained = new Set((newBlocks || oldBlocks).filter((b: Record<string, unknown>) => b.type === 'image').map((b: Record<string, unknown>) => b.path));
        const removed = req.action === 'delete' ? images(raw) : newBlocks ? images(raw).filter(b => !retained.has(b.path)) : [];
        let tasks = tasksOf(removed, ref.companyId);
        if (req.action === 'delete' && typeof raw?.content === 'string' && /<img\b/i.test(raw.content))
            tasks.push({ path: '', status: 'manual-blocked', reason: '이전 HTML 사진의 저장 경로를 확인하지 못했습니다.' });
        // 삭제할 사진의 generation은 TX 전에 조회한 값으로만 고정한다. 없는 근거를 현재 새 파일로 바꾸지 않는다.
        for (const task of tasks) {
            if (!task.path)
                continue;
            const reservation = await tx.get(db.collection(NOTICE_UPLOADS).doc(task.path.split('/').slice(-1)[0]));
            if (reservation.exists && reservation.get('appliedGeneration'))
                task.generation = reservation.get('appliedGeneration');
            else if (legacyGenerations.has(task.path))
                task.generation = legacyGenerations.get(task.path);
        }
        if (req.action === 'delete')
            tx.delete(target);
        else if (req.action === 'create')
            tx.create(target, { ...req.patch, companyId: ref.companyId });
        else
            tx.update(target, Object.fromEntries(Object.entries(req.patch!)));
        for (const photo of newImages)
            tx.update(photo.reservation, { applied: true, appliedGeneration: photo.generation });
        const status = aggregate(tasks);
        return finish(result('applied', status === 'not-required' ? '공지 처리를 저장했습니다.' : '공지 본문 처리는 완료됐습니다. 남은 사진 정리는 별도로 확인해 주세요.', status), tasks);
    });
}
/** 본문 완료와 파일 정리를 분리하고, 같은 회사의 실제 참조와 경로 fence를 확인한다. */
export async function cleanupNoticeOperation(db: admin.firestore.Firestore, actor: Actor, ref: NoticeReference | NoticePhotoReference, photo: boolean, storage: NoticeStoragePort, eventGeneration?: string): Promise<Result> {
    const receiptRef = db.collection(NOTICE_OPERATIONS).doc(photo ? noticePhotoReceiptId(ref as NoticePhotoReference, actor.uid) : noticeReceiptId(ref as NoticeReference, actor.uid));
    const lease = randomUUID();
    const prepared = await db.runTransaction(async (tx) => {
        const value = stored((await tx.get(receiptRef)).data(), ref, actor, photo);
        if (!value)
            throw Error('사진 정리의 최초 요청을 확인해 주세요.');
        if (photo && value.result.status === 'reserved')
            return { ...value, skip: true };
        tx.update(receiptRef, { lease });
        return { ...value, skip: false };
    });
    if (prepared.skip)
        return prepared.result;
    const tasks: Task[] = (prepared.tasks || []).map(t => ({ ...t }));
    for (const task of tasks) {
        if (!task.path || task.status !== 'pending')
            continue;
        if (!ownPath(task.path, ref.companyId)) {
            task.status = 'manual-blocked';
            continue;
        }
        const fence = db.collection(NOTICE_PATHS).doc(noticePathId(task.path)), attempt = randomUUID();
        try {
            const proceed = await db.runTransaction(async (tx) => {
                const current = stored((await tx.get(receiptRef)).data(), ref, actor, photo);
                if (!current || current.lease !== lease)
                    return 'stale';
                await tx.get(fence);
                const posts = await tx.get(db.collection('notices').where('companyId', '==', ref.companyId));
                let ambiguous = false;
                for (const doc of posts.docs) {
                    const p = doc.data();
                    for (const image of images(p)) {
                        if (image.path === task.path || typeof task.url === 'string' && image.url === task.url)
                            return 'shared';
                        if (typeof image.path !== 'string' || !ownPath(image.path, ref.companyId))
                            ambiguous = true;
                    }
                    if (typeof p.content === 'string' && (/<img\b/i.test(p.content) || task.url && p.content.includes(task.url)))
                        ambiguous = true;
                }
                if (ambiguous)
                    return 'manual';
                tx.set(fence, { companyId: ref.companyId, path: task.path, closed: true, owner: receiptRef.id, attempt });
                return 'remove';
            });
            if (proceed === 'stale')
                continue;
            if (proceed === 'shared') {
                task.status = 'retained-shared';
                continue;
            }
            if (proceed === 'manual') {
                task.status = 'manual-blocked';
                continue;
            }
            const object = await storage.stat(task.path);
            let generation = task.generation;
            if (photo && !generation && object) {
                const reservation = await db.collection(NOTICE_UPLOADS).doc((ref as NoticePhotoReference).uploadId).get(), raw = reservation.data();
                if (raw?.actorUid === actor.uid && raw?.employeeId === actor.token.employeeId && object.metadata.uploadId === (ref as NoticePhotoReference).uploadId && object.metadata.actorUid === actor.uid && object.metadata.employeeId === actor.token.employeeId && (raw.request ? object.metadata.sha256 === raw.request.sha256 : true))
                    generation = eventGeneration || object.generation;
            }
            task.status = !object ? 'absent' : !generation ? 'manual-blocked' : await deleteNoticeGeneration(storage, task.path, generation);
        }
        catch {
            task.status = 'pending';
        }
    }
    return db.runTransaction(async (tx) => {
        const current = stored((await tx.get(receiptRef)).data(), ref, actor, photo);
        if (!current)
            throw Error('사진 정리의 근거를 확인하지 못했습니다.');
        if (current.lease !== lease)
            return current.result;
        const cleanupStatus = aggregate(tasks), result = { ...current.result, cleanupStatus, message: cleanupMessage(cleanupStatus) };
        tx.update(receiptRef, { tasks, result });
        return result;
    });
}
export async function cleanupLateNoticeObject(db: admin.firestore.Firestore, object: {
    name: string;
    generation: string;
    bucket: string;
}, storage: NoticeStoragePort): Promise<void> {
    const match = /^companies\/(taebaek|punghoe)\/notices\/([^/]+)\/([^/]+)$/.exec(object.name);
    if (!match)
        return;
    if (object.bucket !== storage.bucketName)
        throw Error('사진 이벤트와 정리 버킷이 다릅니다.');
    const reservation = await db.collection(NOTICE_UPLOADS).doc(match[3]).get(), raw = reservation.data();
    if (!raw || raw.closed !== true || raw.applied === true)
        return;
    const ref = normalizeNoticePhotoReference(raw.reference);
    if (noticePhotoPath(ref) !== object.name || ref.companyId !== match[1])
        throw Error('사진 이벤트와 예약 경로가 다릅니다.');
    const actor = { uid: raw.actorUid, token: { companyId: ref.companyId, employeeId: raw.employeeId, isAdmin: true } };
    // 부재 확인 뒤 늦게 온 객체도 닫힌 동일 예약의 정리로 다시 연결한다.
    const operationRef = db.collection(NOTICE_OPERATIONS).doc(noticePhotoReceiptId(ref, actor.uid));
    await db.runTransaction(async (tx) => {
        const saved = stored((await tx.get(operationRef)).data(), ref, actor, true);
        if (!saved || saved.result.status !== 'cancelled')
            return;
        const tasks = (saved.tasks || []).map(task => task.path === object.name && ['absent', 'pending'].includes(task.status) ? { ...task, status: 'pending' as const, generation: task.generation || object.generation } : task);
        tx.update(operationRef, { tasks, result: { ...saved.result, cleanupStatus: aggregate(tasks) } });
    });
    const outcome = await cleanupNoticeOperation(db, actor, ref, true, storage, object.generation);
    if (outcome.cleanupStatus === 'pending')
        throw Error('늦은 사진 정리를 확인하지 못해 같은 이벤트를 재시도합니다.');
}
export const noticeCommand = onCall({ region: 'asia-northeast3' }, request => executeNoticeCommand(admin.firestore(), request.auth, request.data));
export const cleanupLateNoticeUpload = onObjectFinalized({ region: 'us-east1', retry: true }, event => cleanupLateNoticeObject(admin.firestore(), { name: event.data.name, generation: String(event.data.generation), bucket: event.data.bucket }, createNoticeStoragePort()));
