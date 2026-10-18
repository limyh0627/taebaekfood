import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { EMPLOYEE_EDIT_OPERATIONS, EMPLOYEE_PROFILE_FIELDS, normalizeEmployeeEditReference, normalizeEmployeeEditRequest, normalizeEmployeeEditResult, serializeEmployeeEditRequest, employeeEditExpected, type EmployeeEditCommand, type EmployeeEditReference, type EmployeeEditRequest, type EmployeeEditResult } from './shared/employeeEditCommand';
import { decodeCatalogValue, type CatalogValueAdapter } from './shared/catalogOrderReferenceProof';
import {documentId} from './shared/documentId';
type Actor = {
    uid: string;
    token: Record<string, unknown>;
};
type Scope = EmployeeEditReference & {
    actorUid: string;
};
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
export const employeeEditReceiptId = (companyId: string, actorUid: string, planId: string): string => sha(JSON.stringify([companyId, actorUid, planId]));
function codecOf(db: admin.firestore.Firestore): CatalogValueAdapter {
    return { special: value => value instanceof admin.firestore.Timestamp ? ['timestamp', value.seconds, value.nanoseconds] : value instanceof admin.firestore.DocumentReference ? ['reference', value.path] : value instanceof admin.firestore.GeoPoint ? ['geo', value.latitude, value.longitude] : Buffer.isBuffer(value) ? ['bytes', [...value]] : undefined, timestamp: (seconds, nanos) => new admin.firestore.Timestamp(seconds, nanos), reference: path => db.doc(path), geo: (lat, lng) => new admin.firestore.GeoPoint(lat, lng), bytes: bytes => Buffer.from(bytes) };
}
function outcome(scope: Scope, status: EmployeeEditResult['status'], requestHash: string | null, message: string): EmployeeEditResult { return { ...scope, status, requestHash, message }; }
/** 직원 편집만 허용하며 권한·급여·알림 필드는 현재 문서에 그대로 둔다. */
export async function executeEmployeeEditCommand(db: admin.firestore.Firestore, actor: Actor | undefined, input: EmployeeEditCommand): Promise<EmployeeEditResult> {
    if (!actor?.uid)
        throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    if (actor.token.isAdmin !== true || !documentId(actor.token.employeeId) || !['taebaek', 'punghoe'].includes(String(actor.token.companyId)))
        throw new HttpsError('permission-denied', '현재 회사의 관리자 계정으로 로그인해 주세요.');
    const codec = codecOf(db);
    let request: EmployeeEditRequest | undefined, reference: EmployeeEditReference, text: string | null = null, hash: string | undefined;
    try {
        if (!input || !['apply', 'inspect', 'cancel'].includes(input.mode))
            throw Error('직원 저장 처리 종류를 확인해 주세요.');
        if (Object.keys(input).some(key => !(input.mode === 'apply' ? ['mode', 'request'] : ['mode', 'reference', 'requestHash']).includes(key)))
            throw Error('직원 저장 명령 형식을 확인해 주세요.');
        if (input.mode === 'apply') {
            request = normalizeEmployeeEditRequest(input.request);
            reference = normalizeEmployeeEditReference({ companyId: request.companyId, planId: request.planId, targetId: request.targetId });
            if (request.kind !== 'create') {
                const raw = decodeCatalogValue(request.expected, codec) as Record<string, unknown>;
                if (!raw || Array.isArray(raw) || JSON.stringify(employeeEditExpected(raw, request.kind, codec)) !== JSON.stringify(request.expected))
                    throw Error('직원을 열 때 확인한 원문 형식이 다릅니다.');
            }
            text = serializeEmployeeEditRequest(request);
            hash = sha(text);
        }
        else {
            reference = normalizeEmployeeEditReference(input.reference);
            hash = input.requestHash;
            if (hash !== undefined && (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)))
                throw Error('직원 저장 원문 해시를 확인해 주세요.');
        }
    }
    catch (error) {
        throw new HttpsError('invalid-argument', error instanceof Error ? error.message : '직원 저장 원문을 확인해 주세요.');
    }
    if (reference.companyId !== actor.token.companyId)
        throw new HttpsError('permission-denied', '다른 회사의 직원은 저장할 수 없습니다.');
    const scope: Scope = { ...reference, actorUid: actor.uid }, receiptRef = db.collection(EMPLOYEE_EDIT_OPERATIONS).doc(employeeEditReceiptId(scope.companyId, actor.uid, scope.planId));
    return db.runTransaction(async (tx) => {
        const receipt = await tx.get(receiptRef);
        // 현재 관리자 claim의 자기 ACK는 직원 문서 삭제로 회수하지 않는다. 새 업무 쓰기만 아래 실직원을 검사한다.
        if (receipt.exists) {
            const data = receipt.data()!;
            let result: EmployeeEditResult;
            try {
                if (data.version !== 1 || !['applied', 'rejected', 'cancelled'].includes(data.status))
                    throw Error();
                result = normalizeEmployeeEditResult({ companyId: data.companyId, planId: data.planId, targetId: data.targetId, actorUid: data.actorUid, requestHash: data.requestHash, status: data.status, message: data.message }, reference, actor.uid);
                if (result.requestHash === null) {
                    if (result.status !== 'cancelled' || data.requestText !== null)
                        throw Error();
                }
                else {
                    if (typeof data.requestText !== 'string' || sha(data.requestText) !== result.requestHash)
                        throw Error();
                    const original = normalizeEmployeeEditRequest(JSON.parse(data.requestText));
                    if (serializeEmployeeEditRequest(original) !== data.requestText || original.companyId !== scope.companyId || original.planId !== scope.planId || original.targetId !== scope.targetId)
                        throw Error();
                }
            }
            catch {
                throw new HttpsError('failed-precondition', '직원 저장 처리 근거를 확인하지 못했습니다. 최초 원문을 보존해 주세요.');
            }
            if (hash !== undefined && result.requestHash !== null && hash !== result.requestHash)
                throw new HttpsError('already-exists', '같은 직원 저장 번호의 최초 내용이 다릅니다.');
            return input.mode === 'apply' && result.status === 'applied' ? { ...result, status: 'duplicate' } : result;
        }
        if (input.mode === 'inspect')
            return outcome(scope, 'unknown', null, '직원 저장 결과를 확인하지 못했습니다. 자동으로 다시 저장하지 않습니다.');
        const actorSnapshot = await tx.get(db.collection('employees').doc(actor.token.employeeId as string));
        if (!actorSnapshot.exists || (actorSnapshot.get('companyId') ?? 'taebaek') !== scope.companyId)
            throw new HttpsError('permission-denied', '현재 회사의 관리자 직원 정보를 확인해 주세요.');
        const writeReceipt = (result: EmployeeEditResult): EmployeeEditResult => { tx.create(receiptRef, { ...result, version: 1, requestText: text, createdAt: new Date().toISOString() }); return result; };
        if (input.mode === 'cancel')
            return writeReceipt(outcome(scope, 'cancelled', null, '이 직원 저장 요청을 중단했습니다. 늦게 도착한 저장도 막았습니다.'));
        const reject = (message: string) => writeReceipt(outcome(scope, 'rejected', hash!, message));
        const targetRef = db.collection('employees').doc(scope.targetId), target = await tx.get(targetRef), current = target.data();
        if (current && current.companyId !== scope.companyId)
            return reject(current.companyId == null
                ? '직원 정보의 소속 회사가 지정되지 않아 저장하지 않았습니다. 직원의 소속 정보를 확인한 뒤 다시 열어 주세요.'
                : '같은 번호의 다른 회사 직원이 있어 저장하지 않았습니다.');
        if (request!.kind === 'create' ? target.exists : !target.exists)
            return reject(request!.kind === 'create' ? '같은 번호의 직원이 이미 있어 덮어쓰지 않았습니다.' : '직원 정보가 삭제되어 다시 만들지 않았습니다.');
        if (request!.kind !== 'create' && JSON.stringify(employeeEditExpected(current!, request!.kind, codec)) !== JSON.stringify(request!.expected))
            return reject('직원 정보가 작성 시작 후 바뀌어 저장하지 않았습니다. 최신 정보를 다시 열어 주세요.');
        const result = outcome(scope, 'applied', hash!, request!.kind === 'balance' ? '연차 조정을 저장했습니다.' : '직원 정보를 저장했습니다.');
        if (Buffer.byteLength(JSON.stringify({ ...result, version: 1, requestText: text, createdAt: new Date().toISOString() }), 'utf8') > 850000)
            return reject('직원 저장 근거가 너무 커 저장하지 않았습니다.');
        const annual = current?.annualLeave && typeof current.annualLeave === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(current.annualLeave)) ? current.annualLeave : {};
        const values = request!.kind === 'balance' ? request!.balance : request!.profile.annualLeave;
        const patch: Record<string, unknown> = { annualLeave: { ...annual, ...values } };
        if (request!.kind !== 'balance')
            for (const field of EMPLOYEE_PROFILE_FIELDS)
                patch[field] = request!.profile[field];
        if (request!.kind === 'create')
            tx.create(targetRef, { ...patch, companyId: scope.companyId });
        else
            tx.update(targetRef, patch);
        return writeReceipt(result);
    });
}
export const employeeEditCommand = onCall({ region: 'asia-northeast3' }, request => executeEmployeeEditCommand(admin.firestore(), request.auth, request.data));
