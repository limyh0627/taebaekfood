import { doc, setDoc, deleteDoc, Firestore } from 'firebase/firestore';
import { Order, OrderItem, Item, OrderStatus, AppNotification, ShippingRule, Partner, RawMaterialLot } from '../../shared/types';
import { toKg, baseRawName, lotStockInUnit, unitToKg } from '../../constants/formula';
import { deductFromLots, withCarryOverLot, buildReceiveLot } from '../../shared/lotUtils';
import { bomQty } from '../../shared/bom';
import { stockUnits, isBoxStockItem } from '../../shared/orderUnits';

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
    p.category === '향미유' || p.category === '고춧가루' || p.category === 'goods' ||
    p.procureType === '완사입' || p.procureType === '임가공'; // 사입·임가공 완제품 — 판매 시 생산 없이 자기 재고만 차감(원료는 완사입=무관/임가공=가공입고 때 소진)
  const goodsShipQty = (item: OrderItem, product: Item) => {
    // 박스 품목(BOM에 낱개가 물린 것)은 재고 단위가 박스 → 박스 개수로 뺀다.
    if (isBoxStockItem(product)) return stockUnits(item, product);
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

  // 겉박스 — 일반(낱개) 품목은 거래처별 배송규칙(shipping_rule)에서 온다. sign=-1 차감 / +1 복원.
  // 박스 품목은 겉박스가 자기 BOM에 ×1로 들어있어 accrueBom이 깐다(여기 안 옴).
  const accrueShippingBox = (order: Order, product: Item, item: OrderItem, deltas: Map<string, number>, sign: number) => {
    const boxesUsed = item.isBoxUnit && item.boxQuantity ? item.boxQuantity
      : item.unitsPerBox ? Math.ceil(item.quantity / item.unitsPerBox) : null;
    const shippingRule = shippingRules.find(r => r.item_id === product.id && r.partner_id === order.partnerId);
    const boxSubId = item.boxSubId || shippingRule?.box_item_id;
    const boxSub = boxSubId ? submaterials.find(sm => sm.id === boxSubId) : null;
    if (!boxSub) return;
    const dq = boxesUsed ?? Math.ceil(item.quantity / (boxSub.boxSize || 1));
    if (dq > 0) addDelta(deltas, boxSub.id, sign * dq);
  };

  // 낱개 품목의 겉박스는 shipping_rule이 따로 깎으므로 BOM에서 건너뛴다(이중 차감 방지).
  // 박스 품목은 겉박스가 자기 BOM 구성품이라 그건 깎는다 — isBoxStockItem일 때만 허용.
  // 테이프는 코드로 막지 않는다 — 안 깎으려면 BOM 수량을 0으로 둔다.
  const isShippingBox = (i: Item) =>
    i.category === 'box' || (i.category === 'submaterial' && i.subtype === '박스');

  // 원료 kg 적재 = **item_bom(BOM) 반제품** 기준(등급). 로트·원장 둘 다 이걸로.
  //  · phantom 반제품(참기름특A 등) → buildFormula로 통깨/깨분 leaf 전개
  //  · 홀더(통깨참기름·깨분참기름)   → 직접 차감(비율=BOM 개입수)
  //  · BOM에 반제품이 없으면 품목 원료식으로 폴백(미이관 품목).
  //  (원료수불부 '서류'는 docTab에서 품목으로 월별 재계산 → 이 경로와 별개)
  const accrueRaw = (product: Item, units: number, rawUsage: Record<string, number>) => {
    // 조립 반제품(개 단위 wip = 무라벨 병 등): 오일 구성품 수량은 그 오일의 단위(L)로 직접 입력한 값.
    // → L×밀도(unitToKg)로 환산. 일반 완제품은 기존대로 용량(spec)이 오일량을 준다.
    const isAssembly = product.category === 'wip' && product.unit === '개';
    const oilSubs = (product.submaterials ?? [])
      .map(s => ({ s, comp: allItems.find(p => p.id === s.id) }))
      // 개수(개) 단위 반제품은 오일이 아니라 '조립 반제품'(무라벨 병 등) → accrueBom이 생산·차감. 벌크 반제품(L/kg)만 오일.
      .filter(({ comp }) => comp && (comp.category === 'raw' || (comp.category === 'wip' && comp.unit !== '개')));
    if (oilSubs.length > 0) {
      for (const { s, comp } of oilSubs) {
        const qty = bomQty(s);
        if (!comp || qty <= 0) continue;
        if (comp.phantom) {
          for (const f of buildFormula(comp.name)) {
            const kg = isAssembly
              ? unitToKg(qty * units * f.ratio, f.raw)               // qty = L 직접 입력
              : toKg(product.spec || '', f.raw, units) * f.ratio * qty;
            if (kg > 0) rawUsage[f.raw] = (rawUsage[f.raw] ?? 0) + kg;
          }
        } else {
          const raw = baseRawName(comp.name);
          const kg = isAssembly
            ? unitToKg(qty * units, raw)
            : toKg(product.spec || '', raw, units) * qty;
          if (kg > 0) rawUsage[raw] = (rawUsage[raw] ?? 0) + kg;
        }
      }
      return;
    }
    for (const f of buildFormula(product.품목 || product.name)) {
      const kg = toKg(product.spec || '', f.raw, units) * f.ratio;
      if (kg > 0) rawUsage[f.raw] = (rawUsage[f.raw] ?? 0) + kg;
    }
  };

  /**
   * BOM 차감/복원 — **구성품 × 수량**만큼 그 품목 재고에서 뺀다. 부자재·완제품 구분 없다.
   *
   * 완제품 구성품(선물세트에 든 병 등)이 모자라면 그만큼 **먼저 만든다**: 재고를 채우고
   * 그 병의 BOM·원료까지 재귀로 내려간다. 만든 수량은 autoBuilt에 남겨 되돌리기 때 쓴다.
   * 겉박스·테이프는 BOM 밖(shipping_rule)이라 여기서 제외한다.
   * sign=-1 차감 / +1 복원.
   */
  const accrueBom = (
    order: Order, product: Item, units: number,
    deltas: Map<string, number>, rawUsage: Record<string, number>,
    sign: number, autoBuilt: { itemId: string; qty: number }[], depth = 0,
    fresh = false,   // 낱개 재고 무시하고 전부 새로 생산 (박스 작업완료 시 사용자가 '아니요')
  ) => {
    if (units <= 0 || depth > 4) return;   // depth — BOM 순환 방어
    const isBox = isBoxStockItem(product);   // 박스 품목이면 겉박스도 자기 BOM에서 깐다
    for (const s of (product.submaterials ?? [])) {
      const comp = allItems.find(p => p.id === s.id);
      if (!comp) continue;
      if (isShippingBox(comp) && !isBox) continue;   // 낱개 품목의 겉박스는 shipping_rule 경로 → 건너뜀
      // 원료·벌크 반제품(L/kg)은 kg로 원료식 경로에서 처리. 개수(개) 단위 반제품(조립)은 완제품처럼 여기서 생산·차감.
      if (comp.category === 'raw' || (comp.category === 'wip' && comp.unit !== '개')) continue;
      const need = Math.round(units * bomQty(s) * 1000) / 1000;
      if (need <= 0) continue;

      // 완제품·개수단위 반제품(조립)이 모자라면 먼저 만든다(그 BOM·오일까지 재귀). fresh면 기존 재고 무시하고 전부 생산.
      if (sign < 0 && (comp.category === 'product' || (comp.category === 'wip' && comp.unit === '개')) && !isGoodsItem(comp)) {
        const have = fresh ? 0 : (comp.stock ?? 0) + (deltas.get(comp.id) ?? 0);
        const short = Math.round((need - have) * 1000) / 1000;
        if (short > 0) {
          addDelta(deltas, comp.id, short);
          autoBuilt.push({ itemId: comp.id, qty: short });
          accrueBom(order, comp, short, deltas, rawUsage, sign, autoBuilt, depth + 1);
          accrueRaw(comp, short, rawUsage);
        }
      }
      addDelta(deltas, comp.id, sign * need);
    }
  };

  // 원료 로트 FIFO 차감 + 수불부 기록 → 소비 로트 스냅샷 반환 (생산처리).
  const deductRawLotsForOrder = async (order: Order, rawUsage: Record<string, number>, ledgerOnly: Record<string, number> = {}) => {
    const consumedLots: NonNullable<Order['rawConsumedLots']> = [];
    const rawNames = Object.keys(rawUsage);
    const ledgerOnlyNames = Object.keys(ledgerOnly);
    if (rawNames.length === 0 && ledgerOnlyNames.length === 0) return consumedLots;
    const dateStr = order.deliveredAt?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    const customerName = partners.find(c => c.id === order.partnerId)?.name || order.partnerName || '';

    // 임가공(OEM) 원료 — 우리 로트로 들고 있지 않으니 재고·로트는 건드리지 않고 수불부에만 남긴다.
    for (const raw of ledgerOnlyNames) {
      const usedKg = Math.round(ledgerOnly[raw] * 1000) / 1000;
      if (usedKg <= 0) continue;
      const entryId = `rm-auto-${order.id}-${raw.replace(/\s/g, '_')}`;
      await setDoc(doc(db, 'rawMaterialLedger', entryId), {
        id: entryId, material: raw, date: dateStr, received: 0, used: usedKg,
        note: `자동: ${customerName}`, createdAt: new Date().toISOString(), type: 'auto', unit: 'kg', orderId: order.id,
      }, { merge: true });
    }

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
    // 임가공은 소비 로트 스냅샷이 없다(로트를 안 씀) → 원료식으로 다시 구해 수불부 기록만 지운다.
    for (const item of order.items) {
      const product = allItems.find(p => p.id === item.itemId);
      if (product?.procureType !== '임가공') continue;
      for (const f of buildFormula(product.품목 || product.name)) {
        if (byMat[f.raw]) continue;   // 위에서 이미 지움
        await deleteDoc(doc(db, 'rawMaterialLedger', `rm-auto-${order.id}-${f.raw.replace(/\s/g, '_')}`));
      }
    }
  };

  // 생산처리(작업완료): 원료·부자재 차감 + 완제품 재고 +N. → 소비 로트 스냅샷 반환.
  const produceOrder = async (order: Order, deltas: Map<string, number>, freshItemIds?: Set<string>) => {
    const rawUsage: Record<string, number> = {};
    const rawUsageLedgerOnly: Record<string, number> = {};   // 임가공 — 수불부에만
    const autoBuilt: { itemId: string; qty: number }[] = []; // 모자라서 먼저 만든 구성품
    for (const item of order.items) {
      const product = allItems.find(p => p.id === item.itemId);
      if (!product) continue;
      if (product.category !== 'product') continue;
      const units = stockUnits(item, product);   // 박스 품목이면 박스 개수

      // 임가공(OEM): 완제품은 가공입고로 이미 재고에 있고 원료도 우리 로트가 아니다.
      // 재고는 아무것도 안 건드리되, 원료수불부에는 쓴 만큼 kg으로 남긴다(서류가 흐름을 봐야 함).
      if (product.procureType === '임가공') {
        for (const f of buildFormula(product.품목 || product.name)) {
          const usedKg = toKg(product.spec || '', f.raw, units) * f.ratio;
          if (usedKg > 0) rawUsageLedgerOnly[f.raw] = (rawUsageLedgerOnly[f.raw] ?? 0) + usedKg;
        }
        continue;
      }

      if (isGoodsItem(product)) continue;
      accrueShippingBox(order, product, item, deltas, -1);
      accrueBom(order, product, units, deltas, rawUsage, -1, autoBuilt, 0, freshItemIds?.has(product.id) ?? false);
      // 박스 품목(낱개로 풀림)은 accrueBom이 낱개→원료로 이미 깐다 → accrueRaw는 낱개 아닌 완제품만.
      //   (박스에 품목/원료식이 잘못 달려 있어도 여기서 원료 이중차감을 막는다)
      if (!isBoxStockItem(product)) accrueRaw(product, units, rawUsage);
      addDelta(deltas, product.id, units); // 완제품 재고 +N (생산됨·미출고)
    }
    const consumedLots = await deductRawLotsForOrder(order, rawUsage, rawUsageLedgerOnly);
    await createProductionRecordsForOrder(order);
    return { consumedLots, autoBuilt };
  };

  // 생산처리 취소: BOM 구성품·원료 복원 + 완제품 재고 −N. 먼저 만든 것도 되돌린다.
  const unProduceOrder = async (order: Order, deltas: Map<string, number>) => {
    const drop: Record<string, number> = {};   // 복원 경로에선 원료를 다시 안 센다
    for (const item of order.items) {
      const product = allItems.find(p => p.id === item.itemId);
      if (!product || product.category !== 'product') continue;
      if (product.procureType === '임가공') continue;   // 재고 미변동 — 수불부만 restore에서 지운다
      if (isGoodsItem(product)) continue;
      accrueShippingBox(order, product, item, deltas, +1);
      accrueBom(order, product, stockUnits(item, product), deltas, drop, +1, []);
      addDelta(deltas, product.id, -stockUnits(item, product)); // 완제품 재고 되돌림
    }
    // 모자라서 먼저 만들었던 구성품 — 만든 만큼 빼고 그것의 BOM도 되돌린다
    for (const b of (order.autoBuilt ?? [])) {
      const comp = allItems.find(p => p.id === b.itemId);
      if (!comp) continue;
      addDelta(deltas, comp.id, -b.qty);
      accrueBom(order, comp, b.qty, deltas, drop, +1, [], 1);
    }
    await restoreRawLotsForOrder(order);
  };

  // 출고: 완제품/상품 재고 −N.
  const shipOrder = (order: Order, deltas: Map<string, number>) => {
    for (const item of order.items) {
      const product = allItems.find(p => p.id === item.itemId);
      if (!product) continue;
      if (isGoodsItem(product)) addDelta(deltas, product.id, -goodsShipQty(item, product));
      else if (product.category === 'product') addDelta(deltas, product.id, -stockUnits(item, product));
    }
  };

  // 출고 취소: 완제품/상품 재고 +N.
  const unShipOrder = (order: Order, deltas: Map<string, number>) => {
    for (const item of order.items) {
      const product = allItems.find(p => p.id === item.itemId);
      if (!product) continue;
      if (isGoodsItem(product)) addDelta(deltas, product.id, goodsShipQty(item, product));
      else if (product.category === 'product') addDelta(deltas, product.id, stockUnits(item, product));
    }
  };

  const STATUS_WANT_PRODUCED = new Set<OrderStatus>([OrderStatus.DISPATCHED, OrderStatus.SHIPPED, OrderStatus.DELIVERED]);
  const STATUS_WANT_SHIPPED = new Set<OrderStatus>([OrderStatus.SHIPPED, OrderStatus.DELIVERED]);

  // 목표 상태에 맞춰 재고 상태를 조정(생산/출고/취소 자동). ON_HOLD은 재고 미변동.
  const reconcileOrderStock = async (order: Order, target: OrderStatus, freshItemIds?: Set<string>) => {
    if (target === OrderStatus.ON_HOLD) return;
    const wantProduced = STATUS_WANT_PRODUCED.has(target);
    const wantShipped = STATUS_WANT_SHIPPED.has(target);
    const deltas = new Map<string, number>();
    const patch: Partial<Order> = {};
    // 역방향(되돌리기): 출고취소 → 생산취소
    if (!wantShipped && order.shippedOut) { unShipOrder(order, deltas); patch.shippedOut = false; }
    if (!wantProduced && order.producedAt) { await unProduceOrder(order, deltas); patch.producedAt = ''; patch.rawLotsDeducted = false; patch.rawConsumedLots = []; patch.autoBuilt = []; }
    // 정방향: 생산 → 출고
    if (wantProduced && !order.producedAt) {
      const { consumedLots, autoBuilt } = await produceOrder(order, deltas, freshItemIds);
      patch.producedAt = new Date().toISOString(); patch.rawLotsDeducted = true;
      if (consumedLots.length > 0) patch.rawConsumedLots = consumedLots;
      if (autoBuilt.length > 0) patch.autoBuilt = autoBuilt;
    }
    if (wantShipped && !order.shippedOut) { shipOrder(order, deltas); patch.shippedOut = true; }
    await applyStockDeltas(deltas);
    if (Object.keys(patch).length > 0) await updateItem('orders', order.id, patch);
  };

  // 주문 상태 변경 진입점 — 재고 조정 후 상태 저장. 이미 이력(DELIVERED)이면 재고 조정 없이 상태만.
  const changeOrderStatus = async (id: string, status: OrderStatus, freshItemIds?: Set<string>) => {
    const order = allOrders.find(o => o.id === id) || orders.find(o => o.id === id);
    if (!order) { await updateItem('orders', id, { status }); return; }
    if (order.status !== OrderStatus.DELIVERED) await reconcileOrderStock(order, status, freshItemIds);
    await updateItem('orders', id, { status, ...(status === OrderStatus.DELIVERED && !order.deliveredAt ? { deliveredAt: new Date().toISOString() } : {}) });
  };

  return { changeOrderStatus, reconcileOrderStock };
}
