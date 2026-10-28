const safePart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'item';

/** 옛 주문도 첫 품목 작업 때 줄 ID를 한 번만 확정한다. */
export function ensureOrderLineIds<T extends {itemId:string;lineId?:string}>(items: readonly T[]): T[] {
  const used = new Set<string>();
  return items.map((item, index) => {
    const base = item.lineId || `line-${index + 1}-${safePart(item.itemId)}`;
    let lineId = base;
    let suffix = 2;
    while (used.has(lineId)) lineId = `${base}-${suffix++}`;
    used.add(lineId);
    return item.lineId === lineId ? item : { ...item, lineId };
  });
}

