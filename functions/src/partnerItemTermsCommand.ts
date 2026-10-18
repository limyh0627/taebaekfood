import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { documentId } from './shared/documentId';
import { buildBomIndex } from './shared/bomIndex';
import { unpackStockComponent } from './shared/stockUnitMeasure';
import { decodeCatalogValue, type CatalogValueAdapter } from './shared/catalogOrderReferenceProof';
import { PARTNER_ITEM_TERMS_OPERATIONS, PARTNER_ITEM_TERMS_FIELDS, normalizePartnerItemTermsReference, normalizePartnerItemTermsPreviewInput, normalizePartnerItemTermsPreview, normalizePartnerItemTermsRequest, normalizePartnerItemTermsResult, serializePartnerItemTermsRequest, serializePartnerItemTermsNotice, partnerItemTermsCanonical, partnerItemTermsOpening, partnerItemTermsExpected, type PartnerItemTermsCommand, type PartnerItemTermsReference, type PartnerItemTermsPreviewInput, type PartnerItemTermsPreview, type PartnerItemTermsRequest, type PartnerItemTermsResult, type PartnerItemTerms, type PartnerItemTermsEvidence, type PartnerItemTermsNotice, type CatalogValue } from './shared/partnerItemTermsCommand';
type Actor = {
    uid: string;
    token: Record<string, unknown>;
};
type Scope = PartnerItemTermsReference & {
    actorUid: string;
};
type Operation = {
    id: string;
    exists: boolean;
    data: Record<string, unknown>;
    unsetTax: boolean;
};
class TermsConflict extends Error {
}
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
export const partnerItemTermsReceiptId = (companyId: string, uid: string, planId: string): string => sha(JSON.stringify([companyId, uid, planId]));
const own = (row: Record<string, unknown>, fields: readonly string[]) => Object.fromEntries(fields.filter(field => Object.prototype.hasOwnProperty.call(row, field)).map(field => [field, row[field]]));
const companyOf = (row: Record<string, unknown>) => row.companyId ?? 'taebaek';
const sorted = <T>(rows: T[], key: (row: T) => string): T[] => rows.sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
function codecOf(db: admin.firestore.Firestore): CatalogValueAdapter {
    return { special: value => value instanceof admin.firestore.Timestamp ? ['timestamp', value.seconds, value.nanoseconds] : value instanceof admin.firestore.DocumentReference ? ['reference', value.path] : value instanceof admin.firestore.GeoPoint ? ['geo', value.latitude, value.longitude] : Buffer.isBuffer(value) ? ['bytes', [...value]] : undefined, timestamp: (s, n) => new admin.firestore.Timestamp(s, n), reference: path => db.doc(path), geo: (lat, lng) => new admin.firestore.GeoPoint(lat, lng), bytes: bytes => Buffer.from(bytes) };
}
const result = (scope: Scope, status: PartnerItemTermsResult['status'], requestHash: string | null, message: string): PartnerItemTermsResult => ({ ...scope, status, requestHash, message });
function validateProjection(value: CatalogValue | null, raw: boolean, codec: CatalogValueAdapter): void {
    if (value === null)
        return;
    const decoded = decodeCatalogValue(value, codec) as Record<string, unknown>;
    if (!decoded || Array.isArray(decoded) || JSON.stringify(raw ? partnerItemTermsExpected(decoded, codec) : partnerItemTermsOpening(decoded, codec)) !== JSON.stringify(value))
        throw Error('선택한 거래조건 비교 원문을 확인해 주세요.');
}
/** 전체 원가 자료 대신 실제 사슬에 쓴 query·문서만 근거에 묶는다. */
async function prepare(db: admin.firestore.Firestore, tx: admin.firestore.Transaction, scope: PartnerItemTermsReference, terms: PartnerItemTerms, expected: CatalogValue | null, isOpening: boolean, codec: CatalogValueAdapter): Promise<{
    preview: PartnerItemTermsPreview;
    operations: Operation[];
}> {
    const queries: PartnerItemTermsEvidence['queries'] = [], documents: PartnerItemTermsEvidence['documents'] = [];
    const rows = new Map<string, admin.firestore.DocumentSnapshot>(), linkQueries = new Map<string, admin.firestore.QueryDocumentSnapshot[]>();
    const noteDocument = (kind: 'item' | 'partner' | 'tomb', id: string, snapshot: admin.firestore.DocumentSnapshot, fields?: readonly string[]) => { documents.push({ kind, id, digest: sha(partnerItemTermsCanonical(snapshot.exists ? (fields ? own(snapshot.data()!, fields) : snapshot.data()) : null, codec)) }); };
    const readItem = async (id: string) => {
        if (rows.has(id))
            return rows.get(id)!;
        const item = await tx.get(db.collection('items').doc(id)), tomb = await tx.get(db.collection('inventoryWriterDeletions').doc(scope.companyId + '__' + id));
        rows.set(id, item);
        rows.set('tomb/' + id, tomb);
        noteDocument('item', id, item, ['companyId', 'name', 'type', 'archived']);
        noteDocument('tomb', id, tomb);
        return item;
    };
    const usable = (item: admin.firestore.DocumentSnapshot) => { if (!item.exists || companyOf(item.data()!) !== scope.companyId || item.get('archived') === true || rows.get('tomb/' + item.id)?.get('mergedIntoItemId') !== undefined)
        throw new TermsConflict('통합·보관되었거나 현재 회사에 없는 품목이 있어 저장하지 않았습니다. 현재 품목을 다시 선택해 주세요.'); };
    const readLinks = async (itemId: string) => {
        if (linkQueries.has(itemId))
            return linkQueries.get(itemId)!;
        const snapshot = await tx.get(db.collection('partner_item').where('companyId', '==', scope.companyId).where('partnerId', '==', scope.partnerId).where('itemId', '==', itemId));
        queries.push({ kind: 'links', itemId, count: snapshot.size, digest: sha(partnerItemTermsCanonical(snapshot.docs.map(doc => ({ id: doc.id, data: own(doc.data(), PARTNER_ITEM_TERMS_FIELDS) })), codec)) });
        linkQueries.set(itemId, snapshot.docs);
        return snapshot.docs;
    };
    const target = await tx.get(db.collection('partner_item').doc(scope.targetId)), raw = target.data();
    if (raw && raw.companyId !== scope.companyId)
        throw new TermsConflict(raw.companyId == null ? '거래조건의 소속 회사가 지정되지 않아 저장하지 않았습니다. 해당 연결의 소속 정보를 확인한 뒤 다시 열어 주세요.' : '선택한 거래조건이 다른 회사 자료여서 저장하지 않았습니다.');
    if (raw && Object.prototype.hasOwnProperty.call(raw, 'id') && raw.id !== scope.targetId)
        throw new TermsConflict('선택한 거래조건의 문서 번호와 저장된 번호가 다릅니다. 해당 연결을 확인해 주세요.');
    if (raw && (raw.itemId !== scope.itemId || raw.partnerId !== scope.partnerId || (raw.Direction ?? 'out') !== scope.direction))
        throw new TermsConflict('선택한 연결의 품목·거래처·방향이 바뀌었습니다. 다시 열어 주세요.');
    const comparison = raw ? (isOpening ? partnerItemTermsOpening(raw, codec) : partnerItemTermsExpected(raw, codec)) : null;
    if (JSON.stringify(comparison) !== JSON.stringify(expected))
        throw new TermsConflict('거래조건이 작성 시작 후 바뀌어 저장하지 않았습니다. 최신 내용을 다시 열어 주세요.');
    if (!target.exists && scope.targetId !== `${scope.itemId}_${scope.partnerId}_${scope.direction}`)
        throw new TermsConflict('신규 거래조건의 고정 문서 번호를 확인해 주세요.');
    const partner = await tx.get(db.collection('partners').doc(scope.partnerId));
    noteDocument('partner', scope.partnerId, partner, ['companyId', 'name']);
    if (!partner.exists || companyOf(partner.data()!) !== scope.companyId || partner.get('archived') === true)
        throw new TermsConflict('현재 회사의 거래처를 확인하지 못해 저장하지 않았습니다.');
    const operations: Operation[] = [], notices: PartnerItemTermsNotice[] = [], visited = new Set<string>();
    let current = scope.itemId, currentId = scope.targetId, currentExists = target.exists, currentTerms = { ...terms };
    while (true) {
        if (visited.has(current))
            throw new TermsConflict('박스·낱개 구성이 순환하여 저장하지 않았습니다. 구성을 확인해 주세요.');
        visited.add(current);
        const item = await readItem(current);
        usable(item);
        await readLinks(current);
        const data: Record<string, unknown> = { companyId: scope.companyId, itemId: current, partnerId: scope.partnerId, Direction: scope.direction, ...(currentTerms.price !== undefined ? { price: currentTerms.price } : {}), ...(currentTerms.Account_Code !== undefined ? { Account_Code: currentTerms.Account_Code } : {}), ...(currentTerms.taxType !== undefined && currentTerms.taxType !== null ? { taxType: currentTerms.taxType } : {}) };
        operations.push({ id: currentId, exists: currentExists, data, unsetTax: currentTerms.taxType === null });
        if (operations.length > 499)
            throw new TermsConflict('박스·낱개 연결이 한 번의 499개 업무 저장 한도를 넘습니다. 구성을 확인해 주세요.');
        const boms = await tx.get(db.collection('item_bom').where('companyId', '==', scope.companyId).where('parent_id', '==', current));
        queries.push({ kind: 'bom', itemId: current, count: boms.size, digest: sha(partnerItemTermsCanonical(boms.docs.map(doc => ({ id: doc.id, data: own(doc.data(), ['parent_id', 'child_id', 'quantity']) })), codec)) });
        const itemRows: {
            id: string;
            type?: string;
        }[] = [];
        for (const bom of boms.docs) {
            const childId = bom.get('child_id');
            if (typeof childId === 'string' && documentId(childId)) {
                const child = await readItem(childId);
                if (child.exists)
                    itemRows.push({ id: childId, type: child.get('type') });
            }
        }
        const index = buildBomIndex(itemRows, boms.docs.map(doc => doc.data() as {
            parent_id: string;
            child_id: string;
            quantity?: number;
        })), unpacked = unpackStockComponent(index.of(current));
        if (!unpacked)
            break;
        const child = await readItem(unpacked.itemId), existing = (await readLinks(unpacked.itemId)).some(link => (link.get('Direction') ?? 'out') === scope.direction);
        if (existing)
            break;
        usable(child);
        if (!Number.isFinite(unpacked.count))
            throw new TermsConflict('박스 구성 수량을 확인해 주세요.');
        notices.push({ itemId: current, itemName: String(item.get('name') ?? current), childId: unpacked.itemId, childName: String(child.get('name') ?? unpacked.itemId), count: unpacked.count });
        currentTerms = { ...(typeof currentTerms.price === 'number' && currentTerms.price > 0 ? { price: Math.round(currentTerms.price / unpacked.count) } : {}), ...(currentTerms.taxType !== undefined ? { taxType: currentTerms.taxType } : {}), ...(currentTerms.Account_Code !== undefined ? { Account_Code: currentTerms.Account_Code } : {}) };
        current = unpacked.itemId;
        currentId = `${current}_${scope.partnerId}_${scope.direction}`;
        currentExists = false;
    }
    for (const operation of operations) {
        if (!documentId(operation.id))
            throw new TermsConflict('저장할 연결의 문서 번호가 너무 깁니다.');
        const actual = await tx.get(db.collection('partner_item').doc(operation.id));
        if (actual.exists !== operation.exists || actual.exists && actual.get('companyId') !== scope.companyId)
            throw new TermsConflict('저장할 연결 번호가 기존 자료와 겹치거나 삭제되어 저장하지 않았습니다.');
    }
    const evidence: PartnerItemTermsEvidence = { schemaVersion: 1, queries: sorted(queries, row => row.kind + '|' + row.itemId), documents: sorted(documents, row => row.kind + '|' + row.id) };
    const rawExpected = raw ? partnerItemTermsExpected(raw, codec) : null;
    const preview: PartnerItemTermsPreview = { version: 1, ...scope, expected: rawExpected, evidence, notices, ...(notices.length ? { noticeHash: sha(serializePartnerItemTermsNotice(scope, rawExpected, terms, evidence, notices)) } : {}) };
    try {
        normalizePartnerItemTermsRequest({ version: 1, ...scope, expected: rawExpected, terms, evidence, ...(preview.noticeHash ? { noticeHash: preview.noticeHash } : {}) });
    }
    catch (error) {
        throw new TermsConflict(error instanceof Error ? error.message : '거래조건 저장 근거를 확인해 주세요.');
    }
    return { preview: normalizePartnerItemTermsPreview(preview, scope), operations };
}
export async function executePartnerItemTermsCommand(db: admin.firestore.Firestore, actor: Actor | undefined, input: PartnerItemTermsCommand): Promise<PartnerItemTermsPreview | PartnerItemTermsResult> {
    if (!actor?.uid)
        throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    if (!documentId(actor.token.employeeId) || !['taebaek', 'punghoe'].includes(String(actor.token.companyId)))
        throw new HttpsError('permission-denied', '현재 회사 직원으로 로그인해 주세요.');
    const codec = codecOf(db);
    let reference: PartnerItemTermsReference, request: PartnerItemTermsRequest | undefined, previewInput: PartnerItemTermsPreviewInput | undefined, text: string | null = null, hash: string | undefined;
    try {
        if (!input || !['preview', 'apply', 'inspect', 'cancel'].includes(input.mode))
            throw Error('거래조건 처리 종류를 확인해 주세요.');
        const keys = input.mode === 'preview' ? ['mode', 'input'] : input.mode === 'apply' ? ['mode', 'request'] : ['mode', 'reference', 'requestHash'];
        if (Object.keys(input).some(key => !keys.includes(key)))
            throw Error('거래조건 명령 형식을 확인해 주세요.');
        if (input.mode === 'preview') {
            previewInput = normalizePartnerItemTermsPreviewInput(input.input);
            reference = normalizePartnerItemTermsReference(own(previewInput as unknown as Record<string, unknown>, ['companyId', 'planId', 'targetId', 'itemId', 'partnerId', 'direction']));
            validateProjection(previewInput.opening, false, codec);
        }
        else if (input.mode === 'apply') {
            request = normalizePartnerItemTermsRequest(input.request);
            reference = normalizePartnerItemTermsReference(own(request as unknown as Record<string, unknown>, ['companyId', 'planId', 'targetId', 'itemId', 'partnerId', 'direction']));
            validateProjection(request.expected, true, codec);
            text = serializePartnerItemTermsRequest(request);
            hash = sha(text);
        }
        else {
            reference = normalizePartnerItemTermsReference(input.reference);
            hash = input.requestHash;
            if (hash !== undefined && (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)))
                throw Error('거래조건 원문 해시를 확인해 주세요.');
        }
    }
    catch (error) {
        throw new HttpsError('invalid-argument', error instanceof Error ? error.message : '거래조건 원문을 확인해 주세요.');
    }
    if (reference.companyId !== actor.token.companyId)
        throw new HttpsError('permission-denied', '다른 회사의 거래조건은 저장할 수 없습니다.');
    const scope: Scope = { ...reference, actorUid: actor.uid }, receiptRef = db.collection(PARTNER_ITEM_TERMS_OPERATIONS).doc(partnerItemTermsReceiptId(scope.companyId, actor.uid, scope.planId));
    return db.runTransaction(async (tx) => {
        if (input.mode !== 'preview') {
            const receipt = await tx.get(receiptRef);
            if (receipt.exists) {
                const data = receipt.data()!;
                let saved: PartnerItemTermsResult;
                try {
                    if (data.version !== 1 || !['applied', 'rejected', 'cancelled'].includes(data.status))
                        throw Error();
                    saved = normalizePartnerItemTermsResult(own(data, ['companyId', 'planId', 'targetId', 'itemId', 'partnerId', 'direction', 'actorUid', 'requestHash', 'status', 'message']), reference, actor.uid);
                    if (saved.requestHash === null) {
                        if (saved.status !== 'cancelled' || data.requestText !== null)
                            throw Error();
                    }
                    else {
                        if (typeof data.requestText !== 'string' || sha(data.requestText) !== saved.requestHash)
                            throw Error();
                        const original = normalizePartnerItemTermsRequest(JSON.parse(data.requestText));
                        if (serializePartnerItemTermsRequest(original) !== data.requestText || !Object.entries(reference).every(([key, value]) => (original as unknown as Record<string, unknown>)[key] === value))
                            throw Error();
                    }
                }
                catch {
                    throw new HttpsError('failed-precondition', '거래조건 저장 근거를 확인하지 못했습니다. 최초 원문을 보존해 주세요.');
                }
                if (hash !== undefined && saved.requestHash !== null && hash !== saved.requestHash)
                    throw new HttpsError('already-exists', '같은 거래조건 저장 번호의 최초 내용이 다릅니다.');
                return input.mode === 'apply' && saved.status === 'applied' ? { ...saved, status: 'duplicate' as const } : saved;
            }
            if (input.mode === 'inspect')
                return result(scope, 'unknown', null, '거래조건 저장 결과를 확인하지 못했습니다. 자동으로 다시 저장하지 않습니다.');
        }
        const employee = await tx.get(db.collection('employees').doc(actor.token.employeeId as string));
        if (!employee.exists || companyOf(employee.data()!) !== scope.companyId)
            throw new HttpsError('permission-denied', '현재 회사 직원 정보를 확인해 주세요.');
        const writeReceipt = (outcome: PartnerItemTermsResult) => { tx.create(receiptRef, { ...outcome, version: 1, requestText: text, createdAt: new Date().toISOString() }); return outcome; };
        if (input.mode === 'cancel')
            return writeReceipt(result(scope, 'cancelled', null, '이 거래조건 저장을 중단했습니다. 늦게 도착한 저장도 막았습니다.'));
        let prepared: Awaited<ReturnType<typeof prepare>>;
        try {
            prepared = await prepare(db, tx, reference, input.mode === 'preview' ? previewInput!.terms : request!.terms, input.mode === 'preview' ? previewInput!.opening : request!.expected, input.mode === 'preview', codec);
        }
        catch (error) {
            if (!(error instanceof TermsConflict))
                throw error;
            if (input.mode === 'preview')
                throw new HttpsError('failed-precondition', error.message);
            return writeReceipt(result(scope, 'rejected', hash!, error.message));
        }
        if (input.mode === 'preview')
            return prepared.preview;
        if (partnerItemTermsCanonical(prepared.preview.evidence) !== partnerItemTermsCanonical(request!.evidence) || prepared.preview.noticeHash !== request!.noticeHash)
            return writeReceipt(result(scope, 'rejected', hash!, '품목·구성·거래처 연결 자료가 안내 후 바뀌어 저장하지 않았습니다. 최신 내용으로 다시 열어 주세요.'));
        const outcome = result(scope, 'applied', hash!, '거래조건과 필요한 낱개 연결을 함께 저장했습니다.');
        if (Buffer.byteLength(JSON.stringify({ ...outcome, version: 1, requestText: text, createdAt: new Date().toISOString() }), 'utf8') > 850000)
            return writeReceipt(result(scope, 'rejected', hash!, '거래조건 저장 근거가 너무 커 첫 저장을 실행하지 않았습니다.'));
        for (const operation of prepared.operations) {
            const ref = db.collection('partner_item').doc(operation.id), data = { ...operation.data };
            if (operation.unsetTax && operation.exists)
                data.taxType = admin.firestore.FieldValue.delete();
            if (operation.exists)
                tx.update(ref, data);
            else
                tx.create(ref, data);
        }
        return writeReceipt(outcome);
    });
}
export const partnerItemTermsCommand = onCall({ region: 'asia-northeast3' }, request => executePartnerItemTermsCommand(admin.firestore(), request.auth, request.data));
