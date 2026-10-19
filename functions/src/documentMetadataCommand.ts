import { readDocumentCategoryPath } from './shared/documentCategoryFence';
import * as admin from 'firebase-admin';
import { createHash, randomUUID } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { DOCUMENT_OPERATIONS, DOCUMENT_UPLOADS, DOCUMENT_PATHS, normalizeDocumentMetadataReference, normalizeDocumentMetadataRequest, normalizeDocumentMetadataResult, normalizeDocumentMetadataOpening, normalizeDocumentMetadataOpenResult, serializeDocumentMetadataRequest, documentMetadataOpening, type DocumentMetadataReference, type DocumentMetadataRequest, type DocumentMetadataResult, type DocumentMetadataCommand, type DocumentMetadataOpenResult, type DocumentMetadataPendingResult, type CatalogValueAdapter } from './shared/documentMetadataCommand';
import { createDocumentStoragePort, verifyDocumentUpload, deleteDocumentGeneration, type DocumentStoragePort } from './documentStorageCleanup';
import { documentId } from './shared/documentId';
type Actor = {
    uid: string;
    token: Record<string, unknown>;
};
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
export const documentMetadataReceiptId = (ref: DocumentMetadataReference, uid: string) => sha(JSON.stringify([ref.companyId, uid, ref.planId]));
export const documentDiscoveryScopeKey = (companyId: string, actorUid: string, employeeId: string) => sha(JSON.stringify([companyId, actorUid, employeeId]));
export const documentStoragePathId = (path: string) => sha(path);
const version = (s: admin.firestore.DocumentSnapshot) => s.updateTime ? `${s.updateTime.seconds}:${String(s.updateTime.nanoseconds).padStart(9, '0')}` : null;
const codec = (db: admin.firestore.Firestore): CatalogValueAdapter => ({
    special: v => v instanceof admin.firestore.Timestamp ? ['timestamp', v.seconds, v.nanoseconds] : v instanceof admin.firestore.DocumentReference ? ['reference', v.path] : v instanceof admin.firestore.GeoPoint ? ['geo', v.latitude, v.longitude] : Buffer.isBuffer(v) ? ['bytes', [...v]] : undefined, timestamp: (s, n) => new admin.firestore.Timestamp(s, n), reference: p => db.doc(p), geo: (a, b) => new admin.firestore.GeoPoint(a, b), bytes: b => Buffer.from(b)
});
function authorized(actor: Actor | undefined, ref: DocumentMetadataReference): asserts actor is Actor {
    if (!actor?.uid)
        throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    if (actor.token.isAdmin !== true || !documentId(actor.token.employeeId) || actor.token.companyId !== ref.companyId)
        throw new HttpsError('permission-denied', '현재 회사의 관리자 직원 계정으로 로그인해 주세요.');
}
interface StoredOperation {
    requestText: string | null;
    requestHash: string | null;
    result: DocumentMetadataResult;
    cleanupPath?: string;
    cleanupGeneration?: string;
}
function stored(raw: admin.firestore.DocumentData | undefined, ref: DocumentMetadataReference, actor: Actor): StoredOperation | null {
    if (!raw)
        return null;
    const result = normalizeDocumentMetadataResult(raw.result, ref, actor.uid, String(actor.token.employeeId));
    if (raw.requestText === null) {
        if (result.status !== 'cancelled' || raw.requestHash !== null || result.requestHash !== null)
            throw Error('문서 중단 기록의 원문 근거가 올바르지 않습니다.');
    }
    else {
        if (typeof raw.requestText !== 'string' || sha(raw.requestText) !== raw.requestHash || result.requestHash !== raw.requestHash)
            throw Error('문서 처리 기록의 최초 원문 해시를 확인하지 못했습니다.');
        const req = normalizeDocumentMetadataRequest(JSON.parse(raw.requestText));
        if (serializeDocumentMetadataRequest(req) !== raw.requestText || JSON.stringify(req.reference) !== JSON.stringify(ref))
            throw Error('문서 처리 기록의 대상과 원문이 다릅니다.');
    }
    return {
        ...raw, result
    } as StoredOperation;
}
/** 메타데이터와 영수증은 같은 TX에서 확정하며 파일 상태는 별도 단계로 표현한다. */
export async function executeDocumentMetadataCommand(db: admin.firestore.Firestore, actor: Actor | undefined, input: DocumentMetadataCommand, storagePort?: DocumentStoragePort): Promise<DocumentMetadataResult | DocumentMetadataOpenResult | DocumentMetadataPendingResult> {
    if (input?.mode === 'listPending')
        return listPendingDocumentOperations(db, actor, input);
    if (!input || !['reserveUpload', 'open', 'apply', 'inspect', 'cancel', 'cleanup'].includes(input.mode))
        throw new HttpsError('invalid-argument', '문서 처리 종류를 확인해 주세요.');
    const allowed = input.mode === 'apply' || input.mode === 'reserveUpload' ? ['mode', 'request'] : input.mode === 'open' ? ['mode', 'reference', 'opening'] : ['mode', 'reference'];
    if (Object.keys(input).some(k => !allowed.includes(k)))
        throw new HttpsError('invalid-argument', '문서 명령 형식을 확인해 주세요.');
    let request: DocumentMetadataRequest | undefined;
    let ref: DocumentMetadataReference;
    try {
        request = 'request' in input ? normalizeDocumentMetadataRequest(input.request) : undefined;
        if (input.mode === 'reserveUpload' && request?.action !== 'create')
            throw Error('업로드 예약에는 새 문서 원문이 필요합니다.');
        ref = request?.reference ?? normalizeDocumentMetadataReference('reference' in input ? input.reference : undefined);
        if (input.mode === 'open')
            normalizeDocumentMetadataOpening(input.opening);
    }
    catch (error) {
        throw new HttpsError('invalid-argument', error instanceof Error ? error.message : '문서 요청 원문을 확인해 주세요.');
    }
    authorized(actor, ref);
    const storage = storagePort ?? createDocumentStoragePort();
    const employeeId = String(actor.token.employeeId), receiptRef = db.collection(DOCUMENT_OPERATIONS).doc(documentMetadataReceiptId(ref, actor.uid)), targetRef = db.collection('fileCabinetDocs').doc(ref.documentId);
    const text = request ? serializeDocumentMetadataRequest(request) : null, hash = text ? sha(text) : null;
    const result = (status: DocumentMetadataResult['status'], requestHash: string | null, message: string, uploadStatus: DocumentMetadataResult['uploadStatus'] = 'not-required', cleanupStatus: DocumentMetadataResult['cleanupStatus'] = 'not-required'): DocumentMetadataResult => ({
        version: 1, reference: ref, actorUid: actor.uid, employeeId, status, requestHash, message, uploadStatus, cleanupStatus
    });
    if (input.mode === 'cleanup')
        return cleanupDocumentOperation(db, actor, ref, storage);
    if (input.mode === 'open') {
        normalizeDocumentMetadataOpening(input.opening);
        return db.runTransaction(async (tx) => {
            const employee = await tx.get(db.collection('employees').doc(employeeId)), target = await tx.get(targetRef);
            if (!employee.exists || employee.get('companyId') !== ref.companyId)
                throw new HttpsError('permission-denied', '현재 회사의 관리자 직원 정보를 확인해 주세요.');
            const raw = target.data();
            if (!raw || raw.companyId !== ref.companyId || Object.prototype.hasOwnProperty.call(raw, 'id') && raw.id !== ref.documentId)
                throw new HttpsError('failed-precondition', '문서가 없거나 소속·문서 번호가 다릅니다. 현재 목록에서 다시 열어 주세요.');
            if (JSON.stringify(documentMetadataOpening(raw, codec(db))) !== JSON.stringify(input.opening))
                throw new HttpsError('failed-precondition', '선택한 문서가 바뀌었습니다. 현재 목록에서 다시 열어 주세요.');
            return normalizeDocumentMetadataOpenResult({
                reference: ref, actorUid: actor.uid, employeeId, snapshot: documentMetadataOpening(raw, codec(db)), expectedVersion: version(target)
            }, ref, actor.uid, employeeId);
        });
    }
    // 이미 확정한 ACK는 파일의 현재 존재 여부와 관계없이 원래 근거로 반환한다.
    const prior = stored((await receiptRef.get()).data(), ref, actor);
    if (prior && request && prior.requestHash !== null && hash !== prior.requestHash)
        throw new HttpsError('failed-precondition', '이 요청 번호에는 다른 문서 원문이 먼저 기록되었습니다. 결과를 확인해 주세요.');
    if (prior && prior.result.status !== 'active') {
        return prior.result;
    }
    if (input.mode === 'inspect') {
        if (!prior)
            return result('unknown', null, '서버에 이 요청의 처리 기록이 아직 없습니다. 같은 요청으로 다시 확인하거나 중단해 주세요.');
        if (prior.requestText) {
            const original = normalizeDocumentMetadataRequest(JSON.parse(prior.requestText));
            if (original.action === 'create') {
                try {
                    const verified = await verifyDocumentUpload(storage, original.upload, actor.uid, employeeId);
                    return {
                        ...prior.result, uploadStatus: verified ? 'verified' : 'absent', message: verified ? '파일 업로드를 확인했습니다. 같은 요청으로 목록 등록을 이어갈 수 있습니다.' : '업로드 파일이 아직 없습니다. 같은 원본 파일을 다시 선택해 주세요.'
                    };
                }
                catch (error) {
                    return {
                        ...prior.result, uploadStatus: 'unverified', message: error instanceof Error ? error.message : '업로드 파일 상태를 확인하지 못했습니다.'
                    };
                }
            }
        }
        return prior.result;
    }
    let verified: Awaited<ReturnType<typeof verifyDocumentUpload>> = null, verificationError: string | undefined;
    if (input.mode === 'apply' && request?.action === 'create') {
        if (!prior)
            return result('unknown', hash, '업로드 예약을 먼저 확인해 주세요. 아직 목록 등록을 시작하지 않았습니다.', 'unverified');
        try {
            verified = await verifyDocumentUpload(storage, request.upload, actor.uid, employeeId);
        }
        catch (error) {
            verificationError = error instanceof Error ? error.message : '파일 상태를 확인하지 못했습니다.';
        }
        if (!verified)
            return {
                ...prior.result, uploadStatus: verificationError ? 'unverified' : 'absent', message: verificationError ?? '업로드 파일이 아직 없습니다. 같은 원본 파일을 선택한 뒤 이어가 주세요.'
            };
    }
    let deleteGeneration: string | undefined;
    if (input.mode === 'apply' && request?.action === 'delete') {
        const selected = await targetRef.get(), data = selected.data();
        if (version(selected) === request.expectedVersion && data?.companyId === ref.companyId && typeof data.storagePath === 'string' && data.storagePath.startsWith(`companies/${ref.companyId}/file-cabinet/`))
            deleteGeneration = typeof data.storageGeneration === 'string' ? data.storageGeneration : (await storage.stat(data.storagePath))?.generation;
    }
    const outcome = await db.runTransaction(async (tx) => {
        const receipt = stored((await tx.get(receiptRef)).data(), ref, actor);
        if (receipt) {
            if (request && receipt.requestHash !== null && receipt.requestHash !== hash)
                throw new HttpsError('failed-precondition', '같은 요청 번호의 문서 원문이 다릅니다.');
            if (receipt.result.status !== 'active')
                return receipt.result;
        }
        const original = request ?? (receipt?.requestText ? normalizeDocumentMetadataRequest(JSON.parse(receipt.requestText)) : undefined);
        const employee = await tx.get(db.collection('employees').doc(employeeId));
        if (!employee.exists || employee.get('companyId') !== ref.companyId)
            throw new HttpsError('permission-denied', '현재 회사의 관리자 직원 정보를 확인해 주세요.');
        const categoryPath = original?.action === 'create' && input.mode === 'apply' ? await readDocumentCategoryPath(tx, db, ref.companyId, original.metadata.category, original.metadata.subCategory) : null;
        const target = await tx.get(targetRef), raw = target.data();
        const path = original?.action === 'create' ? original.upload.path : typeof raw?.storagePath === 'string' && raw.storagePath.startsWith(`companies/${ref.companyId}/file-cabinet/`) ? raw.storagePath : undefined;
        const pathRef = path ? db.collection(DOCUMENT_PATHS).doc(documentStoragePathId(path)) : null;
        const fence = pathRef ? await tx.get(pathRef) : null;
        const uploadRef = original?.action === 'create' ? db.collection(DOCUMENT_UPLOADS).doc(original.upload.uploadId) : null;
        const reservation = uploadRef ? await tx.get(uploadRef) : null;
        const record = (r: DocumentMetadataResult, extras: Record<string, unknown> = {}) => {
            tx.set(receiptRef, {
                discoveryScopeKey: documentDiscoveryScopeKey(ref.companyId, actor.uid, employeeId), requestText: original ? serializeDocumentMetadataRequest(original) : null, requestHash: r.requestHash, result: r, ...extras
            });
            return r;
        };
        if (input.mode === 'cancel') {
            if (uploadRef) {
                tx.set(uploadRef, {
                    closed: true
                }, {
                    merge: true
                });
            }
            if (pathRef && original?.action === 'create')
                tx.set(pathRef, {
                    companyId: ref.companyId, path, closed: true
                }, {
                    merge: true
                });
            return record(result('cancelled', receipt?.requestHash ?? hash, '미처리 문서 요청을 중단했습니다. 이미 등록·삭제된 자료를 되돌리는 작업은 아닙니다.', original?.action === 'create' ? 'reserved' : 'not-required', original?.action === 'create' ? 'pending' : 'not-required'), path ? {
                cleanupPath: path
            } : {});
        }
        if (!request)
            throw new HttpsError('invalid-argument', '최초 문서 원문이 필요합니다.');
        if (input.mode === 'reserveUpload') {
            if (request.action !== 'create')
                throw new HttpsError('invalid-argument', '업로드 예약에는 새 문서 원문이 필요합니다.');
            if (receipt)
                return receipt.result;
            if (target.exists || reservation?.exists || fence?.get('closed') === true)
                return record(result('rejected', hash, '문서 번호 또는 업로드 경로가 이미 사용되었습니다. 현재 목록을 확인한 뒤 새로 작성해 주세요.', 'unverified'));
            tx.create(uploadRef!, {
                companyId: ref.companyId, actorUid: actor.uid, employeeId, reference: ref, requestHash: hash, upload: request.upload, closed: false
            });
            tx.set(pathRef!, {
                companyId: ref.companyId, path, closed: false
            });
            return record(result('active', hash, '업로드 예약을 확인했습니다. 같은 원본 파일을 업로드해 주세요.', 'reserved'));
        }
        if (request.action === 'create') {
            const ownReservation = reservation?.exists && reservation.get('requestHash') === hash && reservation.get('actorUid') === actor.uid && reservation.get('employeeId') === employeeId && JSON.stringify(reservation.get('reference')) === JSON.stringify(ref) && reservation.get('upload.path') === request.upload.path;
            const rejectUpload = (message: string, uploadStatus: DocumentMetadataResult['uploadStatus']) => {
                if (!ownReservation)
                    return record(result('rejected', hash, message, uploadStatus));
                tx.update(uploadRef!, {
                    closed: true
                });
                tx.set(pathRef!, {
                    companyId: ref.companyId, path, closed: true
                }, {
                    merge: true
                });
                return record(result('rejected', hash, message + ' 문서 등록은 하지 않았으며 업로드 파일 정리는 별도로 확인해 주세요.', uploadStatus, 'pending'), {
                    cleanupPath: request.upload.path, ...(verified ? {
                        cleanupGeneration: verified.object.generation
                    } : {})
                });
            };
            if (!ownReservation || reservation!.get('closed') !== false || fence?.get('closed') === true)
                return rejectUpload('업로드 예약이 중단되었거나 최초 원문과 다릅니다. 결과를 확인한 뒤 현재 목록에서 다시 작성해 주세요.', 'unverified');
            if (!categoryPath?.exists)
                return rejectUpload('분류가 없어 문서를 등록하지 않았습니다. 현재 분류를 확인한 뒤 다시 작성해 주세요.', 'verified');
            if (target.exists)
                return rejectUpload('같은 문서 번호가 이미 있습니다. 현재 목록에서 확인해 주세요.', 'verified');
            const token = verified!.downloadUrl, bucket = storage.bucketName;
            if (!bucket)
                throw Error('문서 Storage 버킷 설정을 확인해 주세요.');
            const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(request.upload.path)}?alt=media&token=${encodeURIComponent(token)}`;
            categoryPath.touch();
            tx.create(targetRef, {
                companyId: ref.companyId, ...request.metadata, storagePath: request.upload.path, size: request.upload.size, contentType: request.upload.contentType, downloadUrl, storageGeneration: verified!.object.generation
            });
            tx.update(uploadRef!, {
                closed: true, applied: true, generation: verified!.object.generation
            });
            return record(result('applied', hash, '문서 목록 등록이 완료되었습니다.', 'verified'));
        }
        if (!raw || raw.companyId !== ref.companyId || Object.prototype.hasOwnProperty.call(raw, 'id') && raw.id !== ref.documentId || version(target) !== request.expectedVersion)
            return record(result('rejected', hash, '문서가 없거나 선택한 뒤 바뀌었습니다. 현재 목록에서 다시 열어 주세요.'));
        if (request.action === 'note') {
            if (fence?.get('cleaning') === true)
                return record(result('rejected', hash, '이 파일의 정리가 진행 중입니다. 현재 목록을 다시 확인해 주세요.'));
            tx.update(targetRef, {
                note: request.note
            });
            return record(result('applied', hash, '문서 메모를 저장했습니다.'));
        }
        tx.delete(targetRef);
        return record(result('applied', hash, '문서 목록 삭제가 완료되었습니다. 파일 정리 결과는 별도로 확인해 주세요.', 'not-required', path ? 'pending' : 'not-required'), path ? {
            cleanupPath: path, ...(deleteGeneration ? {
                cleanupGeneration: deleteGeneration
            } : {})
        } : {});
    });
    return outcome;
}
/** 같은 path의 참조와 cleanup lease를 TX에서 묶어 다른 시도·새 참조를 보호한다. */
export async function cleanupDocumentOperation(db: admin.firestore.Firestore, actor: Actor, ref: DocumentMetadataReference, storage: DocumentStoragePort, eventGeneration?: string): Promise<DocumentMetadataResult> {
    authorized(actor, ref);
    const receiptRef = db.collection(DOCUMENT_OPERATIONS).doc(documentMetadataReceiptId(ref, actor.uid));
    const receipt = stored((await receiptRef.get()).data(), ref, actor);
    if (!receipt)
        throw new HttpsError('failed-precondition', '먼저 문서 요청의 실제 결과를 확인해 주세요.');
    if (!['applied', 'cancelled', 'rejected'].includes(receipt.result.status) || receipt.result.cleanupStatus === 'not-required')
        return receipt.result;
    const path = receipt.cleanupPath;
    if (!path || !path.startsWith(`companies/${ref.companyId}/file-cabinet/`))
        throw Error('정리 대상의 회사와 파일 경로를 확인하지 못했습니다.');
    const pathRef = db.collection(DOCUMENT_PATHS).doc(documentStoragePathId(path)), leaseId = randomUUID();
    const prepared = await db.runTransaction(async (tx) => {
        const fresh = stored((await tx.get(receiptRef)).data(), ref, actor);
        if (!fresh || !['applied', 'cancelled', 'rejected'].includes(fresh.result.status))
            throw Error('문서 처리 결과가 바뀌었습니다.');
        await tx.get(pathRef);
        const refs = await tx.get(db.collection('fileCabinetDocs').where('storagePath', '==', path));
        if (!refs.empty) {
            const result = {
                ...fresh.result, cleanupStatus: 'retained-shared' as const, message: '문서 목록 처리는 완료됐습니다. 다른 문서가 같은 파일을 참조하여 파일을 보존했습니다.'
            };
            tx.update(receiptRef, {
                result
            });
            return {
                result, remove: false
            };
        }
        tx.set(pathRef, {
            companyId: ref.companyId, path, closed: true, cleaning: true, owner: receiptRef.id, leaseId
        });
        return {
            result: fresh.result, remove: true
        };
    });
    if (!prepared.remove)
        return prepared.result;
    let cleanupStatus: DocumentMetadataResult['cleanupStatus'];
    try {
        const object = await storage.stat(path);
        const original = receipt.requestText ? normalizeDocumentMetadataRequest(JSON.parse(receipt.requestText)) : null;
        const expected = receipt.cleanupGeneration ?? eventGeneration ?? (original?.action === 'create' && object?.metadata.uploadId === original.upload.uploadId && object.metadata.actorUid === actor.uid && object.metadata.employeeId === actor.token.employeeId && object.metadata.sha256 === original.upload.sha256 ? object.generation : undefined);
        cleanupStatus = !object ? 'absent' : !expected ? 'retained-replaced' : await deleteDocumentGeneration(storage, path, expected);
    }
    catch {
        cleanupStatus = 'pending';
    }
    return db.runTransaction(async (tx) => {
        const fresh = stored((await tx.get(receiptRef)).data(), ref, actor), fence = await tx.get(pathRef);
        if (!fresh)
            throw Error('파일 정리의 요청 근거가 바뀌었습니다.');
        // 늦게 끝난 실패가 이미 완료된 새 시도의 ACK를 pending으로 덮지 않는다.
        if (fence.get('owner') !== receiptRef.id || fence.get('leaseId') !== leaseId)
            return fresh.result;
        const message = cleanupStatus === 'pending' ? '문서 목록 처리는 완료됐지만 파일 정리를 확인하지 못했습니다. 파일 정리만 다시 시도해 주세요.' : cleanupStatus === 'retained-replaced' ? '문서 목록 처리는 완료됐습니다. 다른 파일로 바뀌어 삭제하지 않고 보존했습니다.' : cleanupStatus === 'absent' ? '문서 목록 처리는 완료됐고 정리할 파일이 현재 없습니다. 늦은 업로드는 예약 중단 규칙으로 별도 확인합니다.' : '문서 목록 처리와 해당 세대 파일 정리가 완료되었습니다.';
        const result = {
            ...fresh.result, cleanupStatus, message
        };
        tx.update(receiptRef, {
            result
        });
        tx.update(pathRef, {
            cleaning: false
        });
        return result;
    });
}
export const documentMetadataCommand = onCall({
    region: 'asia-northeast3'
}, async (req) => executeDocumentMetadataCommand(admin.firestore(), req.auth ? {
    uid: req.auth.uid, token: req.auth.token
} : undefined, req.data));
export async function cleanupLateDocumentObject(db: admin.firestore.Firestore, object: {
    name: string;
    generation: string;
    bucket: string;
}, storage: DocumentStoragePort): Promise<void> {
    const match = /^companies\/(taebaek|punghoe)\/file-cabinet\/uploads\/([^/]+)\/[^/]+$/.exec(object.name);
    if (!match)
        return;
    if (storage.bucketName !== object.bucket)
        throw Error('업로드 이벤트와 정리 대상 Storage 버킷이 다릅니다.');
    const reservation = await db.collection(DOCUMENT_UPLOADS).doc(match[2]).get(), raw = reservation.data();
    if (!raw || raw.closed !== true || raw.applied === true)
        return;
    const ref = normalizeDocumentMetadataReference(raw.reference);
    if (ref.companyId !== match[1] || raw.upload?.path !== object.name)
        throw Error('업로드 이벤트와 최초 예약의 회사·경로가 다릅니다.');
    const actor = {
        uid: raw.actorUid, token: {
            companyId: ref.companyId, employeeId: raw.employeeId, isAdmin: true
        }
    };
    const outcome = await cleanupDocumentOperation(db, actor, ref, storage, object.generation);
    if (outcome.cleanupStatus === 'pending' || outcome.status === 'unknown')
        throw Error('늦은 문서 업로드 정리가 미확정입니다. 같은 이벤트를 다시 처리해야 합니다.');
}
/** 중단 뒤 도착한 객체의 정리 실패도 이벤트 ACK하지 않아 같은 원문으로 재개한다. */
export const cleanupLateDocumentUpload = onObjectFinalized({
    region: 'asia-northeast3', retry: true
}, async (event) => {
    await cleanupLateDocumentObject(admin.firestore(), {
        name: event.data.name, generation: String(event.data.generation), bucket: event.data.bucket
    }, createDocumentStoragePort());
});
export async function listPendingDocumentOperations(db: admin.firestore.Firestore, actor: Actor | undefined, input: {
    mode: 'listPending';
    companyId: 'taebaek' | 'punghoe';
    cursor?: string;
}): Promise<DocumentMetadataPendingResult> {
    if (Object.keys(input).some(k => !['mode', 'companyId', 'cursor'].includes(k)) || !['taebaek', 'punghoe'].includes(input.companyId) || (input.cursor !== undefined && !/^[a-f0-9]{64}$/.test(input.cursor)))
        throw new HttpsError('invalid-argument', '문서 목록의 회사와 다음 페이지 번호를 확인해 주세요.');
    const reference: DocumentMetadataReference = {
        companyId: input.companyId, planId: 'list', documentId: 'list'
    };
    authorized(actor, reference);
    const employeeId = String(actor.token.employeeId), employee = await db.collection('employees').doc(employeeId).get();
    if (!employee.exists || employee.get('companyId') !== input.companyId)
        throw new HttpsError('permission-denied', '현재 회사의 관리자 직원 정보를 확인해 주세요.');
    let query = db.collection(DOCUMENT_OPERATIONS).where('discoveryScopeKey', '==', documentDiscoveryScopeKey(input.companyId, actor.uid, employeeId)).orderBy(admin.firestore.FieldPath.documentId()).limit(50);
    if (input.cursor)
        query = query.startAfter(input.cursor);
    const snapshot = await query.get(), entries: DocumentMetadataPendingResult['entries'] = [];
    for (const row of snapshot.docs) {
        const raw = row.data(), ref = normalizeDocumentMetadataReference(raw.result?.reference);
        const record = stored(raw, ref, actor);
        if (row.id !== documentMetadataReceiptId(ref, actor.uid))
            throw Error('문서 목록의 요청 번호 근거가 다릅니다.');
        if (!record)
            continue;
        if (ref.companyId !== input.companyId)
            throw Error('문서 목록의 소속 회사가 조회 범위와 다릅니다.');
        if (record.result.status !== 'active' && record.result.cleanupStatus !== 'pending')
            continue;
        const request = record.requestText ? normalizeDocumentMetadataRequest(JSON.parse(record.requestText)) : null;
        const label = request?.action === 'create' ? request.metadata.fileName : ref.documentId;
        entries.push({
            result: record.result, label
        });
    }
    return {
        version: 1, companyId: input.companyId, actorUid: actor.uid, employeeId, entries, nextCursor: snapshot.size === 50 ? snapshot.docs[snapshot.size - 1].id : null
    };
}
