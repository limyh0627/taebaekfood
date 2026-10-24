import { doc, getDocFromServer, type Firestore } from 'firebase/firestore';
import { auth, authReady, db } from '../firebase';
import { prepareCatalogOrderCommit, runInventoryWriterTransaction, captureInventoryWriterContext } from '../inventoryWriterProtocol';
import { stripUndefined } from './firebaseService';
import { itemWritePayload } from '../itemWritePayload';
import { withClaimCompany } from '../companyWriteBoundary';
import { nextPoNo } from '../cardNo';
import type { CompanyId } from '../types';
export interface PurchaseOrderBatchRow {
    id: string;
    quantity: number;
    boxQuantity?: number;
    partnerId?: string;
}
export interface PurchaseOrderBatchScope {
    companyId: CompanyId;
    actorUid: string;
    isCurrent: () => boolean;
}
export interface PurchaseOrderBatchRequest {
    version: 1;
    companyId: CompanyId;
    actorUid: string;
    operationId: string;
    createdAt: string;
    orders: readonly {
        id: string;
        data: Record<string, unknown>;
    }[];
}
export interface PurchaseOrderBatchReference {
    version: 1;
    companyId: CompanyId;
    actorUid: string;
    operationId: string;
    requestHash: string;
}
export interface PurchaseOrderBatchResult {
    reference: PurchaseOrderBatchReference;
    status: 'applied' | 'cancelled' | 'not-found';
}
export type PreparePurchaseOrderBatch = (rows: PurchaseOrderBatchRow[]) => PurchaseOrderBatchRequest | Promise<PurchaseOrderBatchRequest>;
export class PurchaseOrderBatchError extends Error {
    constructor(message: string, readonly outcome: 'not-started' | 'unknown') { super(message); }
}
/** 응답 실패를 미처리로 단정하지 않고, 원오류는 진단용 cause에만 보존한다. */
function responseError(error: unknown, phase: '발주 처리' | '중단' | '처리 결과 조회'): PurchaseOrderBatchError {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code.replace(/^firestore\//, '') : '';
    const reasons: Record<string, string> = {
        'permission-denied': '현재 계정의 회사 또는 발주 처리 권한을 확인하지 못했습니다. 로그인 회사와 권한을 확인한 뒤 보관된 요청의 처리 결과를 먼저 조회해 주세요.',
        'unauthenticated': '로그인 인증을 확인하지 못했습니다. 로그인 상태를 확인한 뒤 보관된 요청의 처리 결과를 먼저 조회해 주세요.',
        'unavailable': '서버 연결이 원활하지 않아 처리 응답을 확인하지 못했습니다. 연결을 확인한 뒤 보관된 요청의 처리 결과를 먼저 조회해 주세요.',
        'deadline-exceeded': '응답 대기 시간이 지나 처리 결과를 확인하지 못했습니다. 보관된 요청의 처리 결과를 먼저 조회해 주세요.',
    };
    const message = reasons[code] ?? `${phase} 결과를 확인하지 못했습니다. 보관된 같은 요청을 조회한 뒤 다시 진행해 주세요.`;
    return Object.assign(new PurchaseOrderBatchError(message, 'unknown'), { cause: error });
}
const fail = (message = '발주 묶음 원문을 확인할 수 없습니다. 보관된 요청을 다시 확인해 주세요.'): never => { throw new PurchaseOrderBatchError(message, 'not-started'); };
const plain = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const idOk = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !value.includes('/');
const canonical = (value: unknown): unknown => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return value;
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (Array.isArray(value))
        return value.map(canonical);
    if (!plain(value))
        return fail();
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
};
const text = (value: unknown) => JSON.stringify(canonical(value));
const freeze = <T>(value: T): T => {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
};
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).sort().join('|') === expected.sort().join('|');
export function normalizePurchaseOrderBatchReference(value: unknown): PurchaseOrderBatchReference {
    if (!plain(value) || !keys(value, ['version', 'companyId', 'actorUid', 'operationId', 'requestHash']) || value.version !== 1
        || !['taebaek', 'punghoe'].includes(value.companyId) || !idOk(value.actorUid)
        || !idOk(value.operationId) || !value.operationId.startsWith('po-batch-') || !/^[a-f0-9]{64}$/.test(value.requestHash))
        return fail();
    return freeze(JSON.parse(text(value)));
}
export function normalizePurchaseOrderBatchRequest(value: unknown): PurchaseOrderBatchRequest {
    if (!plain(value) || !keys(value, ['version', 'companyId', 'actorUid', 'operationId', 'createdAt', 'orders']) || value.version !== 1
        || !['taebaek', 'punghoe'].includes(value.companyId) || !idOk(value.actorUid) || !idOk(value.operationId)
        || !value.operationId.startsWith('po-batch-') || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
        || !Array.isArray(value.orders) || value.orders.length < 1 || value.orders.length > 5)
        return fail('한 번에 거래처별 발주 1~5건을 저장할 수 있습니다.');
    const ids = new Set<string>();
    for (const order of value.orders) {
        if (!plain(order) || !keys(order, ['id', 'data']) || !idOk(order.id) || ids.has(order.id) || !plain(order.data))
            return fail();
        ids.add(order.id);
        const data = order.data;
        if (data.companyId !== value.companyId || data.createdAt !== value.createdAt || data.status !== 'pending'
            || 'id' in data || !Array.isArray(data.items) || !data.items.length || data.items.some((row: any) => !plain(row)
            || !idOk(row.itemId) || typeof row.quantity !== 'number' || !Number.isFinite(row.quantity) || row.quantity <= 0))
            return fail('품목과 0보다 큰 수량을 입력해 주세요.');
        if ('inventoryWriteRevision' in data || 'inventoryWriterProtocolVersion' in data)
            return fail();
    }
    const encoded = text(value);
    // Rules 접근 한도와 별도로 요청 크기를 첫 쓰기 전에 제한한다. 큰 묶음을 나눠 부분 저장하지 않는다.
    if (new TextEncoder().encode(encoded).length > 180000)
        return fail('발주 내용이 너무 큽니다. 품목을 줄여 새로 작성해 주세요.');
    return freeze(JSON.parse(encoded));
}
export const serializePurchaseOrderBatchRequest = (value: PurchaseOrderBatchRequest): string => text(normalizePurchaseOrderBatchRequest(value));
export async function purchaseOrderBatchReference(request: PurchaseOrderBatchRequest): Promise<PurchaseOrderBatchReference> {
    const value = normalizePurchaseOrderBatchRequest(request);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serializePurchaseOrderBatchRequest(value)));
    return normalizePurchaseOrderBatchReference({ version: 1, companyId: value.companyId, actorUid: value.actorUid, operationId: value.operationId,
        requestHash: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') });
}
export function preparePurchaseOrderBatch(scope: PurchaseOrderBatchScope, orders: PurchaseOrderBatchRequest['orders'], meta: {
    operationId: string;
    createdAt: string;
}): PurchaseOrderBatchRequest {
    if (!scope.isCurrent() || !scope.actorUid)
        return fail('로그인이 변경되어 발주를 준비하지 않았습니다.');
    return normalizePurchaseOrderBatchRequest({ version: 1, companyId: scope.companyId, actorUid: scope.actorUid, operationId: meta.operationId, createdAt: meta.createdAt, orders });
}
export function planPurchaseOrderBatch(input: {
    scope: PurchaseOrderBatchScope;
    rows: PurchaseOrderBatchRow[];
    operationId: string;
    createdAt: string;
    date: string;
    items: readonly {
        id: string;
        name?: string;
        unit?: string;
    }[];
    partners: readonly {
        id: string;
        name?: string;
    }[];
    partnerIn: readonly {
        itemId: string;
        partnerId: string;
    }[];
    purchaseOrders: readonly {
        cardNo?: string;
    }[];
}): PurchaseOrderBatchRequest {
    if (input.rows.some(row => row.partnerId && (!input.partners.some(partner => partner.id === row.partnerId)
        || !input.partnerIn.some(link => link.itemId === row.id && link.partnerId === row.partnerId))))
        fail('선택한 매입 거래처 연결이 변경되었습니다. 다시 선택해 주세요.');
    const groups = new Map<string, {
        partnerId?: string;
        partnerName?: string;
        rows: PurchaseOrderBatchRow[];
    }>();
    input.rows.forEach((row, index) => {
        const partnerId = row.partnerId || input.partnerIn.find(link => link.itemId === row.id)?.partnerId;
        const key = partnerId || `__none_${index}`;
        if (!groups.has(key))
            groups.set(key, { partnerId, partnerName: input.partners.find(partner => partner.id === partnerId)?.name, rows: [] });
        groups.get(key)!.rows.push(row);
    });
    const numbered = [...input.purchaseOrders];
    const orders = [...groups.values()].map((group, index) => {
        const cardNo = nextPoNo(input.date, numbered);
        numbered.push({ cardNo });
        const data = withClaimCompany('purchaseOrders', itemWritePayload('purchaseOrders', stripUndefined({
            cardNo, itemId: '', itemName: '', quantity: 0, status: 'pending', createdAt: input.createdAt,
            items: group.rows.map(row => {
                const product = input.items.find(item => item.id === row.id);
                return {
                    itemId: row.id, name: product?.name ?? '', quantity: row.quantity, unit: product?.unit ?? '개', ...(row.boxQuantity ? { boxQuantity: row.boxQuantity } : {}),
                };
            }), ...(group.partnerId ? { partnerId: group.partnerId, partnerName: group.partnerName } : {}),
        })), { companyId: input.scope.companyId });
        return { id: `${input.operationId}-po-${index}`, data };
    });
    return preparePurchaseOrderBatch(input.scope, orders, input);
}
async function actor(scope: PurchaseOrderBatchScope) {
    const companyId = scope.companyId, actorUid = scope.actorUid;
    await authReady;
    const user = auth.currentUser, uid = user?.uid;
    const current = () => scope.companyId === companyId && scope.actorUid === actorUid && scope.isCurrent()
        && !!uid && actorUid === uid && auth.currentUser === user && user?.uid === uid;
    if (!current())
        fail('로그인이 변경되었습니다. 현재 계정에서 다시 확인해 주세요.');
    const token = await user!.getIdTokenResult();
    if (!current() || token.claims.companyId !== companyId || typeof token.claims.employeeId !== 'string')
        fail('로그인 회사와 직원 정보를 확인해 주세요.');
    return () => { if (!current())
        fail('로그인이 변경되었습니다. 현재 계정에서 다시 확인해 주세요.'); };
}
function bind(scope: PurchaseOrderBatchScope, ref: PurchaseOrderBatchReference) {
    if (scope.companyId !== ref.companyId || scope.actorUid !== ref.actorUid)
        fail('다른 회사 또는 계정의 발주 요청입니다.');
}
const receiptRef = (store: Firestore, ref: PurchaseOrderBatchReference) => doc(store, 'purchaseOrderBatchAudits', ref.operationId);
async function terminal(raw: unknown, ref: PurchaseOrderBatchReference): Promise<'applied' | 'cancelled'> {
    if (!plain(raw) || raw.kind !== 'purchase-order-batch' || raw.companyId !== ref.companyId || text(raw.reference) !== text(ref)
        || !['applied', 'cancelled'].includes(raw.status))
        fail('발주 처리 기록이 다른 요청이거나 손상되었습니다.');
    if ((raw as Record<string, any>).request === null) {
        if ((raw as Record<string, any>).status !== 'cancelled')
            fail();
    }
    else if (text(await purchaseOrderBatchReference(normalizePurchaseOrderBatchRequest((raw as Record<string, any>).request))) !== text(ref))
        fail('발주 처리 기록의 원문이 다릅니다.');
    return (raw as Record<string, any>).status;
}
export async function applyPurchaseOrderBatch(scope: PurchaseOrderBatchScope, input: PurchaseOrderBatchRequest, store: Firestore = db): Promise<PurchaseOrderBatchResult> {
    const request = normalizePurchaseOrderBatchRequest(input), reference = await purchaseOrderBatchReference(request);
    bind(scope, reference);
    const check = await actor(scope);
    let sent = false;
    try {
        const context = await captureInventoryWriterContext(store, { companyId: scope.companyId, requestIdentity: serializePurchaseOrderBatchRequest(request), ready: authReady, getCurrentUser: () => auth.currentUser, isStillCurrent: scope.isCurrent });
        check();
        const status = await runInventoryWriterTransaction(store, context, async (tx) => {
            check();
            const receipt = receiptRef(store, reference), observed = await tx.get(receipt);
            check();
            if (observed.exists())
                return terminal(observed.data(), reference);
            const targets = request.orders.map(order => doc(store, 'purchaseOrders', order.id));
            for (const target of targets) {
                const found = await tx.get(target);
                check();
                if (found.exists())
                    fail('같은 발주 ID가 이미 있습니다. 기존 발주는 덮어쓰지 않았습니다.');
            }
            const prepared: Record<string, any>[] = [];
            for (let index = 0; index < targets.length; index++) {
                prepared.push(await prepareCatalogOrderCommit(store, tx, request.orders[index].id, undefined, request.orders[index].data, true, 'purchaseOrders'));
                check();
            }
            // catalog proof를 포함한 모든 읽기가 끝난 뒤에만 업무문서와 영수증을 함께 쓴다.
            sent = true;
            targets.forEach((target, index) => tx.set(target, prepared[index]));
            tx.set(receipt, { kind: 'purchase-order-batch', companyId: reference.companyId, reference, request, status: 'applied' });
            return 'applied' as const;
        });
        if (sent) {
            try {
                check();
            }
            catch {
                throw new PurchaseOrderBatchError('처리 결과 확인이 필요합니다. 보관된 발주 요청을 조회해 주세요.', 'unknown');
            }
        }
        else
            check();
        return { reference, status };
    }
    catch (error) {
        if (!sent && error instanceof PurchaseOrderBatchError)
            throw error;
        throw responseError(error, '발주 처리');
    }
}
export async function inspectPurchaseOrderBatch(scope: PurchaseOrderBatchScope, input: PurchaseOrderBatchReference, store: Firestore = db): Promise<PurchaseOrderBatchResult> {
    const reference = normalizePurchaseOrderBatchReference(input);
    bind(scope, reference);
    const check = await actor(scope);
    try {
        const observed = await getDocFromServer(receiptRef(store, reference));
        check();
        const status = observed.exists() ? await terminal(observed.data(), reference) : 'not-found';
        check();
        return { reference, status };
    }
    catch (error) {
        if (error instanceof PurchaseOrderBatchError)
            throw error;
        throw responseError(error, '처리 결과 조회');
    }
}
export async function cancelPurchaseOrderBatch(scope: PurchaseOrderBatchScope, input: PurchaseOrderBatchReference, store: Firestore = db): Promise<PurchaseOrderBatchResult> {
    const reference = normalizePurchaseOrderBatchReference(input);
    bind(scope, reference);
    const check = await actor(scope);
    try {
        const status = await runInventoryWriterTransaction(store, undefined, async (tx) => {
            check();
            const target = receiptRef(store, reference), observed = await tx.get(target);
            check();
            if (observed.exists())
                return terminal(observed.data(), reference);
            tx.set(target, { kind: 'purchase-order-batch', companyId: reference.companyId, reference, request: null, status: 'cancelled' });
            return 'cancelled' as const;
        });
        check();
        return { reference, status };
    }
    catch (error) {
        throw responseError(error, '중단');
    }
}
