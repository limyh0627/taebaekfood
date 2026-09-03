import type { Item, Order } from '../../shared/types';
import { bomOf } from '../../shared/bomIndex';
import { stockUnits } from '../../shared/orderUnits';
import { dateOfLocal } from '../../shared/day';
import type { ItemReceipt } from '../../shared/receipt';

/**
 * **제품별원장** — 품목 하나가 언제 얼마나 들고 나갔나.
 *
 * 원료·벌크는 이미 원료수불부(rawMaterialLedger)가 있다. 없던 건 **완제품·부자재**다.
 * 그쪽은 재고가 주문 처리로만 움직이는데 그 자취를 한 자리에서 볼 데가 없었다.
 *
 * 근거는 **주문에 남은 스냅샷**과 **입고 기록**이다 — 짐작하지 않는다.
 *   · producedUnits  그때 실제로 만든 양      (+)
 *   · autoBuilt      모자라서 먼저 만든 양     (+)
 *   · shippedOut     출고한 양                (−)
 *   · 상위 품목 생산  그 BOM으로 빠져나간 양    (−)
 *   · 입고           사 온 양                 (+)   `itemReceipts`, 2026-09-03부터
 *
 * **입고는 2026-09-03 전 것이 없다.** 그날 입고 문(`shared/receipt`)을 만들면서 남기기
 * 시작했다. 그 전에는 재고 숫자만 조용히 바뀌어서, 산 것이 통째로 `gap` 으로 빠졌다 —
 * `300ML-사각병` 13,180개처럼 흐름이 0인데 재고만 있는 품목이 134개였다.
 *
 * 재고조정·실사처럼 주문 밖에서 움직인 것은 여기 안 잡힌다. 그래서 **맞춘 잔량이 아니라
 * 흐름**을 보여주고, 지금 재고와의 차이를 따로 밝힌다 — 억지로 맞추면 어디가 틀렸는지 가려진다.
 */
export type ItemLedgerKind = '생산' | '먼저생산' | '출고' | '자재사용' | '입고';

export interface ItemLedgerRow {
  date: string;
  kind: ItemLedgerKind;
  qty: number;            // +는 늘어난 것, −는 빠진 것
  partnerName: string;
  orderId: string;
  note: string;
  balance: number;        // 첫 줄부터 굴린 누계 (0에서 시작)
}

export interface ItemLedger {
  rows: ItemLedgerRow[];
  inSum: number;
  outSum: number;
  net: number;
  /** 지금 재고 − 흐름 합계. 0이 아니면 주문 밖에서 움직인 몫(실사·조정·수동입력)이다. */
  gap: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const dayOf = (o: Order) =>
  dateOfLocal(String((o as { deliveredAt?: string }).deliveredAt || o.deliveryDate || o.createdAt || ''));

export function buildItemLedger(
  itemId: string,
  orders: Order[],
  allItems: Item[],
  /** 사 온 기록. 안 넘기면 예전처럼 주문만 본다(옛 호출부 호환). */
  receipts: ItemReceipt[] = [],
): ItemLedger {
  const rows: ItemLedgerRow[] = [];
  const nameOf = (id: string) => allItems.find(i => i.id === id)?.name ?? id;

  for (const o of orders) {
    const date = dayOf(o);
    const partnerName = o.partnerName ?? '';

    //  ① 그때 실제로 만든 양
    for (const p of (o.producedUnits ?? [])) {
      if (p.itemId !== itemId || !Number(p.qty)) continue;
      rows.push({ date, kind: '생산', qty: r3(Number(p.qty)), partnerName, orderId: o.id, note: '작업완료', balance: 0 });
    }
    //  ② 모자라서 먼저 만든 양
    for (const b of (o.autoBuilt ?? [])) {
      if (b.itemId !== itemId || !Number(b.qty)) continue;
      rows.push({ date, kind: '먼저생산', qty: r3(Number(b.qty)), partnerName, orderId: o.id, note: '구성품이 모자라 먼저 만듦', balance: 0 });
    }
    //  ③ 출고 — 주문 줄에 이 품목이 있으면 판 만큼 빠진다
    if (o.shippedOut) {
      for (const it of o.items) {
        if (it.itemId !== itemId) continue;
        const p = allItems.find(x => x.id === itemId);
        const q = p ? stockUnits(it, p) : it.quantity;
        if (q) rows.push({ date, kind: '출고', qty: -r3(q), partnerName, orderId: o.id, note: '출고', balance: 0 });
      }
    }
    //  ④ 상위 품목을 만들면서 이 품목이 구성품으로 빠져나간 양
    for (const p of (o.producedUnits ?? [])) {
      const line = bomOf(p.itemId).find(l => l.childId === itemId);
      if (!line || !Number(p.qty)) continue;
      const used = r3(Number(p.qty) * Number(line.qty));
      if (used) rows.push({ date, kind: '자재사용', qty: -used, partnerName, orderId: o.id, note: `${nameOf(p.itemId)} ${r3(Number(p.qty))} 생산에 씀`, balance: 0 });
    }
  }

  //  ⑤ 사 온 양 — 주문 밖에서 들어온 유일한 근거
  for (const r of receipts) {
    if (r.itemId !== itemId || !Number(r.quantity)) continue;
    rows.push({
      date: dateOfLocal(r.date), kind: '입고', qty: r3(Number(r.quantity)),
      partnerName: r.partnerName ?? '', orderId: r.poId ?? '',
      note: r.poId ? '발주 입고' : '입고', balance: 0,
    });
  }

  //  날짜 → 주문 id 순. 같은 날 여러 건이면 들어온 순서가 잔량을 가르므로 못 박는다.
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.orderId.localeCompare(b.orderId) || a.kind.localeCompare(b.kind));
  let bal = 0;
  for (const r of rows) { bal = r3(bal + r.qty); r.balance = bal; }

  const inSum = r3(rows.filter(r => r.qty > 0).reduce((a, r) => a + r.qty, 0));
  const outSum = r3(rows.filter(r => r.qty < 0).reduce((a, r) => a + r.qty, 0));
  const stock = Number(allItems.find(i => i.id === itemId)?.stock ?? 0);
  return { rows, inSum, outSum, net: r3(inSum + outSum), gap: r3(stock - r3(inSum + outSum)) };
}
