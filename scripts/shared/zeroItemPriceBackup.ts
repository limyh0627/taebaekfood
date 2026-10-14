import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { resolve, dirname, basename } from 'node:path';

export function resolveZeroItemPriceBackupPath(company:string,input:string){
  if (!['taebaek','punghoe'].includes(company)) throw Error('백업 회사를 확인하세요.');
  const path=resolve(input),family=resolve(`work/zero-item-price-${company}-20261015`);
  if(dirname(path)!==resolve('work')) throw Error('등록된 비공개 백업 경로가 아닙니다.');
  const match=new RegExp(`^zero-item-price-${company}-20261015(?:-v([1-9]\\d*))?\\.json$`).exec(basename(path));
  if(!match)throw Error('백업 revision 경로를 확인하세요.');
  const revision=match[1]===undefined?1:Number(match[1]);
  if(!Number.isSafeInteger(revision)||revision<1||match[1]!==undefined&&(revision<2||String(revision)!==match[1]))throw Error('명시적인 안전 정수 v2 이상 revision을 사용하세요.');
  return {path,revision,family};
}
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
