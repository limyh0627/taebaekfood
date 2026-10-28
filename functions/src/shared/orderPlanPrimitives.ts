import type {OrderInventoryGeneration} from './orderStockReservationPlan';

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function assertPlainOrderRawBatch(value:unknown):void {
 const walk=(v:unknown)=>{if(v===null||typeof v==='string'||typeof v==='boolean')return;if(typeof v==='number'&&Number.isFinite(v))return;if(Array.isArray(v)){v.forEach(walk);return;}if(v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype){Object.values(v).forEach(walk);return;}throw Error('원료 일괄 요청은 유한한 JSON 원문만 저장할 수 있습니다.');};
 walk(value);if(new TextEncoder().encode(JSON.stringify(value)).byteLength>700_000)throw Error('원료 일괄 요청 원문이 저장 한도를 초과했습니다.');
}
export function rawPressText(value: unknown): string {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().filter(key => v[key] !== undefined).map(key => [key, canonical(v[key])])) : v;
  return JSON.stringify(canonical(value));
}
export function validateOrderInventoryGeneration(generation:OrderInventoryGeneration):void {
 if(generation?.contractVersion!==1||!['taebaek','punghoe'].includes(generation.companyId)||![generation.orderId,generation.operationId,generation.actorUid,generation.startedAt].every(value=>typeof value==='string'&&value.trim().length>0&&value===value.trim())||!Number.isFinite(Date.parse(generation.startedAt)))throw Error('주문 재고 작업의 최초 세대를 확인해 주세요.');
}
export const isCalendarDay = (value: string): boolean => {
  const match = DAY_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
};

export function dateOfLocal(iso?: string): string {
  const v = String(iso ?? '');
  if (!v) return '';
  if (!v.includes('T')) return v.slice(0, 10);   // 이미 날짜다
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v.slice(0, 10);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

