import type { Item, Order, OrderStatus } from '../../shared/types';

/**
 * **되돌리면 무엇이 되돌아오는가** — 작업완료·출고에서 대기중·작업중으로 보낼 때 보여줄 문구.
 *
 * 되돌리기는 재고를 조용히 움직인다: 출고취소로 완제품이 다시 채워지고, 생산취소로 BOM 구성품과
 * 원료 로트가 복원되며 원료수불부 줄이 지워진다. 눌러 놓고 나중에 "왜 재고가 늘었지"로 만나면
 * 되짚기 어렵다. 그래서 **누르기 전에** 무엇이 움직이는지 적어 보여주고 확인을 받는다.
 *
 * 순수 함수다 — 화면은 이 글을 띄우기만 한다.
 */
export interface RollbackPlan {
  /** 되돌릴 게 하나도 없으면 false — 물어볼 것도 없다 */
  needed: boolean;
  lines: string[];
  text: string;
}

const fmt = (n: number) => Math.round(n * 1000) / 1000;

export function buildRollbackPlan(
  order: Pick<Order, 'items' | 'producedUnits' | 'rawConsumedLots' | 'shippedOut' | 'autoBuilt'>,
  allItems: Item[],
  from: OrderStatus | string,
  to: OrderStatus | string,
): RollbackPlan {
  const nameOf = (id: string) => {
    const p = allItems.find(i => i.id === id);
    return p ? `${p.name}${p.spec ? ` ${p.spec}` : ''}` : id;
  };
  const unitOf = (id: string) => allItems.find(i => i.id === id)?.unit ?? '개';
  const lines: string[] = [];

  if (order.shippedOut) {
    const rows = order.items
      .map(it => ({ name: nameOf(it.itemId), qty: (it as { isBoxUnit?: boolean; boxQuantity?: number }).isBoxUnit && (it as { boxQuantity?: number }).boxQuantity ? (it as { boxQuantity?: number }).boxQuantity! : it.quantity, unit: unitOf(it.itemId) }))
      .filter(r => r.qty > 0);
    if (rows.length) lines.push(`· 출고취소 — 재고가 다시 늘어납니다: ${rows.map(r => `${r.name} +${fmt(r.qty)}`).join(', ')}`);
  }

  const produced = (order.producedUnits ?? []).filter(p => Number(p.qty) > 0);
  if (produced.length) {
    lines.push(`· 생산취소 — 만든 만큼 재고에서 뺍니다: ${produced.map(p => `${nameOf(p.itemId)} −${fmt(Number(p.qty))}`).join(', ')}`);
    lines.push(`  (그 BOM 구성품 — 병·캡·라벨·박스 — 은 도로 채워집니다)`);
  }

  const raw = order.rawConsumedLots ?? [];
  if (raw.length) {
    const byMat = new Map<string, number>();
    for (const r of raw) byMat.set(r.material, fmt((byMat.get(r.material) ?? 0) + Number(r.kg || 0)));
    lines.push(`· 원료가 로트로 되돌아갑니다: ${[...byMat].map(([m, kg]) => `${m} ${fmt(kg)}kg`).join(', ')}`);
    lines.push(`  원료수불부에 적힌 그 사용 줄도 함께 지워집니다`);
  }

  if ((order.autoBuilt ?? []).length) {
    lines.push(`· 모자라서 먼저 만들었던 구성품도 되돌립니다: ${(order.autoBuilt ?? []).map(b => `${nameOf(b.itemId)} ${fmt(Number(b.qty))}`).join(', ')}`);
  }

  const label = (s: string) => ({ PENDING: '대기중', PROCESSING: '작업중', DISPATCHED: '작업완료', SHIPPED: '출고', DELIVERED: '배송완료' } as Record<string, string>)[String(s)] ?? String(s);
  const head = `'${label(from)}' → '${label(to)}'로 되돌립니다.`;
  return {
    needed: lines.length > 0,
    lines,
    text: lines.length
      ? `${head}\n\n되돌아가는 것:\n${lines.join('\n')}\n\n계속할까요?`
      : `${head}\n\n되돌릴 재고는 없습니다. 계속할까요?`,
  };
}
