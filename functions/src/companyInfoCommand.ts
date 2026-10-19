import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { COMPANY_INFO_OPERATIONS, companyInfoOpening, normalizeCompanyInfoReference, normalizeCompanyInfoRequest, normalizeCompanyInfoOpenRequest, normalizeCompanyInfoResult, serializeCompanyInfoRequest, type CompanyInfoCommand, type CompanyInfoReference, type CompanyInfoRequest, type CompanyInfoResult, type CompanyInfoOpenResult, type CompanyInfoHistoryResult } from './shared/companyInfoCommand';
type Actor = {
    uid: string;
    token: Record<string, unknown>;
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const companyInfoReceiptId = (company: string, uid: string, plan: string) => sha(JSON.stringify([company, uid, plan]));
const scopeKey = (company: string, uid: string) => sha(JSON.stringify([company, uid]));
const nativeVersion = (s: admin.firestore.DocumentSnapshot) => s.updateTime ? `${s.updateTime.seconds}:${String(s.updateTime.nanoseconds).padStart(9, '0')}` : null;
function receipt(data: admin.firestore.DocumentData, reference: CompanyInfoReference, uid: string): CompanyInfoResult {
    const result = normalizeCompanyInfoResult({ version: data.version, reference: data.reference, actorUid: data.actorUid, status: data.status, requestHash: data.requestHash, message: data.message }, reference, uid);
    if (result.status === 'unknown')
        throw Error('확정 근거가 아닙니다.');
    if (result.requestHash === null) {
        if (result.status !== 'cancelled' || data.requestText !== null)
            throw Error('중단 근거가 다릅니다.');
    }
    else {
        if (typeof data.requestText !== 'string' || sha(data.requestText) !== result.requestHash)
            throw Error('원문 해시가 다릅니다.');
        const request = normalizeCompanyInfoRequest(JSON.parse(data.requestText));
        if (serializeCompanyInfoRequest(request) !== data.requestText || JSON.stringify(request.reference) !== JSON.stringify(reference))
            throw Error('원문이 다릅니다.');
    }
    return result;
}
export async function executeCompanyInfoCommand(db: admin.firestore.Firestore, actor: Actor | undefined, input: CompanyInfoCommand): Promise<CompanyInfoResult | CompanyInfoOpenResult | CompanyInfoHistoryResult> {
    if (!actor?.uid)
        throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    if (typeof actor.token.employeeId !== 'string' || !['taebaek', 'punghoe'].includes(String(actor.token.companyId)))
        throw new HttpsError('permission-denied', '현재 회사의 직원 계정으로 로그인해 주세요.');
    let reference: CompanyInfoReference | undefined, request: CompanyInfoRequest | undefined, text: string | null = null, hash: string | null = null;
    try {
        if (!input || !['open', 'apply', 'inspect', 'cancel', 'listHistory'].includes(input.mode))
            throw Error('회사정보 처리 종류를 확인해 주세요.');
        const fields = input.mode === 'apply' ? ['mode', 'request'] : input.mode === 'open' ? ['mode', 'reference', 'opening'] : input.mode === 'listHistory' ? ['mode', 'companyId', 'cursor'] : ['mode', 'reference'];
        if (Object.keys(input).some(k => !fields.includes(k)))
            throw Error('회사정보 명령 형식을 확인해 주세요.');
        if (input.mode === 'apply') {
            request = normalizeCompanyInfoRequest(input.request);
            reference = request.reference;
            text = serializeCompanyInfoRequest(request);
            hash = sha(text);
        }
        else if (input.mode === 'open')
            reference = normalizeCompanyInfoOpenRequest(input).reference;
        else if (input.mode !== 'listHistory')
            reference = normalizeCompanyInfoReference(input.reference);
        else if (!['taebaek', 'punghoe'].includes(input.companyId) || (input.cursor !== undefined && !/^[a-f0-9]{64}$/.test(input.cursor)))
            throw Error('처리이력 범위를 확인해 주세요.');
    }
    catch (e) {
        throw new HttpsError('invalid-argument', e instanceof Error ? e.message : '회사정보 입력을 확인해 주세요.');
    }
    const companyId = reference?.companyId || (input as Extract<CompanyInfoCommand, {
        mode: 'listHistory';
    }>).companyId;
    if (companyId !== actor.token.companyId)
        throw new HttpsError('permission-denied', '현재 회사의 회사정보만 처리할 수 있습니다.');
    if (input.mode === 'listHistory') {
        let query = db.collection(COMPANY_INFO_OPERATIONS).where('scopeKey', '==', scopeKey(companyId, actor.uid)).orderBy(admin.firestore.FieldPath.documentId()).limit(50);
        if (input.cursor)
            query = query.startAfter(input.cursor);
        const rows = await query.get();
        return { version: 1, companyId, actorUid: actor.uid, entries: rows.docs.map(doc => {
                const d = doc.data(), ref = normalizeCompanyInfoReference(d.reference);
                if (ref.companyId !== companyId)
                    throw new HttpsError('failed-precondition', '이력의 회사가 다릅니다.');
                return { result: receipt(d, ref, actor.uid), createdAt: d.createdAt };
            }), nextCursor: rows.size === 50 ? rows.docs[49].id : null };
    }
    const ref = reference!, receiptRef = db.collection(COMPANY_INFO_OPERATIONS).doc(companyInfoReceiptId(companyId, actor.uid, ref.planId));
    const targetRef = db.collection('settings').doc(companyId);
    const result = (status: CompanyInfoResult['status'], requestHash: string | null, message: string): CompanyInfoResult => ({ version: 1, reference: ref, actorUid: actor.uid, status, requestHash, message });
    return db.runTransaction(async (tx) => {
        if (input.mode !== 'open') {
            const prior = await tx.get(receiptRef);
            if (prior.exists) {
                let found: CompanyInfoResult;
                try {
                    found = receipt(prior.data()!, ref, actor.uid);
                }
                catch {
                    throw new HttpsError('failed-precondition', '회사정보 처리 근거를 확인하지 못했습니다. 최초 원문을 보존해 주세요.');
                }
                if (hash !== null && found.requestHash !== null && hash !== found.requestHash)
                    throw new HttpsError('already-exists', '같은 요청 번호의 최초 회사정보 내용이 다릅니다.');
                return found;
            }
            if (input.mode === 'inspect')
                return result('unknown', null, '서버에 이 요청의 처리 기록이 아직 없습니다. 늦게 도착할 수 있으니 같은 요청으로 다시 확인하거나 미처리 요청을 중단해 주세요.');
        }
        const finish = (outcome: CompanyInfoResult) => { tx.create(receiptRef, { ...outcome, requestText: text, scopeKey: scopeKey(companyId, actor.uid), createdAt: new Date().toISOString() }); return outcome; };
        if (input.mode === 'cancel')
            return finish(result('cancelled', null, '이 회사정보 요청을 중단했습니다. 이미 적용된 다른 요청은 되돌리지 않습니다.'));
        const target = await tx.get(targetRef), raw = target.data();
        if (target.exists && raw!.companyId !== companyId) {
            if (input.mode === 'open')
                throw new HttpsError('failed-precondition', '저장된 회사정보의 소속 회사가 일치하지 않습니다.');
            return finish(result('rejected', hash, '저장된 회사정보의 소속 회사가 일치하지 않아 수정하지 않았습니다. 현재 정보를 확인해 주세요.'));
        }
        if (input.mode === 'open') {
            const opening = companyInfoOpening(raw);
            if (JSON.stringify(opening) !== JSON.stringify(input.opening))
                throw new HttpsError('failed-precondition', '선택한 회사정보가 바뀌었습니다. 현재 정보를 다시 열어 주세요.');
            return { reference: ref, actorUid: actor.uid, opening, expectedVersion: nativeVersion(target) };
        }
        if (nativeVersion(target) !== request!.expectedVersion)
            return finish(result('rejected', hash, '회사정보가 확인 후 변경되거나 다시 만들어져 수정하지 않았습니다. 현재 정보를 다시 열어 주세요.'));
        // 숨은 비밀번호와 미지 필드는 반환하지 않고, 변경한 공개 필드만 쓴다.
        if (target.exists)
            tx.update(targetRef, request!.patch);
        else
            tx.create(targetRef, { ...request!.patch, companyId });
        return finish(result('applied', hash, '회사정보의 변경 항목을 저장했습니다.'));
    });
}
export const companyInfoCommand = onCall({ region: 'asia-northeast3' }, request => executeCompanyInfoCommand(admin.firestore(), request.auth, request.data));
