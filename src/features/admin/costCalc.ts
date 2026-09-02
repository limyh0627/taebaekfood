import type { Item } from '../../shared/types';
import { marginFromSupply } from '../../shared/margin';
import { buildCostFn } from '../../shared/bomCost';

/**
 * **원가계산기** — 아직 만들지 않은 품목의 원가를 미리 굴려 본다.
 *
 * 구성품을 골라 넣으면 그 조합의 원가가 나오고, 팔 값을 넣으면 마진이 나온다.
 * 실제 품목을 만들기 전에 "이 배합으로 얼마에 팔아야 남나"를 보는 자리다.
 *
 * **계산은 실제 원가와 같은 함수(buildCostFn)로 한다.** 여기서 따로 더하면
 * 면세 원료 할증(×1.1)이나 하위 BOM 재귀 같은 게 빠져서, 계산기 숫자와 품목 원가가
 * 달라진다 — 그러면 계산기를 믿을 수 없다.
 * 그래서 **가짜 품목 하나**를 만들어 실제 BOM 옆에 끼워 넣고 그걸 굴린다.
 */
export const CALC_ITEM_ID = '__cost-calc__';

export interface CostCalcRow {
  itemId: string;
  /** 이 완제품 하나에 들어가는 양 */
  qty: number;
}

export interface CostCalcLine {
  itemId: string;
  name: string;
  spec: string;
  unit: string;
  qty: number;
  /** 구성품 하나의 원가 */
  unitCost: number;
  /** qty × unitCost × (면세할증) */
  amount: number;
  /** 면세 원료를 과세품에 쓴 줄인가 — 매입세액을 못 빼서 10%가 원가에 얹힌다 */
  vatUp: boolean;
}

export interface CostCalcResult {
  lines: CostCalcLine[];
  /** 구성품 원가 합 + 가공비 */
  cost: number;
  /** 가공비(직접 넣는 값) */
  fee: number;
  price: number;
  /** 팔 값 − 원가. 음수면 팔수록 손해다. */
  margin: number;
  /** 마진율 = 마진 ÷ 판매가. 판매가가 0이면 0. */
  marginRate: number;
  /** 원가대비 = 마진 ÷ 원가. "원가에 몇 % 얹었나". 원가가 0이면 0. */
  markupRate: number;
}

const r0 = (n: number) => Math.round(n);
const rate = (num: number, den: number) => (den > 0 ? num / den : 0);

/**
 * @param rows      고른 구성품과 수량
 * @param allItems  품목 전체 (구성품을 찾고 하위 BOM을 굴리는 데 쓴다)
 * @param itemBoms  item_bom 전체
 * @param opts.price    팔 값(부가세 뺀 공급가 기준)
 * @param opts.taxType  만들 물건이 과세냐 면세냐 — 면세 원료 할증이 여기서 갈린다
 * @param opts.fee      가공비·인건비 등 BOM에 없는 몫
 */
export function calcCost(
  rows: CostCalcRow[],
  allItems: Item[],
  itemBoms: { parent_id: string; child_id: string; quantity?: number }[],
  opts: {
    price?: number; taxType?: '과세' | '면세'; fee?: number;
    /** 원료 배합·수율 — 화면이 실제 원가와 같은 것을 넘겨야 숫자가 맞는다 */
    formulaOf?: (prodKey: string) => { raw: string; ratio: number }[];
    formulaRowsOf?: (prodKey: string) => { raw: string; ratio: number; yieldRate: number }[];
  } = {},
): CostCalcResult {
  const fee = Math.max(0, Number(opts.fee ?? 0));
  const price = Math.max(0, Number(opts.price ?? 0));
  const taxType = opts.taxType ?? '과세';

  //  가짜 완제품 — TERMINAL이 아닌 타입이라야 롤업이 구성품으로 내려간다
  const ghost = {
    id: CALC_ITEM_ID, name: '원가계산', type: 'product', unit: '개',
    stock: 0, minStock: 0, price: 0, taxType, costSource: 'rollup',
  } as unknown as Item;

  const byId = new Map(allItems.map(i => [i.id, i]));
  const valid = rows.filter(r => r.itemId && Number(r.qty) > 0);

  /*
   * **원료(raw)는 BOM으로 못 넣는다.** 실제 롤업은 BOM에 든 raw 구성품을 건너뛴다
   * (`bomCost.ts`의 `if (comp.type === 'raw') continue`) — 원료는 BOM이 아니라
   * 원료식(item_formula)으로 들어오는 게 이 앱의 규칙이기 때문이다.
   *
   * 그런데 계산기는 "참깨 2.7kg + 병 + 캡" 같은 걸 짜 보는 자리라 원료를 빼면 쓸모가 없고,
   * 그렇다고 BOM에 얹으면 **조용히 0으로 잡혀** 계산기가 거짓말을 한다.
   * 그래서 원료 줄만 갈라서 여기서 직접 더한다 — 면세 할증은 똑같이 매긴다.
   */
  const isRaw = (id: string) => byId.get(id)?.type === 'raw';
  const bomRows = valid.filter(r => !isRaw(r.itemId));
  const rawRows = valid.filter(r => isRaw(r.itemId));

  const costOf = buildCostFn({
    allItems: [...allItems, ghost],
    formulaOf: opts.formulaOf ?? (() => []),
    formulaRowsOf: opts.formulaRowsOf,
    itemBoms: [
      ...itemBoms,
      ...bomRows.map(r => ({ parent_id: CALC_ITEM_ID, child_id: r.itemId, quantity: Number(r.qty) })),
    ],
  });

  //  줄마다 보여줄 값 — 합계는 아래에서 롤업이 다시 내므로, 여기 숫자는 '왜 그 값인지'를 보여주는 몫이다
  const lines: CostCalcLine[] = valid.map(r => {
    const it = byId.get(r.itemId);
    const unitCost = it ? costOf(it) : 0;
    const vatUp = !!it && it.taxType === '면세' && taxType !== '면세';
    return {
      itemId: r.itemId,
      name: it?.name ?? '(없는 품목)',
      spec: String(it?.spec ?? ''),
      unit: String(it?.unit ?? ''),
      qty: Number(r.qty),
      unitCost,
      amount: Number(r.qty) * unitCost * (vatUp ? 1.1 : 1),
      vatUp,
    };
  });

  //  BOM 몫은 **롤업이 낸 값**을 쓴다 — 줄 합을 쓰면 하위 BOM 재귀에서 갈린다.
  //  원료 몫은 위에서 말한 까닭으로 여기서 따로 더한다.
  const rawTotal = rawRows.reduce((a, r) => {
    const it = byId.get(r.itemId)!;
    const up = it.taxType === '면세' && taxType !== '면세' ? 1.1 : 1;
    return a + Number(r.qty) * costOf(it) * up;
  }, 0);
  const cost = r0(costOf.rollup(ghost) + rawTotal + fee);
  //  셈은 shared/margin 한 곳에 있다. price 는 이미 공급가 기준이라 두 번 안 나눈다.
  const m = marginFromSupply(price, cost);
  return {
    lines,
    cost,
    fee: r0(fee),
    price: r0(price),
    margin: m.margin,
    marginRate: m.marginRate,
    markupRate: m.markupRate,
  };
}
