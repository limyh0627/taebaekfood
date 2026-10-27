import type {Item,Order,OrderRawCalculationEvidence} from './types';
import {isStockProduction} from './orderPurpose';
import {isBulkItem,isGoodsItem,holdsUnitStock} from './itemTaxonomy';
import {shipQtyOfLine} from './shipDeduction';
import {stockUnits,isBoxStockItem,unpackComponent,unpackQty,type OrderUnitInputs} from './orderUnits';
import {toKg,baseRawName,unitToKg} from '../constants/formula';
import {docName} from './docName';
import {stock3 as kg3} from './orderStockReservationPlan';


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
 * 완제품 1개당 오일 kg = **BOM 수량 그대로**. 오직 BOM만 본다.
 *
 * BOM 수량은 2026-08-14부터 언제나 kg으로 저장한다(기름도 마찬가지). 화면에서만 L로 보여준다.
 * 병 용량(spec)으로 계산하던 경로는 없앴다 — 근거가 둘이면 곱해져서(0.35² 같은) 이중 계산이 난다.
 */
export const perUnitOilKg = (bomQuantity: number): number => bomQuantity;

export type RawUsageKg = Record<string, number>;

/**
 * 임가공 완제품 한 줄이 원료수불부에 남길 kg.
 * 박스는 BOM이 정한 개입수까지 `unpackQty`로 편 뒤 한 공식을 쓴다.
 */
export function oemLedgerKg(
  product: Pick<Item, 'id' | 'spec'>,
  units: number,
  formula: readonly { raw: string; ratio: number }[],
  inputs?: OrderUnitInputs,
): RawUsageKg {
  const eachQty = unpackQty(units, product, isBoxStockItem(product, inputs), inputs);
  const out: RawUsageKg = {};
  for (const row of formula) {
    const kg = toKg(product.spec || '', row.raw, eachQty) * row.ratio;
    if (kg > 0) out[row.raw] = kg3((out[row.raw] ?? 0) + kg);
  }
  return out;
}



  //  셈은 [shipDeduction](./shipDeduction.ts) 한 곳이다 — 화면의 출고 확인창도
  //  같은 함수를 본다. 여기 한 벌 더 적어 두면 **말과 실제가 갈린다**(2026-09-15).
export const addDelta = (m: Map<string, number>, id: string, d: number) => { if (d) m.set(id, (m.get(id) ?? 0) + d); };

