import { normalizeOrderInterpretationUnits, resolveOrderInterpretationAlias } from './orderInterpretation';
import { validateOrderCopyScopedSources, type ScopedOrderSource } from '../../functions/src/shared/orderCopyInterpretationScope';
import type { CatalogItem, ScopedExtractResult } from './orderExtract';
export { validateOrderCopyScopedSources } from '../../functions/src/shared/orderCopyInterpretationScope';
export type ScopedSource = ScopedOrderSource;
export type OrderCopyScopeRow = { sourceId: string; rawText: string; rawName: string; qty: number; isBox: boolean; selectedProductId: string | null; manual?: boolean; aiResolved?: boolean; aliasConflict?: boolean; orderedAs?: string; sourceStart?: number; sourceEnd?: number };
type Context = { catalog: readonly CatalogItem[]; rules: readonly { alias: string; itemId: string; partnerId: string; status: string; kind?: string }[]; partnerId: string };
const normalized = (value: string) => normalizeOrderInterpretationUnits(value).trim().replace(/\s+/g, ' ').toLowerCase();

export function classifyOrderCopyRow(row: OrderCopyScopeRow, context: Context): { status: 'confirmed' | 'ambiguous' | 'manual' | 'conflict' | 'resolved' } {
  if (row.manual) return { status: 'manual' };
  if (row.aiResolved) return { status: 'resolved' };
  if (row.aliasConflict) return { status: 'conflict' };
  const text = normalizeOrderInterpretationUnits(row.rawText);
  // 용량만 적힌 글을 기본 주문 수량 1의 근거로 삼지 않는다.
  const specificationOnly = context.catalog.some(item => !!item.spec?.trim() && normalized(`${item.name} ${item.spec}`) === normalized(text));
  const quantities = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(박스|box|개|병|캔|포)(?=\s|$)/gi)];
  const last = quantities[quantities.length - 1];
  const expression = last ? (text.slice(0, last.index) + text.slice(last.index! + last[0].length)).trim() : text.trim();
  const alias = resolveOrderInterpretationAlias(normalizeOrderInterpretationUnits(expression), context.rules.map(rule => ({ ...rule, alias: normalizeOrderInterpretationUnits(rule.alias) })), context.partnerId);
  if (alias.status === 'conflict') return { status: 'conflict' };
  if (specificationOnly || !last || Number(last[1]) !== row.qty || !(row.qty > 0) || !Number.isFinite(row.qty)) return { status: 'ambiguous' };
  const unitMatches = /박스|box/i.test(last[2]) === row.isBox;
  const exact = context.catalog.filter(item => normalized(item.name) === normalized(expression) || normalized(`${item.name} ${item.spec ?? ''}`) === normalized(expression));
  const itemId = alias.status === 'matched' ? alias.itemId : exact.length === 1 ? exact[0].id : undefined;
  return { status: unitMatches && itemId !== undefined && row.selectedProductId === itemId && context.catalog.some(item => item.id === itemId) ? 'confirmed' : 'ambiguous' };
}

export function buildOrderCopyScopedSources(rows: readonly OrderCopyScopeRow[], context: Context): ScopedSource[] {
  const sources = rows.filter(row => classifyOrderCopyRow(row, context).status === 'ambiguous').map(row => ({ sourceId: row.sourceId, text: row.rawText }));
  return sources.length ? validateOrderCopyScopedSources(sources) : [];
}

export function mergeOrderCopyScopedResult<T extends OrderCopyScopeRow>(rows: readonly T[], sources: readonly ScopedSource[], result: ScopedExtractResult): T[] {
  if (!result.valid) return [...rows];
  const requested = new Map(sources.map(source => [source.sourceId, source.text])), used = new Set(rows.map(row => row.sourceId));
  return rows.flatMap(row => {
    if (row.manual || row.aiResolved || row.aliasConflict || requested.get(row.sourceId) !== row.rawText) return [row];
    const matches = result.results.filter(group => group.sourceId === row.sourceId);
    if (matches.length !== 1 || result.unresolvedSourceIds.includes(row.sourceId)) return [row];
    return matches[0].lines.map((line, index) => {
      let sourceId = row.sourceId;
      if (matches[0].lines.length > 1) {
        const base = `${row.sourceId.slice(0, 48)}_ai${index + 1}`; sourceId = base; let collision = 0;
        while (used.has(sourceId)) sourceId = `${base.slice(0, 55)}_c${++collision}`;
        used.add(sourceId);
      }
      return { ...row, sourceId, rawName: line.name, qty: line.qty, isBox: line.isBox ?? row.isBox, selectedProductId: line.itemId, aiResolved: true, orderedAs: line.source };
    });
  });
}
