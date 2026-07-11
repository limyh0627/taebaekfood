import { doc, setDoc, deleteDoc, Firestore } from 'firebase/firestore';
import { Order, OrderItem, Item, OrderStatus, AppNotification, ShippingRule, Partner, RawMaterialLot } from '../../shared/types';
import { toKg, baseRawName, lotStockInUnit } from '../../constants/formula';
import { deductFromLots, withCarryOverLot, buildReceiveLot } from '../../shared/lotUtils';

/**
 * 생산/출고 분리 재고 엔진 (도메인 모듈).
 *  작업완료(DISPATCHED) = 생산처리: 완제품 원료·부자재 차감 + 완제품 재고 +N (상품은 미변동)
 *  출고(SHIPPED)        = 완제품/상품 재고 −N
 *  되돌리기 = 뺀 만큼 그대로 복원(원료는 rawConsumedLots 스냅샷으로 로트에 +).
 *  reconcileOrderStock(order, target)이 목표 상태에 맞춰 자동 조정 → changeOrderStatus가 진입점.
 *
 * AdminApp에서 매 렌더 시점의 데이터·쓰기 함수를 주입해 생성한다(순수 로직 + 의존성 주입).
 */
export interface OrderStockEngineDeps {
  allItems: Item[];
  shippingRules: ShippingRule[];
  submaterials: Item[];
  partners: Partner[];
  allOrders: Order[];
  orders: Order[];
  db: Firestore;
  buildFormula: (prodKey: string) => { raw: string; ratio: number }[];
  createProductionRecordsForOrder: (order: Order) => Promise<void>;
  mutateRawMaterialLots: (rawItemId: string, transform: (lots: RawMaterialLot[], stock: number) => RawMaterialLot[], computeStock?: (lots: RawMaterialLot[]) => number) => Promise<RawMaterialLot[]>;
  updateItem: (collection: string, id: string, data: Record<string, any>) => Promise<any>;
  addItem: (collection: string, data: Record<string, any>) => Promise<any>;
}

