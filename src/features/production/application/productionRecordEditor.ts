import { OrderStatus, type Item, type Order, type ProductionRecord } from '../../../shared/types';
import { dateOfLocal } from '../../../shared/day';
import { hasProductionRecordIndex } from '../../../shared/productionRecordProjection';

export interface ProductionRecordForm {
    date: string;
    itemId: string;
    finishedQty: string;
    wipItemId: string;
    wipUsed: string;
    note: string;
}
export interface ProductionRecordIdentity {
    id: string;
    createdAt: string;
    currentUserName?: string;
}
export interface ProductionRecordPorts {
    onAdd?: (record: ProductionRecord) => Promise<unknown>;
    onUpdate?: (id: string, patch: Partial<ProductionRecord>) => Promise<unknown>;
    onDelete?: (id: string) => Promise<unknown>;
}
export interface ProductionRecordContext { isCurrent: () => boolean }
export interface ProductionRecordWriteResult {
    status: 'saved' | 'unknown' | 'not-started' | 'stale';
    targetId: string;
    acknowledged: boolean;
    message: string;
}
export interface ProductionRecordSyncPlan {
    records: ProductionRecord[];
    deliveredOrderCount: number;
}
export interface ProductionRecordSyncResult {
    status: 'saved' | 'partial' | 'unknown' | 'not-started' | 'stale';
    confirmedIds: string[];
    failedId: string | null;
    remainingIds: string[];
    message: string;
}

const SUB_ONLY_CATS = new Set(['용기', '마개', '테이프', '박스', '라벨', '향미유', '고춧가루']);

/** 기존 입력 변환을 한 곳에 둔다. 수량·원가의 새 업무 조건을 여기서 만들지 않는다. */
export function buildProductionRecord(form: ProductionRecordForm, items: readonly Item[], identity: ProductionRecordIdentity): ProductionRecord {
    if (!form.itemId || !form.finishedQty) throw Error('품목과 생산수량을 입력해주세요.');
    const product = items.find(item => item.id === form.itemId);
    const wipProduct = form.wipItemId ? items.find(item => item.id === form.wipItemId) : undefined;
    return {
        id: identity.id,
        date: form.date,
        itemId: form.itemId,
        itemName: product?.name ?? '',
        finishedQty: Number(form.finishedQty),
        ...(wipProduct?.id ? { wipItemId: wipProduct.id, wipItemName: wipProduct.name } : {}),
        ...(form.wipUsed ? { wipUsed: Number(form.wipUsed) } : {}),
        ...(product?.cost != null ? { cost: product.cost } : {}),
        ...(form.note ? { note: form.note } : {}),
        ...(identity.currentUserName ? { createdBy: identity.currentUserName } : {}),
        createdAt: identity.createdAt,
    };
}

/** 계획은 최초 클릭 때 고정한다. ACK가 끝난 항목과 미확정 항목은 호출자가 scope별로 제외한다. */
export function planProductionRecordSync(input: {
    orders: readonly Order[];
    items: readonly Item[];
    records: readonly ProductionRecord[];
    excludedIds?: ReadonlySet<string>;
    now?: () => Date;
}): ProductionRecordSyncPlan {
    const deliveredOrders = input.orders.filter(order => order.status === OrderStatus.DELIVERED && order.partnerName !== '생산기록');
    const existingIds = new Set([...input.records.map(record => record.id), ...(input.excludedIds ?? [])]);
    const records: ProductionRecord[] = [];
    for (const order of deliveredOrders) {
        // 새 세대의 현재 기록은 손으로 지워도 옛 주소의 동기화로 되살리지 않는다.
        if (hasProductionRecordIndex(order)) continue;
        for (const item of order.items) {
            const product = input.items.find(product => product.id === item.itemId);
            if (product && SUB_ONLY_CATS.has(product.type)) continue;
            const recordId = `pr-${order.id}-${item.itemId}`;
            if (existingIds.has(recordId)) continue;
            records.push({
                id: recordId,
                date: dateOfLocal(order.deliveredAt || order.createdAt),
                itemId: item.itemId,
                itemName: product?.name ?? item.name,
                finishedQty: item.quantity,
                ...(product?.cost != null ? { cost: product.cost } : {}),
                note: `주문 자동 연동 (${order.partnerName})`,
                createdAt: (input.now?.() ?? new Date()).toISOString(),
            });
            existingIds.add(recordId);
        }
    }
    return { records, deliveredOrderCount: deliveredOrders.length };
}

