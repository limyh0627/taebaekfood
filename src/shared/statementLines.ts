import type { Item, Order, OrderItem, PartnerItem } from './types';
import { lineAmount } from './lineAmount';
import { unpackComponent, boxDerivedUnitPrice } from './orderUnits';

/**
 * **전표 품목 줄을 세우는 셈.**
 *
 * [TradeStatement.tsx](../../components/TradeStatement.tsx) 안에 70줄짜리 `useMemo` 로
 * 박혀 있던 것을 그대로 떼어 왔다. 이 앱에서 제일 얽힌 셈이라 화면과 붙여 두면 손대기가
 * 무섭다 — 박스를 낱개로 푸는 것, 단가 우선순위, 과세 판정, 계정 고르기, 같은 품목 합치기가
 * 전부 여기 있다. 순수 함수라 시험할 수 있다(2026-09-05).
 *
 * 부수효과 없음(입력 → 값).
 */

/** 전표 갈래. '비용' 은 매입의 한 갈래라 계정 기본값이 없다(골라야 한다). */
export type StatementType = '매출' | '매입' | '비용';

/** 손으로 적는 줄 — 화면의 입력칸 그대로라 전부 글자다. */
export interface ManualRow {
  name: string; spec: string; qty: string; price: string;
  isTaxExempt: boolean; note?: string; accountCode?: string;
  side?: '차변' | '대변';
}

export interface LineItem {
  key: string; no: number; name: string; spec: string;
  qty: number; price: number; supply: number; tax: number; total: number;
  isTaxExempt: boolean; accountCode?: string;
  /** 차·대를 직접 세운 줄 — 있으면 양변 전표(일반전표)다. 합계는 차변 합만 센다. */
  side?: '차변' | '대변';
  /** 주문의 품목을 못 찾음 — 박스가 안 풀렸을 수 있어 화면에 경고를 단다 */
  unknownItem?: boolean;
  /**
   * **과세·면세를 아직 아무도 안 정했다** — 거래처–품목 연결에 `taxType` 이 없고
   * 이번에 손으로 뒤집지도 않았다.
   *
   * 전에는 그냥 **과세로 떨어뜨렸다**. 정한 적 없는 것과 과세로 정한 것이 화면에서
   * 똑같이 보여서, 안 정한 채로 전표가 나가도 아무도 몰랐다(2026-09-06 사장님).
   * 셈은 그대로 과세로 한다 — 합계가 비면 그게 더 나쁘다. 대신 화면에 `-` 로 띄워
   * **아직 안 정했다는 걸 보이게** 한다.
   */
  taxUnknown?: boolean;
}

/** 매출이면 기본 계정이 800(일반매출)이다. 매입은 줄마다 골라야 한다. */
const 기본계정 = (t: StatementType) => (t === '매출' ? '800' : undefined);

/** 손으로 적은 줄 → 전표 줄. 이름이 빈 줄은 아직 안 적은 것이라 버린다. */
export function manualLines(rows: readonly ManualRow[], stmtType: StatementType): LineItem[] {
  return rows
    .filter(i => i.name.trim())
    .map((item, idx) => {
      const qty = parseFloat(item.qty) || 0;
      const price = parseFloat(item.price) || 0;
      /**
       * 단가는 부가세 포함 → 공급가액 역산 (주문 기반 경로와 같은 규칙).
       * **원 단위로 반올림한다** — 수량이 소수인 줄(0.277kg 같은 것)이 끼면 공급가·세액에
       * 소수점이 남아 합계가 1원씩 어긋나고, 전표에 '1,234.56원'이 찍힌다.
       */
      const { supply, tax } = lineAmount(qty, price, item.isTaxExempt);
      return {
        key: `manual-${idx}`, no: idx + 1, name: item.name, spec: item.spec,
        qty, price, supply, tax, total: supply + tax,
        isTaxExempt: item.isTaxExempt, side: item.side,
        accountCode: item.accountCode || 기본계정(stmtType),
      };
    });
}

/** 주문 한 줄이 실제로 무엇인지 — 박스면 낱개로 풀어서. */
export interface ResolvedOrderItem {
  /** 박스였으면 **낱개 품목**으로 바뀌어 있다 */
  product?: Item;
  /** 낱개 기준 수량 */
  qty: number;
  /** 박스를 풀었으면 개입수, 아니면 1 — **주문에 적힌 단가를 나눌 때 쓴다** */
  perBox: number;
  /** 품목을 못 찾음 — 박스가 안 풀렸을 수 있다 */
  unknownItem: boolean;
}

/**
 * 주문 줄 → 실제 품목·수량.
 *
 * **전표는 낱개 기준이다.** 박스 품목이면 낱개로 바꾸고 수량을 개입수만큼 늘린다.
 * 품목이 지워졌거나 id가 바뀌면 못 찾는다 → 박스가 안 풀리고 박스 수량 그대로 들어간다.
 * 이름으로 한 번 더 찾아보고, 그래도 없으면 `unknownItem` 을 단다(조용히 넘기지 않는다).
 */
export function resolveOrderItem(item: OrderItem, allItems: readonly Item[]): ResolvedOrderItem {
  let product = allItems.find(p => p.id === item.itemId)
    ?? (item.name ? allItems.find(p => !p.archived && p.name === item.name) : undefined);
  const unknownItem = !product;

  const uc = unpackComponent(product);
  let qty = item.quantity;
  let perBox = 1;
  if (uc) {
    const loose = allItems.find(p => p.id === uc.itemId);
    if (loose) {
      const boxCount = item.isBoxUnit && item.boxQuantity ? item.boxQuantity : item.quantity;
      product = loose;
      qty = boxCount * uc.count;
      perBox = uc.count;
    }
  }
  return { product, qty, perBox, unknownItem };
}

