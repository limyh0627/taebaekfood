export interface FullEffectAuthorityV1 {
  readonly version: 1;
  readonly protocol: 'full-v1';
  readonly companyId: 'taebaek' | 'punghoe';
  readonly orderId: string;
  readonly ownerUid: string;
  readonly attemptId: string;
}
export type FullEffectAuthorityRead = {kind:'absent'} | {kind:'valid-v1';value:Readonly<FullEffectAuthorityV1>} | {kind:'invalid'};
const authorityKeys = ['version','protocol','companyId','orderId','ownerUid','attemptId'] as const;
const own = (object:object, key:PropertyKey) => Object.prototype.hasOwnProperty.call(object,key);
const ordinary = (value:unknown):value is Record<string,unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype=Object.getPrototypeOf(value);
  return prototype===Object.prototype || prototype===null;
};
/** 읽기 전용 descriptor 검사로 낯선 getter를 실행하지 않는다. */
function dataEntries(value:unknown):[string,unknown][] | null {
  if (!ordinary(value)) return null;
  const result:[string,unknown][]=[];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return null;
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
    result.push([key,descriptor.value]);
  }
  return result;
}
function authority(value:unknown):Readonly<FullEffectAuthorityV1> | null {
  const entries=dataEntries(value);
  if (!entries || entries.length!==authorityKeys.length || authorityKeys.some(key=>!own(value as object,key))) return null;
  const fields=Object.fromEntries(entries);
  if (fields.version!==1 || fields.protocol!=='full-v1' || !['taebaek','punghoe'].includes(fields.companyId as string)
    || typeof fields.orderId!=='string' || fields.orderId.length===0 || typeof fields.ownerUid!=='string' || fields.ownerUid.length===0
    || typeof fields.attemptId!=='string' || fields.attemptId.length===0) return null;
  return Object.freeze({version:1,protocol:'full-v1',companyId:fields.companyId as FullEffectAuthorityV1['companyId'],orderId:fields.orderId,ownerUid:fields.ownerUid,attemptId:fields.attemptId});
}
/** 형식만 확인한다. 발행자나 저장 근거의 권위는 호출자가 확인한다. */
export function readFullEffectAuthority(row:unknown):FullEffectAuthorityRead {
  if (!row || typeof row!=='object' || Array.isArray(row)) return {kind:'invalid'};
  if (!own(row,'fullEffectAuthority')) return 'fullEffectAuthority' in row ? {kind:'invalid'} : {kind:'absent'};
  const descriptor=Object.getOwnPropertyDescriptor(row,'fullEffectAuthority');
  if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return {kind:'invalid'};
  const value=authority(descriptor.value);
  return value ? {kind:'valid-v1',value} : {kind:'invalid'};
}
export function markNewFullEffect<T extends Record<string,unknown>>(payload:T, context:FullEffectAuthorityV1):T & {fullEffectAuthority:Readonly<FullEffectAuthorityV1>} {
  const entries=dataEntries(payload),value=authority(context);
  if (!entries || 'fullEffectAuthority' in payload || !value) throw new Error('신규 효과와 서버 표식 형식을 확인해 주세요.');
  return Object.fromEntries([...entries,['fullEffectAuthority',value]]) as T & {fullEffectAuthority:Readonly<FullEffectAuthorityV1>};
}
export interface ProductionRecordMatchOptions {text:(value:unknown)=>string;assertSupersession?:(before:unknown,after:unknown)=>unknown}
/** 생성 근거의 hash 검증과 별개로 현재 업무 필드만 비교한다. */
export function assertProductionRecordBusinessMatches(original:Record<string,unknown>,current:Record<string,unknown>,options:ProductionRecordMatchOptions):void {
  const before=dataEntries(original),after=dataEntries(current);
  if (!before || !after || !options || typeof options.text!=='function') throw new Error('생산 기록 원문 형식을 확인해 주세요.');
  const pick=(entries:[string,unknown][],excluded:readonly string[])=>Object.fromEntries(entries.filter(([key])=>!excluded.includes(key)));
  const originalTransportAbsent=!own(original,'inventoryWriterProtocolVersion')&&!own(original,'inventoryWriteRevision');
  const currentTransportPresent=own(current,'inventoryWriterProtocolVersion')||own(current,'inventoryWriteRevision');
  const introducedTransport=originalTransportAbsent&&currentTransportPresent;
  if (introducedTransport && (!own(current,'inventoryWriterProtocolVersion')||current.inventoryWriterProtocolVersion!==1||!own(current,'inventoryWriteRevision')||!Number.isSafeInteger(current.inventoryWriteRevision)||(current.inventoryWriteRevision as number)<1)) throw new Error('생산 기록의 쓰기 전이 형식을 확인해 주세요.');
  const excluded=['date','inventoryWriteRevision',...(introducedTransport?['inventoryWriterProtocolVersion']:[])];
  const first=pick(before,excluded),last=pick(after,excluded);
  const firstSup=pick(before.filter(([key])=>key==='supersededBy'),[]),lastSup=pick(after.filter(([key])=>key==='supersededBy'),[]);
  if (options.text(firstSup)!==options.text(lastSup)) {
    if (typeof options.assertSupersession!=='function') throw new Error('생산 기록의 후속 전이 근거를 확인해 주세요.');
    const verified=options.assertSupersession(firstSup.supersededBy,lastSup.supersededBy);
    if (verified !== undefined) {
      // 비동기 실패는 관측만 하고, 검증이 끝난 것으로 받아들이지 않는다.
      try { Promise.prototype.then.call(verified as Promise<unknown>,undefined,()=>undefined); } catch { /* Promise가 아니면 실행하지 않는다. */ }
      throw new Error('생산 기록 후속 전이는 동기 검증으로 확인해 주세요.');
    }
    delete first.supersededBy; delete last.supersededBy;
  }
  if (options.text(first)!==options.text(last)) throw new Error('생산 기록 업무 원문이 다릅니다.');
}
