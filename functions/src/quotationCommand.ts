import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { documentId } from './shared/documentId';
import { QUOTATION_FIELDS, QUOTATION_OPERATIONS, decodeQuotationSnapshot, quotationOpening, quotationSnapshot, normalizeQuotationOpening, normalizeQuotationOpenResult, normalizeQuotationReference, normalizeQuotationRequest, normalizeQuotationResult, serializeQuotationRequest, type QuotationCommand, type QuotationReference, type QuotationRequest, type QuotationResult, type QuotationOpenResult, type CatalogValue, type CatalogValueAdapter } from './shared/quotationCommand';
type Actor = {
    uid: string;
    token: Record<string, unknown>;
};
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
export const quotationReceiptId = (companyId: string, actorUid: string, planId: string): string => sha(JSON.stringify([companyId, actorUid, planId]));
const nativeVersion = (snapshot: admin.firestore.DocumentSnapshot): string | null => snapshot.updateTime ? `${snapshot.updateTime.seconds}:${String(snapshot.updateTime.nanoseconds).padStart(9, '0')}` : null;
function codecOf(db: admin.firestore.Firestore): CatalogValueAdapter {
    return { special: value => value instanceof admin.firestore.Timestamp ? ['timestamp', value.seconds, value.nanoseconds] : value instanceof admin.firestore.DocumentReference ? ['reference', value.path] : value instanceof admin.firestore.GeoPoint ? ['geo', value.latitude, value.longitude] : Buffer.isBuffer(value) ? ['bytes', [...value]] : undefined, timestamp: (seconds, nanos) => new admin.firestore.Timestamp(seconds, nanos), reference: path => db.doc(path), geo: (lat, lng) => new admin.firestore.GeoPoint(lat, lng), bytes: bytes => Buffer.from(bytes) };
}
function parse(input: QuotationCommand): {
    reference: QuotationReference;
    request?: QuotationRequest;
    opening?: CatalogValue;
    text: string | null;
    hash?: string;
} {
    if (!input || !['open', 'apply', 'inspect', 'cancel'].includes(input.mode))
        throw Error('견적 처리 종류를 확인해 주세요.');
    if (Object.keys(input).some(key => !(input.mode === 'apply' ? ['mode', 'request'] : input.mode === 'open' ? ['mode', 'reference', 'opening'] : ['mode', 'reference', 'requestHash']).includes(key)))
        throw Error('견적 명령 형식을 확인해 주세요.');
    if (input.mode === 'apply') {
        const request = normalizeQuotationRequest(input.request), text = serializeQuotationRequest(request);
        return { reference: request.reference, request, text, hash: sha(text) };
    }
    if (input.mode === 'open')
        return { reference: normalizeQuotationReference(input.reference), opening: normalizeQuotationOpening(input.opening), text: null };
    if (input.requestHash !== undefined && (typeof input.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.requestHash)))
        throw Error('견적 최초 원문 해시를 확인해 주세요.');
    return { reference: normalizeQuotationReference(input.reference), text: null, hash: input.requestHash };
}
/** 견적 한 건과 처리 근거만 확정한다. 금액·번호 계산은 기존 화면 정본을 바꾸지 않는다. */
export async function executeQuotationCommand(db: admin.firestore.Firestore, actor: Actor | undefined, input: QuotationCommand): Promise<QuotationResult | QuotationOpenResult> {
    if (!actor?.uid)
        throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    if (actor.token.isAdmin !== true || !documentId(actor.token.employeeId) || !['taebaek', 'punghoe'].includes(String(actor.token.companyId)))
        throw new HttpsError('permission-denied', '현재 회사의 관리자 계정으로 로그인해 주세요.');
    let parsed: ReturnType<typeof parse>;
    try {
        parsed = parse(input);
    }
    catch (error) {
        throw new HttpsError('invalid-argument', error instanceof Error ? error.message : '견적 요청을 확인해 주세요.');
    }
    const { reference, request, text, hash } = parsed;
    if (reference.companyId !== actor.token.companyId)
        throw new HttpsError('permission-denied', '다른 회사의 견적은 처리할 수 없습니다.');
    const receiptRef = db.collection(QUOTATION_OPERATIONS).doc(quotationReceiptId(reference.companyId, actor.uid, reference.planId));
    const targetRef = db.collection('quotations').doc(reference.targetId);
    const outcome = (status: QuotationResult['status'], requestHash: string | null, message: string): QuotationResult => ({ version: 1, reference, actorUid: actor.uid, status, requestHash, message });
    return db.runTransaction(async (tx) => {
        if (input.mode === 'open') {
            const employee = await tx.get(db.collection('employees').doc(actor.token.employeeId as string));
            if (!employee.exists || (employee.get('companyId') ?? 'taebaek') !== reference.companyId)
                throw new HttpsError('permission-denied', '현재 회사의 관리자 직원 정보를 확인해 주세요.');
            const target = await tx.get(targetRef), raw = target.data();
            if (!target.exists)
                throw new HttpsError('failed-precondition', '견적이 삭제되었거나 없습니다. 최신 목록에서 다시 열어 주세요.');
            if (raw!.companyId !== reference.companyId)
                throw new HttpsError('failed-precondition', '견적의 소속 회사가 현재 회사와 명시적으로 일치하지 않습니다. 소속 정보를 확인해 주세요.');
            if (Object.prototype.hasOwnProperty.call(raw, 'id') && raw!.id !== reference.targetId)
                throw new HttpsError('failed-precondition', '견적 문서 번호와 저장된 번호가 다릅니다. 해당 견적을 확인해 주세요.');
            if (JSON.stringify(quotationOpening(raw!, codecOf(db))) !== JSON.stringify(parsed.opening))
                throw new HttpsError('failed-precondition', '견적이 화면에서 선택한 내용과 다릅니다. 최신 목록에서 다시 열어 주세요.');
            return normalizeQuotationOpenResult({ reference, actorUid: actor.uid, snapshot: quotationSnapshot({ ...raw, id: reference.targetId, companyId: reference.companyId }, codecOf(db)), expectedVersion: nativeVersion(target) }, reference, actor.uid);
        }
        const receipt = await tx.get(receiptRef);
        if (receipt.exists) {
            const data = receipt.data()!;
            let saved: QuotationResult;
            try {
                saved = normalizeQuotationResult({ version: data.version, reference: data.reference, actorUid: data.actorUid, status: data.status, requestHash: data.requestHash, message: data.message }, reference, actor.uid);
                if (saved.status === 'unknown')
                    throw Error();
                if (saved.requestHash === null) {
                    if (saved.status !== 'cancelled' || data.requestText !== null)
                        throw Error();
                }
                else {
                    if (typeof data.requestText !== 'string' || sha(data.requestText) !== saved.requestHash)
                        throw Error();
                    const original = normalizeQuotationRequest(JSON.parse(data.requestText));
                    if (serializeQuotationRequest(original) !== data.requestText || JSON.stringify(original.reference) !== JSON.stringify(reference))
                        throw Error();
                }
            }
            catch {
                throw new HttpsError('failed-precondition', '견적 처리 근거를 확인하지 못했습니다. 최초 원문을 보존해 주세요.');
            }
            if (hash !== undefined && saved.requestHash !== null && hash !== saved.requestHash)
                throw new HttpsError('already-exists', '같은 견적 요청 번호의 최초 내용이 다릅니다.');
            return saved;
        }
        if (input.mode === 'inspect')
            return outcome('unknown', null, '견적 처리 결과를 확인하지 못했습니다. 최초 원문을 보존하고 같은 요청의 결과 확인 또는 요청 중단을 선택해 주세요.');
        const employee = await tx.get(db.collection('employees').doc(actor.token.employeeId as string));
        if (!employee.exists || (employee.get('companyId') ?? 'taebaek') !== reference.companyId)
            throw new HttpsError('permission-denied', '현재 회사의 관리자 직원 정보를 확인해 주세요.');
        const save = (result: QuotationResult): QuotationResult => { tx.create(receiptRef, { ...result, requestText: text, createdAt: new Date().toISOString() }); return result; };
        if (input.mode === 'cancel')
            return save(outcome('cancelled', null, '이 견적 요청을 중단했습니다. 늦게 도착한 같은 요청도 실행하지 않습니다.'));
        const reject = (message: string) => save(outcome('rejected', hash!, message));
        const target = await tx.get(targetRef);
        if (request!.action === 'create') {
            if (target.exists)
                return reject('같은 번호의 견적이 이미 있어 덮어쓰지 않았습니다. 최신 목록을 확인해 주세요.');
        }
        else {
            if (!target.exists)
                return reject('견적이 이미 삭제되었거나 없습니다. 이 요청을 중단하고 최신 목록에서 다시 열어 주세요.');
            if (target.get('companyId') == null)
                return reject('견적의 소속 회사가 지정되지 않아 처리하지 않았습니다. 소속 정보를 확인한 뒤 다시 열어 주세요.');
            if (target.get('companyId') !== reference.companyId)
                return reject('현재 회사의 견적이 아니므로 처리하지 않았습니다. 견적과 현재 선택한 회사를 확인해 주세요.');
            if (Object.prototype.hasOwnProperty.call(target.data()!, 'id') && target.get('id') !== reference.targetId)
                return reject('견적 문서 번호와 저장된 번호가 다릅니다. 해당 견적을 확인한 뒤 다시 열어 주세요.');
            if (nativeVersion(target) !== request!.expectedVersion)
                return reject('견적이 작성 시작 후 변경되거나 다시 만들어졌습니다. 이 요청을 중단하고 최신 내용을 다시 열어 주세요.');
        }
        const result = outcome('applied', hash!, request!.action === 'delete' ? '선택한 견적 한 건을 삭제했습니다.' : '견적을 저장했습니다.');
        if (Buffer.byteLength(JSON.stringify({ ...result, requestText: text, createdAt: new Date().toISOString() }), 'utf8') > 850000)
            return reject('견적 처리 근거가 너무 커 저장하지 않았습니다.');
        if (request!.action === 'delete')
            tx.delete(targetRef);
        else {
            const snapshot = decodeQuotationSnapshot(request!.snapshot!, codecOf(db));
            if (request!.action === 'create') {
                const { id: identity, ...data } = snapshot;
                tx.create(targetRef, data);
            }
            else {
                const patch: Record<string, unknown> = {};
                // 비운 선택 필드는 지우되 현재 상위 미지 필드와 줄 안의 원형 값은 보존한다.
                for (const field of QUOTATION_FIELDS)
                    if (field !== 'id' && field !== 'companyId')
                        patch[field] = Object.prototype.hasOwnProperty.call(snapshot, field) ? snapshot[field] : admin.firestore.FieldValue.delete();
                tx.update(targetRef, patch);
            }
        }
        return save(result);
    });
}
export const quotationCommand = onCall({ region: 'asia-northeast3' }, request => executeQuotationCommand(admin.firestore(), request.auth, request.data));