export function createOrderStockEngine(deps: OrderStockEngineDeps) {
  const { allItems, shippingRules, submaterials, partners, allOrders, orders, db,
    buildFormula, createProductionRecordsForOrder, mutateRawMaterialLots, updateItem, addItem } = deps;

  const isGoodsItem = (p: Item) =>
    p.subtype === '향미유' || p.subtype === '고춧가루' ||
    p.category === '향미유' || p.category === '고춧가루' || p.category === 'goods';
  const goodsShipQty = (item: OrderItem, product: Item) => {
    const uPerBox = item.unitsPerBox || product.defaultBoxConfig?.unitsPerBox || product.boxSize || 12;
    return item.isBoxUnit && item.boxQuantity ? item.boxQuantity * uPerBox : item.quantity;
  };
  const addDelta = (m: Map<string, number>, id: string, d: number) => { if (d) m.set(id, (m.get(id) ?? 0) + d); };

  // 품목 재고 델타 일괄 반영 — 한 상태전환에서 같은 품목이 +/−로 겹쳐도(생산+출고 스킵 등) 순변화만 1회 기록.
  const applyStockDeltas = async (deltas: Map<string, number>) => {
    for (const [itemId, delta] of deltas) {
      if (!delta) continue;
      const it = allItems.find(p => p.id === itemId);
      if (!it) continue;
      const newStock = Math.round((it.stock + delta) * 1000) / 1000;
      await updateItem('items', itemId, { stock: newStock });
      if (newStock < 0) {
        console.warn(`[재고 부족] ${it.name}: ${it.stock} → ${newStock}`);
        await addItem('notifications', {
          type: 'inventory_shortage', title: '재고 부족 경고',
          body: `${it.name}: 재고 ${newStock} (부족분 ${Math.abs(newStock)}). 주문 상태변경 반영 확인 필요.`,
          linkedId: itemId, readBy: [], createdAt: new Date().toISOString(),
        } as Omit<AppNotification, 'id'>);
      }
    }
  };

  // 완제품 부자재 차감/복원 델타 적재 (박스 포함, 테이프 제외). sign=-1 차감 / +1 복원.
  const accrueSubmaterialDeltas = (order: Order, product: Item, item: OrderItem, deltas: Map<string, number>, sign: number) => {
    if (!product.submaterials) return;
    const boxesUsed = item.isBoxUnit && item.boxQuantity ? item.boxQuantity
      : item.unitsPerBox ? Math.ceil(item.quantity / item.unitsPerBox) : null;
    const shippingRule = shippingRules.find(r => r.item_id === product.id && r.partner_id === order.partnerId);
    const boxSubId = item.boxSubId || shippingRule?.box_item_id;
    const boxSub = boxSubId ? submaterials.find(sm => sm.id === boxSubId) : null;
    if (boxSub) { const dq = boxesUsed ?? Math.ceil(item.quantity / (boxSub.boxSize || 1)); if (dq > 0) addDelta(deltas, boxSub.id, sign * dq); }
    for (const s of product.submaterials) {
      const sub = submaterials.find(sm => sm.id === s.id);
      if (!sub) continue;
      if (sub.category === 'box' || sub.category === 'tape' ||
          (sub.category === 'submaterial' && (sub.subtype === '박스' || sub.subtype === '테이프'))) continue;
      addDelta(deltas, sub.id, sign * item.quantity);
    }
  };

  // 원료 로트 FIFO 차감 + 수불부 기록 → 소비 로트 스냅샷 반환 (생산처리).
  const deductRawLotsForOrder = async (order: Order, rawUsage: Record<string, number>) => {
    const consumedLots: NonNullable<Order['rawConsumedLots']> = [];
    const rawNames = Object.keys(rawUsage);
    if (rawNames.length === 0) return consumedLots;
    const dateStr = order.deliveredAt?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    const customerName = partners.find(c => c.id === order.partnerId)?.name || order.partnerName || '';
    for (const raw of rawNames) {
      const usedKg = Math.round(rawUsage[raw] * 1000) / 1000;
      // 원료 홀더 = raw, 또는 wip 벌크 반제품(unit≠'개'). phantom(무재고)은 이미 전개돼 여기 오지 않음.
      const rawItem = allItems.find(i => !i.phantom && (i.category === 'raw' || (i.category === 'wip' && i.unit !== '개')) && baseRawName(i.name) === raw);
      let noteSuffix = '';
      if (rawItem) {
        const mix = rawItem.mixEnabled ? { topPercent: rawItem.mixTopPercent ?? 50 } : undefined;
        let captured: { distribution: { lotId?: string; supplierName: string; lotNo?: string; receivedDate?: string; kg: number }[]; shortageKg: number } | null = null;
        await mutateRawMaterialLots(
          rawItem.id,
          (lots, stock) => { const r = deductFromLots(withCarryOverLot(lots, stock, raw), usedKg, mix); captured = r; return r.lots; },
          (lots) => lotStockInUnit(lots, raw),
        );
        if (captured) {
          const result = captured as { distribution: { lotId?: string; supplierName: string; lotNo?: string; receivedDate?: string; kg: number }[]; shortageKg: number };
          if (result.distribution.length > 0) {
            noteSuffix = ' ▸ ' + result.distribution.map(d => `${d.supplierName} ${Math.round(d.kg * 10) / 10}kg`).join(' + ');
            for (const d of result.distribution) consumedLots.push({
              material: raw, supplierName: d.supplierName, kg: d.kg,
              ...(d.lotId ? { lotId: d.lotId } : {}), ...(d.lotNo ? { lotNo: d.lotNo } : {}), ...(d.receivedDate ? { receivedDate: d.receivedDate } : {}),
            });
          }
          if (result.shortageKg > 0) {
            console.warn(`[원료 부족] ${raw}: 로트 잔량보다 ${result.shortageKg}kg 더 사용 (주문 ${order.id})`);
            await addItem('notifications', { type: 'inventory_shortage', title: '원료 로트 부족', body: `${raw}: 로트 잔량보다 ${result.shortageKg}kg 더 사용됨 (주문 ${order.id}, ${customerName}). 입고/이월 확인 필요.`, linkedId: rawItem.id, readBy: [], createdAt: new Date().toISOString() } as Omit<AppNotification, 'id'>);
          }
        }
      }
      const entryId = `rm-auto-${order.id}-${raw.replace(/\s/g, '_')}`;
      await setDoc(doc(db, 'rawMaterialLedger', entryId), { id: entryId, material: raw, date: dateStr, received: 0, used: usedKg, note: `자동: ${customerName}${noteSuffix}`, createdAt: new Date().toISOString(), type: 'auto', orderId: order.id }, { merge: true });
    }
    return consumedLots;
  };

  // 원료 로트 복원 (생산처리 취소) — 소비 스냅샷대로 로트 kg 되돌림 + 수불부 auto 삭제.
  const restoreRawLotsForOrder = async (order: Order) => {
    const consumed = order.rawConsumedLots ?? [];
    const byMat: Record<string, NonNullable<Order['rawConsumedLots']>> = {};
    for (const c of consumed) (byMat[c.material] = byMat[c.material] || []).push(c);
    for (const [material, arr] of Object.entries(byMat)) {
      const rawItem = allItems.find(i => !i.phantom && (i.category === 'raw' || (i.category === 'wip' && i.unit !== '개')) && baseRawName(i.name) === material);
      if (rawItem) {
        await mutateRawMaterialLots(
          rawItem.id,
          (lots, stock) => {
            const next = withCarryOverLot(lots, stock, material).map(l => ({ ...l }));
            for (const c of arr) {
              const idx = c.lotId ? next.findIndex(l => l.id === c.lotId) : -1;
              if (idx >= 0) {
                next[idx].kgRemaining = Math.round(((next[idx].kgRemaining ?? 0) + c.kg) * 1000) / 1000;
                if (next[idx].kgRemaining > 0) next[idx].status = 'active';
              } else {
                next.push(buildReceiveLot({ material, supplierName: c.supplierName || '복원', qtyIn: 0, kgIn: c.kg, receivedDate: c.receivedDate }));
              }
            }
            return next;
          },
          (lots) => lotStockInUnit(lots, material),
        );
      }
      await deleteDoc(doc(db, 'rawMaterialLedger', `rm-auto-${order.id}-${material.replace(/\s/g, '_')}`));
    }
  };

  // 생산처리(작업완료): 원료·부자재 차감 + 완제품 재고 +N. → 소비 로트 스냅샷 반환.
  const produceOrder = async (order: Order, deltas: Map<string, number>) => {
    const rawUsage: Record<string, number> = {};
    for (const item of order.items) {
      const product = allItems.find(p => p.id === item.itemId);
      if (!product || isGoodsItem(product)) continue;
      if (product.category !== 'product' || !product.submaterials) continue;
      accrueSubmaterialDeltas(order, product, item, deltas, -1);
      for (const f of buildFormula(product.품목 || product.name)) {
        const usedKg = toKg(product.spec || '', f.raw, item.quantity) * f.ratio;
        if (usedKg > 0) rawUsage[f.raw] = (rawUsage[f.raw] ?? 0) + usedKg;
      }
      addDelta(deltas, product.id, item.quantity); // 완제품 재고 +N (생산됨·미출고)
    }
    const consumedLots = await deductRawLotsForOrder(order, rawUsage);
    await createProductionRecordsForOrder(order);
    return consumedLots;
  };

  // 생산처리 취소: 부자재·원료 복원 + 완제품 재고 −N.
  const unProduceOrder = async (order: Order, deltas: Map<string, number>) => {
    for (const item of order.items) {
      const product = allItems.find(p => p.id === item.itemId);
      if (!product || isGoodsItem(product)) continue;
      if (product.category !== 'product' || !product.submaterials) continue;
      accrueSubmaterialDeltas(order, product, item, deltas, +1);
      addDelta(deltas, product.id, -item.quantity); // 완제품 재고 되돌림
    }
    await restoreRawLotsForOrder(order);
  };

  // 출고: 완제품/상품 재고 −N.
  const shipOrder = (order: Order, deltas: Map<string, number>) => {
    for (const item of order.items) {
      const product = allItems.find(p => p.id === item.itemId);
      if (!product) continue;
      if (isGoodsItem(product)) addDelta(deltas, product.id, -goodsShipQty(item, product));
      else if (product.category === 'product') addDelta(deltas, product.id, -item.quantity);
    }
  };

  // 출고 취소: 완제품/상품 재고 +N.
  const unShipOrder = (order: Order, deltas: Map<string, number>) => {
    for (const item of order.items) {
      const product = allItems.find(p => p.id === item.itemId);
      if (!product) continue;
      if (isGoodsItem(product)) addDelta(deltas, product.id, goodsShipQty(item, product));
      else if (product.category === 'product') addDelta(deltas, product.id, item.quantity);
    }
  };

  const STATUS_WANT_PRODUCED = new Set<OrderStatus>([OrderStatus.DISPATCHED, OrderStatus.SHIPPED, OrderStatus.DELIVERED]);
  const STATUS_WANT_SHIPPED = new Set<OrderStatus>([OrderStatus.SHIPPED, OrderStatus.DELIVERED]);

  // 목표 상태에 맞춰 재고 상태를 조정(생산/출고/취소 자동). ON_HOLD은 재고 미변동.
  const reconcileOrderStock = async (order: Order, target: OrderStatus) => {
    if (target === OrderStatus.ON_HOLD) return;
    const wantProduced = STATUS_WANT_PRODUCED.has(target);
    const wantShipped = STATUS_WANT_SHIPPED.has(target);
    const deltas = new Map<string, number>();
    const patch: Partial<Order> = {};
    // 역방향(되돌리기): 출고취소 → 생산취소
    if (!wantShipped && order.shippedOut) { unShipOrder(order, deltas); patch.shippedOut = false; }
    if (!wantProduced && order.producedAt) { await unProduceOrder(order, deltas); patch.producedAt = ''; patch.rawLotsDeducted = false; patch.rawConsumedLots = []; }
    // 정방향: 생산 → 출고
    if (wantProduced && !order.producedAt) { const consumed = await produceOrder(order, deltas); patch.producedAt = new Date().toISOString(); patch.rawLotsDeducted = true; if (consumed.length > 0) patch.rawConsumedLots = consumed; }
    if (wantShipped && !order.shippedOut) { shipOrder(order, deltas); patch.shippedOut = true; }
    await applyStockDeltas(deltas);
    if (Object.keys(patch).length > 0) await updateItem('orders', order.id, patch);
  };

  // 주문 상태 변경 진입점 — 재고 조정 후 상태 저장. 이미 이력(DELIVERED)이면 재고 조정 없이 상태만.
  const changeOrderStatus = async (id: string, status: OrderStatus) => {
    const order = allOrders.find(o => o.id === id) || orders.find(o => o.id === id);
    if (!order) { await updateItem('orders', id, { status }); return; }
    if (order.status !== OrderStatus.DELIVERED) await reconcileOrderStock(order, status);
    await updateItem('orders', id, { status, ...(status === OrderStatus.DELIVERED && !order.deliveredAt ? { deliveredAt: new Date().toISOString() } : {}) });
  };

  return { changeOrderStatus, reconcileOrderStock };
}
