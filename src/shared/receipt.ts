import type { CompanyId, Item } from './types';
import { addItem, adjustItemStock } from './services/firebaseService';
import { rawLotTarget, recordRawMaterialReceipt } from './rawReceipt';

/**
 * **입고는 문 하나로 들어온다.**
 *
 * 예전엔 부르는 자리마다 "원료면 로트+수불부, 아니면 재고만 더하기"를 손으로 갈랐다.
 * 갈림이 화면에 흩어져 있으면 세 가지가 따라온다 —
 *
 *   ① 겹쳐 눌러도 막을 자리가 없다. 실제로 2026-08-06 참깨 1500kg 이 107밀리초 사이에
 *      두 번 들어갔다(로트 둘·원장 두 줄). 원료 쪽은 막았는데 부자재는 막을 데가 없었다.
 *   ② **부자재 입고가 아무 기록도 안 남는다.** 재고 숫자만 조용히 바뀐다.
 *      제품별원장은 주문 스냅샷만 보므로, 산 것은 통째로 '설명 안 되는 차이'로 빠진다.
 *   ③ 새 입고 경로를 붙일 때마다 그 갈림을 또 적어야 한다.
 *
 * 그래서 갈림을 여기 하나로 옮긴다. 부르는 쪽은 "이만큼 들어왔다"만 말한다.
 *
 *   원료·반제품  → 로트 + 원료수불부(kg)          `rawReceipt.ts`
 *   그 밖        → 재고 + **입고 기록**(itemReceipts)
 *
 * 원료는 이미 수불부가 사건을 담고 있어 따로 안 남긴다 — 두 벌이 되면 또 갈린다.
 */

/** 원료가 아닌 품목의 입고 한 줄. 제품별원장이 이걸 읽어 '입고'로 그린다. */
export interface ItemReceipt {
  id: string;
  itemId: string;
  itemName: string;
  quantity: number;
  unit?: string;
  partnerId?: string;
  partnerName: string;
  /** 입고일 'YYYY-MM-DD' */
  date: string;
  poId?: string;
  companyId?: CompanyId;
  addedBy?: string;
  createdAt: string;
}

/** 아직 처리 중인 입고 — 같은 것이 겹쳐 들어오면 두 번째는 돌려보낸다 */
const 처리중 = new Set<string>();

export interface ReceiptResult {
  /** 'raw' 원료로 잡힘 · 'stock' 재고로 잡힘 · 'skipped' 겹쳐 들어와 막힘 · 'none' 품목을 모름 */
  kind: 'raw' | 'stock' | 'skipped' | 'none';
  baseName?: string;
  kgIn?: number;
}

export async function recordReceipt(opts: {
  allItems: Item[];
  product?: Item;
  itemName: string;
  quantity: number;
  unit?: string;
  partnerId?: string;
  partnerName: string;
  dateStr: string;
  nowIso: string;
  poId?: string;
  addedBy?: string;
  companyId?: CompanyId;
}): Promise<ReceiptResult> {
  const { allItems, product, itemName, quantity, unit, partnerId, partnerName,
          dateStr, nowIso, poId, addedBy, companyId } = opts;

  //  원료·반제품이면 로트와 수불부가 맡는다(그쪽도 제 몫의 겹침 방지를 갖고 있다)
  if (rawLotTarget(allItems, product, product?.name ?? itemName, companyId)) {
    const r = await recordRawMaterialReceipt(opts);
    return r.recorded ? { kind: 'raw', baseName: r.baseName, kgIn: r.kgIn } : { kind: 'skipped' };
  }

  if (!product) return { kind: 'none' };
  if (!Number.isFinite(quantity) || quantity === 0) return { kind: 'none' };

  const 표 = `${product.id}|${dateStr}|${quantity}|${partnerId ?? partnerName}|${poId ?? ''}`;
  if (처리중.has(표)) return { kind: 'skipped' };
  처리중.add(표);
  try {
    //  재고는 DB에서 읽어 더한다 — 화면값에 더해 덮어쓰면 그 사이 들어온 쓰기가 날아간다
    await adjustItemStock('items', product.id, quantity);
    await addItem('itemReceipts', {
      id: `rcv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      itemId: product.id,
      itemName: product.name,
      quantity,
      ...(unit ? { unit } : {}),
      ...(partnerId ? { partnerId } : {}),
      partnerName,
      date: dateStr,
      ...(poId ? { poId } : {}),
      ...(companyId ? { companyId } : {}),
      ...(addedBy ? { addedBy } : {}),
      createdAt: nowIso,
    } as Omit<ItemReceipt, 'id'> & { id: string });
    return { kind: 'stock' };
  } finally {
    처리중.delete(표);
  }
}
