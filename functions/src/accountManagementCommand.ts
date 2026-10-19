import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { documentId } from './shared/documentId';

import { ACCOUNT_MANAGEMENT_OPERATIONS, accountManagementOpening, normalizeAccountManagementOpenRequest, normalizeAccountManagementReference, normalizeAccountManagementRequest, normalizeAccountManagementResult, serializeAccountManagementRequest, type AccountManagementCommand, type AccountManagementOpenResult, type AccountManagementReference, type AccountManagementRequest, type AccountManagementResult } from './shared/accountManagementCommand';
type Actor = {
    uid: string;
    token: Record<string, unknown>;
};
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
export const accountManagementReceiptId = (companyId: string, actorUid: string, planId: string): string => sha(JSON.stringify([companyId, actorUid, planId]));
// 연결 정리 명령과 같은 native updateTime 정밀도를 사용한다. 밀리초 변환은 재생성을 놓칠 수 있다.
const nativeVersion = (snapshot: admin.firestore.DocumentSnapshot): string | null => snapshot.updateTime ? `${snapshot.updateTime.seconds}:${String(snapshot.updateTime.nanoseconds).padStart(9, '0')}` : null;
function parse(input: AccountManagementCommand): {
    reference: AccountManagementReference;
    request?: AccountManagementRequest;
    text: string | null;
    hash?: string;
} {
    if (!input || !['open', 'apply', 'inspect', 'cancel'].includes(input.mode))
        throw Error('계정 처리 종류를 확인해 주세요.');
    const fields = input.mode === 'apply' ? ['mode', 'request'] : input.mode === 'open' ? ['mode', 'reference', 'opening'] : ['mode', 'reference', 'requestHash'];
    if (Object.keys(input).some(key => !fields.includes(key)))
        throw Error('계정 명령 형식이 다릅니다.');
    if (input.mode === 'apply') {
        const request = normalizeAccountManagementRequest(input.request), text = serializeAccountManagementRequest(request);
        return { reference: request.reference, request, text, hash: sha(text) };
    }
    const reference = normalizeAccountManagementReference(input.reference);
    if (input.mode === 'open') {
        // 저장 입력 검증과 분리하여 선택한 원문과 조회 응답만 확인한다.
        normalizeAccountManagementOpenRequest(input);
        return { reference, text: null };
    }
    if (input.requestHash !== undefined && !/^[a-f0-9]{64}$/.test(input.requestHash))
        throw Error('계정 최초 원문 해시를 확인해 주세요.');
    return { reference, text: null, hash: input.requestHash };
}
/** 계정 한 건의 등록·수정·삭제와 처리 근거를 함께 확정한다. 회계 계산이나 연결 정리는 하지 않는다. */
export async function executeAccountManagementCommand(db: admin.firestore.Firestore, actor: Actor | undefined, input: AccountManagementCommand): Promise<AccountManagementOpenResult | AccountManagementResult> {
    if (!actor?.uid)
        throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    if (!documentId(actor.token.employeeId) || actor.token.isAdmin !== true || !['taebaek', 'punghoe'].includes(String(actor.token.companyId)))
        throw new HttpsError('permission-denied', '현재 회사의 직원 계정으로 로그인해 주세요.');
    let parsed: ReturnType<typeof parse>;
    try {
        parsed = parse(input);
    }
    catch (error) {
        throw new HttpsError('invalid-argument', error instanceof Error ? error.message : '계정 원문을 확인해 주세요.');
    }
    const { reference, request, text, hash } = parsed;
    if (reference.companyId !== actor.token.companyId)
        throw new HttpsError('permission-denied', '현재 회사의 계정 처리 권한을 확인해 주세요.');
    const receiptRef = db.collection(ACCOUNT_MANAGEMENT_OPERATIONS).doc(accountManagementReceiptId(reference.companyId, actor.uid, reference.planId));
    const targetRef = db.collection(reference.kind === 'code' ? 'accountCodes' : 'accountGroups').doc(reference.targetId);
    const outcome = (status: AccountManagementResult['status'], requestHash: string | null, message: string): AccountManagementResult => ({ version: 1, reference, actorUid: actor.uid, status, requestHash, message });
    return db.runTransaction(async (tx) => {
        if (input.mode !== 'open') {
            const prior = await tx.get(receiptRef);
            if (prior.exists) {
                const data = prior.data()!;
                let result: AccountManagementResult;
                try {
                    result = normalizeAccountManagementResult({ version: data.version, reference: data.reference, actorUid: data.actorUid, status: data.status, requestHash: data.requestHash, message: data.message }, reference, actor.uid);
                    if (result.status === 'unknown')
                        throw Error();
                    if (result.requestHash === null) {
                        if (result.status !== 'cancelled' || data.requestText !== null)
                            throw Error();
                    }
                    else {
                        if (typeof data.requestText !== 'string' || sha(data.requestText) !== result.requestHash)
                            throw Error();
                        const original = normalizeAccountManagementRequest(JSON.parse(data.requestText));
                        if (serializeAccountManagementRequest(original) !== data.requestText || JSON.stringify(original.reference) !== JSON.stringify(reference))
                            throw Error();
                    }
                }
                catch {
                    throw new HttpsError('failed-precondition', '계정 처리 근거를 확인하지 못했습니다. 최초 원문을 보존해 주세요.');
                }
                if (hash !== undefined && result.requestHash !== null && hash !== result.requestHash)
                    throw new HttpsError('already-exists', '같은 계정 요청 번호의 최초 내용이 다릅니다.');
                return result;
            }
            if (input.mode === 'inspect')
                return outcome('unknown', null, '서버에 이 요청의 처리 기록이 아직 없습니다. 요청이 뒤늦게 도착할 수 있으니 같은 요청으로 결과를 다시 확인하거나 중단해 주세요.');
        }
        // 기존 자기 영수증은 직원 삭제 후에도 확인한다. 실제 새 쓰기·준비만 현재 실직원을 검사한다.
        const actorSnapshot = await tx.get(db.collection('employees').doc(actor.token.employeeId as string));
        if (!actorSnapshot.exists || (actorSnapshot.get('companyId') ?? 'taebaek') !== reference.companyId)
            throw new HttpsError('permission-denied', '현재 회사의 직원 정보를 확인해 주세요.');
        const writeReceipt = (result: AccountManagementResult): AccountManagementResult => {
            tx.create(receiptRef, { ...result, requestText: text, createdAt: new Date().toISOString() });
            return result;
        };
        if (input.mode === 'cancel')
            return writeReceipt(outcome('cancelled', null, '이 계정 요청을 중단했습니다. 늦게 도착한 같은 요청도 실행하지 않습니다.'));
        const target = await tx.get(targetRef), current = target.data();
        const operationName = request?.action === 'update' ? '수정' : '삭제';
        const issue = !target.exists ? `${operationName} 대상이 이미 없거나 바뀌었습니다. 현재 목록을 다시 확인해 주세요.` : current!.companyId !== reference.companyId ? `${operationName} 대상의 회사가 명시적으로 일치하지 않아 처리하지 않았습니다. 회사 정보를 확인해 주세요.` : null;
        const opening = target.exists ? accountManagementOpening(current!, reference.kind) : null;
        if (input.mode === 'open') {
            if (issue)
                throw new HttpsError('failed-precondition', issue);
            if (JSON.stringify(opening) !== JSON.stringify(input.opening))
                throw new HttpsError('failed-precondition', '선택한 이름·회사 정보가 바뀌었습니다. 최신 목록에서 다시 열어 주세요.');
            return { reference, actorUid: actor.uid, opening: opening!, expectedVersion: nativeVersion(target)! };
        }
        const reject = (message: string) => writeReceipt(outcome('rejected', hash!, message));
        if (request!.action === 'create') {
            if (target.exists) return reject('같은 번호의 계정이 이미 있어 등록하지 않았습니다. 현재 목록을 확인해 주세요.');
            const { id: _id, ...data } = request!.data!;
            tx.create(targetRef, { ...data, companyId: reference.companyId });
            return writeReceipt(outcome('applied', hash!, '계정 한 건을 등록했습니다.'));
        }
        if (issue) return reject(issue);
        if (nativeVersion(target) !== request!.expectedVersion) {
            return reject(`계정이 확인 후 변경되거나 다시 만들어져 ${operationName}하지 않았습니다. 최신 목록에서 다시 확인해 주세요.`);
        }
        if (request!.action === 'update') {
            const groupId = request!.patch!.groupId;
            if (reference.kind === 'code' && groupId) {
                if (!documentId(groupId)) return reject('이동할 그룹 번호를 확인해 주세요.');
                const group = await tx.get(db.collection('accountGroups').doc(groupId));
                if (!group.exists || group.get('companyId') !== reference.companyId)
                    return reject('이동할 그룹이 없거나 현재 회사와 다릅니다. 현재 그룹 목록을 확인한 뒤 다시 수정해 주세요.');
            }
            // 전체 문서의 native 버전은 검사하되 실제 쓰기는 사용자가 바꾼 허용 필드만 한다.
            const patch: Record<string, string | admin.firestore.FieldValue> = {};
            for (const [field, value] of Object.entries(request!.patch!)) {
                patch[field] = value === null ? admin.firestore.FieldValue.delete() : value;
            }
            tx.update(targetRef, patch);
            return writeReceipt(outcome('applied', hash!, '계정 한 건의 수정 항목을 저장했습니다.'));
        }
        tx.delete(targetRef);
        return writeReceipt(outcome('applied', hash!, '계정 한 건을 삭제했습니다.'));    });
}
export const accountManagementCommand = onCall({ region: 'asia-northeast3' }, request => executeAccountManagementCommand(admin.firestore(), request.auth, request.data));
