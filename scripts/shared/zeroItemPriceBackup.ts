import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
// JSON은 Timestamp/비유한수/undefined를 잃으므로 원문을 명시적으로 보존한다.
export const encode = (v: any): any => {
  if (v instanceof Timestamp) return { __zeroMigrationType: 'timestamp', seconds: v.seconds, nanoseconds: v.nanoseconds };
  if (v === undefined) return { __zeroMigrationType: 'undefined' };
  if (typeof v === 'number' && (!Number.isFinite(v) || Object.is(v, -0))) return { __zeroMigrationType: 'number', value: Object.is(v, -0) ? '-0' : String(v) };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') {
    if (Object.getPrototypeOf(v) !== Object.prototype || Object.hasOwn(v, '__zeroMigrationType')) throw Error('지원하지 않는 원문 타입. 적용 보류');
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  }
  return v;
};
export const decode = (v: any): any => v?.__zeroMigrationType === 'timestamp' ? new Timestamp(v.seconds, v.nanoseconds)
  : v?.__zeroMigrationType === 'undefined' ? undefined : v?.__zeroMigrationType === 'number' ? Number(v.value)
  : Array.isArray(v) ? v.map(decode) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)])) : v;
export const stable = (v: any): any => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
export const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(stable(encode(v)))).digest('hex');