export function createOrderProductionPlanner({allItems,inputs,buildFormula}:{allItems:Item[];inputs:OrderUnitInputs;buildFormula:(prodKey:string)=>{raw:string;ratio:number}[]}) {
  const bomOf = (id: string | undefined) => id ? inputs.bom.of(id) : [];
  const hasProductComponent = (product: Pick<Item, 'id'> | undefined) =>
    bomOf(product?.id).some(line => line.child?.type === 'product' || line.child?.type === '완제품');

  // 겉박스·테이프는 BOM으로만 깎는다. 박스 품목을 만들 때 그 BOM에 들어 있고,
  // 낱개 BOM에는 애초에 두지 않는다 — 거래처별 배송규칙 경로는 폐기했다.

  // 원료 kg 적재 = **item_bom(BOM) 반제품** 기준(등급). 로트·원장 둘 다 이걸로.
  //  · phantom 반제품(참기름특A 등) → buildFormula로 통깨/깨분 leaf 전개
  //  · 홀더(통깨참기름·깨분참기름)   → 직접 차감(비율=BOM 개입수)
  //  · BOM에 반제품이 없으면 품목 원료식으로 폴백(미이관 품목).
  //  여기서 쓰는 건 **실제 원장**(rawMaterialLedger) — 실제로 차감이 일어난 시점의 기록이다.
  //  관청에 내는 원료수불부는 **서류용 원장**(rawDocEntries)으로 서류 탭에서 따로 만든다(docOil.ts).
  const accrueRaw = (product: Item, units: number, rawUsage: Record<string, number>, evidence: OrderRawCalculationEvidence[]) => {
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
            if (kg > 0) {
              rawUsage[f.raw] = (rawUsage[f.raw] ?? 0) + kg;
              evidence.push({ productId: product.id, spec: product.spec || '', units, raw: f.raw, kg,
                path: 'bom-formula', childItemId: comp.id, bomQuantityKg: qty, formulaName: comp.name, ratio: f.ratio });
            }
          }
        } else {
          const raw = baseRawName(comp.name);
          const kg = isAssembly
            ? qty * units
            : perUnitKg() * units;
          if (kg > 0) {
            rawUsage[raw] = (rawUsage[raw] ?? 0) + kg;
            evidence.push({ productId: product.id, spec: product.spec || '', units, raw, kg,
              path: 'bom-direct', childItemId: comp.id, bomQuantityKg: qty });
          }
        }
      }
      return;
    }
    for (const f of buildFormula(docName(product))) {
      const convertedKg = toKg(product.spec || '', f.raw, units);
      const kg = convertedKg * f.ratio;
      if (kg > 0) {
        rawUsage[f.raw] = (rawUsage[f.raw] ?? 0) + kg;
        evidence.push({ productId: product.id, spec: product.spec || '', units, raw: f.raw, kg,
          path: 'formula-fallback', formulaName: docName(product), ratio: f.ratio, convertedKg });
      }
    }
  };

  // 포장·세트는 이미 만든 완제품을 조립할 수 있다. 원료 검사는 실제 새로 만드는
  // 낱개 완제품마다 한다 — 주문 전체 합계로 보면 다른 품목의 원료가 누락을 가린다.
  const rawUsageKg = (usage: Record<string, number>) =>
    Math.round(Object.values(usage).reduce((sum, kg) => sum + kg, 0) * 1000) / 1000;
  const requireRawForProduction = (product: Item, beforeKg: number, usage: Record<string, number>) => {
    if (product.type === 'product' && !hasProductComponent(product)
        && rawUsageKg(usage) <= beforeKg) {
      throw new Error(`원료 BOM·원료식에서 사용량이 0kg인 완제품은 생산 완료할 수 없습니다: ${product.name}`);
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
    stockOf?: (item: Item) => number,
    evidence: OrderRawCalculationEvidence[] = [],
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
      //  판정은 `holdsUnitStock` 한 곳이다 — 여기 적혀 있던 `unit === '개'` 가 단위를
      //  '캔'으로 쓴 품목을 빠뜨렸다(시골향참기름1-캔).
      if (sign < 0 && holdsUnitStock(comp) && !isGoodsItem(comp)) {
        if (!stockOf) throw new Error(`생산 재고 스냅샷이 없습니다: ${comp.id}`);
        const onHand = stockOf(comp) + (deltas.get(comp.id) ?? 0);
        const cap = stockCap?.get(comp.id);
        const have = Math.max(0, cap === undefined ? onHand : Math.min(onHand, cap));
        const short = Math.round((need - have) * 1000) / 1000;
        if (short > 0) {
          addDelta(deltas, comp.id, short);
          autoBuilt.push({ itemId: comp.id, qty: short });
          const beforeRawKg = rawUsageKg(rawUsage);
          accrueBom(order, comp, short, deltas, rawUsage, sign, autoBuilt, depth + 1, undefined, stockOf, evidence);
          accrueRaw(comp, short, rawUsage, evidence);
          requireRawForProduction(comp, beforeRawKg, rawUsage);
        }
      }
      addDelta(deltas, comp.id, sign * need);
    }
  };

  /**
   * DB 쓰기 없이 생산량·원료 사용량·품목 증감을 계산한다.
   * 예약 transaction과 실제 생산이 반드시 같은 함수를 써야 둘의 배정량이 갈리지 않는다.
   */
  const planOrderProduction = (
    order: Order,
    deltas: Map<string, number>,
    stockSnapshot: ReadonlyMap<string, number>,
    plan?: StockUsePlan,
    allocatedOutput:Map<string,number>=new Map(),
  ) => {
    const stockOf = (item: Item) => {
      const stock = stockSnapshot.get(item.id);
      if (stock === undefined) throw new Error(`주문 재고 스냅샷에 품목이 없습니다: ${item.id}`);
      // 앞선 줄의 최종 출력 몫은 재사용 재고가 아니다. 음수 중간값을 유지해 생산 deltas와 상쇄한다.
      return stock-(allocatedOutput.get(item.id)??0);
    };
    const rawUsage: Record<string, number> = {};
    const rawCalculationEvidence: OrderRawCalculationEvidence[] = [];
    const rawUsageLedgerOnly: Record<string, number> = {};   // 임가공 — 수불부에만
    const autoBuilt: { itemId: string; qty: number }[] = []; // 모자라서 먼저 만든 구성품
    const producedByItem = new Map<string, number>();        // 실제 생산량 — 되돌리기용
    for (const [idx, item] of order.items.entries()) {
      const product = allItems.find(p => p.id === item.itemId);
      if (!product) throw new Error(`주문 품목 기준정보를 찾을 수 없습니다: ${item.itemId}`);
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
        const usedKg = unitToKg(stockUnits(item, product, inputs), raw);
        if (usedKg > 0) {
          const previousKg = rawUsage[raw] ?? 0;
          rawUsage[raw] = Math.round((previousKg + usedKg) * 1000) / 1000;
          rawCalculationEvidence.push({ productId: product.id, spec: product.spec || '',
            units: stockUnits(item, product, inputs), raw, kg: rawUsage[raw] - previousKg, path: 'bulk', convertedKg: usedKg });
          //  **재고는 따로 안 뺀다** — 로트를 깎으면 `mutateRawMaterialLots` 가 stock 을
          //  로트 합계로 맞춘다(2026-09-16 `lotsAreTotal` 예외를 걷어냈다). 여기서 또
          //  빼면 **두 번 빠진다.**
        }
        continue;
      }
      //  **캔 같은 개수 반제품도 여기 든다**(2026-09-16) — 판정은 `holdsUnitStock` 한 곳.
      //  `type === 'product'` 로만 보다가 캔을 반제품으로 옮기면 생산이 조용히 멈춘다.
      if (!holdsUnitStock(product)) continue;
      const units = stockUnits(item, product, inputs);   // 박스 품목이면 박스 개수
      const allocateOutput=()=>addDelta(allocatedOutput,product.id,units);

      // 임가공(OEM): 완제품은 가공입고로 이미 재고에 있고 원료도 우리 로트가 아니다.
      // 재고는 아무것도 안 건드리되, 원료수불부에는 쓴 만큼 kg으로 남긴다(서류가 흐름을 봐야 함).
      if (product.procureType === '임가공') {
        for (const [raw, kg] of Object.entries(oemLedgerKg(product, units, buildFormula(docName(product)), inputs)))
          rawUsageLedgerOnly[raw] = (rawUsageLedgerOnly[raw] ?? 0) + kg;
        allocateOutput();
        continue;
      }

      if (isGoodsItem(product)) {allocateOutput();continue;}

      // 이 품목 자신의 재고로 충당할 몫. 앞선 라인이 이미 쓴 만큼(deltas)은 빠진 값으로 본다.
      const onHand = Math.max(0, stockOf(product) + (deltas.get(product.id) ?? 0));
      const choice = plan?.[idx];
      const own = isStockProduction(order) ? 0 : Math.min(choice ? Math.max(0, choice.own) : onHand, onHand, units);
      const toProduce = Math.round((units - own) * 1000) / 1000;
      if (toProduce <= 0) {allocateOutput();continue;}

      // 박스 품목이면 낱개 재고 사용량도 사용자가 정한 만큼으로 묶는다.
      const looseId = unpackComponent(product, inputs)?.itemId;
      const stockCap = looseId && choice?.loose !== undefined
        ? new Map([[looseId, Math.max(0, choice.loose)]]) : undefined;

      const beforeRawKg = rawUsageKg(rawUsage);
      accrueBom(order, product, toProduce, deltas, rawUsage, -1, autoBuilt, 0, stockCap, stockOf, rawCalculationEvidence);
      // 구성품에 완제품이 있으면 accrueBom이 그 완제품을 따라 내려가며 원료를 뺀다.
      if (!hasProductComponent(product)) accrueRaw(product, toProduce, rawUsage, rawCalculationEvidence);
      requireRawForProduction(product, beforeRawKg, rawUsage);
      addDelta(deltas, product.id, toProduce);
      producedByItem.set(product.id, (producedByItem.get(product.id) ?? 0) + toProduce);
      allocateOutput();
    }
    return {
      rawUsage,
      rawCalculationEvidence,
      rawUsageLedgerOnly,
      autoBuilt,
      producedUnits: [...producedByItem].map(([itemId, qty]) => ({ itemId, qty })),
    };
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
      if (!product) continue;
      addDelta(deltas, product.id, -shipQtyOfLine(item, product, inputs));
    }
  };

  // 출고 취소 — shipOrder와 같은 규칙이어야 되돌린 값이 맞는다.
  const unShipOrder = (order: Order, deltas: Map<string, number>) => {
    for (const item of order.items) {
      const product = allItems.find(p => p.id === item.itemId);
      if (!product) continue;
      addDelta(deltas, product.id, shipQtyOfLine(item, product, inputs));
    }
  };
  return {planOrderProduction,accrueBom,shipOrder,unShipOrder};
}
