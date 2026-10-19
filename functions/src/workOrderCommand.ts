import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { WORK_ORDER_OPERATIONS, WORK_ORDER_FENCES, encodeCatalogValue, normalizeWorkOrderReference, normalizeWorkOrderRequest, normalizeWorkOrderResult, normalizeWorkOrderOpening, serializeWorkOrderRequest, workOrderExpected, type WorkOrderCommand, type WorkOrderReference, type WorkOrderRequest, type WorkOrderResult, type WorkOrderOpening, type WorkOrderHistoryResult } from './shared/workOrderCommand';

type Actor = { uid: string; token: Record<string, unknown> };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
export const workOrderReceiptId = (company: string, uid: string, plan: string) => sha(JSON.stringify([company, uid, plan]));
const scopeKey = (company: string, uid: string) => sha(JSON.stringify([company, uid]));
const version = (snapshot: admin.firestore.DocumentSnapshot) => snapshot.updateTime ? `${snapshot.updateTime.seconds}:${String(snapshot.updateTime.nanoseconds).padStart(9, '0')}` : null;
export const workOrderToday = (now = new Date()) => now.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }).replace(/\. /g, '-').replace('.', '');
function sameDay(a: unknown, b: string) {
    if (typeof a !== 'string' || !/^\d{4}-\d{1,2}-\d{1,2}$/.test(a)) return false;
    return a.split('-').map(Number).join('-') === b.split('-').map(Number).join('-');
}
function encode(raw: admin.firestore.DocumentData) {
    return encodeCatalogValue(raw, { special(value) {
        if (value instanceof admin.firestore.Timestamp) return ['timestamp', value.seconds, value.nanoseconds];
        if (value instanceof admin.firestore.DocumentReference) return ['reference', value.path];
        if (value instanceof admin.firestore.GeoPoint) return ['geo', value.latitude, value.longitude];
        if (Buffer.isBuffer(value)) return ['bytes', [...value]];
        return undefined;
    } });
}
function readReceipt(data: admin.firestore.DocumentData, reference: WorkOrderReference, uid: string): WorkOrderResult {
    const result = normalizeWorkOrderResult({ version: data.version, reference: data.reference, actorUid: data.actorUid, status: data.status, requestHash: data.requestHash, message: data.message }, reference, uid);
    if (result.status === 'unknown') throw Error('확정된 작업순서 근거가 아닙니다.');
    if (result.requestHash === null) {
        if (result.status !== 'cancelled' || data.requestText !== null || data.action !== 'cancel') throw Error('작업순서 중단 근거가 다릅니다.');
    } else {
        if (typeof data.requestText !== 'string' || sha(data.requestText) !== result.requestHash) throw Error('작업순서 원문 해시가 다릅니다.');
        const request = normalizeWorkOrderRequest(JSON.parse(data.requestText));
        if (serializeWorkOrderRequest(request) !== data.requestText || JSON.stringify(request.reference) !== JSON.stringify(reference) || data.action !== request.action) throw Error('작업순서 최초 요청이 다릅니다.');
    }
    return result;
}
export async function executeWorkOrderCommand(db: admin.firestore.Firestore, actor: Actor | undefined, input: WorkOrderCommand): Promise<WorkOrderOpening | WorkOrderResult | WorkOrderHistoryResult> {
    if (!actor?.uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    if (typeof actor.token.employeeId !== 'string' || !['taebaek', 'punghoe'].includes(String(actor.token.companyId))) throw new HttpsError('permission-denied', '현재 회사의 직원 계정으로 로그인해 주세요.');
    let reference: WorkOrderReference | undefined, request: WorkOrderRequest | undefined, text: string | null = null, hash: string | null = null;
    try {
        if (!input || !['open', 'apply', 'inspect', 'cancel', 'listHistory'].includes(input.mode)) throw Error('작업순서 처리 종류를 확인해 주세요.');
        const fields = input.mode === 'apply' ? ['mode', 'request'] : input.mode === 'listHistory' ? ['mode', 'companyId', 'cursor'] : ['mode', 'reference'];
        if (Object.keys(input).some(key => !fields.includes(key))) throw Error('작업순서 요청 형식을 확인해 주세요.');
        if (input.mode === 'apply') {
            request = normalizeWorkOrderRequest(input.request);
            reference = request.reference;
            text = serializeWorkOrderRequest(request);
            hash = sha(text);
        } else if (input.mode !== 'listHistory') reference = normalizeWorkOrderReference(input.reference);
        else if (!['taebaek', 'punghoe'].includes(input.companyId) || (input.cursor !== undefined && !/^[a-f0-9]{64}$/.test(input.cursor))) throw Error('작업순서 이력 범위를 확인해 주세요.');
    } catch (error) {
        throw new HttpsError('invalid-argument', error instanceof Error ? error.message : '작업순서 입력을 확인해 주세요.');
    }
    const companyId = reference?.companyId ?? (input as Extract<WorkOrderCommand, { mode: 'listHistory' }>).companyId;
    if (companyId !== actor.token.companyId) throw new HttpsError('permission-denied', '현재 회사의 작업순서만 처리할 수 있습니다.');
    if (input.mode === 'listHistory') {
        let query = db.collection(WORK_ORDER_OPERATIONS).where('scopeKey', '==', scopeKey(companyId, actor.uid)).orderBy(admin.firestore.FieldPath.documentId()).limit(50);
        if (input.cursor) query = query.startAfter(input.cursor);
        const rows = await query.get();
        return { version: 1, companyId, actorUid: actor.uid, entries: rows.docs.map(row => {
            const data = row.data(), ref = normalizeWorkOrderReference(data.reference);
            if (ref.companyId !== companyId || typeof data.createdAt !== 'string') throw new HttpsError('failed-precondition', '작업순서 이력 범위를 확인하지 못했습니다.');
            return { result: readReceipt(data, ref, actor.uid), action: data.action, createdAt: data.createdAt };
        }), nextCursor: rows.size === 50 ? rows.docs[49].id : null };
    }
    const ref = reference!, receiptRef = db.collection(WORK_ORDER_OPERATIONS).doc(workOrderReceiptId(companyId, actor.uid, ref.planId));
    const groupRef = db.doc(`settings/${companyId}__workGroups`), resetRef = db.doc(`appMeta/workOrderReset_${companyId}`), fenceRef = db.collection(WORK_ORDER_FENCES).doc(companyId);
    const result = (status: WorkOrderResult['status'], requestHash: string | null, message: string): WorkOrderResult => ({ version: 1, reference: ref, actorUid: actor.uid, status, requestHash, message });
    return db.runTransaction(async tx => {
        if (input.mode !== 'open') {
            const prior = await tx.get(receiptRef);
            if (prior.exists) {
                let found: WorkOrderResult;
                try { found = readReceipt(prior.data()!, ref, actor.uid); }
                catch { throw new HttpsError('failed-precondition', '작업순서 처리 근거를 확인하지 못했습니다. 최초 원문을 보존해 주세요.'); }
                if (hash !== null && found.requestHash !== null && hash !== found.requestHash) throw new HttpsError('already-exists', '같은 요청 번호의 최초 작업순서가 다릅니다.');
                return found;
            }
            if (input.mode === 'inspect') return result('unknown', null, '서버에 이 요청의 처리 기록이 아직 없습니다. 같은 요청으로 다시 확인하거나 미처리 요청을 중단해 주세요.');
        }
        const finish = (outcome: WorkOrderResult) => {
            tx.create(receiptRef, { ...outcome, requestText: text, action: request?.action ?? 'cancel', scopeKey: scopeKey(companyId, actor.uid), createdAt: new Date().toISOString() });
            return outcome;
        };
        if (input.mode === 'cancel') return finish(result('cancelled', null, '미처리 작업순서 요청을 중단했습니다. 이미 저장된 작업순서는 되돌리지 않습니다.'));
        // 모든 목록 변경과 초기화가 같은 회사 fence를 읽고 써서 빈 목록·새 항목 경합도 직렬화한다.
        const [fence, groups, reset, items] = await Promise.all([
            tx.get(fenceRef), tx.get(groupRef), tx.get(resetRef), tx.get(db.collection('workOrderItems').where('companyId', '==', companyId).orderBy(admin.firestore.FieldPath.documentId()).limit(501))
        ]);
        const reject = (message: string) => {
            if (input.mode === 'open') throw new HttpsError('failed-precondition', message);
            return finish(result('rejected', hash, message));
        };
        if (items.size > 500) return reject('작업순서가 한 번에 처리할 수 있는 한도를 넘었습니다. 분할 저장하지 않았습니다.');
        if ([groups, reset, fence].some(row => row.exists && row.get('companyId') !== companyId)) return reject('작업순서 설정의 소속 회사가 일치하지 않아 처리하지 않았습니다. 소속 정보를 확인해 주세요.');
        const setting = (snapshot: admin.firestore.DocumentSnapshot) => ({ exists: snapshot.exists, version: version(snapshot), data: snapshot.exists ? encode(snapshot.data()!) : null });
        const opening = normalizeWorkOrderOpening({ reference: ref, actorUid: actor.uid, items: items.docs.map(row => ({ id: row.id, data: encode(row.data()), version: version(row) })), groups: setting(groups), reset: setting(reset) }, ref, actor.uid);
        if (input.mode === 'open') return opening;
        if (JSON.stringify(workOrderExpected(opening)) !== JSON.stringify(request!.expected)) return reject('작업순서나 그룹·초기화 상태가 확인 후 변경됐습니다. 최신 목록을 다시 열어 주세요.');
        const req = request!;
        if (req.action === 'resetDaily') {
            if (!sameDay(req.date, workOrderToday())) return reject('초기화 날짜가 현재 공장 날짜와 다릅니다. 현재 날짜로 다시 확인해 주세요.');
            if (reset.exists && sameDay(reset.get('date'), req.date)) return finish(result('applied', hash, '오늘의 작업순서 초기화는 이미 완료됐습니다. 이후 추가한 항목은 유지했습니다.'));
            if (items.size + 3 > 500) return reject('한 번의 초기화 한도를 넘어 아무 항목도 삭제하지 않았습니다.');
            for (const row of items.docs) tx.delete(row.ref);
            if (reset.exists) tx.update(resetRef, { date: req.date, companyId });
            else tx.create(resetRef, { date: req.date, companyId });
            tx.set(fenceRef, { companyId, planId: ref.planId });
            return finish(result('applied', hash, '오늘의 작업순서를 초기화했습니다. 주문 자료는 변경하지 않았습니다.'));
        }
        const existing = new Map(items.docs.map(row => [row.id, row]));
        const additions = req.items.filter(row => !existing.has(row.id));
        const destinations = additions.length ? await tx.getAll(...additions.map(row => db.collection('workOrderItems').doc(row.id))) : [];
        if (destinations.some(row => row.exists)) return reject('새 작업순서 번호가 이미 사용 중입니다. 현재 목록을 다시 열어 주세요.');
        if (req.items.some(row => existing.has(row.id) && existing.get(row.id)!.get('key') !== row.key)) return reject('기존 작업순서의 항목 번호가 달라 저장하지 않았습니다. 현재 목록을 다시 열어 주세요.');
        const nextIds = new Set(req.items.map(row => row.id));
        const removals = items.docs.filter(row => !nextIds.has(row.id));
        const updates = req.items.filter(row => existing.has(row.id)).map(row => {
            const prior = existing.get(row.id)!.data(), patch: Record<string, unknown> = {};
            if (prior.sortIndex !== row.sortIndex) patch.sortIndex = row.sortIndex;
            for (const field of ['groupId', 'groupName', 'workGroup'] as const) if ((prior[field] ?? null) !== (row[field] ?? null)) patch[field] = row[field] ?? null;
            return { row, patch };
        }).filter(value => Object.keys(value.patch).length);
        if (removals.length + additions.length + updates.length + (req.groups === undefined ? 0 : 1) + 2 > 500) return reject('한 번의 저장 한도를 넘어 아무 항목도 변경하지 않았습니다. 분할 저장하지 않았습니다.');
        for (const row of removals) tx.delete(row.ref);
        for (const row of additions) { const { id, ...body } = row; tx.create(db.collection('workOrderItems').doc(id), { ...body, companyId }); }
        for (const { row, patch } of updates) tx.update(existing.get(row.id)!.ref, patch);
        if (req.groups !== undefined) {
            if (groups.exists) tx.update(groupRef, { names: req.groups });
            else tx.create(groupRef, { companyId, names: req.groups });
        }
        tx.set(fenceRef, { companyId, planId: ref.planId });
        return finish(result('applied', hash, '작업순서와 그룹을 함께 저장했습니다.'));
    });
}
export const workOrderCommand = onCall({ region: 'asia-northeast3' }, request => executeWorkOrderCommand(admin.firestore(), request.auth, request.data));
