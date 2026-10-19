import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { encodeCatalogValue } from './shared/catalogOrderReferenceProof';
import { PARTNER_EDIT_OPERATIONS, partnerEditOpening, normalizePartnerEditReference, normalizePartnerEditRequest, normalizePartnerEditOpenRequest, normalizePartnerEditResult, serializePartnerEditRequest, type PartnerEditCommand, type PartnerEditReference, type PartnerEditRequest, type PartnerEditResult, type PartnerEditOpenResult, type PartnerEditHistoryResult } from './shared/partnerEditCommand';
type Actor = {
    uid: string;
    token: Record<string, unknown>;
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const partnerEditReceiptId = (company: string, uid: string, plan: string, target: string) => sha(JSON.stringify([company, uid, plan, target]));
const scopeKey = (company: string, uid: string) => sha(JSON.stringify([company, uid]));
const nativeVersion = (s: admin.firestore.DocumentSnapshot) => s.updateTime ? `${s.updateTime.seconds}:${String(s.updateTime.nanoseconds).padStart(9, '0')}` : null;
function receipt(data: admin.firestore.DocumentData, reference: PartnerEditReference, uid: string): PartnerEditResult {
    const result = normalizePartnerEditResult({ version: data.version, reference: data.reference, actorUid: data.actorUid, status: data.status, requestHash: data.requestHash, message: data.message }, reference, uid);
    if (result.status === 'unknown')
        throw Error('확정 근거가 아닙니다.');
    if (result.requestHash === null) {
        if (result.status !== 'cancelled' || data.requestText !== null)
            throw Error('중단 근거가 다릅니다.');
    }
    else {
        if (typeof data.requestText !== 'string' || sha(data.requestText) !== result.requestHash)
            throw Error('원문 해시가 다릅니다.');
        const request = normalizePartnerEditRequest(JSON.parse(data.requestText));
        if (serializePartnerEditRequest(request) !== data.requestText || JSON.stringify(request.reference) !== JSON.stringify(reference))
            throw Error('원문이 다릅니다.');
    }
    return result;
}
const own = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);
const shipMethod = (value: unknown) => ['배송', '화물', '수령', '택배'].includes(String(value));
const sameValue = (left: unknown, right: unknown) => left === right || left !== undefined && right !== undefined && JSON.stringify(encodeCatalogValue(left)) === JSON.stringify(encodeCatalogValue(right));
function validatePatch(raw: admin.firestore.DocumentData, patch: import('./shared/partnerEditCommand').PartnerEditPatch) {
    for (const [field, allowed] of [['partnerType', ['매출처', '매입처', '매출+매입처', '금융기관']], ['type', ['일반', '택배', '스마트스토어']], ['defaultShipMethod', ['배송', '화물', '수령', '택배']]] as const) {
        if (own(patch, field) && patch[field] !== raw[field] && !allowed.some(value => value === patch[field]))
            throw Error('거래처 구분·유형·배송방식 변경값을 확인해 주세요.');
    }
}
function mergeShipTos(raw: admin.firestore.DocumentData, rows: import('./shared/partnerEditCommand').PartnerEditShipTo[], nextPartnerType?: string) {
    const before = raw.shipTos === undefined ? [] : raw.shipTos;
    if (!Array.isArray(before) || before.some(row => !row || typeof row !== 'object' || typeof row.id !== 'string'))
        throw Error('기존 배송지 원문을 확인하지 못해 변경하지 않았습니다.');
    const originals = new Map(before.map(row => [row.id, row]));
    if (originals.size !== before.length || new Set(rows.map(row => row.id)).size !== rows.length)
        throw Error('배송지 번호가 중복되어 변경하지 않았습니다.');
    if (before.some(row => !rows.some(next => next.id === row.id)))
        throw Error('기존 배송지는 삭제하지 않고 보관해 주세요. 지난 주문의 연결을 유지했습니다.');
    const type = nextPartnerType === undefined ? raw.partnerType : nextPartnerType;
    const shipping = type === undefined || type === '매출처' || type === '매출+매입처';
    return rows.map(row => {
        const old = originals.get(row.id);
        if (!old) {
            if (typeof row.name !== 'string' || !row.name.trim() || row.name !== row.name.trim() || (shipping && !shipMethod(row.defaultShipMethod)) || (own(row, 'defaultShipMethod') && !shipMethod(row.defaultShipMethod)) || (own(row, 'archived') && typeof row.archived !== 'boolean'))
                throw Error('새 배송지의 이름과 배송방식을 확인해 주세요.');
            if (rows.some(other => other !== row && other.name === row.name && !other.archived && !row.archived))
                throw Error('같은 이름의 사용 중인 배송지가 있습니다. 기존 배송지를 확인해 주세요.');
            return { ...row };
        }
        if (own(row, 'name') && !sameValue(row.name, old.name) && typeof row.name !== 'string')
            throw Error('배송지 이름을 확인해 주세요.');
        if (own(row, 'archived') && !sameValue(row.archived, old.archived) && typeof row.archived !== 'boolean')
            throw Error('배송지 보관 상태를 확인해 주세요.');
        if (own(row, 'defaultShipMethod') && !sameValue(row.defaultShipMethod, old.defaultShipMethod) && !shipMethod(row.defaultShipMethod))
            throw Error('배송지 배송방식을 확인해 주세요.');
        return { ...old, ...row };
    });
}
export async function executePartnerEditCommand(db: admin.firestore.Firestore, actor: Actor | undefined, input: PartnerEditCommand): Promise<PartnerEditResult | PartnerEditOpenResult | PartnerEditHistoryResult> {
    if (!actor?.uid)
        throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    if (typeof actor.token.employeeId !== 'string' || !['taebaek', 'punghoe'].includes(String(actor.token.companyId)))
        throw new HttpsError('permission-denied', '현재 회사의 직원 계정으로 로그인해 주세요.');
    let reference: PartnerEditReference | undefined, request: PartnerEditRequest | undefined, text: string | null = null, hash: string | null = null;
    try {
        if (!input || !['open', 'apply', 'inspect', 'cancel', 'listHistory'].includes(input.mode))
            throw Error('거래처 처리 종류를 확인해 주세요.');
        const fields = input.mode === 'apply' ? ['mode', 'request'] : input.mode === 'open' ? ['mode', 'reference', 'opening'] : input.mode === 'listHistory' ? ['mode', 'companyId', 'cursor'] : ['mode', 'reference'];
        if (Object.keys(input).some(k => !fields.includes(k)))
            throw Error('거래처 명령 형식을 확인해 주세요.');
        if (input.mode === 'apply') {
            request = normalizePartnerEditRequest(input.request);
            reference = request.reference;
            text = serializePartnerEditRequest(request);
            hash = sha(text);
        }
        else if (input.mode === 'open')
            reference = normalizePartnerEditOpenRequest(input).reference;
        else if (input.mode !== 'listHistory')
            reference = normalizePartnerEditReference(input.reference);
        else if (!['taebaek', 'punghoe'].includes(input.companyId) || (input.cursor !== undefined && !/^[a-f0-9]{64}$/.test(input.cursor)))
            throw Error('처리이력 범위를 확인해 주세요.');
    }
    catch (e) {
        throw new HttpsError('invalid-argument', e instanceof Error ? e.message : '거래처 입력을 확인해 주세요.');
    }
    const companyId = reference?.companyId || (input as Extract<PartnerEditCommand, {
        mode: 'listHistory';
    }>).companyId;
    if (companyId !== actor.token.companyId)
        throw new HttpsError('permission-denied', '현재 회사의 거래처만 처리할 수 있습니다.');
    if (input.mode === 'listHistory') {
        let query = db.collection(PARTNER_EDIT_OPERATIONS).where('scopeKey', '==', scopeKey(companyId, actor.uid)).orderBy(admin.firestore.FieldPath.documentId()).limit(50);
        if (input.cursor)
            query = query.startAfter(input.cursor);
        const rows = await query.get();
        return { version: 1, companyId, actorUid: actor.uid, entries: rows.docs.map(doc => {
                const d = doc.data(), ref = normalizePartnerEditReference(d.reference);
                if (ref.companyId !== companyId)
                    throw new HttpsError('failed-precondition', '이력의 회사가 다릅니다.');
                return { result: receipt(d, ref, actor.uid), createdAt: d.createdAt };
            }), nextCursor: rows.size === 50 ? rows.docs[49].id : null };
    }
    const ref = reference!, receiptRef = db.collection(PARTNER_EDIT_OPERATIONS).doc(partnerEditReceiptId(companyId, actor.uid, ref.planId, ref.targetId));
    const targetRef = db.collection('partners').doc(ref.targetId);
    const result = (status: PartnerEditResult['status'], requestHash: string | null, message: string): PartnerEditResult => ({ version: 1, reference: ref, actorUid: actor.uid, status, requestHash, message });
    return db.runTransaction(async (tx) => {
        if (input.mode !== 'open') {
            const prior = await tx.get(receiptRef);
            if (prior.exists) {
                let found: PartnerEditResult;
                try {
                    found = receipt(prior.data()!, ref, actor.uid);
                }
                catch {
                    throw new HttpsError('failed-precondition', '거래처 처리 근거를 확인하지 못했습니다. 최초 원문을 보존해 주세요.');
                }
                if (hash !== null && found.requestHash !== null && hash !== found.requestHash)
                    throw new HttpsError('already-exists', '같은 요청 번호의 최초 거래처 내용이 다릅니다.');
                return found;
            }
            if (input.mode === 'inspect')
                return result('unknown', null, '서버에 이 요청의 처리 기록이 아직 없습니다. 늦게 도착할 수 있으니 같은 요청으로 다시 확인하거나 미처리 요청을 중단해 주세요.');
        }
        const finish = (outcome: PartnerEditResult) => { tx.create(receiptRef, { ...outcome, requestText: text, scopeKey: scopeKey(companyId, actor.uid), createdAt: new Date().toISOString() }); return outcome; };
        if (input.mode === 'cancel')
            return finish(result('cancelled', null, '이 거래처 요청을 중단했습니다. 이미 적용된 다른 요청은 되돌리지 않습니다.'));
        const target = await tx.get(targetRef), raw = target.data();
        if (!target.exists || raw!.companyId !== companyId || raw!.archived === true) {
            if (input.mode === 'open')
                throw new HttpsError('failed-precondition', '선택한 거래처가 없거나 소속 회사·보관 상태가 달라 편집할 수 없습니다.');
            return finish(result('rejected', hash, '거래처가 없거나 소속 회사·보관 상태가 달라 수정하지 않았습니다. 현재 목록을 확인해 주세요.'));
        }
        if (input.mode === 'open') {
            const opening = partnerEditOpening(raw!);
            if (JSON.stringify(opening) !== JSON.stringify(input.opening))
                throw new HttpsError('failed-precondition', '선택한 거래처가 바뀌었습니다. 현재 정보를 다시 열어 주세요.');
            return { reference: ref, actorUid: actor.uid, opening, expectedVersion: nativeVersion(target)! };
        }
        if (nativeVersion(target) !== request!.expectedVersion)
            return finish(result('rejected', hash, '거래처가 확인 후 변경되거나 다시 만들어져 수정하지 않았습니다. 현재 정보를 다시 열어 주세요.'));
        const patch: admin.firestore.UpdateData<admin.firestore.DocumentData> = { ...request!.patch };
        try {
            validatePatch(raw!, request!.patch);
            if (request!.patch.shipTos)
                patch.shipTos = mergeShipTos(raw!, request!.patch.shipTos, request!.patch.partnerType);
        }
        catch (error) {
            return finish(result('rejected', hash, error instanceof Error ? error.message : '배송지 변경 내용을 확인해 주세요.'));
        }
        // 원문에 없는 필드와 미지 필드는 재작성하지 않고 공개 변경 필드만 patch한다.
        tx.update(targetRef, patch);
        const name = request!.patch.name ?? raw!.name;
        return finish(result('applied', hash, (typeof name === 'string' && name.trim() ? name : '거래처') + '의 변경 항목을 저장했습니다.'));
    });
}
export const partnerEditCommand = onCall({ region: 'asia-northeast3' }, request => executePartnerEditCommand(admin.firestore(), request.auth, request.data));
