import type { Item } from '../../../shared/types';
import type { OrderCopyScopeRow } from '../../../shared/orderCopyInterpretationScope';

const getBigrams = (s: string) => {
  const clean = s.toLowerCase().replace(/\s+/g, '');
  const set = new Set<string>();
  for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
  return set;
};

const bigramSim = (a: string, b: string) => {
  const ba = getBigrams(a), bb = getBigrams(b);
  if (!ba.size || !bb.size) return 0;
  return (2 * [...ba].filter(x => bb.has(x)).length) / (ba.size + bb.size);
};

const scoreOne = (target: string, q: string): number => {
  const pn = target.toLowerCase().replace(/\s+/g, '');
  if (!q) return 0;
  if (pn === q) return 1;
  if (pn.includes(q) || q.includes(pn)) return 0.85;
  return bigramSim(pn, q);
};

export const scoreProduct = (product: { name: string; spec?: string }, query: string): number => {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const 이름 = scoreOne(product.name, q);
  const 규격까지 = product.spec ? scoreOne(`${product.name} ${product.spec}`, q) : 0;
  return Math.max(이름, 규격까지);
};

export type ParsedLine = OrderCopyScopeRow;

export const parseLine = (line: string, pool: Item[]): Omit<ParsedLine,'sourceId'> => {
  // "3박스", "5개", "1kg" 형태에서 마지막 수량+단위 추출
  // ※ \b 는 한글(非ASCII) 뒤에서 동작하지 않으므로 (?:\s|$) 로 대체
  const re = /(\d+(?:\.\d+)?)\s*(박스|box|개|kg|g|L|ml|l)(?=\s|$)/gi;
  let qty = 1, isBox = true, m: RegExpExecArray | null, last: RegExpExecArray | null = null;
  while ((m = re.exec(line)) !== null) last = m;
  if (last) {
    qty = parseFloat(last[1]);
    isBox = /박스|box/i.test(last[2]);
  }
  const rawName = line.replace(/\d+(?:\.\d+)?\s*(?:박스|box|개|kg|g|L|ml|l)(?=\s|$)/gi, '').trim();
  const scored = pool
    .map(p => ({ product: p, score: scoreProduct(p, rawName) }))
    .sort((a, b) => b.score - a.score);
  return {
    rawText: line,
    rawName,
    qty,
    isBox,
    selectedProductId: scored[0]?.score >= 0.25 ? scored[0].product.id : null,
  };
};
