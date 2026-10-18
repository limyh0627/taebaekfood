type Row = Record<string, any>;
export const INVENTORY_WRITER_PROTOCOL_VERSION = 1;

/** 같은 거래의 가상 상태가 아니라 최초 조회 값을 받는다. 같은 품목을 두 번 쓰더라도 증가량은 한 번이다. */
export function advanceInventoryWriterProtocol(before: Row | undefined, next: Row): Row {
  const version = before?.inventoryWriterProtocolVersion;
  const revision = before?.inventoryWriteRevision === undefined ? 0 : before.inventoryWriteRevision;
  if (version !== undefined && version !== INVENTORY_WRITER_PROTOCOL_VERSION
    || version === INVENTORY_WRITER_PROTOCOL_VERSION && before?.inventoryWriteRevision === undefined
    || !Number.isSafeInteger(revision) || revision < 0 || !Number.isSafeInteger(revision + 1))
    throw new Error('재고 쓰기 프로토콜과 최초 버전을 확인해 주세요.');
  return { ...next, inventoryWriterProtocolVersion: INVENTORY_WRITER_PROTOCOL_VERSION, inventoryWriteRevision: revision + 1 };
}

/** 원가 메모만 바꿀 때는 재고 효과로 세지 않으며 정규화에서 빠진 기존 봉쇄 표식을 보존한다. */
export function preserveInventoryWriterProtocol(before: Row | undefined, next: Row): Row {
  const result = { ...next };
  for (const field of ['inventoryWriterProtocolVersion', 'inventoryWriteRevision']) {
    if (before?.[field] !== undefined) result[field] = before[field];
    else delete result[field];
  }
  return result;
}

const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
export const inventoryWriterSame=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
/** 초기 snapshot을 넘긴다. 같은 거래의 virtual 명령들이 문서 revision을 각각 올리지 않는다. */
export function protectInventoryWriterPatch(before:Record<string,any>|undefined,next:Record<string,any>,keys?:readonly string[]):Record<string,any>{
 const fields=keys??Object.keys(next).filter(key=>key!=='inventoryWriterProtocolVersion'&&key!=='inventoryWriteRevision');
 const changed=!before||!keys||fields.some(key=>key in next&&!inventoryWriterSame(key.split('.').reduce((value,part)=>value?.[part],before),next[key]));
 return changed?advanceInventoryWriterProtocol(before,next):preserveInventoryWriterProtocol(before,next);
}