const failure = (targetId: string, message: string): ProductionRecordWriteResult => ({ status: 'not-started', targetId, acknowledged: false, message });
const reason = (error: unknown) => error instanceof Error ? error.message : String(error);

async function executeWrite(targetId: string, context: ProductionRecordContext, send: (() => Promise<unknown>) | undefined): Promise<ProductionRecordWriteResult> {
    if (!context.isCurrent()) return failure(targetId, '회사 또는 로그인 계정이 바뀌어 이 요청을 보내지 않았습니다.');
    if (!send) return failure(targetId, '생산 실적 저장 기능이 연결되지 않았습니다. 현재 목록을 확인하고 다시 열어 주세요.');
    try {
        const pending = send();
        // void 반환을 성공 ACK로 간주하면 이전 fire-and-forget 문제가 다시 생긴다.
        if (!pending || typeof pending.then !== 'function') throw Error('저장 완료 응답을 기다릴 수 없는 연결입니다.');
        await pending;
        if (!context.isCurrent()) return { status: 'stale', targetId, acknowledged: true, message: '이전 화면의 요청은 응답을 받았습니다. 현재 입력은 변경하지 않았습니다.' };
        return { status: 'saved', targetId, acknowledged: true, message: '생산 실적 처리를 완료했습니다.' };
    } catch (error) {
        return { status: 'unknown', targetId, acknowledged: false, message: `${reason(error)} 처리 결과를 확정하지 못했습니다. 현재 목록을 확인해 주세요. 이 요청을 자동으로 다시 보내지 않았습니다.` };
    }
}

export function addProductionRecord(record: ProductionRecord, ports: ProductionRecordPorts, context: ProductionRecordContext): Promise<ProductionRecordWriteResult> {
    const original = structuredClone(record);
    return executeWrite(original.id, context, ports.onAdd ? () => ports.onAdd!(original) : undefined);
}
export function updateProductionRecordDate(recordId: string, date: string, ports: ProductionRecordPorts, context: ProductionRecordContext): Promise<ProductionRecordWriteResult> {
    if (!date) return Promise.resolve(failure(recordId, '생산 날짜를 입력해 주세요.'));
    return executeWrite(recordId, context, ports.onUpdate ? () => ports.onUpdate!(recordId, { date }) : undefined);
}
export function deleteProductionRecord(recordId: string, ports: ProductionRecordPorts, context: ProductionRecordContext): Promise<ProductionRecordWriteResult> {
    return executeWrite(recordId, context, ports.onDelete ? () => ports.onDelete!(recordId) : undefined);
}

/** 첫 미확정 이후 멈춘다. 단일 영수증이 없는 여러 쓰기를 전체 성공·전체 실패로 뭉치지 않는다. */
export async function runProductionRecordSync(plan: ProductionRecordSyncPlan, ports: ProductionRecordPorts, context: ProductionRecordContext): Promise<ProductionRecordSyncResult> {
    const records = structuredClone(plan.records), confirmedIds: string[] = [];
    for (let index = 0; index < records.length; index++) {
        const record = records[index];
        const result = await addProductionRecord(record, ports, context);
        if (result.acknowledged) confirmedIds.push(record.id);
        if (result.status !== 'saved') {
            const unattempted = result.status === 'not-started' ? index : index + 1;
            return {
                status: result.status === 'stale' ? 'stale' : result.status === 'not-started' ? 'not-started' : confirmedIds.length ? 'partial' : 'unknown',
                confirmedIds,
                failedId: result.status === 'unknown' ? record.id : null,
                remainingIds: records.slice(unattempted).map(record => record.id),
                message: `${confirmedIds.length}건은 완료 응답을 받았습니다. ${result.message} 나머지 기록은 보내지 않았습니다.`,
            };
        }
    }
    return {
        status: 'saved', confirmedIds, failedId: null, remainingIds: [],
        message: plan.deliveredOrderCount === 0 ? '이력에 완료된 주문이 없습니다.' : confirmedIds.length === 0 ? '동기화할 새 기록이 없습니다.' : `${confirmedIds.length}건 동기화 완료`,
    };
}
