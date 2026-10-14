export type ScopedOrderSource = { sourceId: string; text: string };
export type ScopedOrderLine = { itemId: string; qty: number; isBox?: boolean; source: string };
export type ScopedOrderResponse = { valid: boolean; results: { sourceId: string; lines: ScopedOrderLine[] }[]; unresolvedSourceIds: string[] };
const plain = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const groupLineLimit = 40;
const assignmentBudget = 20000;

/** 같은 원문 구간을 여러 품목의 증거로 쓰지 않는다. 배치를 확정하지 못하면 직접 확인한다. */
function assignFragments(text: string, lines: readonly ScopedOrderLine[]): boolean {
  let budget = assignmentBudget;
  const cache = new Map<string, number[]>();
  const choices: { size: number; starts: number[] }[] = [];
  for (const line of lines) {
    let starts = cache.get(line.source);
    if (!starts) {
      starts = []; let from = 0;
      while (from < text.length) {
        if (--budget < 0) return false;
        const index = text.indexOf(line.source, from); if (index < 0) break;
        starts.push(index); from = index + 1;
      }
      cache.set(line.source, starts);
    }
    choices.push({ size: line.source.length, starts });
  }
  choices.sort((a, b) => a.starts.length - b.starts.length || b.size - a.size);
  const occupied: { start: number; end: number }[] = [];
  function search(index: number): boolean {
    if (index === choices.length) return true;
    const choice = choices[index];
    for (const start of choice.starts) {
      if (--budget < 0) return false;
      const end = start + choice.size;
      if (occupied.some(range => start < range.end && end > range.start)) continue;
      occupied.push({ start, end });
      if (search(index + 1)) return true;
      occupied.pop();
    }
    return false;
  }
  return search(0);
}

/** 선택한 원문을 자르거나 합치면 귀속이 바뀌므로 한도를 넘긴 요청은 통째로 거절한다. */
export function validateOrderCopyScopedSources(value: unknown): ScopedOrderSource[] {
  if (!Array.isArray(value) || !value.length || value.length > 40) throw Error('읽을 원문 범위를 확인해 주세요.');
  const seen = new Set<string>(); let length = 0;
  return value.map(row => {
    if (!plain(row) || Object.keys(row).some(key => !['sourceId', 'text'].includes(key))
      || typeof row.sourceId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(row.sourceId) || seen.has(row.sourceId)
      || typeof row.text !== 'string' || !row.text.trim()) throw Error('읽을 원문 범위를 확인해 주세요.');
    seen.add(row.sourceId); length += row.text.length;
    if (length > 4000) throw Error('읽을 원문 범위가 너무 깁니다.');
    return { sourceId: row.sourceId, text: row.text };
  });
}

/** 서버와 앱이 같은 원문 그룹을 검사한다. 한 그룹의 실패가 다른 그룹의 증거가 되지 않는다. */
export function validateOrderCopyScopedResponse(raw: unknown, sources: readonly ScopedOrderSource[], itemIds: readonly string[]): ScopedOrderResponse {
  const targets = validateOrderCopyScopedSources(sources), allowed = new Map(targets.map(row => [row.sourceId, row.text]));
  const invalid = (): ScopedOrderResponse => ({ valid: false, results: [], unresolvedSourceIds: targets.map(row => row.sourceId) });
  if (!plain(raw) || !Array.isArray(raw.results)) return invalid();
  if (raw.results.some(group => !plain(group) || typeof group.sourceId !== 'string' || !allowed.has(group.sourceId))) return invalid();
  const catalog = new Set(itemIds), results: ScopedOrderResponse['results'] = [], unresolvedSourceIds: string[] = [];
  for (const target of targets) {
    const groups = raw.results.filter(group => group.sourceId === target.sourceId);
    if (groups.length !== 1) { unresolvedSourceIds.push(target.sourceId); continue; }
    const group = groups[0], tuples = new Set<string>();
    const fragment = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && target.text.includes(value);
    if (!Array.isArray(group.lines) || !Array.isArray(group.rejected) || !group.lines.length || group.lines.length > groupLineLimit || group.rejected.length) {
      unresolvedSourceIds.push(target.sourceId); continue;
    }
    const lines: ScopedOrderLine[] = []; let valid = true;
    for (const line of group.lines) {
      if (!plain(line) || typeof line.itemId !== 'string' || !catalog.has(line.itemId)
        || typeof line.qty !== 'number' || !Number.isFinite(line.qty) || line.qty <= 0
        || line.isBox !== undefined && typeof line.isBox !== 'boolean' || !fragment(line.source)) { valid = false; break; }
      const tuple = JSON.stringify([line.itemId, line.qty, line.isBox ?? null, line.source]);
      if (tuples.has(tuple)) { valid = false; break; }
      tuples.add(tuple); lines.push({ itemId: line.itemId, qty: line.qty, source: line.source, ...(line.isBox !== undefined ? { isBox: line.isBox } : {}) });
    }
    if (valid && assignFragments(target.text, lines)) results.push({ sourceId: target.sourceId, lines }); else unresolvedSourceIds.push(target.sourceId);
  }
  return { valid: true, results, unresolvedSourceIds };
}
