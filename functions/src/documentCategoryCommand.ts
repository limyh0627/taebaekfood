import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { documentId } from './shared/documentId';
import { DOCUMENT_CATEGORY_OPERATIONS, DOCUMENT_DEFAULT_CATEGORIES, decodeDocumentCategoryOpening, documentCategoryOpening, normalizeDocumentCategoryReference, normalizeDocumentCategoryRequest, normalizeDocumentCategoryResult, serializeDocumentCategoryRequest, type DocumentCategoryCommand, type DocumentCategoryReference, type DocumentCategoryRequest, type DocumentCategoryResult, type DocumentCategoryPendingResult } from './shared/documentCategoryCommand';
import { readDocumentCategoryFences } from './shared/documentCategoryFence';
type Actor = {
    uid: string;
    token: Record<string, unknown>;
};
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
export const documentCategoryReceiptId = (reference: DocumentCategoryReference, actorUid: string) => sha(JSON.stringify([reference.companyId, actorUid, reference.planId]));
export const documentCategoryScopeKey = (companyId: string, actorUid: string, employeeId: string) => sha(JSON.stringify([companyId, actorUid, employeeId]));
function authorize(actor: Actor | undefined, companyId: string): asserts actor is Actor {
    if (!actor?.uid)
        throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    if (actor.token.isAdmin !== true || !documentId(actor.token.employeeId) || actor.token.companyId !== companyId || !['taebaek', 'punghoe'].includes(companyId))
        throw new HttpsError('permission-denied', '현재 회사의 관리자 직원 계정으로 로그인해 주세요.');
}
function readReceipt(data: admin.firestore.DocumentData | undefined, reference: DocumentCategoryReference, actor: Actor): DocumentCategoryResult | null {
    if (!data)
        return null;
    const result = normalizeDocumentCategoryResult(data.result, reference, actor.uid, String(actor.token.employeeId));
    if (data.requestText === null) {
        if (data.requestHash !== null || result.requestHash !== null || result.status !== 'cancelled')
            throw Error('분류 중단 기록의 원문 근거가 올바르지 않습니다.');
    }
    else {
        if (typeof data.requestText !== 'string' || sha(data.requestText) !== data.requestHash || result.requestHash !== data.requestHash)
            throw Error('분류 처리 기록의 최초 원문 해시를 확인하지 못했습니다.');
        const request = normalizeDocumentCategoryRequest(JSON.parse(data.requestText));
        if (serializeDocumentCategoryRequest(request) !== data.requestText || JSON.stringify(request.reference) !== JSON.stringify(reference))
            throw Error('분류 처리 기록의 회사·요청 번호가 다릅니다.');
    }
    return result;
}
export async function executeDocumentCategoryCommand(db: admin.firestore.Firestore, actor: Actor | undefined, input: DocumentCategoryCommand): Promise<DocumentCategoryResult | DocumentCategoryPendingResult> {
    if (input?.mode === 'listPending')
        return listDocumentCategoryOperations(db, actor, input);
    let request: DocumentCategoryRequest | undefined, reference: DocumentCategoryReference;
    try {
        if (!input || !['apply', 'inspect', 'cancel'].includes(input.mode) || Object.keys(input).some(k => !(input.mode === 'apply' ? ['mode', 'request'] : ['mode', 'reference']).includes(k)))
            throw Error('분류 명령 형식을 확인해 주세요.');
        request = input.mode === 'apply' ? normalizeDocumentCategoryRequest(input.request) : undefined;
        reference = request?.reference ?? normalizeDocumentCategoryReference('reference' in input ? input.reference : undefined);
    }
    catch (error) {
        throw new HttpsError('invalid-argument', error instanceof Error ? error.message : '분류 요청을 확인해 주세요.');
    }
    authorize(actor, reference.companyId);
    const employeeId = String(actor.token.employeeId), receiptRef = db.collection(DOCUMENT_CATEGORY_OPERATIONS).doc(documentCategoryReceiptId(reference, actor.uid));
    const text = request ? serializeDocumentCategoryRequest(request) : null, hash = text ? sha(text) : null;
    const outcome = (status: DocumentCategoryResult['status'], requestHash: string | null, message: string): DocumentCategoryResult => ({
        version: 1, reference, actorUid: actor.uid, employeeId, requestHash, status, message
    });
    return db.runTransaction(async (tx) => {
        const receiptData = (await tx.get(receiptRef)).data(), previous = readReceipt(receiptData, reference, actor);
        if (previous) {
            if (request && previous.requestHash !== null && previous.requestHash !== hash)
                throw new HttpsError('failed-precondition', '같은 요청 번호에 다른 분류 원문이 먼저 확정되었습니다. 결과를 확인해 주세요.');
            return previous;
        }
        const employee = await tx.get(db.collection('employees').doc(employeeId));
        if (!employee.exists || employee.get('companyId') !== reference.companyId)
            throw new HttpsError('permission-denied', '현재 회사의 관리자 직원 정보를 확인해 주세요.');
        const record = (result: DocumentCategoryResult) => {
            tx.create(receiptRef, {
                discoveryScopeKey: documentCategoryScopeKey(reference.companyId, actor.uid, employeeId), requestText: text, requestHash: result.requestHash, result, label: request ? categoryRequestLabel(request) : reference.planId
            });
            return result;
        };
        if (input.mode === 'inspect')
            return outcome('unknown', null, '서버에 이 분류 요청의 처리 기록이 아직 없습니다. 같은 요청으로 결과를 다시 확인하거나 중단해 주세요.');
        if (input.mode === 'cancel')
            return record(outcome('cancelled', null, '미처리 분류 요청을 중단했습니다. 이미 등록·삭제된 분류를 되돌리는 작업은 아닙니다.'));
        if (!request)
            throw Error('최초 분류 원문이 필요합니다.');
        const co = reference.companyId, action = request.action;
        const selected = action === 'deleteCategory' || action === 'deleteSubCategory' ? decodeDocumentCategoryOpening(request.opening) : null;
        const selectedRecord = selected as Record<string, unknown> | null;
        const category = action === 'createCategory' ? request.name : action === 'createSubCategory' || action === 'ensurePath' ? request.category : action === 'deleteCategory' ? String(selectedRecord?.name) : action === 'deleteSubCategory' ? String(selectedRecord?.category) : undefined;
        const subCategory = action === 'createSubCategory' ? request.name : action === 'ensurePath' ? request.subCategory : action === 'deleteSubCategory' ? String(selectedRecord?.name) : undefined;
        const paths = action === 'seedDefaults' ? [{}, ...DOCUMENT_DEFAULT_CATEGORIES.map(category => ({
                category
            }))] : [{}, ...(category ? [{
                    category
                }] : []), ...(subCategory ? [{
                    category, subCategory
                }] : [])];
        const fence = await readDocumentCategoryFences(tx, db, co, paths);
        const categories = await tx.get(db.collection('fileCabinetCategories').where('companyId', '==', co));
        const subs = await tx.get(db.collection('fileCabinetSubCategories').where('companyId', '==', co));
        const ids = action === 'seedDefaults' ? request.categoryIds : action === 'createCategory' || action === 'ensurePath' ? [request.categoryId] : [];
        const targetRefs = ids.map(id => db.collection('fileCabinetCategories').doc(id));
        if (action === 'createSubCategory' || action === 'ensurePath')
            targetRefs.push(db.collection('fileCabinetSubCategories').doc(request.subCategoryId));
        if (action === 'deleteCategory' || action === 'deleteSubCategory')
            targetRefs.push(db.collection(action === 'deleteCategory' ? 'fileCabinetCategories' : 'fileCabinetSubCategories').doc(request.targetId));
        const targets: admin.firestore.DocumentSnapshot[] = [];
        for (const ref of targetRefs)
            targets.push(await tx.get(ref));
        const docs = action === 'deleteCategory' || action === 'deleteSubCategory' ? await tx.get(db.collection('fileCabinetDocs').where('companyId', '==', co).where('category', '==', category)) : null;
        const reject = (message: string) => record(outcome('rejected', hash, message));
        const categoryExists = categories.docs.some(row => row.get('name') === category), subExists = subs.docs.some(row => row.get('category') === category && row.get('name') === subCategory);
        const row = (name: string, order: number) => ({
            companyId: co, name, order, createdAt: 'createdAt' in request ? request.createdAt : ''
        });
        if (action === 'seedDefaults') {
            if (!categories.empty)
                return record(outcome('applied', hash, '기존 대분류가 있어 기본 분류를 추가하지 않았습니다. 기존 이름과 순서를 유지했습니다.'));
            if (targets.some(t => t.exists))
                return reject('기본 분류 번호가 이미 사용되었습니다. 현재 목록을 확인한 뒤 다시 준비해 주세요.');
            fence.touch();
            for (let i = 0; i < DOCUMENT_DEFAULT_CATEGORIES.length; i++)
                tx.create(targetRefs[i], row(DOCUMENT_DEFAULT_CATEGORIES[i], i));
        }
        else if (action === 'createCategory') {
            if (categoryExists)
                return reject('이미 있는 대분류입니다. 현재 목록에서 선택해 주세요.');
            if (targets[0].exists)
                return reject('분류 번호가 이미 사용되었습니다. 현재 목록을 확인해 주세요.');
            fence.touch();
            tx.create(targetRefs[0], row(request.name, request.order));
        }
        else if (action === 'createSubCategory') {
            if (!categoryExists)
                return reject('대분류가 없어 중분류를 등록하지 않았습니다. 현재 목록에서 대분류를 확인해 주세요.');
            if (subExists)
                return reject('이미 있는 중분류입니다. 현재 목록에서 선택해 주세요.');
            if (targets[0].exists)
                return reject('중분류 번호가 이미 사용되었습니다. 현재 목록을 확인해 주세요.');
            fence.touch();
            tx.create(targetRefs[0], {
                ...row(request.name, request.order), category: request.category
            });
        }
        else if (action === 'ensurePath') {
            if (!categoryExists && targets[0].exists || !subExists && targets[1].exists)
                return reject('분류 번호가 이미 사용되었습니다. 현재 목록을 확인해 주세요.');
            fence.touch();
            if (!categoryExists)
                tx.create(targetRefs[0], row(request.category, 90));
            if (!subExists)
                tx.create(targetRefs[1], {
                    ...row(request.subCategory, 0), category: request.category
                });
        }
        else {
            const target = targets[0], raw = target.data();
            if (!raw || raw.companyId !== co || Object.prototype.hasOwnProperty.call(raw, 'id') && raw.id !== request.targetId || JSON.stringify(documentCategoryOpening(raw, action === 'deleteCategory' ? 'category' : 'subCategory')) !== JSON.stringify(request.opening))
                return reject('선택한 분류가 없거나 이름·소속이 바뀌었습니다. 현재 목록에서 다시 선택해 주세요.');
            if (docs?.docs.some(doc => action === 'deleteCategory' || doc.get('subCategory') === subCategory))
                return reject('이 분류에 파일이 있어 삭제할 수 없습니다. 파일을 먼저 확인해 주세요.');
            if (action === 'deleteCategory' && subs.docs.some(sub => sub.get('category') === category))
                return reject('이 대분류에 중분류가 있어 삭제할 수 없습니다. 먼저 중분류를 확인해 주세요.');
            fence.touch();
            tx.delete(targetRefs[0]);
        }
        return record(outcome('applied', hash, action.startsWith('delete') ? '분류 삭제가 완료되었습니다.' : '분류 등록을 완료했습니다.'));
    });
}
export function categoryRequestLabel(request: DocumentCategoryRequest): string {
    if (request.action === 'seedDefaults')
        return '기본 분류 등록';
    if (request.action === 'ensurePath')
        return request.category + ' / ' + request.subCategory;
    if (request.action === 'createCategory')
        return request.name;
    if (request.action === 'createSubCategory')
        return request.category + ' / ' + request.name;
    const raw = decodeDocumentCategoryOpening(request.opening) as Record<string, unknown>;
    return (request.action === 'deleteSubCategory' ? String(raw.category) + ' / ' : '') + String(raw.name);
}
export async function listDocumentCategoryOperations(db: admin.firestore.Firestore, actor: Actor | undefined, input: {
    mode: 'listPending';
    companyId: 'taebaek' | 'punghoe';
    cursor?: string;
}): Promise<DocumentCategoryPendingResult> {
    if (Object.keys(input).some(k => !['mode', 'companyId', 'cursor'].includes(k)) || (input.cursor !== undefined && !/^[a-f0-9]{64}$/.test(input.cursor)))
        throw new HttpsError('invalid-argument', '분류 처리 목록의 회사·페이지 번호를 확인해 주세요.');
    authorize(actor, input.companyId);
    const employeeId = String(actor.token.employeeId), employee = await db.collection('employees').doc(employeeId).get();
    if (!employee.exists || employee.get('companyId') !== input.companyId)
        throw new HttpsError('permission-denied', '현재 회사의 관리자 직원 정보를 확인해 주세요.');
    let query = db.collection(DOCUMENT_CATEGORY_OPERATIONS).where('discoveryScopeKey', '==', documentCategoryScopeKey(input.companyId, actor.uid, employeeId)).orderBy(admin.firestore.FieldPath.documentId()).limit(50);
    if (input.cursor)
        query = query.startAfter(input.cursor);
    const snapshot = await query.get(), entries: DocumentCategoryPendingResult['entries'] = [];
    for (const doc of snapshot.docs) {
        const data = doc.data(), reference = normalizeDocumentCategoryReference(data.result?.reference), result = readReceipt(data, reference, actor);
        if (reference.companyId !== input.companyId || doc.id !== documentCategoryReceiptId(reference, actor.uid) || !result)
            throw Error('분류 처리 목록의 회사·요청 근거가 다릅니다.');
        entries.push({
            result, label: typeof data.label === 'string' && data.label ? data.label : reference.planId
        });
    }
    return {
        version: 1, companyId: input.companyId, actorUid: actor.uid, employeeId, entries, nextCursor: snapshot.size === 50 ? snapshot.docs[snapshot.size - 1].id : null
    };
}
export const documentCategoryCommand = onCall({
    region: 'asia-northeast3'
}, async (req) => executeDocumentCategoryCommand(admin.firestore(), req.auth ? {
    uid: req.auth.uid, token: req.auth.token
} : undefined, req.data));
