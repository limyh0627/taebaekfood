type Row = Record<string, any>;
export const INVENTORY_WRITER_PROTOCOL_VERSION = 1;

/** 같은 거래의 가상 상태가 아니라 최초 조회 값을 받는다. 같은 품목을 두 번 쓰더라도 증가량은 한 번이다. */
export function advanceInventoryWriterProtocol(before: Row | undefined, next: Row): Row {
  // 단순 버전 확인은 이미 부족한 옛 재고의 업무 변경이 아니다.
  const own = (row:Row | undefined,key:string) => !!row && Object.prototype.hasOwnProperty.call(row,key);
  const relevant = ['stock','inventoryReservations','fullReservationRows','serverReservedStockFloorV1'];
  if ((own(before,'serverReservedStockFloorV1') || own(next,'serverReservedStockFloorV1'))
    && relevant.some(key => own(next,key) && !inventoryWriterSame(before?.[key],next[key]))) {
    const after = {...before,...next}, rows = after.fullReservationRows ?? [], actual = after.inventoryReservations ?? [];
    const milli=(n:any) => typeof n==='number' && Number.isFinite(n) && n>=0 && !Object.is(n,-0)
      && Number.isSafeInteger(Math.round(n*1000)) && Math.round(n*1000)/1000===n ? Math.round(n*1000) : NaN;
    let sum=0; const seen=new Set<string>();
    if (!Array.isArray(rows) || !Array.isArray(actual)) throw new Error('다른 주문의 예약 재고를 확인해 주세요.');
    for (const row of rows) {
      const qty=milli(row?.qty), key=JSON.stringify(canonical(row));
      if (!row || row.serverProtocol!=='full-v1' || !['allocated','processing'].includes(row.state)
        || !(qty>0) || seen.has(key) || actual.filter((entry:any)=>inventoryWriterSame(entry,row)).length!==1)
        throw new Error('다른 주문의 예약 재고를 확인해 주세요.');
      seen.add(key);sum+=qty;
    }
    if (!Number.isSafeInteger(sum) || milli(after.serverReservedStockFloorV1)!==sum || !(milli(after.stock)>=sum))
      throw new Error('다른 주문의 예약 재고를 침범할 수 없습니다.');
  }
  const version = before?.inventoryWriterProtocolVersion;
  const revision = before?.inventoryWriteRevision === undefined ? 0 : before.inventoryWriteRevision;
  if (version !== undefined && version !== INVENTORY_WRITER_PROTOCOL_VERSION
    || version === INVENTORY_WRITER_PROTOCOL_VERSION && before?.inventoryWriteRevision === undefined
    || !Number.isSafeInteger(revision) || revision < 0 || !Number.isSafeInteger(revision + 1))
    throw new Error('재고 쓰기 프로토콜과 최초 버전을 확인해 주세요.');
  const result = { ...next };
  if (before && Object.prototype.hasOwnProperty.call(before,'rawReversePermitRefV1') && !Object.prototype.hasOwnProperty.call(next,'rawReversePermitRefV1')) result.rawReversePermitRefV1=before.rawReversePermitRefV1;
  return { ...result, inventoryWriterProtocolVersion: INVENTORY_WRITER_PROTOCOL_VERSION, inventoryWriteRevision: revision + 1 };
}

/** 원가 메모만 바꿀 때는 재고 효과로 세지 않으며 정규화에서 빠진 기존 봉쇄 표식을 보존한다. */
export function preserveInventoryWriterProtocol(before: Row | undefined, next: Row): Row {
  const result = { ...next };
  for (const field of ['inventoryWriterProtocolVersion', 'inventoryWriteRevision', 'rawReversePermitRefV1']) {
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
 const protectedChanged=!!before&&(Object.prototype.hasOwnProperty.call(before,'serverReservedStockFloorV1')||Object.prototype.hasOwnProperty.call(next,'serverReservedStockFloorV1'))&&['serverReservedStockFloorV1','fullReservationRows'].some(key=>Object.prototype.hasOwnProperty.call(next,key)&&!inventoryWriterSame(before[key],next[key]));
 const changed=!before||!keys||protectedChanged||fields.some(key=>key in next&&!inventoryWriterSame(key.split('.').reduce((value,part)=>value?.[part],before),next[key]));
 return changed?advanceInventoryWriterProtocol(before,next):preserveInventoryWriterProtocol(before,next);
}
