import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { ITEM_EDITOR_OPERATIONS, ITEM_EDITOR_STAGES, ITEM_EDITOR_GRAPH_PARTS, normalizeItemEditorReference, normalizeItemEditorRequest, normalizeItemEditorResult, serializeItemEditorRequest, serializeItemEditorGraphPart, itemEditorTargetExpected, itemEditorDocumentId, itemEditorPurchaseNoticeText, type ItemEditorCommand, type ItemEditorRequest, type ItemEditorReference, type ItemEditorResult, type ItemEditorGraphDocuments, type ItemEditorGraphEvidence, type ItemEditorStage } from './shared/itemEditorCommand';
import { buildItemEditorPlan, assertItemEditorTombstone, type ItemEditorOperation } from './shared/itemEditorDomain';
import { encodeCatalogValue, decodeCatalogValue, type CatalogValue, type CatalogValueAdapter } from './shared/catalogOrderReferenceProof';
import { advanceInventoryWriterProtocol, preserveInventoryWriterProtocol } from './shared/inventoryWriterProtocol';
type Actor = {
    uid: string;
    token: Record<string, unknown>;
};
type Scope = ItemEditorReference & {
    actorUid: string;
};
type CompactStage = {
    operations: CatalogValue;
    before: ItemEditorGraphEvidence;
    after: ItemEditorGraphEvidence;
    targetBefore: CatalogValue | null;
    targetAfter: CatalogValue | null;
};
type Plans = Record<ItemEditorStage, CompactStage>;
const collectionOf = { items: 'items', boms: 'item_bom', formulas: 'item_formula', links: 'partner_item' } as const;
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
export const itemEditorReceiptId = (companyId: string, actorUid: string, planId: string): string => sha(JSON.stringify([companyId, actorUid, planId]));
function codecOf(db: admin.firestore.Firestore): CatalogValueAdapter {
    return { special: value => value instanceof admin.firestore.Timestamp ? ['timestamp', value.seconds, value.nanoseconds] : value instanceof admin.firestore.DocumentReference ? ['reference', value.path] : value instanceof admin.firestore.GeoPoint ? ['geo', value.latitude, value.longitude] : Buffer.isBuffer(value) ? ['bytes', [...value]] : undefined, timestamp: (seconds, nanos) => new admin.firestore.Timestamp(seconds, nanos), reference: path => db.doc(path), geo: (lat, lng) => new admin.firestore.GeoPoint(lat, lng), bytes: bytes => Buffer.from(bytes) };
}
function graphEvidence(graph: ItemEditorGraphDocuments, codec: CatalogValueAdapter): ItemEditorGraphEvidence {
    const result = { schemaVersion: 1 } as ItemEditorGraphEvidence;
    for (const part of ITEM_EDITOR_GRAPH_PARTS)
        result[part] = { count: graph[part].length, digest: sha(serializeItemEditorGraphPart(part, graph[part], codec)) };
    return result;
}
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
function changedPart(current: ItemEditorGraphEvidence, expected: ItemEditorGraphEvidence): string | undefined {
    const names = { items: '품목', boms: '구성품', formulas: '배합', links: '거래처 연결' };
    return ITEM_EDITOR_GRAPH_PARTS.filter(part => !same(current[part], expected[part])).map(part => names[part]).join('·') || undefined;
}
function response(scope: Scope, status: ItemEditorResult['status'], requestHash: string | null, confirmedStageIds: ItemEditorStage[], message: string): ItemEditorResult {
    return { ...scope, status, requestHash, confirmedStageIds, message };
}
function photoBinding(request: ItemEditorRequest): void {
    if (!request.draft.photoChanged)
        return;
    const { image, imagePath } = request.draft.metadata;
    if ((image === undefined || image === '') && (imagePath === undefined || imagePath === ''))
        return;
    if (typeof image !== 'string' || typeof imagePath !== 'string' || !imagePath.startsWith(`companies/${request.companyId}/items/${request.targetId}/`) || imagePath.split('/').length !== 5 || !/^photo-[\w-]+\.[a-zA-Z0-9]+$/.test(imagePath.split('/')[4]))
        throw Error('사진의 회사·품목 저장 경로를 확인해 주세요.');
    let url: URL;
    try {
        url = new URL(image);
    }
    catch {
        throw Error('품목 사진 주소를 확인해 주세요.');
    }
    if (url.protocol !== 'https:' || !['firebasestorage.googleapis.com', 'storage.googleapis.com'].includes(url.hostname) || !decodeURIComponent(url.pathname).endsWith('/' + imagePath))
        throw Error('사진 주소와 저장 경로가 다릅니다.');
}
function decodeOperations(value: CatalogValue, codec: CatalogValueAdapter): ItemEditorOperation[] {
    const rows = decodeCatalogValue(value, codec) as ItemEditorOperation[];
    if (!Array.isArray(rows) || rows.length > 499 || rows.some(row => !row || !Object.values(collectionOf).includes(row.collection) || !itemEditorDocumentId(row.id) || !['create', 'update', 'set', 'delete'].includes(row.kind)))
        throw Error('저장 단계의 업무 계획을 확인하지 못했습니다.');
    return rows;
}
/** 최초 요청의 유한 계획과 단계별 ACK를 같은 문서에 묶어 응답 유실 뒤에도 다시 계산·재전송하지 않는다. */
export async function executeItemEditorCommand(db: admin.firestore.Firestore, actor: Actor | undefined, input: ItemEditorCommand): Promise<ItemEditorResult> {
    if (!actor?.uid)
        throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    if (!itemEditorDocumentId(actor.token.employeeId) || !['taebaek', 'punghoe'].includes(String(actor.token.companyId)))
        throw new HttpsError('permission-denied', '현재 회사 직원으로 로그인해 주세요.');
    const codec = codecOf(db);
    let request: ItemEditorRequest | undefined, reference: ItemEditorReference, requestText: string | null = null, requestHash: string | undefined;
    try {
        if (!input || !['apply', 'inspect', 'cancel'].includes(input.mode))
            throw Error('품목 저장 처리 종류를 확인해 주세요.');
        const allowed = input.mode === 'apply' ? ['mode', 'request', 'stage'] : ['mode', 'reference', 'requestHash'];
        if (Object.keys(input).some(key => !allowed.includes(key)))
            throw Error('품목 저장 명령 형식을 확인해 주세요.');
        if (input.mode === 'apply') {
            if (!ITEM_EDITOR_STAGES.includes(input.stage))
                throw Error('품목 저장 단계를 확인해 주세요.');
            request = normalizeItemEditorRequest(input.request);
            reference = normalizeItemEditorReference({ companyId: request.companyId, planId: request.planId, targetId: request.targetId });
            if (request.targetExpected !== null) {
                const raw = decodeCatalogValue(request.targetExpected, codec) as Record<string, unknown>;
                if (!raw || Array.isArray(raw) || !same(itemEditorTargetExpected(raw, codec), request.targetExpected))
                    throw Error('품목을 열 때 확인한 원문 형식이 다릅니다.');
            }
            photoBinding(request);
            requestText = serializeItemEditorRequest(request);
            requestHash = sha(requestText);
        }
        else {
            reference = normalizeItemEditorReference(input.reference);
            requestHash = input.requestHash;
            if (requestHash !== undefined && !/^[a-f0-9]{64}$/.test(requestHash))
                throw Error('품목 저장 원문 해시를 확인해 주세요.');
        }
    }
    catch (error) {
        throw new HttpsError('invalid-argument', error instanceof Error ? error.message : '품목 저장 원문을 확인해 주세요.');
    }
    if (reference.companyId !== actor.token.companyId)
        throw new HttpsError('permission-denied', '다른 회사의 품목은 수정할 수 없습니다.');
    const scope: Scope = { ...reference, actorUid: actor.uid }, receiptRef = db.collection(ITEM_EDITOR_OPERATIONS).doc(itemEditorReceiptId(scope.companyId, actor.uid, scope.planId));
    return db.runTransaction(async (tx) => {
        const receipt = await tx.get(receiptRef);
        let saved: ItemEditorResult | undefined, plans: Plans | undefined;
        if (receipt.exists) {
            const data = receipt.data()!;
            try {
                if (data.version !== 1)
                    throw Error();
                saved = normalizeItemEditorResult({ companyId: data.companyId, planId: data.planId, targetId: data.targetId, actorUid: data.actorUid, requestHash: data.requestHash, status: data.status, confirmedStageIds: data.confirmedStageIds, message: data.message }, reference, actor.uid);
                if (saved.requestHash === null) {
                    if (data.requestText !== null || saved.status !== 'cancelled')
                        throw Error();
                }
                else {
                    if (typeof data.requestText !== 'string' || sha(data.requestText) !== saved.requestHash)
                        throw Error();
                    const original = normalizeItemEditorRequest(JSON.parse(data.requestText));
                    if (serializeItemEditorRequest(original) !== data.requestText || original.companyId !== scope.companyId || original.planId !== scope.planId || original.targetId !== scope.targetId)
                        throw Error();
                    // 최초 업무 검증에서 거절한 요청은 실행 계획 없이도 확정 종결할 수 있다.
                    if (!(data.plansText === undefined && saved.status === 'rejected' && saved.confirmedStageIds.length === 0)) {
                        if (typeof data.plansText !== 'string')
                            throw Error();
                        plans = JSON.parse(data.plansText) as Plans;
                        if (!plans || Object.keys(plans).length !== 5)
                            throw Error();
                        for (const stage of ITEM_EDITOR_STAGES) {
                            const plan = plans[stage];
                            if (!plan || plan.before.schemaVersion !== 1 || plan.after.schemaVersion !== 1)
                                throw Error();
                            decodeOperations(plan.operations, codec);
                        }
                    }
                }
            }
            catch {
                throw new HttpsError('failed-precondition', '품목 저장 처리 근거를 확인하지 못했습니다. 최초 원문을 보존해 주세요.');
            }
            if (requestHash !== undefined && saved.requestHash !== null && saved.requestHash !== requestHash)
                throw new HttpsError('already-exists', '같은 품목 저장 번호의 최초 내용이 다릅니다.');
            if (input.mode === 'inspect' || saved.status !== 'active')
                return saved;
            if (input.mode === 'apply' && saved.confirmedStageIds.includes(input.stage))
                return saved;
        }
        if (input.mode === 'inspect')
            return response(scope, 'unknown', null, [], '품목 저장 결과를 확인하지 못했습니다. 자동으로 다시 저장하지 않습니다.');
        const writeReceipt = (result: ItemEditorResult, prepared?: Plans): ItemEditorResult => {
            if (receipt.exists)
                tx.update(receiptRef, { ...result, updatedAt: new Date().toISOString() });
            // 태그 codec의 중첩 배열은 Firestore 필드가 허용하지 않아 정본 문자열로 보존한다.
            else
                tx.create(receiptRef, { ...result, version: 1, requestText, ...(prepared ? { plansText: JSON.stringify(prepared) } : {}), createdAt: new Date().toISOString() });
            return result;
        };
        if (input.mode === 'cancel')
            return writeReceipt(response(scope, 'cancelled', saved?.requestHash ?? null, saved?.confirmedStageIds ?? [], '완료된 단계는 유지하고 남은 품목 저장을 중단했습니다. 늦게 도착한 저장도 막았습니다.'));
        if (input.mode !== 'apply')
            throw new HttpsError('invalid-argument', '품목 저장 처리 종류를 확인해 주세요.');
        const stageIndex = ITEM_EDITOR_STAGES.indexOf(input.stage);
        if (stageIndex !== (saved?.confirmedStageIds.length ?? 0))
            throw new HttpsError('failed-precondition', '앞 단계의 저장 결과를 먼저 확인해 주세요.');
        // query 자체가 TX 읽기 집합에 들어가 새 구성품·연결 문서의 삽입도 경합으로 감지한다.
        const graph = {} as ItemEditorGraphDocuments;
        for (const part of ITEM_EDITOR_GRAPH_PARTS) {
            const snapshot = await tx.get(db.collection(collectionOf[part]).where('companyId', '==', scope.companyId));
            graph[part] = snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }));
        }
        const employee = await tx.get(db.collection('employees').doc(actor.token.employeeId as string));
        const target = await tx.get(db.collection('items').doc(scope.targetId));
        if (!employee.exists || (employee.get('companyId') ?? 'taebaek') !== scope.companyId)
            throw new HttpsError('permission-denied', '현재 회사의 직원 정보를 확인해 주세요.');
        const evidence = graphEvidence(graph, codec), targetEvidence = target.exists ? itemEditorTargetExpected(target.data()!, codec) : null;
        const reject = (message: string, prepared?: Plans) => writeReceipt(response(scope, 'rejected', saved?.requestHash ?? requestHash!, saved?.confirmedStageIds ?? [], message), prepared);
        if (!plans) {
            const changed = changedPart(evidence, request!.graph);
            if (changed || !same(targetEvidence, request!.targetExpected))
                return reject(`${changed ?? '편집 품목'} 자료가 작성 시작 후 바뀌어 저장하지 않았습니다. 최신 자료로 다시 열어 주세요.`);
            if (target.exists && target.get('companyId') !== scope.companyId)
                return reject('같은 번호의 다른 회사 품목이 있어 저장하지 않았습니다.');
            let domain: ReturnType<typeof buildItemEditorPlan>;
            try {
                domain = buildItemEditorPlan(graph, request!);
            }
            catch (error) {
                return reject(error instanceof Error ? error.message : '품목 저장 계획을 확인해 주세요.');
            }
            const noticeText = itemEditorPurchaseNoticeText(scope.companyId, scope.targetId, graph, request!.draft);
            if (noticeText ? request!.purchaseNoticeHash !== sha(noticeText) : request!.purchaseNoticeHash !== undefined)
                return reject('박스·낱개 연결 안내를 현재 초안으로 확인해 주세요.');
            plans = {} as Plans;
            let before = evidence, previousTarget = targetEvidence;
            for (const stage of ITEM_EDITOR_STAGES) {
                const operations = domain.stages[stage];
                if (operations.length > 499 || operations.some(op => !itemEditorDocumentId(op.id)))
                    return reject('품목 저장 계획이 업무 쓰기 한도나 문서 번호 범위를 넘습니다.');
                const after = graphEvidence(domain.after[stage], codec), row = domain.after[stage].items.find(item => item.id === scope.targetId), targetAfter = row ? itemEditorTargetExpected(row.data, codec) : null;
                plans[stage] = { operations: encodeCatalogValue(operations, codec), before, after, targetBefore: previousTarget, targetAfter };
                before = after;
                previousTarget = targetAfter;
            }
            // Firestore 문서 1MiB보다 여유를 두고 필드명·인덱스 외피까지 포함한 실제 압축 계획을 제한한다.
            const encoded = JSON.stringify({ version: 1, ...scope, requestHash, requestText, plansText: JSON.stringify(plans), confirmedStageIds: [...ITEM_EDITOR_STAGES], status: 'completed', message: '품목 저장을 완료했습니다.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
            if (Buffer.byteLength(encoded, 'utf8') > 850000)
                return reject('품목 저장 단계 계획이 너무 큽니다. 첫 저장은 실행하지 않았습니다.');
            // 회사 query에 안 보이는 다른 회사의 같은 deterministic ID도 첫 쓰기 전에 검사한다.
            const allOperations = ITEM_EDITOR_STAGES.flatMap(stage => decodeOperations(plans![stage].operations, codec));
            const refs = new Map(allOperations.map(op => [op.collection + '/' + op.id, db.collection(op.collection).doc(op.id)]));
            for (const ref of refs.values()) {
                const actual = await tx.get(ref);
                if (actual.exists && actual.get('companyId') !== scope.companyId)
                    return reject('저장할 문서 번호가 다른 회사 자료와 겹칩니다. 첫 저장은 실행하지 않았습니다.');
            }
            for (const op of allOperations.filter(op => op.collection === 'items')) {
                const tomb = await tx.get(db.collection('inventoryWriterDeletions').doc(scope.companyId + '__' + op.id));
                try {
                    assertItemEditorTombstone(tomb.data(), scope.companyId, op.id);
                }
                catch (error) {
                    return reject(error instanceof Error ? error.message : '품목 삭제 기록을 확인해 주세요.');
                }
            }
        }
        const compact = plans[input.stage], changed = changedPart(evidence, compact.before);
        if (changed || !same(targetEvidence, compact.targetBefore))
            return reject(`${changed ?? '편집 품목'} 자료가 작성 시작 후 바뀌어 남은 단계를 진행하지 않았습니다. 이미 완료된 단계는 유지됩니다. 요청을 중단한 뒤 최신 자료로 다시 열어 주세요.`, plans);
        const operations = decodeOperations(compact.operations, codec);
        const current = new Map<string, admin.firestore.DocumentSnapshot>();
        for (const op of operations) {
            const key = op.collection + '/' + op.id;
            current.set(key, await tx.get(db.doc(key)));
        }
        const tombs = new Map<string, Record<string, unknown> | undefined>();
        for (const op of operations.filter(op => op.collection === 'items')) {
            const tomb = await tx.get(db.collection('inventoryWriterDeletions').doc(scope.companyId + '__' + op.id));
            try {
                assertItemEditorTombstone(tomb.data(), scope.companyId, op.id);
            }
            catch {
                return reject('품목 삭제·통합 기록이 바뀌어 남은 단계를 진행하지 않았습니다. 완료된 단계는 유지됩니다.', plans);
            }
            tombs.set(op.id, tomb.data());
        }
        const partners = request?.draft.inPartnerIds ?? normalizeItemEditorRequest(JSON.parse(receipt.get('requestText') as string)).draft.inPartnerIds;
        for (const partnerId of partners) {
            const partner = await tx.get(db.collection('partners').doc(partnerId));
            if (!partner.exists || (partner.get('companyId') ?? 'taebaek') !== scope.companyId)
                return reject('현재 회사의 매입 거래처를 확인하지 못해 남은 단계를 진행하지 않았습니다.', plans);
        }
        for (const op of operations) {
            const actual = current.get(op.collection + '/' + op.id)!;
            if (actual.exists && actual.get('companyId') !== scope.companyId)
                return reject('저장할 문서 번호가 다른 회사 자료와 겹쳐 남은 단계를 진행하지 않았습니다.', plans);
            if (op.kind === 'create' && actual.exists || op.kind === 'update' && !actual.exists)
                return reject('저장 대상의 존재 여부가 바뀌어 남은 단계를 진행하지 않았습니다. 완료된 단계는 유지됩니다.', plans);
        }
        for (const op of operations) {
            const ref = db.collection(op.collection).doc(op.id), before = current.get(op.collection + '/' + op.id)!.data();
            if (op.kind === 'delete') {
                tx.delete(ref);
                continue;
            }
            let data = { ...op.data };
            if (op.collection === 'items') {
                const floor = tombs.get(op.id)?.lastDeletedItemRevision;
                data = before ? preserveInventoryWriterProtocol(before, data) : advanceInventoryWriterProtocol(floor === undefined ? undefined : { inventoryWriterProtocolVersion: 1, inventoryWriteRevision: floor }, data);
            }
            for (const field of op.unset ?? [])
                if (op.kind === 'update')
                    data[field] = admin.firestore.FieldValue.delete();
                else
                    delete data[field];
            if (op.removeSmartStoreMarker)
                data.partnerIds = admin.firestore.FieldValue.arrayRemove('SMARTSTORE');
            if (op.kind === 'update')
                tx.update(ref, data);
            else if (op.kind === 'create')
                tx.create(ref, data);
            else
                tx.set(ref, data);
        }
        const confirmed = [...(saved?.confirmedStageIds ?? []), input.stage];
        return writeReceipt(response(scope, confirmed.length === 5 ? 'completed' : 'active', saved?.requestHash ?? requestHash!, confirmed, confirmed.length === 5 ? '품목 저장을 완료했습니다.' : '현재 단계 저장을 확인했습니다. 남은 단계만 이어서 진행할 수 있습니다.'), plans);
    });
}
export const itemEditorCommand = onCall({ region: 'asia-northeast3' }, request => executeItemEditorCommand(admin.firestore(), request.auth, request.data));
