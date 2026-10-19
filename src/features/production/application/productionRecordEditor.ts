import { productionRecordSourceEvidence } from '../../../shared/productionRecordCommand';
import type { CatalogValue } from '../../../shared/productionRecordCommand';
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
export interface ProductionRecordSyncPlan {
    records: ProductionRecord[];
    deliveredOrderCount: number;
    sources?: Record<string, {
        orderId: string;
        evidence: CatalogValue;
    }>;
}
const SUB_ONLY_CATS = new Set(['용기', '마개', '테이프', '박스', '라벨', '향미유', '고춧가루']);
/** 기존 입력 변환을 한 곳에 둔다. 수량·원가의 새 업무 조건을 여기서 만들지 않는다. */
export function buildProductionRecord(form: ProductionRecordForm, items: readonly Item[], identity: ProductionRecordIdentity): ProductionRecord {
    if (!form.itemId || !form.finishedQty)
        throw Error('품목과 생산수량을 입력해주세요.');
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
    const sources: NonNullable<ProductionRecordSyncPlan['sources']> = {};
    for (const order of deliveredOrders) {
        // 새 세대의 현재 기록은 손으로 지워도 옛 주소의 동기화로 되살리지 않는다.
        if (hasProductionRecordIndex(order))
            continue;
        for (const item of order.items) {
            const product = input.items.find(product => product.id === item.itemId);
            if (product && SUB_ONLY_CATS.has(product.type))
                continue;
            const recordId = `pr-${order.id}-${item.itemId}`;
            if (existingIds.has(recordId))
                continue;
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
            sources[recordId] = { orderId: order.id, evidence: productionRecordSourceEvidence(order) };
            existingIds.add(recordId);
        }
    }
    return { records, deliveredOrderCount: deliveredOrders.length, sources };
}
