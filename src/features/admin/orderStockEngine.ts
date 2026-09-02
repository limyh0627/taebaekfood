import { doc, setDoc, deleteDoc, getDoc, runTransaction, Firestore } from 'firebase/firestore';
import { today } from '../../shared/day';
import { isBulkItem } from '../../shared/itemTaxonomy';
import { bomOf } from '../../shared/bomIndex';
import { Order, OrderItem, Item, OrderStatus, AppNotification, Partner, RawMaterialLot } from '../../shared/types';
import { toKg, baseRawName, lotStockInUnit, unitToKg } from '../../constants/formula';
import { deductFromLots, withCarryOverLot, buildReceiveLot, deductLotsByQty, restoreLotsByQty } from '../../shared/lotUtils';
import { checkLedgerLot, gapMessage } from '../../shared/ledgerLotCheck';
import type { ProductLotTake } from '../../shared/lotUtils';
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
  product: Pick<Item, 'id'> | undefined,
): boolean => bomOf(product?.id).some(l => l.child?.type === 'product' || l.child?.type === '완제품');

/** 사입·임가공 완제품 — 판매 시 생산 없이 자기 재고만 차감(원료는 완사입=무관/임가공=가공입고 때 소진).
 *  생산을 안 하므로 '재고 쓸까요' 물음의 대상도 아니다 → 화면(stockUseRows)도 이걸 본다. */
export const isGoodsItem = (p: Item) =>
  p.category === '향미유' || p.category === '고춧가루' ||
  p.type === '향미유' || p.type === '고춧가루' || p.type === 'goods' ||
  p.procureType === '완사입' || p.procureType === '임가공';

