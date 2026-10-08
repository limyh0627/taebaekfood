import { parsePackageKg, parseSpecCount } from './formula';

export type StockComponent = { childId: string; qty: number; child?: { type?: string } };
export function unpackStockComponent(lines: readonly StockComponent[]): { itemId: string; count: number } | null {
  const components = lines.filter(line => line.child?.type === 'product' || line.child?.type === '완제품');
  return components.length === 1 && components[0].qty > 1
    ? { itemId: components[0].childId, count: components[0].qty } : null;
}

export function itemPackageKg(item: { packageKg?: number; spec?: string; name: string; unit?: string }, isBox: boolean): number {
  if (item.packageKg) return item.packageKg;
  const perUnit = parsePackageKg(item.spec) ?? parsePackageKg(item.name) ?? 0;
  return perUnit * (isBox || item.unit === '박스' ? parseSpecCount(item.spec) : 1);
}

export function stockUnitKg(product: { spec?: string } | undefined,
  component: { itemId: string; count: number } | null,
  findItem: (id: string) => { spec?: string } | undefined): number | undefined {
  if (!product) return undefined;
  if (!component) return parsePackageKg(product.spec);
  const looseKg = parsePackageKg(findItem(component.itemId)?.spec);
  return looseKg === undefined ? undefined : looseKg * component.count;
}

/** 입고 수량의 kg 환산. 앱과 서버는 같은 포장·밀도 계약을 사용한다. */
export function receiptToKg(params: { quantity: number; unit?: string; density: number; packageKg?: number }): number {
  const unit = (params.unit ?? '').toLowerCase();
  let kg: number;
  if (unit === 'kg') kg = params.quantity;
  else if (unit === 'l') kg = params.quantity * params.density;
  else if (params.packageKg) kg = params.quantity * params.packageKg;
  else kg = params.quantity;
  return Math.round(kg * 1000) / 1000;
}
