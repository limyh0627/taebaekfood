import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { protectInventoryWriterPatch } from './shared/inventoryWriterProtocol';
import { PRODUCTION_RECORD_OPERATIONS, productionRecordOpening, productionRecordSourceEvidence, normalizeProductionRecordReference, normalizeProductionRecordRequest, normalizeProductionRecordOpenRequest, normalizeProductionRecordResult, serializeProductionRecordRequest, type ProductionRecordCommand, type ProductionRecordReference, type ProductionRecordRequest, type ProductionRecordResult, type ProductionRecordOpenResult, type ProductionRecordHistoryResult, type ProductionRecordSourceVersion } from './shared/productionRecordCommand';
import type { CatalogValueAdapter } from './shared/catalogOrderReferenceProof';
type Actor = {
    uid: string;
    token: Record<string, unknown>;
};
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
export const productionRecordReceiptId = (ref: ProductionRecordReference, uid: string) => sha(JSON.stringify([ref.companyId, uid, ref.planId, ref.targetId]));
const scopeKey = (company: string, uid: string) => sha(JSON.stringify([company, uid]));
const version = (snapshot: admin.firestore.DocumentSnapshot) => snapshot.updateTime ? `${snapshot.updateTime.seconds}:${String(snapshot.updateTime.nanoseconds).padStart(9, '0')}` : null;
const codec: Pick<CatalogValueAdapter, 'special'> = { special(value) {
        if (value instanceof admin.firestore.Timestamp)
            return ['timestamp', value.seconds, value.nanoseconds];
        if (value instanceof admin.firestore.DocumentReference)
            return ['reference', value.path];
        if (value instanceof admin.firestore.GeoPoint)
            return ['geo', value.latitude, value.longitude];
        if (Buffer.isBuffer(value))
            return ['bytes', [...value]];
        return undefined;
    } };
