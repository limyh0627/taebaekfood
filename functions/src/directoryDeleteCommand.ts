import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { documentId } from './shared/documentId';
import { retirementProfileId, RETIREMENT_COLLECTIONS } from './shared/retirementBenefit';
import { DIRECTORY_DELETE_OPERATIONS, directoryDeleteOpening, normalizeDirectoryDeleteReference, normalizeDirectoryDeleteRequest, normalizeDirectoryDeleteResult, serializeDirectoryDeleteRequest, type DirectoryDeleteCommand, type DirectoryDeletePreview, type DirectoryDeleteReference, type DirectoryDeleteRequest, type DirectoryDeleteResult } from './shared/directoryDeleteCommand';
type Actor = {
    uid: string;
    token: Record<string, unknown>;
};
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
export const directoryDeleteReceiptId = (companyId: string, actorUid: string, planId: string): string => sha(JSON.stringify([companyId, actorUid, planId]));
// 연결 정리 명령과 같은 native updateTime 정밀도를 사용한다. 밀리초 변환은 재생성을 놓칠 수 있다.
const nativeVersion = (snapshot: admin.firestore.DocumentSnapshot): string | null => snapshot.updateTime ? `${snapshot.updateTime.seconds}:${String(snapshot.updateTime.nanoseconds).padStart(9, '0')}` : null;
function parse(input: DirectoryDeleteCommand): {
    reference: DirectoryDeleteReference;
    request?: DirectoryDeleteRequest;
    text: string | null;
    hash?: string;
} {
    if (!input || !['preview', 'apply', 'inspect', 'cancel'].includes(input.mode))
        throw Error('삭제 처리 종류를 확인해 주세요.');
    const fields = input.mode === 'apply' ? ['mode', 'request'] : input.mode === 'preview' ? ['mode', 'reference', 'opening'] : ['mode', 'reference', 'requestHash'];
    if (Object.keys(input).some(key => !fields.includes(key)))
        throw Error('삭제 명령 형식이 다릅니다.');
    if (input.mode === 'apply') {
        const request = normalizeDirectoryDeleteRequest(input.request), text = serializeDirectoryDeleteRequest(request);
        return { reference: request.reference, request, text, hash: sha(text) };
    }
    const reference = normalizeDirectoryDeleteReference(input.reference);
    if (input.mode === 'preview') {
        // 같은 정본 검증을 사용하되 버전은 아직 읽기 전이므로 검증용 자리값만 둔다.
        normalizeDirectoryDeleteRequest({ version: 1, reference, opening: input.opening, expectedVersion: '0:000000000' });
        return { reference, text: null };
    }
    if (input.requestHash !== undefined && !/^[a-f0-9]{64}$/.test(input.requestHash))
        throw Error('삭제 최초 원문 해시를 확인해 주세요.');
    return { reference, text: null, hash: input.requestHash };
}
/** 거래처·직원 한 건의 삭제와 처리 근거를 함께 확정한다. 다른 연결을 정리하지 않는다. */
export async function executeDirectoryDeleteCommand(db: admin.firestore.Firestore, actor: Actor | undefined, input: DirectoryDeleteCommand): Promise<DirectoryDeletePreview | DirectoryDeleteResult> {
    if (!actor?.uid)
        throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    if (!documentId(actor.token.employeeId) || !['taebaek', 'punghoe'].includes(String(actor.token.companyId)))
        throw new HttpsError('permission-denied', '현재 회사의 직원 계정으로 로그인해 주세요.');
    let parsed: ReturnType<typeof parse>;
    try {
        parsed = parse(input);
    }
    catch (error) {
        throw new HttpsError('invalid-argument', error instanceof Error ? error.message : '삭제 원문을 확인해 주세요.');
    }
    const { reference, request, text, hash } = parsed;
    if (reference.companyId !== actor.token.companyId || reference.kind === 'employee' && actor.token.isAdmin !== true)
        throw new HttpsError('permission-denied', '현재 회사의 삭제 권한을 확인해 주세요.');
    const receiptRef = db.collection(DIRECTORY_DELETE_OPERATIONS).doc(directoryDeleteReceiptId(reference.companyId, actor.uid, reference.planId));
    const targetRef = db.collection(reference.kind === 'employee' ? 'employees' : 'partners').doc(reference.targetId);
    const outcome = (status: DirectoryDeleteResult['status'], requestHash: string | null, message: string): DirectoryDeleteResult => ({ version: 1, reference, actorUid: actor.uid, status, requestHash, message });
    return db.runTransaction(async (tx) => {
        if (input.mode !== 'preview') {
            const prior = await tx.get(receiptRef);
            if (prior.exists) {
                const data = prior.data()!;
                let result: DirectoryDeleteResult;
                try {
                    result = normalizeDirectoryDeleteResult({ version: data.version, reference: data.reference, actorUid: data.actorUid, status: data.status, requestHash: data.requestHash, message: data.message }, reference, actor.uid);
                    if (result.status === 'unknown')
                        throw Error();
                    if (result.requestHash === null) {
                        if (result.status !== 'cancelled' || data.requestText !== null)
                            throw Error();
                    }
                    else {
                        if (typeof data.requestText !== 'string' || sha(data.requestText) !== result.requestHash)
                            throw Error();
                        const original = normalizeDirectoryDeleteRequest(JSON.parse(data.requestText));
                        if (serializeDirectoryDeleteRequest(original) !== data.requestText || JSON.stringify(original.reference) !== JSON.stringify(reference))
                            throw Error();
                    }
                }
                catch {
                    throw new HttpsError('failed-precondition', '삭제 처리 근거를 확인하지 못했습니다. 최초 원문을 보존해 주세요.');
                }
                if (hash !== undefined && result.requestHash !== null && hash !== result.requestHash)
                    throw new HttpsError('already-exists', '같은 삭제 요청 번호의 최초 내용이 다릅니다.');
                return result;
            }
            if (input.mode === 'inspect')
                return outcome('unknown', null, '삭제 결과를 확인하지 못했습니다. 현재 문서가 없다는 이유만으로 완료를 단정하지 않습니다. 최초 원문을 보존한 채 결과를 다시 확인하거나 요청을 중단해 주세요.');
        }
        // 기존 자기 영수증은 직원 삭제 후에도 확인한다. 실제 새 쓰기·준비만 현재 실직원을 검사한다.
        const actorSnapshot = await tx.get(db.collection('employees').doc(actor.token.employeeId as string));
        if (!actorSnapshot.exists || (actorSnapshot.get('companyId') ?? 'taebaek') !== reference.companyId)
            throw new HttpsError('permission-denied', '현재 회사의 직원 정보를 확인해 주세요.');
        const writeReceipt = (result: DirectoryDeleteResult): DirectoryDeleteResult => {
            tx.create(receiptRef, { ...result, requestText: text, createdAt: new Date().toISOString() });
            return result;
        };
        if (input.mode === 'cancel')
            return writeReceipt(outcome('cancelled', null, '이 삭제 요청을 중단했습니다. 늦게 도착한 같은 요청도 실행하지 않습니다.'));
        const target = await tx.get(targetRef), current = target.data();
        const issue = !target.exists ? '삭제 대상이 이미 없거나 바뀌었습니다. 현재 목록을 다시 확인해 주세요.' : current!.companyId !== reference.companyId ? '삭제 대상의 회사가 명시적으로 일치하지 않아 삭제하지 않았습니다. 회사 정보를 확인해 주세요.' : null;
        const opening = target.exists ? directoryDeleteOpening(current!) : null;
        if (input.mode === 'preview') {
            if (issue)
                throw new HttpsError('failed-precondition', issue);
            if (JSON.stringify(opening) !== JSON.stringify(input.opening))
                throw new HttpsError('failed-precondition', '선택한 이름·회사 정보가 바뀌었습니다. 최신 목록에서 다시 열어 주세요.');
            return { reference, actorUid: actor.uid, opening: opening!, expectedVersion: nativeVersion(target)! };
        }
        const reject = (message: string) => writeReceipt(outcome('rejected', hash!, message));
        if (issue)
            return reject(issue);
        if (nativeVersion(target) !== request!.expectedVersion || JSON.stringify(opening) !== JSON.stringify(request!.opening))
            return reject('삭제 대상이 확인 후 변경되거나 다시 만들어졌습니다. 이 요청을 중단하고 최신 목록에서 다시 확인해 주세요.');
        if (reference.kind === 'employee') {
            const profile = await tx.get(db.collection(RETIREMENT_COLLECTIONS.profiles).doc(retirementProfileId(reference.companyId, reference.targetId)));
            if (profile.exists)
                return reject('퇴직금 관리 대상 직원은 삭제할 수 없습니다. 직원 상태를 퇴사로 변경하고 퇴직금 장부를 확인해 주세요.');
        }
        tx.delete(targetRef);
        return writeReceipt(outcome('applied', hash!, reference.kind === 'employee' ? '선택한 직원 한 건을 삭제했습니다.' : '선택한 거래처 한 건을 삭제했습니다.'));
    });
}
export const directoryDeleteCommand = onCall({ region: 'asia-northeast3' }, request => executeDirectoryDeleteCommand(admin.firestore(), request.auth, request.data));
