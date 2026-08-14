import { doc, setDoc, deleteDoc, getDoc, Firestore } from 'firebase/firestore';
import { isBulkItem } from '../../shared/itemTaxonomy';
import { Order, OrderItem, Item, OrderStatus, AppNotification, ShippingRule, Partner, RawMaterialLot } from '../../shared/types';
import { toKg, baseRawName, lotStockInUnit, unitToKg } from '../../constants/formula';
import { deductFromLots, withCarryOverLot, buildReceiveLot } from '../../shared/lotUtils';
import { bomQty } from '../../shared/bom';
import { stockUnits, isBoxStockItem, unpackComponent } from '../../shared/orderUnits';

/**
 * 작업완료 때 "이미 있는 재고를 얼마나 쓸까" — 주문 라인(order.items 인덱스)별 선택.
 * 화면(StockUseModal)이 만들어 넘긴다. 안 넘기면 쓸 수 있는 만큼 다 쓴다(모달 기본값과 같음).
 */
export interface StockUseChoice {
  /** 주문 품목 자신의 기존 재고에서 쓸 수량 — 재고 단위(박스 품목이면 박스 개수). 0이면 '사용안함' = 전량 생산. */
  own: number;
  /** 박스 품목일 때, 부족분 박스를 만드는 데 쓸 낱개 재고 수량(낱개 개수). 없으면 있는 만큼 다 쓴다. */
  loose?: number;
}
export type StockUsePlan = Record<number, StockUseChoice>;

/**
 * 생산/출고 분리 재고 엔진 (도메인 모듈).
 *  작업완료(DISPATCHED) = 생산처리: 완제품 원료·부자재 차감 + 완제품 재고 +생산분 (상품은 미변동)
 *  출고(SHIPPED)        = 완제품/상품 재고 −주문량
 *
 *  생산분은 **주문량 − 기존 재고로 충당한 몫**이다. 재고가 넉넉하면 생산이 0이고 출고만 빠져
 *  재고가 실제로 줄어든다(전에는 +주문량/−주문량이 상쇄돼 박스 재고가 그대로 남았다).
 *  얼마나 충당할지는 화면에서 사용자가 고른다 → StockUsePlan.
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

/**
 * 완제품 1개당 오일 kg = **BOM 수량 그대로**. 오직 BOM만 본다.
 *
 * BOM 수량은 2026-08-14부터 언제나 kg으로 저장한다(기름도 마찬가지). 화면에서만 L로 보여준다.
 * 병 용량(spec)으로 계산하던 경로는 없앴다 — 근거가 둘이면 곱해져서(0.35² 같은) 이중 계산이 난다.
 */
export const perUnitOilKg = (bomQuantity: number): number => bomQuantity;

/** 처리 중인 주문 id — 같은 주문의 상태 변경이 겹쳐 들어오는 것을 막는다(중복 차감 방지).
 *  엔진은 렌더마다 새로 만들어지므로 모듈 스코프에 둬야 인스턴스 간에도 공유된다. */
const inFlightOrders = new Set<string>();

/** 구성품에 완제품이 있는가 — 박스·세트·재포장. 그 완제품이 자기 원료를 지니므로
 *  이런 품목에 품목 원료식을 또 적용하면 원료가 두 번 빠진다. */
export const hasProductComponent = (
  product: Pick<Item, 'submaterials'> | undefined,
): boolean => (product?.submaterials ?? []).some(s => s.category === 'product' || s.category === '완제품');

/** 사입·임가공 완제품 — 판매 시 생산 없이 자기 재고만 차감(원료는 완사입=무관/임가공=가공입고 때 소진).
 *  생산을 안 하므로 '재고 쓸까요' 물음의 대상도 아니다 → 화면(stockUseRows)도 이걸 본다. */
export const isGoodsItem = (p: Item) =>
  p.subtype === '향미유' || p.subtype === '고춧가루' ||
  p.category === '향미유' || p.category === '고춧가루' || p.category === 'goods' ||
  p.procureType === '완사입' || p.procureType === '임가공';