/**
 * 이 줄에 붙일 단가. **거래처 단가 > 주문에 적힌 값**.
 *
 * **주문 값으로 물러설 때는 개입수로 나눈다.** 주문은 박스로 받는데(`10개입 180,000`)
 * 위에서 수량을 낱개로 풀었다. 안 나누면 낱개 10개에 180,000씩 붙어 **열 배로 끊긴다.**
 */
export function orderItemPrice(
  r: Pick<ResolvedOrderItem, 'perBox'>, item: Pick<OrderItem, 'price'>, pcPrice?: number,
): number {
  const 주문단가 = item.price !== undefined ? Math.round(item.price / r.perBox) : undefined;
  return pcPrice ?? 주문단가 ?? 0;
}

export interface OrderLinesInput {
  order: Order;
  stmtType: StatementType;
  allItems: readonly Item[];
  /** 매출이면 판매(out), 매입이면 매입(in) 줄만 넘긴다 */
  partnerItems: readonly PartnerItem[];
  partnerId: string;
  /** 사람이 고쳐 적은 단가 (key → 글자) */
  editablePrices?: Record<string, string>;
  /** 사람이 뒤집은 과세 여부 (key → 면세인가) */
  taxExemptOverrides?: Record<string, boolean>;
  /** 사람이 고른 계정 (key → 계정코드) */
  accountCodeOverrides?: Record<string, string>;
}

/**
 * 주문 → 전표 줄.
 *
 * **같은 품목·규격은 한 줄로 합친다**(`key`). 주문 카드가 여럿이거나 한 카드에 같은 품목이
 * 두 번 들어 있어도 전표에는 한 줄로 나가야 한다.
 */
export function orderLines(input: OrderLinesInput): LineItem[] {
  const {
    order, stmtType, allItems, partnerItems, partnerId,
    editablePrices = {}, taxExemptOverrides = {}, accountCodeOverrides = {},
  } = input;

  const itemMap: Record<string, LineItem> = {};
  let no = 1;

  for (const item of order.items) {
    const { product, qty: qtyUnits, perBox, unknownItem } = resolveOrderItem(item, allItems);
    const displayName = product?.name || item.name;
    const spec = product?.spec || item.displaySize || '';
    const key = `${displayName}||${spec}`;

    const pcEntry = partnerItems.find(pc => pc.itemId === product?.id && pc.partnerId === partnerId);
    // 낱개 단가 (박스는 위에서 낱개로 바꿔 조회 → 낱개 partner_item 단가)
    const pcPrice = pcEntry?.price ?? boxDerivedUnitPrice(product, partnerId, partnerItems as any);
    const pcTaxType = pcEntry?.taxType;   // '과세' | '면세' | undefined(=과세 기본)

    //  단가 우선순위: 이번에 고친 값 > 거래처 단가 > 주문에 적힌 값(개입수로 나눠서)
    const defaultPrice = orderItemPrice({ perBox }, item, pcPrice);
    const unitPrice = editablePrices[key] !== undefined
      ? (parseFloat(editablePrices[key]) || 0) : defaultPrice;

    //  면세 여부: 사람이 뒤집은 것 > 거래처 taxType (없으면 과세)
    const isTaxExempt = key in taxExemptOverrides ? taxExemptOverrides[key] : pcTaxType === '면세';
    //  아무도 안 정했다 — 연결에 taxType 이 없고 이번에 뒤집지도 않았다.
    const taxUnknown = !(key in taxExemptOverrides) && pcTaxType === undefined;

    //  단가는 부가세 포함 값이라 거꾸로 푼다 — 셈은 shared/lineAmount 한 곳에 있다.
    //  예전엔 여기만 **단가를 먼저 나눠** 손입력과 1~2원 갈렸다(1,070원 × 7개 = 6,811 vs 6,809).
    const { supply, tax } = lineAmount(qtyUnits, unitPrice, isTaxExempt);

    const 있던줄 = itemMap[key];
    if (있던줄) {
      있던줄.qty += qtyUnits;
      있던줄.supply += supply;
      있던줄.tax += tax;
      있던줄.total += supply + tax;
    } else {
      // 계정 우선순위: 이번에 고른 값 > 전에 끊었던 계정(pcEntry) > 매출이면 800. 빈값('')도 800으로.
      const acCode = accountCodeOverrides[key] || pcEntry?.Account_Code || 기본계정(stmtType);
      itemMap[key] = {
        key, no: no++, name: displayName, spec,
        qty: qtyUnits, price: unitPrice, supply, tax, total: supply + tax,
        isTaxExempt, accountCode: acCode,
        ...(unknownItem ? { unknownItem: true } : {}),
        ...(taxUnknown ? { taxUnknown: true } : {}),
      };
    }
  }
  return Object.values(itemMap);
}

export interface LineTotals {
  /** 양변 전표(일반전표)인가 — 줄마다 차·대를 직접 세운 것 */
  isTwoSided: boolean;
  supply: number;
  tax: number;
  amount: number;
}

/**
 * 합계.
 *
 * **양변 전표는 차변 합만이 전표 금액이다.** 품목표처럼 전 줄을 더하면 차·대가 겹쳐
 * 두 배가 된다 — 거산농산 기초이월 1,230,000이 2,460,000으로 떴다.
 */
export function lineTotals(lines: readonly LineItem[]): LineTotals {
  const isTwoSided = lines.some(r => r.side === '차변' || r.side === '대변');
  const 셀것 = isTwoSided ? lines.filter(r => r.side === '차변') : lines;
  const supply = 셀것.reduce((s, r) => s + r.supply, 0);
  const tax = 셀것.reduce((s, r) => s + r.tax, 0);
  return { isTwoSided, supply, tax, amount: supply + tax };
}
