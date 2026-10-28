export interface PackRow {
  item_id: string;
  units_per_box?: number;
}

export interface PackIndex {
  /** 개입수. 없으면 0 = 박스로 안 판다. */
  of: (_itemId: string) => number;
  size: number;
}

export function buildPackIndex(rows: PackRow[] = []): PackIndex {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!r?.item_id) continue;
    const n = Number(r.units_per_box);
    //  1은 안 담는다 — "한 박스에 한 개"는 박스가 아니다
    if (!Number.isFinite(n) || n <= 1) continue;
    m.set(r.item_id, n);
  }
  return { of: (id: string) => m.get(id) ?? 0, size: m.size };
}