export function createOrderStockEngine(deps: OrderStockEngineDeps) {
  const { allItems, shippingRules, submaterials, partners, allOrders, orders, db,
    buildFormula, createProductionRecordsForOrder, mutateRawMaterialLots, updateItem, addItem } = deps;

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

  // 겉박스·테이프는 BOM으로만 깎는다. 박스 품목을 만들 때 그 BOM에 들어 있고,
  // 낱개 BOM에는 애초에 두지 않는다 — 거래처별 배송규칙(shipping_rule) 경로는 폐기했다.

  // 원료 kg 적재 = **item_bom(BOM) 반제품** 기준(등급). 로트·원장 둘 다 이걸로.
  //  · phantom 반제품(참기름특A 등) → buildFormula로 통깨/깨분 leaf 전개
  //  · 홀더(통깨참기름·깨분참기름)   → 직접 차감(비율=BOM 개입수)
  //  · BOM에 반제품이 없으면 품목 원료식으로 폴백(미이관 품목).
  //  여기서 쓰는 건 **실제 원장**(rawMaterialLedger) — 실제로 차감이 일어난 시점의 기록이다.
  //  관청에 내는 원료수불부는 **서류용 원장**(rawDocEntries)으로 서류 탭에서 따로 만든다(docOil.ts).
  const accrueRaw = (product: Item, units: number, rawUsage: Record<string, number>) => {
    // 조립 반제품(개 단위 wip = 무라벨 병 등): 오일 구성품 수량은 그 오일의 단위(L)로 직접 입력한 값.
    // → L×밀도(unitToKg)로 환산. 일반 완제품은 기존대로 용량(spec)이 오일량을 준다.
    const isAssembly = product.category === 'wip' && product.unit === '개';
    const oilSubs = (product.submaterials ?? [])
      .map(s => ({ s, comp: allItems.find(p => p.id === s.id) }))
      // 개수(개) 단위 반제품은 오일이 아니라 '조립 반제품'(무라벨 병 등) → accrueBom이 생산·차감. 벌크 반제품(L/kg)만 오일.
      .filter(({ comp }) => comp && isBulkItem(comp));
    if (oilSubs.length > 0) {
      for (const { s, comp } of oilSubs) {
        const qty = bomQty(s);
        if (!comp || qty <= 0) continue;
        const perUnitKg = () => perUnitOilKg(qty);
        if (comp.phantom) {
          for (const f of buildFormula(comp.name)) {
            const kg = isAssembly
              ? qty * units * f.ratio                                // qty는 이미 kg
              : perUnitKg() * units * f.ratio;
            if (kg > 0) rawUsage[f.raw] = (rawUsage[f.raw] ?? 0) + kg;
          }
        } else {
          const raw = baseRawName(comp.name);
          const kg = isAssembly
            ? qty * units
            : perUnitKg() * units;
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
   *
   * stockCap — 구성품 재고를 이만큼까지만 쓴다(사용자가 모달에서 정한 낱개 사용량). 없으면 있는 대로 다 쓴다.
   */
  const accrueBom = (
    order: Order, product: Item, units: number,
    deltas: Map<string, number>, rawUsage: Record<string, number>,
    sign: number, autoBuilt: { itemId: string; qty: number }[], depth = 0,
    stockCap?: Map<string, number>,
  ) => {
    if (units <= 0 || depth > 4) return;   // depth — BOM 순환 방어
    for (const s of (product.submaterials ?? [])) {
      const comp = allItems.find(p => p.id === s.id);
      if (!comp) continue;
      // 겉박스·테이프도 BOM에 있으면 그대로 깎는다 — 낱개 BOM엔 그것들을 안 둔다
      // (박스 품목을 만들 때 그 BOM으로 잡힌다). BOM이 곧 구성이다.
      // 원료·벌크 반제품(L/kg)은 kg로 원료식 경로에서 처리. 개수(개) 단위 반제품(조립)은 완제품처럼 여기서 생산·차감.
      if (isBulkItem(comp)) continue;
      const need = Math.round(units * bomQty(s) * 1000) / 1000;
      if (need <= 0) continue;

      // 완제품·개수단위 반제품(조립)이 모자라면 먼저 만든다(그 BOM·오일까지 재귀).
      // 재고를 얼마나 쓸지는 stockCap이 정한다(0이면 전부 새로 생산). 그래도 차감은 need 전액 —
      // 먼저 만든 short가 상쇄해서 순변화는 딱 '쓴 재고'만큼이 된다.
      if (sign < 0 && (comp.category === 'product' || (comp.category === 'wip' && comp.unit === '개')) && !isGoodsItem(comp)) {
        const onHand = (comp.stock ?? 0) + (deltas.get(comp.id) ?? 0);
        const cap = stockCap?.get(comp.id);
        const have = Math.max(0, cap === undefined ? onHand : Math.min(onHand, cap));
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

  // 원료 로트 FIFO 차감 + **실제 원장**(rawMaterialLedger) 기록 → 소비 로트 스냅샷 반환 (생산처리).
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
      const rawItem = allItems.find(i => !i.phantom && isBulkItem(i) && baseRawName(i.name) === raw);
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
      const rawItem = allItems.find(i => !i.phantom && isBulkItem(i) && baseRawName(i.name) === material);
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

  // 생산처리(작업완료): 원료·부자재 차감 + 완제품 재고 +(생산분). → 소비 로트 스냅샷 반환.
  //  **주문량 전량이 아니라 "기존 재고로 못 채우는 몫"만 생산한다.** 출고는 늘 주문량을 빼므로
  //  순변화 = 쓴 재고만큼. 얼마나 쓸지는 plan(사용자 선택)이 정하고, 없으면 있는 만큼 다 쓴다.
  const produceOrder = async (order: Order, deltas: Map<string, number>, plan?: StockUsePlan) => {
    const rawUsage: Record<string, number> = {};
    const rawUsageLedgerOnly: Record<string, number> = {};   // 임가공 — 수불부에만
    const autoBuilt: { itemId: string; qty: number }[] = []; // 모자라서 먼저 만든 구성품
    const producedByItem = new Map<string, number>();        // 실제 생산량 — 되돌리기용
    for (const [idx, item] of order.items.entries()) {
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

      // 이 품목 자신의 재고로 충당할 몫. 앞선 라인이 이미 쓴 만큼(deltas)은 빠진 값으로 본다.
      const onHand = Math.max(0, (product.stock ?? 0) + (deltas.get(product.id) ?? 0));
      const choice = plan?.[idx];
      const own = Math.min(choice ? Math.max(0, choice.own) : onHand, onHand, units);
      const toProduce = Math.round((units - own) * 1000) / 1000;
      if (toProduce <= 0) continue;   // 재고로 전부 충당 — 생산도 원료도 없다

      // 박스 품목이면 낱개 재고 사용량도 사용자가 정한 만큼으로 묶는다.
      const looseId = unpackComponent(product)?.itemId;
      const stockCap = looseId && choice?.loose !== undefined
        ? new Map([[looseId, Math.max(0, choice.loose)]]) : undefined;

      accrueBom(order, product, toProduce, deltas, rawUsage, -1, autoBuilt, 0, stockCap);
      // 구성품에 완제품이 있으면(박스·세트·재포장) accrueBom이 그 완제품을 따라 내려가며
      // 거기서 원료를 뺀다 → 여기서 품목 원료식으로 또 빼면 이중 차감이다.
      //   (품목·규격은 서류용이라 재고 계산에 끌어들이지 않는다. BOM이 곧 구성이다)
      if (!hasProductComponent(product)) accrueRaw(product, toProduce, rawUsage);
      addDelta(deltas, product.id, toProduce); // 완제품 재고 +생산분 (미출고)
      producedByItem.set(product.id, (producedByItem.get(product.id) ?? 0) + toProduce);
    }
    const consumedLots = await deductRawLotsForOrder(order, rawUsage, rawUsageLedgerOnly);
    await createProductionRecordsForOrder(order);
    const producedUnits = [...producedByItem].map(([itemId, qty]) => ({ itemId, qty }));
    return { consumedLots, autoBuilt, producedUnits };
  };

  // 생산처리 취소: BOM 구성품·원료 복원 + 완제품 재고 −(생산분). 먼저 만든 것도 되돌린다.
  //  **뺄 건 주문량이 아니라 그때 실제로 생산한 양**(producedUnits). 기존 재고로 충당했던 몫은
  //  애초에 만든 적이 없으니 되돌릴 것도 없다 — 출고취소가 이미 +주문량으로 되돌려 놨다.
  const unProduceOrder = async (order: Order, deltas: Map<string, number>) => {
    const drop: Record<string, number> = {};   // 복원 경로에선 원료를 다시 안 센다
    // producedUnits가 없는 옛 주문 = 주문량 전량을 생산하던 시절 → 그때 규칙대로 되돌린다.
    const produced = Array.isArray(order.producedUnits)
      ? order.producedUnits
      : order.items.map(item => {
          const p = allItems.find(x => x.id === item.itemId);
          return { itemId: item.itemId, qty: p ? stockUnits(item, p) : 0 };
        });
    for (const { itemId, qty } of produced) {
      const product = allItems.find(p => p.id === itemId);
      if (!product || product.category !== 'product') continue;
      if (product.procureType === '임가공') continue;   // 재고 미변동 — 수불부만 restore에서 지운다
      if (isGoodsItem(product)) continue;
      if (qty <= 0) continue;
      accrueBom(order, product, qty, deltas, drop, +1, []);
      addDelta(deltas, product.id, -qty); // 완제품 재고 되돌림
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
  const reconcileOrderStock = async (order: Order, target: OrderStatus, plan?: StockUsePlan) => {
    if (target === OrderStatus.ON_HOLD) return;
    const wantProduced = STATUS_WANT_PRODUCED.has(target);
    const wantShipped = STATUS_WANT_SHIPPED.has(target);
    const deltas = new Map<string, number>();
    const patch: Partial<Order> = {};
    // 역방향(되돌리기): 출고취소 → 생산취소
    if (!wantShipped && order.shippedOut) { unShipOrder(order, deltas); patch.shippedOut = false; }
    if (!wantProduced && order.producedAt) { await unProduceOrder(order, deltas); patch.producedAt = ''; patch.rawLotsDeducted = false; patch.rawConsumedLots = []; patch.autoBuilt = []; patch.producedUnits = []; }
    // 정방향: 생산 → 출고
    if (wantProduced && !order.producedAt) {
      const { consumedLots, autoBuilt, producedUnits } = await produceOrder(order, deltas, plan);
      patch.producedAt = new Date().toISOString(); patch.rawLotsDeducted = true;
      // 빈 결과여도 반드시 덮어쓴다 — 안 쓰면 이전 생산의 스냅샷이 남아, 취소 때
      // 이번에 빼지도 않은 양을 되돌려버린다(유령 복원).
      patch.rawConsumedLots = consumedLots;
      // 생산량도 마찬가지로 항상 쓴다. 빈 배열([])과 없음(undefined)은 뜻이 다르다 —
      // 없음은 '옛 주문(전량 생산)'이라 되돌리기가 주문량으로 계산한다.
      patch.producedUnits = producedUnits;
      if (autoBuilt.length > 0) patch.autoBuilt = autoBuilt;
    }
    if (wantShipped && !order.shippedOut) { shipOrder(order, deltas); patch.shippedOut = true; }
    await applyStockDeltas(deltas);
    if (Object.keys(patch).length > 0) await updateItem('orders', order.id, patch);
  };

  // 주문 상태 변경 진입점 — 재고 조정 후 상태 저장. 이미 이력(DELIVERED)이면 재고 조정 없이 상태만.
  const changeOrderStatus = async (id: string, status: OrderStatus, plan?: StockUsePlan) => {
    // 같은 주문이 동시에 두 번 생산 처리되는 것을 막는다.
    //  품목 체크가 연달아 들어오면 handleToggleItemChecked가 같은 틱에 작업완료를 여러 번 부르는데,
    //  producedAt 판정이 React 상태 기준이라 전부 통과해 원료가 배수로 빠졌다(수입들기름 3배).
    if (inFlightOrders.has(id)) return;
    inFlightOrders.add(id);
    try {
      const order = allOrders.find(o => o.id === id) || orders.find(o => o.id === id);
      if (!order) { await updateItem('orders', id, { status }); return; }
      // producedAt·shippedOut은 DB에서 다시 읽는다 — React 상태는 같은 틱에 갱신되지 않아
      // 직전 호출이 이미 생산했는지 알 수 없다.
      let live = order;
      try {
        const snap = await getDoc(doc(db, 'orders', id));
        if (snap.exists()) live = { ...order, ...(snap.data() as Partial<Order>) } as Order;
      } catch { /* 읽기 실패 시 메모리 상태로 진행 */ }
      if (live.status !== OrderStatus.DELIVERED) await reconcileOrderStock(live, status, plan);
      // 배송완료일은 **여기서 만들어 넣지 않는다.** 서류 네 종의 유일한 기준일이라,
      // '지금 시각'으로 채우면 새벽에 처리한 건이 다음 날짜로 새서 서류가 갈린다.
      // 판매기록부를 뽑는 쪽이 서류 날짜로 미리 박아 준다. 비어 있으면 알림으로 드러낸다.
      if (status === OrderStatus.DELIVERED && !live.deliveredAt) {
        console.error(`[배송완료일 없음] 주문 ${id} (${live.partnerName ?? ''}) — 서류에서 빠집니다`);
        await addItem('notifications', {
          type: 'inventory_shortage',
          title: '배송완료일 없는 주문',
          body: `${live.partnerName ?? id} 주문에 배송완료일이 없어 원료수불부·판매기록부에서 빠집니다. 주문을 열어 날짜를 넣어 주세요.`,
          linkedId: id, readBy: [], createdAt: new Date().toISOString(),
        } as Omit<AppNotification, 'id'>);
      }
      await updateItem('orders', id, { status });
    } finally {
      inFlightOrders.delete(id);
    }
  };

  return { changeOrderStatus, reconcileOrderStock };
}