function readReceipt(data: admin.firestore.DocumentData, ref: ProductionRecordReference, uid: string): ProductionRecordResult {
    const result = normalizeProductionRecordResult({ version: data.version, reference: data.reference, actorUid: data.actorUid, status: data.status, requestHash: data.requestHash, message: data.message }, ref, uid);
    if (result.status === 'unknown')
        throw Error('생산기록 확정 근거가 아닙니다.');
    if (result.requestHash === null) {
        if (result.status !== 'cancelled' || data.requestText !== null || data.action !== 'cancel')
            throw Error('생산기록 중단 근거가 다릅니다.');
    }
    else {
        if (typeof data.requestText !== 'string' || sha(data.requestText) !== result.requestHash)
            throw Error('생산기록 원문 해시가 다릅니다.');
        const request = normalizeProductionRecordRequest(JSON.parse(data.requestText));
        if (serializeProductionRecordRequest(request) !== data.requestText || JSON.stringify(request.reference) !== JSON.stringify(ref) || request.action !== data.action)
            throw Error('생산기록 최초 원문이 다릅니다.');
    }
    return result;
}
export async function executeProductionRecordCommand(db: admin.firestore.Firestore, actor: Actor | undefined, input: ProductionRecordCommand): Promise<ProductionRecordResult | ProductionRecordOpenResult | ProductionRecordHistoryResult> {
    if (!actor?.uid)
        throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    if (typeof actor.token.employeeId !== 'string' || !['taebaek', 'punghoe'].includes(String(actor.token.companyId)))
        throw new HttpsError('permission-denied', '현재 회사 직원 계정으로 로그인해 주세요.');
    let reference: ProductionRecordReference | undefined, request: ProductionRecordRequest | undefined, opened: Extract<ProductionRecordCommand, {
        mode: 'open';
    }> | undefined;
    let text: string | null = null, hash: string | null = null;
    try {
        if (!input || !['open', 'apply', 'inspect', 'cancel', 'listHistory'].includes(input.mode))
            throw Error('생산기록 처리 종류를 확인해 주세요.');
        const fields = input.mode === 'apply' ? ['mode', 'request'] : input.mode === 'open' ? ['mode', 'reference', 'opening', 'source'] : input.mode === 'listHistory' ? ['mode', 'companyId', 'cursor'] : ['mode', 'reference'];
        if (Object.keys(input).some(key => !fields.includes(key)))
            throw Error('생산기록 명령 형식이 다릅니다.');
        if (input.mode === 'apply') {
            request = normalizeProductionRecordRequest(input.request);
            reference = request.reference;
            text = serializeProductionRecordRequest(request);
            hash = sha(text);
        }
        else if (input.mode === 'open') {
            opened = normalizeProductionRecordOpenRequest(input);
            reference = opened.reference;
        }
        else if (input.mode !== 'listHistory')
            reference = normalizeProductionRecordReference(input.reference);
        else if (!['taebaek', 'punghoe'].includes(input.companyId) || (input.cursor !== undefined && !/^[a-f0-9]{64}$/.test(input.cursor)))
            throw Error('생산기록 처리이력 범위를 확인해 주세요.');
    }
    catch (error) {
        throw new HttpsError('invalid-argument', error instanceof Error ? error.message : '생산기록 입력을 확인해 주세요.');
    }
    const companyId = reference?.companyId ?? (input as Extract<ProductionRecordCommand, {
        mode: 'listHistory';
    }>).companyId;
    if (companyId !== actor.token.companyId)
        throw new HttpsError('permission-denied', '현재 회사의 생산기록만 처리할 수 있습니다.');
    if (input.mode === 'listHistory') {
        let query = db.collection(PRODUCTION_RECORD_OPERATIONS).where('scopeKey', '==', scopeKey(companyId, actor.uid)).orderBy(admin.firestore.FieldPath.documentId()).limit(50);
        if (input.cursor)
            query = query.startAfter(input.cursor);
        const rows = await query.get();
        return { version: 1, companyId, actorUid: actor.uid, entries: rows.docs.map(row => {
                const data = row.data(), ref = normalizeProductionRecordReference(data.reference);
                if (ref.companyId !== companyId || typeof data.createdAt !== 'string')
                    throw new HttpsError('failed-precondition', '생산기록 이력 범위를 확인하지 못했습니다.');
                return { result: readReceipt(data, ref, actor.uid), action: data.action, createdAt: data.createdAt };
            }), nextCursor: rows.size === 50 ? rows.docs[49].id : null };
    }
    const ref = reference!, receiptRef = db.collection(PRODUCTION_RECORD_OPERATIONS).doc(productionRecordReceiptId(ref, actor.uid));
    const targetRef = db.collection('productionRecords').doc(ref.targetId);
    const result = (status: ProductionRecordResult['status'], requestHash: string | null, message: string): ProductionRecordResult => ({ version: 1, reference: ref, actorUid: actor.uid, status, requestHash, message });
    return db.runTransaction(async (tx) => {
        if (input.mode !== 'open') {
            const prior = await tx.get(receiptRef);
            if (prior.exists) {
                let found: ProductionRecordResult;
                try {
                    found = readReceipt(prior.data()!, ref, actor.uid);
                }
                catch {
                    throw new HttpsError('failed-precondition', '생산기록 처리 근거를 확인하지 못했습니다. 최초 원문을 보존해 주세요.');
                }
                if (hash !== null && found.requestHash !== null && found.requestHash !== hash)
                    throw new HttpsError('already-exists', '같은 요청 번호의 최초 생산기록 내용이 다릅니다.');
                return found;
            }
            if (input.mode === 'inspect')
                return result('unknown', null, '서버에 이 요청의 처리 기록이 아직 없습니다. 늦게 도착할 수 있으니 같은 요청으로 다시 확인하거나 미처리 요청을 중단해 주세요.');
        }
        const finish = (outcome: ProductionRecordResult) => {
            tx.create(receiptRef, { ...outcome, requestText: text, action: request?.action ?? 'cancel', scopeKey: scopeKey(companyId, actor.uid), createdAt: new Date().toISOString() });
            return outcome;
        };
        if (input.mode === 'cancel')
            return finish(result('cancelled', null, '미처리 생산기록 요청을 중단했습니다. 이미 적용된 생산기록은 되돌리지 않습니다.'));
        const target = await tx.get(targetRef);
        const reject = (message: string) => { if (input.mode === 'open')
            throw new HttpsError('failed-precondition', message); return finish(result('rejected', hash, message)); };
        if (target.exists && target.get('companyId') !== companyId)
            return reject('생산기록의 소속 회사가 일치하지 않아 처리하지 않았습니다. 소속 정보를 확인해 주세요.');
        const source = input.mode === 'open' ? opened!.source : request!.action === 'sync' ? request!.source : undefined;
        let sourceSnapshot: admin.firestore.DocumentSnapshot | undefined;
        if (source) {
            sourceSnapshot = await tx.get(db.collection('orders').doc(source.orderId));
            if (!sourceSnapshot.exists || sourceSnapshot.get('companyId') !== companyId)
                return reject('동기화할 원래 주문과 소속 회사를 확인하지 못했습니다. 현재 주문을 다시 확인해 주세요.');
            const raw = sourceSnapshot.data()!;
            if (raw.status !== 'DELIVERED' || raw.partnerName === '생산기록' || Object.prototype.hasOwnProperty.call(raw, 'productionRecordIndex'))
                return reject('원래 주문은 이 동기화 경로의 대상이 아닙니다. 현재 주문의 생산기록을 확인해 주세요.');
            if (JSON.stringify(productionRecordSourceEvidence(raw, codec)) !== JSON.stringify(source.evidence))
                return reject('주문의 품목·수량·날짜 또는 생산 근거가 처음 선택한 내용과 다릅니다. 최신 주문으로 다시 계획해 주세요.');
            if (input.mode === 'apply' && version(sourceSnapshot) !== (source as ProductionRecordSourceVersion).expectedVersion)
                return reject('원래 주문이 확인 후 변경됐습니다. 최초 동기화 원문을 보존하고 현재 주문을 다시 확인해 주세요.');
        }
        if (input.mode === 'open') {
            const opening = productionRecordOpening(target.data(), codec);
            if (JSON.stringify(opening) !== JSON.stringify(opened!.opening))
                return reject('선택한 생산기록이 바뀌었습니다. 현재 목록에서 다시 열어 주세요.');
            return { reference: ref, actorUid: actor.uid, opening, expectedVersion: version(target), ...(source && sourceSnapshot ? { source: { ...source, expectedVersion: version(sourceSnapshot)! } } : {}) };
        }
        const req = request!;
        if (version(target) !== req.expectedVersion)
            return reject('생산기록이 확인 후 수정·삭제되거나 다시 만들어졌습니다. 현재 목록에서 다시 열어 주세요.');
        if (req.action === 'create' || req.action === 'sync') {
            if (target.exists)
                return reject('같은 번호의 생산기록이 이미 있어 덮어쓰지 않았습니다. 현재 목록을 확인해 주세요.');
            if (req.action === 'sync' && ref.targetId !== `pr-${req.source.orderId}-${req.record.itemId}`)
                return reject('동기화 기록 번호와 원래 주문·품목이 일치하지 않습니다.');
            tx.create(targetRef, protectInventoryWriterPatch(undefined, { ...req.record, companyId }));
        }
        else {
            if (!target.exists)
                return reject('수정·삭제할 생산기록이 없어 처리하지 않았습니다. 현재 목록을 확인해 주세요.');
            if (req.action === 'date') {
                let patch: Record<string, unknown>;
                try {
                    patch = protectInventoryWriterPatch(target.data(), { date: req.date });
                }
                catch {
                    return reject('생산기록의 쓰기 버전을 확인하지 못해 날짜를 수정하지 않았습니다.');
                }
                tx.update(targetRef, patch);
            }
            else
                tx.delete(targetRef);
        }
        const itemName = req.action === 'create' || req.action === 'sync' ? req.record.itemName : target.get('itemName');
        const label = typeof itemName === 'string' && itemName ? `${itemName} 생산기록` : '생산기록';
        return finish(result('applied', hash, req.action === 'delete' ? `${label}을 삭제했습니다.` : req.action === 'date' ? `${label}의 생산일을 변경했습니다.` : `${label}을 등록했습니다.`));
    });
}
export const productionRecordCommand = onCall({ region: 'asia-northeast3' }, request => executeProductionRecordCommand(admin.firestore(), request.auth, request.data));