export function createOrderStockEngine(deps: OrderStockEngineDeps) {
  const { allItems, submaterials, partners, allOrders, orders, db,
    buildFormula, createProductionRecordsForOrder, mutateRawMaterialLots, updateItem, addItem } = deps;

  const goodsShipQty = (item: OrderItem, product: Item) => {
    // 박스 품목(BOM에 낱개가 물린 것)은 재고 단위가 박스 → 박스 개수로 뺀다.
    if (isBoxStockItem(product)) return stockUnits(item, product);
    const uPerBox = item.unitsPerBox || product.defaultBoxConfig?.unitsPerBox || product.boxSize || 12;
    return item.isBoxUnit && item.boxQuantity ? item.boxQuantity * uPerBox : item.quantity;
  };
  const addDelta = (m: Map<string, number>, id: string, d: number) => { if (d) m.set(id, (m.get(id) ?? 0) + d); };

  /**
   * **재고 판정에 쓸 실제 값** — 생산 한 판이 시작될 때 DB에서 읽어 채운다.
   *
   * 쓰기(applyStockDeltas)는 진작 트랜잭션으로 고쳤는데 **읽기가 남아 있었다.**
   * `product.stock`은 엔진을 만들 때 클로저에 갇힌 화면 값이라, 앞 주문이 방금 깎아도
   * 그대로다. 그래서 "재고 있으니 안 만들어도 된다"고 판단해 놓고 실제로는 없어서 파였다:
   *
   *   화면 낱개 30개  ─┬─ 훈장골 5개   → "30 있다" 생산 0, 출고 −5   DB 30→25
   *                   └─ 현대유통 30개 → "30 있다" 생산 0, 출고 −30  DB 25→ **−5**
   *
   * 재고만 음수가 아니다. 안 만들었으니 **원료도 안 빠진다**(rawConsumedLots 0건) —
   * 이쪽이 더 크다. 판정도 DB를 보게 한다.
   */
  const freshStock = new Map<string, number>();
  const stockOf = (p: Item) => freshStock.get(p.id) ?? p.stock ?? 0;

  /** 주문이 건드릴 품목 — 주문 라인 + BOM 하위 전체(구성품을 모자라면 먼저 만들기 때문에 필요하다) */
  const stockTouchedIds = (order: Order): string[] => {
    const seen = new Set<string>();
    const walk = (id: string, depth: number) => {
      if (depth > 5 || seen.has(id)) return;
      seen.add(id);
      for (const line of bomOf(id)) walk(line.childId, depth + 1);
    };
    for (const item of order.items) walk(item.itemId, 0);
    return [...seen];
  };

  /** 판정용 재고를 DB에서 새로 읽어 둔다 — 생산 한 판마다 한 번. */
  const loadFreshStock = async (order: Order) => {
    freshStock.clear();
    const ids = stockTouchedIds(order);
    const snaps = await Promise.all(ids.map(id => getDoc(doc(db, 'items', id))));
    snaps.forEach((snap, i) => { if (snap.exists()) freshStock.set(ids[i], Number(snap.data().stock ?? 0)); });
  };

  /**
   * 품목 재고 델타 일괄 반영 — 한 상태전환에서 같은 품목이 +/−로 겹쳐도 순변화만 1회 기록.
   *
   * **DB에서 읽어 더한다(트랜잭션).** 화면 상태(allItems)의 stock에 더해 덮어쓰면
   * 앞선 쓰기가 통째로 날아간다. 실제로 그렇게 재고가 마이너스로 파였다:
   *
   *   작업완료  재고 0 + 100 = 100  → DB에 100
   *   출고      allItems.stock이 아직 0(구독 미갱신) → 0 − 100 = −100  → DB에 −100
   *                                                     ↑ +100이 사라진다
   *
   * allItems는 엔진을 만들 때 클로저에 갇혀서, 함수가 도는 동안 절대 안 바뀐다.
   * 구독이 새 값을 받아도 이미 실행 중인 호출은 옛 배열을 계속 본다.
   * 원료 로트는 진작 트랜잭션(mutateRawMaterialLots)이라 멀쩡했다 — 재고만 빠져 있었다.
   */
  const applyStockDeltas = async (deltas: Map<string, number>) => {
    for (const [itemId, delta] of deltas) {
      if (!delta) continue;
      const it = allItems.find(p => p.id === itemId);
      if (!it) continue;
      let before = 0, newStock = 0;
      await runTransaction(db, async (tx) => {
        const ref = doc(db, 'items', itemId);
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        before = Number(snap.data().stock ?? 0);
        newStock = Math.round((before + delta) * 1000) / 1000;
        tx.update(ref, { stock: newStock });
      });
      if (newStock < 0) {
        console.warn(`[재고 부족] ${it.name}: ${before} → ${newStock}`);
        await addItem('notifications', {
          type: 'inventory_shortage', title: '재고 부족 경고',
          body: `${it.name}: 재고 ${newStock} (부족분 ${Math.abs(newStock)}). 주문 상태변경 반영 확인 필요.`,
          linkedId: itemId, readBy: [], createdAt: new Date().toISOString(),
        } as Omit<AppNotification, 'id'>);
      }
    }
  };

  // 겉박스·테이프는 BOM으로만 깎는다. 박스 품목을 만들 때 그 BOM에 들어 있고,
  // 낱개 BOM에는 애초에 두지 않는다 — 거래처별 배송규칙 경로는 폐기했다.

  // 원료 kg 적재 = **item_bom(BOM) 반제품** 기준(등급). 로트·원장 둘 다 이걸로.
  //  · phantom 반제품(참기름특A 등) → buildFormula로 통깨/깨분 leaf 전개
  //  · 홀더(통깨참기름·깨분참기름)   → 직접 차감(비율=BOM 개입수)
  //  · BOM에 반제품이 없으면 품목 원료식으로 폴백(미이관 품목).
  //  여기서 쓰는 건 **실제 원장**(rawMaterialLedger) — 실제로 차감이 일어난 시점의 기록이다.
  //  관청에 내는 원료수불부는 **서류용 원장**(rawDocEntries)으로 서류 탭에서 따로 만든다(docOil.ts).
  const accrueRaw = (product: Item, units: number, rawUsage: Record<string, number>) => {
    // 조립 반제품(개 단위 wip = 무라벨 병 등): 오일 구성품 수량은 그 오일의 단위(L)로 직접 입력한 값.
    // → L×밀도(unitToKg)로 환산. 일반 완제품은 기존대로 용량(spec)이 오일량을 준다.
    const isAssembly = product.type === 'wip' && product.unit === '개';
    const oilSubs = bomOf(product.id)
      .map(l => ({ l, comp: allItems.find(p => p.id === l.childId) }))
      // 개수(개) 단위 반제품은 오일이 아니라 '조립 반제품'(무라벨 병 등) → accrueBom이 생산·차감. 벌크 반제품(L/kg)만 오일.
      .filter(({ comp }) => comp && isBulkItem(comp));
    if (oilSubs.length > 0) {
      for (const { l, comp } of oilSubs) {
        const qty = l.qty;
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
   * 겉박스·테이프는 박스 품목 BOM에 들어 있어 여기서 제외한다.
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
    for (const line of bomOf(product.id)) {
      const comp = allItems.find(p => p.id === line.childId);
      if (!comp) continue;
      // 겉박스·테이프도 BOM에 있으면 그대로 깎는다 — 낱개 BOM엔 그것들을 안 둔다
      // (박스 품목을 만들 때 그 BOM으로 잡힌다). BOM이 곧 구성이다.
      // 원료·벌크 반제품(L/kg)은 kg로 원료식 경로에서 처리. 개수(개) 단위 반제품(조립)은 완제품처럼 여기서 생산·차감.
      if (isBulkItem(comp)) continue;
      const need = Math.round(units * line.qty * 1000) / 1000;
      if (need <= 0) continue;

      // 완제품·개수단위 반제품(조립)이 모자라면 먼저 만든다(그 BOM·오일까지 재귀).
      // 재고를 얼마나 쓸지는 stockCap이 정한다(0이면 전부 새로 생산). 그래도 차감은 need 전액 —
      // 먼저 만든 short가 상쇄해서 순변화는 딱 '쓴 재고'만큼이 된다.
      if (sign < 0 && (comp.type === 'product' || (comp.type === 'wip' && comp.unit === '개')) && !isGoodsItem(comp)) {
        const onHand = stockOf(comp) + (deltas.get(comp.id) ?? 0);
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
    const dateStr = order.deliveredAt?.slice(0, 10) || today();
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

      /**
       * **둘 다 쓴 뒤에 되읽어 대조한다.**
       * 원장과 로트는 따로 쓰기 때문에 한쪽만 성공하면 그대로 갈린다. 쓰는 순서를 바꾸는 걸로는
       * 못 막는다 — 로트가 실패하면 일은 어차피 날아가고, 다만 조용히 날아갈 뿐이다.
       * 실패했는지는 되읽어 대조해야만 안다.
       */
      if (rawItem) {
        const gap = await checkLedgerLot(db, rawItem.id, raw, rawItem.density ?? 1);
        if (gap) {
          console.warn(`[원장·로트 불일치] ${gapMessage(gap)} (주문 ${order.id})`);
          await addItem('notifications', {
            type: 'inventory_shortage', title: '원장·로트 불일치',
            body: `${gapMessage(gap)} — 주문 ${order.id}(${customerName}) 처리 뒤. 한쪽만 반영됐을 수 있습니다.`,
            linkedId: rawItem.id, readBy: [], createdAt: new Date().toISOString(),
          } as Omit<AppNotification, 'id'>);
        }
      }
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
    // **같은 주문은 원료를 한 번만 뺀다.**
    //   원장 줄은 id가 `rm-auto-{주문}-{원료}`로 고정이라 두 번째 처리 때 덮어써지는데,
    //   로트는 mutateRawMaterialLots가 부를 때마다 깎아서 한쪽만 이중이 됐다.
    //   (생들기름 775.98kg = 8/04 277.2 + 8/05 249.48 + 8/14 249.3 세 건이 각각 두 번씩 빠졌다)
    //   바깥 가드(`wantProduced && !order.producedAt`)는 **화면 상태**를 보므로 다른 탭·중복 클릭으로
    //   낡으면 그냥 통과한다 — 재고 음수를 만들던 것과 같은 낡은-상태 문제다.
    //   → DB의 지금 값을 직접 보고, 이미 빼둔 몫이 있으면 되돌린 뒤 새로 뺀다.
    //     (수량이 바뀐 재처리도 이 순서면 맞는 값으로 끝난다)
    await loadFreshStock(order);   // 판정 기준을 DB의 지금 값으로 — 화면 값은 낡는다
    const fresh = await getDoc(doc(db, 'orders', order.id));
    const already = (fresh.exists() ? (fresh.data().rawConsumedLots as Order['rawConsumedLots']) : undefined) ?? [];
    if (already.length > 0) {
      console.warn(`[생산 재처리] ${order.id} — 이미 빠진 원료 ${already.length}건을 되돌리고 다시 뺀다`);
      await restoreRawLotsForOrder({ ...order, rawConsumedLots: already });
    }
    const rawUsage: Record<string, number> = {};
    const rawUsageLedgerOnly: Record<string, number> = {};   // 임가공 — 수불부에만
    const autoBuilt: { itemId: string; qty: number }[] = []; // 모자라서 먼저 만든 구성품
    const producedByItem = new Map<string, number>();        // 실제 생산량 — 되돌리기용
    for (const [idx, item] of order.items.entries()) {
      const product = allItems.find(p => p.id === item.itemId);
      if (!product) continue;
      /**
       * **벌크를 그대로 파는 주문** — 볶음참깨 20kg 자루 같은 것.
       *
       * 완제품이 아니라 예전엔 통째로 건너뛰었다. 주문 화면이 완제품만 띄우던 시절엔
       * 들어올 일이 없었는데, 연결된 품목이면 다 뜨게 바꾸면서 길이 열렸다.
       * 안 막으면 **팔아도 재고·로트·원장이 하나도 안 움직인다.**
       *
       * 원료식과 같은 길(rawUsage)로 보낸다 — 로트 FIFO 차감과 원장 기록이 저절로 따라온다.
       * 로트는 kg으로 세므로 L 단위 품목은 밀도로 환산한다.
       */
      if (isBulkItem(product)) {
        const raw = baseRawName(product.name);
        const usedKg = unitToKg(stockUnits(item, product), raw);
        if (usedKg > 0) {
          rawUsage[raw] = Math.round(((rawUsage[raw] ?? 0) + usedKg) * 1000) / 1000;
          //  lotsAreTotal 원료는 로트합이 통합재고라 stock을 안 덮는다(mutateRawMaterialLots).
          //  벌크로 나간 만큼은 벌크 재고에서도 빼 줘야 한다.
          if (product.lotsAreTotal) addDelta(deltas, product.id, -usedKg);
        }
        continue;
      }
      if (product.type !== 'product') continue;
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
      const onHand = Math.max(0, stockOf(product) + (deltas.get(product.id) ?? 0));
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
      if (!product || product.type !== 'product') continue;
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

  /**
   * 출고 — **타입을 안 가리고 판 만큼 뺀다.**
   *
   * 예전엔 완제품(type='product')과 상품만 뺐다. 주문 화면이 완제품만 띄우던 시절의 규칙인데,
   * "연결된 품목이면 다 뜬다"로 바꾸면서 부자재·조립반제품도 팔 수 있게 됐다.
   * 안 빼면 **팔아도 재고가 그대로 남는다.**
   *
   * 벌크(L/kg 반제품·원료)만 예외다 — 그쪽은 생산처리에서 rawUsage로 로트·원장까지 함께
   * 빠지므로, 여기서 또 빼면 두 번 빠진다.
   */
  const shipOrder = (order: Order, deltas: Map<string, number>) => {
    for (const item of order.items) {
      const product = allItems.find(p => p.id === item.itemId);
      if (!product || isBulkItem(product)) continue;
      if (isGoodsItem(product)) addDelta(deltas, product.id, -goodsShipQty(item, product));
      else addDelta(deltas, product.id, -stockUnits(item, product));
    }
  };

  // 출고 취소 — shipOrder와 같은 규칙이어야 되돌린 값이 맞는다.
  const unShipOrder = (order: Order, deltas: Map<string, number>) => {
    for (const item of order.items) {
      const product = allItems.find(p => p.id === item.itemId);
      if (!product || isBulkItem(product)) continue;
      if (isGoodsItem(product)) addDelta(deltas, product.id, goodsShipQty(item, product));
      else addDelta(deltas, product.id, stockUnits(item, product));
    }
  };

  // ── 완제품 로트 ─────────────────────────────────────────────────────────
  //  박스에도 로트를 매겨 어느 로트가 어느 거래처로 나갔는지 남긴다(회수·클레임 역추적).
  //  재고 숫자는 종전대로 deltas가 움직이고, 로트는 **그 옆에서 같은 수량으로** 따라 빠진다.
  //  로트에 재고 권한을 주지 않는 이유: 실사·개봉·주문취소 등 재고를 건드리는 길이 여럿이라
  //  로트를 유일한 근거로 삼으면 아직 안 태운 경로에서 재고가 통째로 날아간다.
  //  대신 어긋나면 '이월(미상)' 버킷이 음수로 받아 **보이게** 둔다(벌크 로트와 같은 규칙).

  /** 출고 수량 — shipOrder와 같은 규칙이어야 로트와 재고가 안 갈린다. */
  const shipQtyOf = (item: OrderItem, product: Item) =>
    isGoodsItem(product) ? goodsShipQty(item, product)
      : product.type === 'product' ? stockUnits(item, product) : 0;

  /** 로트를 쓰는 완제품인가 — 로트가 한 번이라도 선 품목만. 안 선 품목은 종전대로 숫자 재고만 움직인다. */
  const hasProductLots = (p: Item) => (p.lots ?? []).some(l => l.qtyRemaining != null);

  /** 출고 — 완제품 로트를 FIFO로 까고, 어느 로트가 나갔는지 주문에 스냅샷으로 남긴다. */
  const deductProductLotsForOrder = async (order: Order) => {
    const taken: NonNullable<Order['productConsumedLots']> = [];
    for (const item of order.items) {
      const product = allItems.find(p => p.id === item.itemId);
      if (!product || !hasProductLots(product)) continue;
      const qty = shipQtyOf(item, product);
      if (qty <= 0) continue;
      let captured: ProductLotTake[] = [];
      // computeStock을 안 넘긴다 — 재고는 deltas가 쓴다(둘이 쓰면 서로 덮어쓴다).
      await mutateRawMaterialLots(product.id, (lots) => {
        const r = deductLotsByQty(lots, qty);
        captured = r.distribution;
        return r.lots;
      });
      for (const t of captured) {
        taken.push({
          itemId: product.id,
          material: (product.lots ?? []).find(l => l.id === t.lotId)?.material,
          lotId: t.lotId, lotNo: t.lotNo, receivedDate: t.receivedDate, qty: t.qty,
        });
      }
    }
    return taken;
  };

  /** 출고취소 — 그때 깐 로트에 스냅샷대로 되돌린다(역FIFO는 그새 들어온 로트에 얹혀 어긋난다). */
  const restoreProductLotsForOrder = async (order: Order) => {
    const byItem = new Map<string, ProductLotTake[]>();
    for (const t of order.productConsumedLots ?? []) {
      const cur = byItem.get(t.itemId) ?? [];
      cur.push({ lotId: t.lotId, lotNo: t.lotNo, receivedDate: t.receivedDate, supplierName: '', qty: t.qty });
      byItem.set(t.itemId, cur);
    }
    for (const [itemId, takes] of byItem) {
      await mutateRawMaterialLots(itemId, (lots) => restoreLotsByQty(lots, takes));
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
    if (!wantShipped && order.shippedOut) {
      unShipOrder(order, deltas); patch.shippedOut = false;
      await restoreProductLotsForOrder(order); patch.productConsumedLots = [];
    }
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
    if (wantShipped && !order.shippedOut) {
      shipOrder(order, deltas); patch.shippedOut = true;
      // 빈 배열이어도 반드시 쓴다 — 안 쓰면 이전 출고의 스냅샷이 남아 취소 때 유령 복원이 된다.
      patch.productConsumedLots = await deductProductLotsForOrder(order);
    }
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
